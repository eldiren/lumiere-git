// Pure parsers for git plumbing/porcelain output. No I/O here so they're easy to test.
import type {
  ChangeStatus,
  Commit,
  DiffHunk,
  DiffLine,
  DiffLineSelection,
  FileChange,
  FileDiff,
  Ref,
  Stash,
  WorkingStatus,
} from "../shared/types";

export const FS = "\x1f";
export const RS = "\x1e";

export const LOG_FORMAT = `${RS}%H${FS}%P${FS}%an${FS}%ae${FS}%at${FS}%cn${FS}%ce${FS}%ct${FS}%s${FS}%b`;

export function parseLog(out: string): Commit[] {
  const commits: Commit[] = [];
  for (const rec of out.split(RS)) {
    if (!rec) continue;
    const f = rec.split(FS);
    if (f.length < 10) continue;
    commits.push({
      hash: f[0],
      parents: f[1] ? f[1].split(" ") : [],
      author: { name: f[2], email: f[3], date: Number(f[4]) },
      committer: { name: f[5], email: f[6], date: Number(f[7]) },
      subject: f[8],
      // Body may itself contain the field separator in pathological cases; rejoin.
      body: f.slice(9).join(FS).replace(/\n+$/, ""),
    });
  }
  return commits;
}

export const REF_FORMAT = [
  "%(refname)",
  "%(objectname)",
  "%(*objectname)",
  "%(upstream:short)",
  "%(upstream:track,nobracket)",
  "%(HEAD)",
  "%(symref)",
].join("%1f");

function parseTrack(track: string): {
  ahead: number;
  behind: number;
  gone: boolean;
} {
  const ahead = /ahead (\d+)/.exec(track);
  const behind = /behind (\d+)/.exec(track);
  return {
    ahead: ahead ? Number(ahead[1]) : 0,
    behind: behind ? Number(behind[1]) : 0,
    gone: track.includes("gone"),
  };
}

export function parseRefs(out: string): {
  branches: Ref[];
  remotes: Ref[];
  tags: Ref[];
} {
  const branches: Ref[] = [];
  const remotes: Ref[] = [];
  const tags: Ref[] = [];
  for (const line of out.split("\n")) {
    if (!line) continue;
    const [name, oid, peeled, upstream, track, head, symref] = line.split(FS);
    if (name.startsWith("refs/heads/")) {
      const t = parseTrack(track ?? "");
      branches.push({
        name,
        shortName: name.slice("refs/heads/".length),
        kind: "branch",
        hash: oid,
        upstream: upstream || undefined,
        ahead: t.ahead,
        behind: t.behind,
        upstreamGone: t.gone,
        isHead: head === "*",
      });
    } else if (name.startsWith("refs/remotes/")) {
      // Skip origin/HEAD symbolic refs.
      if (symref) continue;
      const short = name.slice("refs/remotes/".length);
      const slash = short.indexOf("/");
      remotes.push({
        name,
        shortName: short,
        kind: "remote",
        hash: oid,
        remote: slash > 0 ? short.slice(0, slash) : short,
      });
    } else if (name.startsWith("refs/tags/")) {
      tags.push({
        name,
        shortName: name.slice("refs/tags/".length),
        kind: "tag",
        hash: peeled || oid,
      });
    }
  }
  return { branches, remotes, tags };
}

export const STASH_FORMAT = `%H${FS}%P${FS}%gd${FS}%ct${FS}%gs`;

export function parseStashList(out: string): Stash[] {
  const stashes: Stash[] = [];
  for (const line of out.split("\n")) {
    if (!line) continue;
    const [hash, parents, ref, date, message] = line.split(FS);
    const m = /\{(\d+)\}/.exec(ref);
    stashes.push({
      index: m ? Number(m[1]) : stashes.length,
      ref,
      hash,
      parents: parents ? parents.split(" ") : [],
      date: Number(date),
      message: message ?? "",
    });
  }
  return stashes;
}

function normStatus(c: string): ChangeStatus {
  switch (c[0]) {
    case "A":
    case "M":
    case "D":
    case "R":
    case "C":
    case "T":
    case "U":
    case "?":
      return c[0] as ChangeStatus;
    default:
      return "M";
  }
}

/** Parse `git status --porcelain=v2 --branch -z`. */
export function parseStatusV2(
  out: string,
): Omit<WorkingStatus, "state" | "pendingMessage"> {
  const res: Omit<WorkingStatus, "state" | "pendingMessage"> = {
    branch: null,
    headHash: null,
    upstream: null,
    ahead: 0,
    behind: 0,
    staged: [],
    unstaged: [],
    conflicted: [],
  };
  const parts = out.split("\0");
  for (let i = 0; i < parts.length; i++) {
    const entry = parts[i];
    if (!entry) continue;
    if (entry.startsWith("# ")) {
      const [, key, ...rest] = entry.split(" ");
      const val = rest.join(" ");
      if (key === "branch.oid") res.headHash = val === "(initial)" ? null : val;
      else if (key === "branch.head")
        res.branch = val === "(detached)" ? null : val;
      else if (key === "branch.upstream") res.upstream = val;
      else if (key === "branch.ab") {
        const m = /\+(\d+) -(\d+)/.exec(val);
        if (m) {
          res.ahead = Number(m[1]);
          res.behind = Number(m[2]);
        }
      }
      continue;
    }
    const type = entry[0];
    if (type === "1" || type === "2") {
      const fields = entry.split(" ");
      const xy = fields[1];
      const nFields = type === "1" ? 8 : 9;
      const path = fields.slice(nFields).join(" ");
      let oldPath: string | undefined;
      if (type === "2") oldPath = parts[++i];
      const x = xy[0];
      const y = xy[1];
      if (x !== ".")
        res.staged.push({
          path,
          status: normStatus(x),
          ...(type === "2" && { oldPath }),
        });
      if (y !== ".") res.unstaged.push({ path, status: normStatus(y) });
    } else if (type === "u") {
      const fields = entry.split(" ");
      const path = fields.slice(10).join(" ");
      res.conflicted.push({ path, status: "U" });
    } else if (type === "?") {
      res.unstaged.push({ path: entry.slice(2), status: "?" });
    }
  }
  return res;
}

/** Parse `--name-status -z` output. */
export function parseNameStatus(out: string): FileChange[] {
  const parts = out.split("\0");
  const files: FileChange[] = [];
  for (let i = 0; i < parts.length; i++) {
    const code = parts[i];
    if (!code) continue;
    const status = normStatus(code);
    if (status === "R" || status === "C") {
      const oldPath = parts[++i];
      const path = parts[++i];
      files.push({ path, oldPath, status });
    } else {
      files.push({ path: parts[++i], status });
    }
  }
  return files;
}

/** Parse `--numstat -z` output into a map keyed by (new) path. */
export function parseNumstat(
  out: string,
): Map<string, { additions: number; deletions: number; binary: boolean }> {
  const map = new Map<
    string,
    { additions: number; deletions: number; binary: boolean }
  >();
  const parts = out.split("\0");
  for (let i = 0; i < parts.length; i++) {
    const rec = parts[i];
    if (!rec) continue;
    const [a, d, p] = rec.split("\t");
    let path = p;
    if (p === "" || p === undefined) {
      // Rename: path fields follow as separate NUL-terminated entries (old, new).
      i++;
      path = parts[++i];
    }
    const binary = a === "-" && d === "-";
    map.set(path, {
      additions: binary ? 0 : Number(a),
      deletions: binary ? 0 : Number(d),
      binary,
    });
  }
  return map;
}

export function mergeNumstat(
  files: FileChange[],
  numstat: ReturnType<typeof parseNumstat>,
): FileChange[] {
  return files.map((f) => {
    const n = numstat.get(f.path);
    return n ? { ...f, ...n } : f;
  });
}

const HUNK_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/;

/** Parse a unified diff (as produced by `git diff`) into per-file structures. */
export function parseDiff(text: string, encoding = "UTF-8"): FileDiff[] {
  const files: FileDiff[] = [];
  let file: FileDiff | null = null;
  let hunk: DiffHunk | null = null;
  let oldLine = 0;
  let newLine = 0;

  const lines = text.split("\n");
  // A trailing newline yields an empty last element that isn't a diff line.
  if (lines.length && lines[lines.length - 1] === "") lines.pop();

  for (const line of lines) {
    if (line.startsWith("diff --git ")) {
      const m = /^diff --git "?a\/(.+?)"? "?b\/(.+?)"?$/.exec(line);
      file = { path: m ? m[2] : "", binary: false, hunks: [], encoding };
      if (m && m[1] !== m[2]) file.oldPath = m[1];
      files.push(file);
      hunk = null;
      continue;
    }
    if (!file) continue;
    if (
      !hunk ||
      !(
        line[0] === " " ||
        line[0] === "+" ||
        line[0] === "-" ||
        line[0] === "\\"
      )
    ) {
      if (line.startsWith("@@")) {
        const m = HUNK_RE.exec(line);
        if (!m) continue;
        hunk = {
          header: line,
          oldStart: Number(m[1]),
          oldLines: m[2] === undefined ? 1 : Number(m[2]),
          newStart: Number(m[3]),
          newLines: m[4] === undefined ? 1 : Number(m[4]),
          lines: [],
        };
        oldLine = hunk.oldStart;
        newLine = hunk.newStart;
        file.hunks.push(hunk);
        continue;
      }
      if (line.startsWith("new file mode ")) {
        file.isNew = true;
        file.mode = line.slice("new file mode ".length);
      } else if (line.startsWith("deleted file mode ")) {
        file.isDeleted = true;
        file.mode = line.slice("deleted file mode ".length);
      }
      else if (line.startsWith("rename from "))
        file.oldPath = line.slice("rename from ".length);
      else if (line.startsWith("rename to "))
        file.path = line.slice("rename to ".length);
      else if (
        line.startsWith("Binary files ") ||
        line.startsWith("GIT binary patch")
      )
        file.binary = true;
      else if (line.startsWith("+++ ") && !file.path) file.path = line.slice(6);
      continue;
    }
    // Inside a hunk.
    let dl: DiffLine;
    const content = line.slice(1);
    if (line[0] === "+") dl = { type: "add", content, newLine: newLine++ };
    else if (line[0] === "-") dl = { type: "del", content, oldLine: oldLine++ };
    else if (line[0] === "\\") dl = { type: "noeol", content: line.slice(2) };
    else
      dl = { type: "context", content, oldLine: oldLine++, newLine: newLine++ };
    hunk.lines.push(dl);
  }
  return files;
}

/**
 * Patch header for one file. Creations and deletions need their mode line: without it
 * `git apply` reads `/dev/null` as a path.
 */
function patchHeader(
  diff: FileDiff,
  oldPath: string,
  created: boolean,
  deleted: boolean,
): string[] {
  const mode = diff.mode ?? "100644";
  return [
    `diff --git a/${oldPath} b/${diff.path}`,
    ...(created ? [`new file mode ${mode}`] : []),
    ...(deleted ? [`deleted file mode ${mode}`] : []),
    created ? "--- /dev/null" : `--- a/${oldPath}`,
    deleted ? "+++ /dev/null" : `+++ b/${diff.path}`,
  ];
}

function patchLine(l: DiffLine, type = l.type): string {
  switch (type) {
    case "add":
      return "+" + l.content;
    case "del":
      return "-" + l.content;
    case "noeol":
      return "\\ " + l.content;
    default:
      return " " + l.content;
  }
}

/**
 * Rebuild a patch for a single hunk of a file, suitable for `git apply --cached`.
 * `reverse` is handled by git (`-R`), so we emit the hunk as-is.
 */
export function buildHunkPatch(diff: FileDiff, hunkIndex: number): string {
  const hunk = diff.hunks[hunkIndex];
  if (!hunk) throw new Error(`No hunk ${hunkIndex}`);
  const header = patchHeader(
    diff,
    diff.oldPath ?? diff.path,
    !!diff.isNew,
    !!diff.isDeleted,
  );
  const body = hunk.lines.map((l) => patchLine(l));
  return [...header, hunk.header, ...body].join("\n") + "\n";
}

/**
 * Build a patch that carries only the selected lines of a file's diff, or null when the
 * selection holds no changed line.
 *
 * The patch has to match the side it is applied to. Applied forward (stage) that is the old
 * side, so an unselected deletion stays as context and an unselected addition is left out.
 * Applied with `-R` (unstage, discard) it is the new side, so it is the other way round.
 */
export function buildLinesPatch(
  diff: FileDiff,
  selection: DiffLineSelection,
  reverse: boolean,
): string | null {
  const oldSel = new Set(selection.old);
  const newSel = new Set(selection.new);
  // A hunk without lines on one side is numbered from the line before it.
  const position = (start: number, count: number) =>
    count === 0 ? start + 1 : start;
  const range = (pos: number, count: number) =>
    `${count === 0 ? pos - 1 : pos},${count}`;

  const hunks: string[] = [];
  let delta = 0;
  let oldTotal = 0;
  let newTotal = 0;
  for (const h of diff.hunks) {
    const body: string[] = [];
    let oldCount = 0;
    let newCount = 0;
    let changed = false;
    // Whether the previous line made it into the patch (a "no newline" marker follows its line).
    let kept = false;
    for (const l of h.lines) {
      if (l.type === "noeol") {
        if (kept) body.push(patchLine(l));
        continue;
      }
      const selected =
        l.type === "add"
          ? newSel.has(l.newLine!)
          : l.type === "del" && oldSel.has(l.oldLine!);
      const asContext =
        l.type === "context" ||
        (!selected && (l.type === "add") === reverse);
      kept = selected || asContext;
      if (!kept) continue;
      body.push(patchLine(l, asContext ? "context" : l.type));
      if (asContext || l.type === "del") oldCount++;
      if (asContext || l.type === "add") newCount++;
      if (selected) changed = true;
    }
    if (!changed) continue;
    // The side the patch applies to keeps its place; the other shifts by what earlier hunks did.
    const oldPos = reverse
      ? position(h.newStart, h.newLines) - delta
      : position(h.oldStart, h.oldLines);
    const newPos = oldPos + delta;
    delta += newCount - oldCount;
    oldTotal += oldCount;
    newTotal += newCount;
    hunks.push(
      `@@ -${range(oldPos, oldCount)} +${range(newPos, newCount)} @@`,
      ...body,
    );
  }
  if (!hunks.length) return null;
  // Lines left behind turn a creation or deletion into a plain modification. The file exists
  // under its new name on the side being patched, so a rename plays no part either.
  const header = patchHeader(
    diff,
    diff.path,
    !!diff.isNew && oldTotal === 0,
    !!diff.isDeleted && newTotal === 0,
  );
  return [...header, ...hunks].join("\n") + "\n";
}
