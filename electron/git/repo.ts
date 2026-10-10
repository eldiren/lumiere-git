import fs from "node:fs/promises";
import path from "node:path";
import chardet from "chardet";
import iconv from "iconv-lite";
import type {
  Commit,
  CommitDetail,
  DiffLineSelection,
  DiffSource,
  FileContent,
  FileDiff,
  JournalState,
  PullMode,
  RepoRefs,
  RepoState,
  ResetMode,
  WorkingStatus,
} from "../shared/types";
import { git, gitRaw, GitError } from "./exec";
import {
  buildHunkPatch,
  buildLinesPatch,
  LOG_FORMAT,
  mergeNumstat,
  parseDiff,
  parseLog,
  parseNameStatus,
  parseNumstat,
  parseRefs,
  parseStashList,
  parseStatusV2,
  REF_FORMAT,
  STASH_FORMAT,
} from "./parse";
import { Journal } from "./journal";

const MAX_DIFF_BYTES = 8 * 1024 * 1024;

const utf8 = new TextDecoder("utf-8", { fatal: true });

function decode(buf: Buffer): { text: string; encoding: string } {
  if (buf.length === 0) return { text: "", encoding: "UTF-8" };
  try {
    // Valid UTF-8 (which includes plain ASCII) wins over statistical detection.
    return { text: utf8.decode(buf), encoding: "UTF-8" };
  } catch {
    // fall through to detection
  }
  let enc = chardet.detect(buf.subarray(0, 64 * 1024)) ?? "ISO-8859-1";
  if (!iconv.encodingExists(enc)) enc = "ISO-8859-1";
  return { text: iconv.decode(buf, enc), encoding: enc.toUpperCase() };
}

function looksBinary(buf: Buffer) {
  const n = Math.min(buf.length, 8000);
  for (let i = 0; i < n; i++) if (buf[i] === 0) return true;
  return false;
}

export class Repo {
  readonly journal = new Journal();
  private emptyTree: string | null = null;

  constructor(readonly root: string) {}

  static async resolveRoot(dir: string): Promise<string> {
    const out = await git(["rev-parse", "--show-toplevel"], { cwd: dir });
    return out.trim();
  }

  static async init(dir: string, defaultBranch = "main"): Promise<string> {
    await fs.mkdir(dir, { recursive: true });
    await git(["init", "-b", defaultBranch], { cwd: dir });
    return Repo.resolveRoot(dir);
  }

  static async clone(url: string, dir: string): Promise<string> {
    await git(["clone", "--", url, dir], { cwd: path.dirname(dir) });
    return Repo.resolveRoot(dir);
  }

  private run(
    args: string[],
    opts: { input?: string | Buffer; okCodes?: number[] } = {},
  ) {
    return git(args, { cwd: this.root, ...opts });
  }

  private async gitDir(): Promise<string> {
    const out = await this.run(["rev-parse", "--absolute-git-dir"]);
    return out.trim();
  }

  private async headHash(): Promise<string | null> {
    try {
      return (
        (await this.run(["rev-parse", "--verify", "-q", "HEAD"])).trim() || null
      );
    } catch {
      return null;
    }
  }

  private async getEmptyTree(): Promise<string> {
    if (!this.emptyTree) {
      this.emptyTree = (
        await this.run(["hash-object", "-t", "tree", "--stdin"], { input: "" })
      ).trim();
    }
    return this.emptyTree;
  }

  // ---------------------------------------------------------------- reading

  async log(opts: { skip?: number; limit?: number } = {}): Promise<Commit[]> {
    const args = [
      "log",
      "--date-order",
      `--format=${LOG_FORMAT}`,
      "--branches",
      "--remotes",
      "--tags",
    ];
    if (await this.headHash()) args.push("HEAD");
    else if (!(await this.hasAnyRefs())) return [];
    if (opts.skip) args.push(`--skip=${opts.skip}`);
    if (opts.limit) args.push(`-n${opts.limit}`);
    args.push("--");
    return parseLog(await this.run(args));
  }

  private async hasAnyRefs() {
    const out = await this.run([
      "for-each-ref",
      "--count=1",
      "refs/heads",
      "refs/remotes",
      "refs/tags",
    ]);
    return out.trim().length > 0;
  }

  async refs(): Promise<RepoRefs> {
    const [refOut, headOut, stashOut, remoteOut] = await Promise.all([
      this.run([
        "for-each-ref",
        `--format=${REF_FORMAT}`,
        "refs/heads",
        "refs/remotes",
        "refs/tags",
      ]),
      this.run(["symbolic-ref", "-q", "--short", "HEAD"], { okCodes: [0, 1] }),
      this.run(["stash", "list", `--format=${STASH_FORMAT}`], {
        okCodes: [0, 1],
      }).catch(() => ""),
      this.run(["remote"]),
    ]);
    const { branches, remotes, tags } = parseRefs(refOut);
    const hash = await this.headHash();
    const branch = headOut.trim() || null;
    return {
      head: { branch, hash, detached: !branch, unborn: !hash },
      branches,
      remotes,
      tags,
      stashes: parseStashList(stashOut),
      remoteNames: remoteOut.split("\n").filter(Boolean),
    };
  }

  async state(): Promise<{ state: RepoState; pendingMessage: string | null }> {
    const dir = await this.gitDir();
    const exists = (p: string) =>
      fs.access(path.join(dir, p)).then(
        () => true,
        () => false,
      );
    let state: RepoState = "clean";
    if ((await exists("rebase-merge")) || (await exists("rebase-apply")))
      state = "rebasing";
    else if (await exists("MERGE_HEAD")) state = "merging";
    else if (await exists("CHERRY_PICK_HEAD")) state = "cherry-picking";
    else if (await exists("REVERT_HEAD")) state = "reverting";
    else if (await exists("BISECT_LOG")) state = "bisecting";
    let pendingMessage: string | null = null;
    if (state !== "clean") {
      pendingMessage = await fs
        .readFile(path.join(dir, "MERGE_MSG"), "utf8")
        .then((t) =>
          t
            .split("\n")
            .filter((l) => !l.startsWith("#"))
            .join("\n")
            .trim(),
        )
        .catch(() => null);
    }
    return { state, pendingMessage };
  }

  async status(): Promise<WorkingStatus> {
    const out = await this.run([
      "status",
      "--porcelain=v2",
      "--branch",
      "-z",
      "--untracked-files=all",
    ]);
    const parsed = parseStatusV2(out);
    const st = await this.state();
    return { ...parsed, ...st };
  }

  async commitDetail(hash: string): Promise<CommitDetail> {
    const out = await this.run([
      "log",
      "-1",
      `--format=${LOG_FORMAT}`,
      hash,
      "--",
    ]);
    const [commit] = parseLog(out);
    if (!commit) throw new Error(`Commit ${hash} not found`);
    const base = commit.parents[0] ?? (await this.getEmptyTree());
    const [ns, num] = await Promise.all([
      this.run([
        "diff-tree",
        "-r",
        "-z",
        "-M",
        "--no-commit-id",
        "--name-status",
        base,
        hash,
      ]),
      this.run([
        "diff-tree",
        "-r",
        "-z",
        "-M",
        "--no-commit-id",
        "--numstat",
        base,
        hash,
      ]),
    ]);
    return {
      commit,
      files: mergeNumstat(parseNameStatus(ns), parseNumstat(num)),
    };
  }

  async diffFile(
    source: DiffSource,
    file: string,
    oldPath?: string,
    context = 3,
  ): Promise<FileDiff> {
    const res = await this.diffRaw(source, file, oldPath, context);
    const { text, encoding } = decode(res.stdout);
    return this.toFileDiff(source, file, text, encoding, res.truncated);
  }

  private async diffRaw(
    source: DiffSource,
    file: string,
    oldPath?: string,
    context = 3,
  ) {
    const paths = oldPath && oldPath !== file ? [oldPath, file] : [file];
    let args: string[];
    const common = ["--no-color", "--no-ext-diff", "-M", `-U${context}`];
    let okCodes = [0];
    if (source.kind === "commit") {
      const base =
        source.parent ??
        (await this.commitParent(source.hash)) ??
        (await this.getEmptyTree());
      args = ["diff", ...common, base, source.hash, "--", ...paths];
    } else if (source.kind === "staged") {
      args = ["diff", "--cached", ...common, "--", ...paths];
    } else if (source.untracked) {
      args = ["diff", "--no-index", ...common, "--", "/dev/null", file];
      okCodes = [0, 1];
    } else {
      args = ["diff", ...common, "--", ...paths];
    }
    return gitRaw(args, {
      cwd: this.root,
      okCodes,
      maxBuffer: MAX_DIFF_BYTES,
    });
  }

  private toFileDiff(
    source: DiffSource,
    file: string,
    text: string,
    encoding: string,
    truncated: boolean,
  ): FileDiff {
    const [diff] = parseDiff(text, encoding);
    const result: FileDiff = diff ?? {
      path: file,
      binary: false,
      hunks: [],
      encoding,
    };
    // --no-index reports the path as given; normalise.
    result.path = file;
    if (source.kind === "unstaged" && source.untracked) {
      result.isNew = true;
      delete result.oldPath;
    }
    if (truncated) result.tooLarge = true;
    return result;
  }

  /**
   * The diff to build a patch from. It is read as latin1, one character per byte, so a patch
   * made from it and written back the same way matches the file whatever its encoding.
   */
  private async patchDiff(source: DiffSource, file: string): Promise<FileDiff> {
    const res = await this.diffRaw(source, file);
    return this.toFileDiff(
      source,
      file,
      res.stdout.toString("latin1"),
      "latin1",
      res.truncated,
    );
  }

  private async applyPatch(
    patch: string,
    action: "stage" | "unstage" | "discard",
  ) {
    const args = ["apply", "--whitespace=nowarn", "--recount"];
    if (action === "stage") args.push("--cached");
    else if (action === "unstage") args.push("--cached", "-R");
    else args.push("-R");
    args.push("-");
    await this.run(args, { input: Buffer.from(patch, "latin1") });
  }

  private async commitParent(hash: string): Promise<string | null> {
    const out = await this.run(["rev-list", "--parents", "-n1", hash]);
    const [, first] = out.trim().split(" ");
    return first ?? null;
  }

  /** Read a file at a revision ('' / undefined = working tree, ':' = index). */
  async readFile(file: string, rev?: string): Promise<FileContent> {
    let buf: Buffer;
    if (!rev) {
      const abs = path.resolve(this.root, file);
      if (!abs.startsWith(this.root))
        throw new Error("Path outside repository");
      buf = await fs.readFile(abs);
    } else {
      const spec = rev === ":" ? `:${file}` : `${rev}:${file}`;
      buf = (
        await gitRaw(["show", spec], {
          cwd: this.root,
          maxBuffer: MAX_DIFF_BYTES,
        })
      ).stdout;
    }
    if (looksBinary(buf)) return { text: "", encoding: "binary", binary: true };
    const { text, encoding } = decode(buf);
    return { text, encoding, binary: false };
  }

  journalState(): JournalState {
    return this.journal.state();
  }

  // ---------------------------------------------------------------- index

  async stage(paths: string[]) {
    if (!paths.length) return;
    await this.run(["add", "-A", "--", ...paths]);
  }

  async stageAll() {
    await this.run(["add", "-A"]);
  }

  async unstage(paths: string[]) {
    if (!paths.length) return;
    if (await this.headHash())
      await this.run(["reset", "-q", "HEAD", "--", ...paths]);
    else await this.run(["rm", "--cached", "-r", "-q", "--", ...paths]);
  }

  async unstageAll() {
    if (await this.headHash()) await this.run(["reset", "-q", "HEAD"]);
    else
      await this.run(["rm", "--cached", "-r", "-q", "."], {
        okCodes: [0, 128],
      });
  }

  /** Discard working-tree changes. Untracked files are removed. */
  async discard(paths: string[], untracked: string[] = []) {
    if (paths.length) await this.run(["checkout", "--", ...paths]);
    if (untracked.length)
      await this.run(["clean", "-f", "-q", "--", ...untracked]);
  }

  async discardAll() {
    if (await this.headHash())
      await this.run(["reset", "--hard", "-q", "HEAD"]);
    await this.run(["clean", "-fd", "-q"]);
  }

  /** Stage, unstage or discard a single hunk. */
  async applyHunk(
    source: DiffSource,
    file: string,
    hunkIndex: number,
    action: "stage" | "unstage" | "discard",
  ) {
    const diff = await this.patchDiff(source, file);
    await this.applyPatch(buildHunkPatch(diff, hunkIndex), action);
  }

  /** Stage, unstage or discard only the selected lines of a file's diff. */
  async applyLines(
    source: DiffSource,
    file: string,
    selection: DiffLineSelection,
    action: "stage" | "unstage" | "discard",
  ) {
    if (source.kind === "unstaged" && source.untracked) {
      if (action === "unstage") throw new Error("File is not staged");
      return this.applyUntrackedLines(file, new Set(selection.new), action);
    }
    const diff = await this.patchDiff(source, file);
    if (diff.tooLarge)
      throw new Error("The diff is too large to pick lines from");
    const patch = buildLinesPatch(diff, selection, action !== "stage");
    if (!patch) throw new Error("No changed lines selected");
    await this.applyPatch(patch, action);
  }

  /**
   * An untracked file has no index entry to patch, so its lines are picked from the file itself:
   * staging writes the selected lines as the file's blob, discarding removes them from disk.
   */
  private async applyUntrackedLines(
    file: string,
    selected: Set<number>,
    action: "stage" | "discard",
  ) {
    const abs = path.resolve(this.root, file);
    if (!abs.startsWith(this.root)) throw new Error("Path outside repository");
    const stat = await fs.lstat(abs);
    if (!stat.isFile()) throw new Error("Not a regular file");
    const buf = await fs.readFile(abs);
    const picked: Buffer[] = [];
    const rest: Buffer[] = [];
    for (let start = 0, n = 1; start < buf.length; n++) {
      const nl = buf.indexOf(0x0a, start);
      const end = nl === -1 ? buf.length : nl + 1;
      (selected.has(n) ? picked : rest).push(buf.subarray(start, end));
      start = end;
    }
    if (!picked.length) throw new Error("No changed lines selected");
    if (action === "discard") {
      // Nothing left of a file that was never tracked: remove it, as discarding the file does.
      if (rest.length) await fs.writeFile(abs, Buffer.concat(rest));
      else await fs.rm(abs);
      return;
    }
    const hash = (
      await this.run(["hash-object", "-w", "--path", file, "--stdin"], {
        input: Buffer.concat(picked),
      })
    ).trim();
    const mode =
      process.platform !== "win32" && stat.mode & 0o111 ? "100755" : "100644";
    await this.run([
      "update-index",
      "--add",
      "--cacheinfo",
      `${mode},${hash},${file}`,
    ]);
  }

  // ---------------------------------------------------------------- commits

  async commit(message: string, opts: { amend?: boolean } = {}) {
    const before = await this.headHash();
    const args = ["commit", "-F", "-"];
    if (opts.amend) args.push("--amend");
    await this.run(args, { input: message });
    const after = await this.headHash();
    this.journal.push({
      label: opts.amend ? "Amend commit" : "Commit",
      before,
      after,
      undo: before ? ["reset", "--soft", before] : ["update-ref", "-d", "HEAD"],
      redo: ["reset", "--soft", after!],
    });
  }

  async lastCommitMessage(): Promise<string> {
    return (await this.run(["log", "-1", "--format=%B"])).trimEnd();
  }

  // ---------------------------------------------------------------- branches

  private async currentRefName(): Promise<string | null> {
    const out = await this.run(["symbolic-ref", "-q", "--short", "HEAD"], {
      okCodes: [0, 1],
    });
    return out.trim() || null;
  }

  async checkout(target: string, opts: { remote?: boolean } = {}) {
    const prev = (await this.currentRefName()) ?? (await this.headHash());
    const beforeHash = await this.headHash();
    let label = `Checkout ${target}`;
    if (opts.remote) {
      // origin/feature → local feature tracking origin/feature
      const local = target.slice(target.indexOf("/") + 1);
      if (await this.branchExists(local)) await this.run(["checkout", local]);
      else await this.run(["checkout", "-b", local, "--track", target]);
      label = `Checkout ${local}`;
      target = local;
    } else {
      await this.run(["checkout", target]);
    }
    if (prev) {
      this.journal.push({
        label,
        before: beforeHash,
        after: await this.headHash(),
        undo: ["checkout", prev],
        redo: ["checkout", target],
      });
    }
  }

  private async branchExists(name: string) {
    try {
      await this.run(["show-ref", "--verify", "-q", `refs/heads/${name}`]);
      return true;
    } catch {
      return false;
    }
  }

  async createBranch(name: string, start?: string, checkout = true) {
    const beforeRef = await this.currentRefName();
    const before = await this.headHash();
    if (checkout)
      await this.run(["checkout", "-b", name, ...(start ? [start] : [])]);
    else await this.run(["branch", name, ...(start ? [start] : [])]);
    const at = (await this.run(["rev-parse", name])).trim();
    this.journal.push({
      label: `Create branch ${name}`,
      before,
      after: checkout ? at : before,
      undo:
        checkout && beforeRef
          ? [
              ["checkout", beforeRef],
              ["branch", "-D", name],
            ]
          : [["branch", "-D", name]],
      redo: checkout ? [["checkout", "-b", name, at]] : [["branch", name, at]],
    });
  }

  async deleteBranch(name: string, force = false) {
    const at = (await this.run(["rev-parse", `refs/heads/${name}`])).trim();
    await this.run(["branch", force ? "-D" : "-d", name]);
    const head = await this.headHash();
    this.journal.push({
      label: `Delete branch ${name}`,
      before: head,
      after: head,
      undo: ["branch", name, at],
      redo: ["branch", "-D", name],
    });
  }

  async deleteRemoteBranch(remoteRef: string) {
    const slash = remoteRef.indexOf("/");
    await this.run([
      "push",
      remoteRef.slice(0, slash),
      "--delete",
      remoteRef.slice(slash + 1),
    ]);
  }

  async renameBranch(oldName: string, newName: string) {
    await this.run(["branch", "-m", oldName, newName]);
    const head = await this.headHash();
    this.journal.push({
      label: `Rename branch ${oldName}`,
      before: head,
      after: head,
      undo: ["branch", "-m", newName, oldName],
      redo: ["branch", "-m", oldName, newName],
    });
  }

  /** Set (e.g. `origin/main`) or clear (null) the upstream a local branch tracks. */
  async setUpstream(branch: string, upstream: string | null) {
    const cfg = async (key: string) =>
      (
        await this.run(["config", "--get", `branch.${branch}.${key}`], {
          okCodes: [0, 1],
        })
      ).trim();
    const [remote, merge] = [await cfg("remote"), await cfg("merge")];
    const apply: string[] = upstream
      ? ["branch", `--set-upstream-to=${upstream}`, branch]
      : ["branch", "--unset-upstream", branch];
    await this.run(apply);
    const restore: string[][] =
      remote && merge
        ? [
            ["config", `branch.${branch}.remote`, remote],
            ["config", `branch.${branch}.merge`, merge],
          ]
        : [["branch", "--unset-upstream", branch]];
    const head = await this.headHash();
    this.journal.push({
      label: upstream
        ? `Track ${upstream} from ${branch}`
        : `Stop tracking for ${branch}`,
      before: head,
      after: head,
      undo: restore,
      redo: apply,
    });
  }

  /** Operations that move HEAD and can be reversed with `reset --keep`. */
  private async headMoving(label: string, args: string[]) {
    const before = await this.headHash();
    try {
      await this.run(args);
    } finally {
      const after = await this.headHash();
      if (before && after && before !== after) {
        this.journal.push({
          label,
          before,
          after,
          undo: ["reset", "--keep", before],
          redo: ["reset", "--keep", after],
        });
      }
    }
  }

  merge(ref: string, opts: { noFF?: boolean; ffOnly?: boolean } = {}) {
    const args = ["merge", "--no-edit"];
    if (opts.noFF) args.push("--no-ff");
    if (opts.ffOnly) args.push("--ff-only");
    return this.headMoving(`Merge ${ref}`, [...args, ref]);
  }

  rebase(onto: string) {
    return this.headMoving(`Rebase onto ${onto}`, ["rebase", onto]);
  }

  cherryPick(hash: string) {
    return this.headMoving(`Cherry-pick ${hash.slice(0, 7)}`, [
      "cherry-pick",
      hash,
    ]);
  }

  revert(hash: string) {
    return this.headMoving(`Revert ${hash.slice(0, 7)}`, [
      "revert",
      "--no-edit",
      hash,
    ]);
  }

  async reset(hash: string, mode: ResetMode) {
    const before = await this.headHash();
    await this.run(["reset", `--${mode}`, hash]);
    if (before && mode !== "hard") {
      this.journal.push({
        label: `Reset to ${hash.slice(0, 7)}`,
        before,
        after: hash,
        undo: ["reset", `--${mode}`, before],
        redo: ["reset", `--${mode}`, hash],
      });
    }
  }

  async abort(state: RepoState) {
    const cmd: Record<string, string[]> = {
      merging: ["merge", "--abort"],
      rebasing: ["rebase", "--abort"],
      "cherry-picking": ["cherry-pick", "--abort"],
      reverting: ["revert", "--abort"],
      bisecting: ["bisect", "reset"],
    };
    if (cmd[state]) await this.run(cmd[state]);
  }

  async continueOp(state: RepoState) {
    const cmd: Record<string, string[]> = {
      merging: ["commit", "--no-edit"],
      rebasing: ["rebase", "--continue"],
      "cherry-picking": ["cherry-pick", "--continue"],
      reverting: ["revert", "--continue"],
    };
    if (cmd[state])
      await git(cmd[state], { cwd: this.root, env: { GIT_EDITOR: "true" } });
  }

  // ---------------------------------------------------------------- tags

  async createTag(name: string, hash: string, message?: string) {
    if (message)
      await this.run(["tag", "-a", name, hash, "-F", "-"], { input: message });
    else await this.run(["tag", name, hash]);
  }

  /** Deletes the tag locally, and first on each of `remotes` (a remote that doesn't have it is fine). */
  async deleteTag(name: string, remotes: string[] = []) {
    for (const remote of remotes) {
      try {
        await this.run(["push", remote, "--delete", `refs/tags/${name}`]);
      } catch (e) {
        if (
          !(e instanceof GitError) ||
          !/remote ref does not exist/.test(e.stderr)
        )
          throw e;
      }
    }
    await this.run(["tag", "-d", name]);
  }

  async pushTag(name: string, remote = "origin") {
    await this.run(["push", remote, `refs/tags/${name}`]);
  }

  // ---------------------------------------------------------------- remotes

  async fetch(opts: { remote?: string; prune?: boolean } = {}) {
    const args = ["fetch"];
    args.push(opts.remote ?? "--all");
    if (opts.prune !== false) args.push("--prune");
    await this.run(args);
  }

  /** True when a tracked `.gitattributes` (or `.git/info/attributes`) routes files through LFS. */
  async usesLfs(): Promise<boolean> {
    const listed = await this.run([
      "ls-files",
      "-z",
      "--",
      ":(glob)**/.gitattributes",
    ]);
    const files = listed
      .split("\0")
      .filter(Boolean)
      .map((f) => path.join(this.root, f));
    files.push(path.join(await this.gitDir(), "info", "attributes"));
    for (const f of files) {
      const text = await fs.readFile(f, "utf8").catch(() => "");
      if (/\sfilter=lfs\b/.test(text)) return true;
    }
    return false;
  }

  /** Downloads LFS objects for the checked-out commit (or every ref with `all`) without touching files. */
  async lfsFetch(opts: { remote?: string; all?: boolean } = {}) {
    const args = ["lfs", "fetch"];
    if (opts.all) args.push("--all");
    if (opts.remote) args.push(opts.remote);
    await this.run(args);
  }

  /** Downloads LFS objects for the checked-out commit and replaces pointer files with their content. */
  async lfsPull(remote?: string) {
    await this.run(remote ? ["lfs", "pull", remote] : ["lfs", "pull"]);
  }

  pull(mode: PullMode = "ff-only") {
    const flag =
      mode === "ff-only"
        ? "--ff-only"
        : mode === "rebase"
          ? "--rebase"
          : "--no-rebase";
    return this.headMoving("Pull", ["pull", flag]);
  }

  /**
   * Push `branch` (default: the checked-out one). `to` names the branch on `remote` to update
   * when it isn't the upstream / same-named one; `tags` also pushes every local tag.
   */
  async push(
    opts: {
      force?: boolean;
      remote?: string;
      branch?: string;
      to?: string;
      tags?: boolean;
    } = {},
  ) {
    const branch = opts.branch ?? (await this.currentRefName());
    if (!branch) throw new Error("Cannot push from a detached HEAD");
    const upstream = await this.run(
      ["rev-parse", "--abbrev-ref", `${branch}@{upstream}`],
      { okCodes: [0, 128] },
    );
    const args = ["push"];
    if (opts.force) args.push("--force-with-lease");
    if (opts.tags) args.push("--tags");
    const tracked = upstream.trim() && !upstream.includes("fatal");
    if (opts.to) {
      const remotes = (await this.run(["remote"])).split("\n").filter(Boolean);
      const remote =
        opts.remote ?? (remotes.includes("origin") ? "origin" : remotes[0]);
      if (!remote) throw new Error("This repository has no remotes");
      if (!tracked) args.push("-u");
      args.push(remote, `refs/heads/${branch}:refs/heads/${opts.to}`);
    } else if (tracked && opts.branch) {
      // A bare `git push` would push the checked-out branch, so name the refspec.
      const cfg = (key: string) =>
        this.run(["config", "--get", `branch.${branch}.${key}`], {
          okCodes: [0, 1],
        });
      const remote = (await cfg("remote")).trim();
      const merge = (await cfg("merge")).trim();
      if (!opts.remote || opts.remote === remote)
        args.push(remote, `refs/heads/${branch}:${merge}`);
      else args.push("-u", opts.remote, branch);
    } else if (!tracked) {
      const remotes = (await this.run(["remote"])).split("\n").filter(Boolean);
      const remote =
        opts.remote ?? (remotes.includes("origin") ? "origin" : remotes[0]);
      if (!remote) throw new Error("This repository has no remotes");
      args.push("-u", remote, branch);
    }
    await this.run(args);
  }

  /** Add a remote; a separate push URL is set with `remote set-url --push`. */
  async addRemote(name: string, url: string, pushUrl?: string) {
    await this.run(["remote", "add", name, url]);
    if (pushUrl && pushUrl !== url)
      await this.run(["remote", "set-url", "--push", name, pushUrl]);
  }

  async removeRemote(name: string) {
    await this.run(["remote", "remove", name]);
  }

  /** Fetch and push URLs of a remote; `pushUrl` is undefined when it isn't set separately. */
  async remoteInfo(name: string): Promise<{ url: string; pushUrl?: string }> {
    const url = (
      await this.run(["config", "--get", `remote.${name}.url`], {
        okCodes: [0, 1],
      })
    ).trim();
    const pushUrl = (
      await this.run(["config", "--get", `remote.${name}.pushurl`], {
        okCodes: [0, 1],
      })
    ).trim();
    return { url, pushUrl: pushUrl || undefined };
  }

  /** Rename a remote and/or change its URLs. An empty push URL clears a separate one. */
  async editRemote(
    name: string,
    v: { name: string; url: string; pushUrl?: string },
  ) {
    let current = name;
    if (v.name !== name) {
      await this.run(["remote", "rename", name, v.name]);
      current = v.name;
    }
    await this.run(["remote", "set-url", current, v.url]);
    await this.run(["config", "--unset-all", `remote.${current}.pushurl`], {
      okCodes: [0, 5],
    });
    if (v.pushUrl && v.pushUrl !== v.url)
      await this.run(["remote", "set-url", "--push", current, v.pushUrl]);
  }

  /** Check that a URL is a reachable repository by listing its refs. Returns the branch count. */
  async testRemote(url: string): Promise<{ branches: number }> {
    if (!url || url.startsWith("-")) throw new Error("Invalid remote URL");
    const signal = AbortSignal.timeout(30_000);
    try {
      const out = await git(["ls-remote", "--heads", url], {
        cwd: this.root,
        signal,
      });
      return { branches: out.split("\n").filter(Boolean).length };
    } catch (e) {
      if (signal.aborted) throw new Error("Timed out after 30 seconds");
      throw e;
    }
  }

  async remoteUrls(): Promise<Record<string, string>> {
    const out = await this.run(["remote", "-v"]);
    const map: Record<string, string> = {};
    for (const line of out.split("\n")) {
      const m = /^(\S+)\s+(\S+)\s+\(fetch\)/.exec(line);
      if (m) map[m[1]] = m[2];
    }
    return map;
  }

  // ---------------------------------------------------------------- stash

  async stash(message?: string, includeUntracked = true) {
    const args = ["stash", "push"];
    if (includeUntracked) args.push("--include-untracked");
    if (message) args.push("-m", message);
    await this.run(args);
    const hash = (await this.run(["rev-parse", "stash@{0}"])).trim();
    const head = await this.headHash();
    this.journal.push({
      label: "Stash",
      before: head,
      after: head,
      undo: ["stash", "pop", "--index"],
      redo: ["stash", "push", "--include-untracked"],
      stashHash: hash,
    });
  }

  async stashPop(index = 0) {
    await this.run(["stash", "pop", "--index", `stash@{${index}}`]).catch(
      async (e) => {
        // --index fails when the stash's index can't be restored; fall back to a plain pop.
        if (e instanceof GitError && /index/i.test(e.message))
          await this.run(["stash", "pop", `stash@{${index}}`]);
        else throw e;
      },
    );
  }

  async stashApply(index = 0) {
    await this.run(["stash", "apply", `stash@{${index}}`]);
  }

  async stashDrop(index = 0) {
    await this.run(["stash", "drop", `stash@{${index}}`]);
  }

  // ---------------------------------------------------------------- undo / redo

  async undo() {
    const entry = this.journal.peekUndo();
    if (!entry) throw new Error("Nothing to undo");
    const head = await this.headHash();
    if (entry.after !== undefined && head !== entry.after) {
      this.journal.clear();
      throw new Error(
        "The repository changed outside Lumiere Git; undo history was cleared.",
      );
    }
    for (const cmd of Journal.commands(entry.undo)) await this.run(cmd);
    this.journal.didUndo();
    return entry.label;
  }

  async redo() {
    const entry = this.journal.peekRedo();
    if (!entry) throw new Error("Nothing to redo");
    const head = await this.headHash();
    if (entry.before !== undefined && head !== entry.before) {
      this.journal.clear();
      throw new Error(
        "The repository changed outside Lumiere Git; redo history was cleared.",
      );
    }
    for (const cmd of Journal.commands(entry.redo)) await this.run(cmd);
    this.journal.didRedo();
    return entry.label;
  }
}
