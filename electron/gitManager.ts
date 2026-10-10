import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { BrowserWindow, dialog, net } from "electron";
import type { GitInfo, GitSetupProgress, GitSource } from "./shared/types";
import {
  type GithubRelease,
  isNewerRelease,
  isSupportedVersion,
  mergeSearchPath,
  MIN_GIT_VERSION,
  parseGitVersion,
  parseShellPath,
  pickMinGitAsset,
  probeGit,
} from "./git/binary";
import { git, setGitBinary, setSearchPath } from "./git/exec";
import type { SettingsStore } from "./settings";

// Finds the git binary to use and, on Windows, downloads and updates an app-managed MinGit.
//
// Resolution order: LUMIERE_GIT_PATH > the path picked with "Locate Git…" > managed MinGit > system git.
// Managed installs live in <userData>/git/<tag>/, with current.json naming the active one, so an
// update unpacks next to the old copy and switches only after the new one runs.

const RELEASES_URL =
  "https://api.github.com/repos/git-for-windows/git/releases/latest";
const UPDATE_INTERVAL_MS = 24 * 60 * 60 * 1000;
const CAN_DOWNLOAD = process.platform === "win32";

/** Places a GUI-launched app may not have on PATH (Finder apps don't get the shell's PATH). */
const EXTRA_SYSTEM_CANDIDATES: Record<string, string[]> = {
  darwin: ["/opt/homebrew/bin/git", "/usr/local/bin/git", "/usr/bin/git"],
  win32: [
    path.join(
      process.env.ProgramFiles ?? "C:\\Program Files",
      "Git",
      "cmd",
      "git.exe",
    ),
  ],
  linux: ["/usr/bin/git", "/usr/local/bin/git"],
};

/**
 * Directories added to git's PATH so it can find `git-lfs` and other helpers it runs by name,
 * even when the app was launched from Finder/Explorer with a minimal PATH.
 */
const EXTRA_PATH_DIRS: Record<string, string[]> = {
  darwin: ["/opt/homebrew/bin", "/usr/local/bin"],
  win32: [
    path.join(process.env.ProgramFiles ?? "C:\\Program Files", "Git LFS"),
    path.join(
      process.env.ProgramFiles ?? "C:\\Program Files",
      "Git",
      "mingw64",
      "bin",
    ),
  ],
  linux: ["/usr/local/bin", "/home/linuxbrew/.linuxbrew/bin"],
};

/** PATH as the user's login shell sets it up (macOS/Linux), or null if it can't be read quickly. */
function loginShellPath(): Promise<string | null> {
  if (process.platform === "win32") return Promise.resolve(null);
  const shell =
    process.env.SHELL || (process.platform === "darwin" ? "/bin/zsh" : "/bin/sh");
  const marker = "__LUMIERE_PATH__";
  return new Promise((resolve) => {
    execFile(
      shell,
      ["-ilc", `printf '%s%s%s' '${marker}' "$PATH" '${marker}'`],
      {
        timeout: 5000,
        // Keep oh-my-zsh and friends from prompting or updating.
        env: { ...process.env, DISABLE_AUTO_UPDATE: "true" },
      },
      // A timeout or non-zero exit can still leave a complete PATH on stdout.
      (_err, stdout) => resolve(parseShellPath(String(stdout ?? ""), marker)),
    );
  });
}

export class GitManager {
  private info: GitInfo = {
    source: "none",
    path: null,
    version: null,
    supported: false,
    minVersion: MIN_GIT_VERSION,
    platform: process.platform,
    canDownload: CAN_DOWNLOAD,
    customPath: null,
    managedTag: null,
    update: null,
    warning: null,
    lfsVersion: null,
  };
  private shellPath: Promise<string | null> | null = null;
  private installing: Promise<GitInfo> | null = null;
  private readonly root: string;

  constructor(
    userData: string,
    private settings: SettingsStore,
  ) {
    this.root = path.join(userData, "git");
  }

  get(): GitInfo {
    return this.info;
  }

  /** Picks the git binary and points the exec layer at it. */
  async resolve(): Promise<GitInfo> {
    const managedTag = await this.managedTag();
    const candidates: { source: GitSource; bin: string }[] = [];
    if (process.env.LUMIERE_GIT_PATH)
      candidates.push({ source: "env", bin: process.env.LUMIERE_GIT_PATH });
    const custom = this.settings.get().gitPath;
    if (custom) candidates.push({ source: "custom", bin: custom });
    if (managedTag)
      candidates.push({
        source: "managed",
        bin: this.managedBinary(managedTag),
      });
    candidates.push({ source: "system", bin: "git" });
    for (const bin of EXTRA_SYSTEM_CANDIDATES[process.platform] ?? [])
      candidates.push({ source: "system", bin });

    let warning: string | null = null;
    for (const c of candidates) {
      const version = await probeGit(c.bin);
      if (!version) {
        if (c.source === "custom")
          warning = `The Git you chose (${c.bin}) no longer runs, so auto-detected Git is used instead.`;
        if (c.source === "env")
          warning = `LUMIERE_GIT_PATH (${c.bin}) does not run.`;
        continue;
      }
      setGitBinary(c.bin);
      await this.applySearchPath(c.bin);
      const numeric = parseGitVersion(version) ?? "0.0.0";
      return this.setInfo({
        source: c.source,
        path: c.bin,
        version,
        supported: isSupportedVersion(numeric),
        managedTag,
        customPath: custom,
        warning,
        update: managedTag ? this.info.update : null,
        lfsVersion: await this.probeLfs(),
      });
    }
    setGitBinary("git");
    return this.setInfo({
      source: "none",
      path: null,
      version: null,
      supported: false,
      managedTag,
      customPath: custom,
      warning,
      update: null,
      lfsVersion: null,
    });
  }

  /** Points git's PATH at the login shell's PATH plus common install dirs and git's own dir. */
  private async applySearchPath(bin: string) {
    this.shellPath ??= loginShellPath();
    setSearchPath(
      mergeSearchPath(
        [
          await this.shellPath,
          process.env.PATH ?? process.env.Path,
          path.isAbsolute(bin) ? path.dirname(bin) : null,
          ...(EXTRA_PATH_DIRS[process.platform] ?? []),
        ],
        path.delimiter,
        process.platform === "win32",
      ),
    );
  }

  private async probeLfs(): Promise<string | null> {
    try {
      const out = await git(["lfs", "version"], { cwd: os.homedir() });
      return out.trim() || null;
    } catch {
      return null;
    }
  }

  /** Startup: check for a managed Git update at most once a day, if the user allows it. */
  async maybeCheckForUpdates() {
    const s = this.settings.get();
    if (!CAN_DOWNLOAD || !this.info.managedTag || !s.gitCheckUpdates) return;
    if (Date.now() - s.gitLastUpdateCheck < UPDATE_INTERVAL_MS) return;
    await this.checkForUpdates().catch((e) =>
      console.warn("git update check failed:", e),
    );
  }

  async checkForUpdates(): Promise<GitInfo> {
    if (!CAN_DOWNLOAD)
      throw new Error("Managed Git is only available on Windows");
    const release = await this.latestRelease();
    this.settings.set({ gitLastUpdateCheck: Date.now() });
    const asset = pickMinGitAsset(release, process.arch);
    const current = this.info.managedTag;
    const update =
      asset && (!current || isNewerRelease(asset.tag, current))
        ? { tag: asset.tag, size: asset.size }
        : null;
    return this.setInfo({ update });
  }

  /** Downloads (or updates to) the latest MinGit and switches to it. */
  install(): Promise<GitInfo> {
    this.installing ??= this.doInstall().finally(
      () => (this.installing = null),
    );
    return this.installing;
  }

  private async doInstall(): Promise<GitInfo> {
    if (!CAN_DOWNLOAD)
      throw new Error("Managed Git is only available on Windows");
    const release = await this.latestRelease();
    const asset = pickMinGitAsset(release, process.arch);
    if (!asset)
      throw new Error(
        `No MinGit download with a published checksum found in ${release.tag_name} for ${process.arch}`,
      );

    await fs.mkdir(this.root, { recursive: true });
    const zip = path.join(this.root, `${asset.tag}.zip.part`);
    const staging = path.join(this.root, `${asset.tag}.partial`);
    const dest = path.join(this.root, asset.tag);
    try {
      const sha = await this.download(asset.url, zip, asset.size);
      this.progress({ phase: "verify" });
      if (sha !== asset.sha256)
        throw new Error(
          `Checksum mismatch for ${asset.name}: expected ${asset.sha256}, got ${sha}`,
        );

      this.progress({ phase: "extract" });
      await fs.rm(staging, { recursive: true, force: true });
      await fs.mkdir(staging, { recursive: true });
      await extractZip(zip, staging);
      if (!(await probeGit(path.join(staging, "cmd", "git.exe"))))
        throw new Error("The downloaded Git does not run");
      await fs.rm(dest, { recursive: true, force: true });
      await fs.rename(staging, dest);
      await fs.writeFile(
        path.join(this.root, "current.json"),
        JSON.stringify({ tag: asset.tag }, null, 2),
      );
    } finally {
      await fs.rm(zip, { force: true }).catch(() => {});
      await fs.rm(staging, { recursive: true, force: true }).catch(() => {});
    }

    this.info.update = null;
    const info = await this.resolve();
    this.progress({ phase: "done" });
    // Old versions may still be held open by a running git; whatever fails is retried next time.
    await this.pruneManaged(asset.tag);
    return info;
  }

  /** Removes the managed Git entirely and falls back to the next source. */
  async removeManaged(): Promise<GitInfo> {
    await fs.rm(path.join(this.root, "current.json"), { force: true });
    await this.pruneManaged(null);
    this.info.update = null;
    return this.resolve();
  }

  /** Lets the user pick a git executable. Returns null if they cancel. */
  async locate(): Promise<GitInfo | null> {
    const win = BrowserWindow.getFocusedWindow();
    const opts: Electron.OpenDialogOptions = {
      title: "Locate the git executable",
      properties: ["openFile"],
      filters:
        process.platform === "win32"
          ? [{ name: "git.exe", extensions: ["exe"] }]
          : undefined,
    };
    const res = win
      ? await dialog.showOpenDialog(win, opts)
      : await dialog.showOpenDialog(opts);
    if (res.canceled || !res.filePaths[0]) return null;
    const bin = res.filePaths[0];
    const version = await probeGit(bin);
    if (!version) throw new Error(`${bin} is not a working git executable`);
    this.settings.set({ gitPath: bin });
    return this.resolve();
  }

  /** Forgets the path picked with locate() and goes back to auto-detection. */
  async resetPath(): Promise<GitInfo> {
    this.settings.set({ gitPath: null });
    return this.resolve();
  }

  /** macOS: opens Apple's Command Line Tools installer, which ships git. */
  installSystemTools() {
    if (process.platform !== "darwin")
      throw new Error("Only available on macOS");
    spawn("xcode-select", ["--install"], {
      detached: true,
      stdio: "ignore",
    }).unref();
  }

  private managedBinary(tag: string) {
    return path.join(this.root, tag, "cmd", "git.exe");
  }

  private async managedTag(): Promise<string | null> {
    if (!CAN_DOWNLOAD) return null;
    try {
      const { tag } = JSON.parse(
        await fs.readFile(path.join(this.root, "current.json"), "utf8"),
      );
      return typeof tag === "string" && /^[\w.-]+$/.test(tag) ? tag : null;
    } catch {
      return null;
    }
  }

  private async pruneManaged(keep: string | null) {
    let entries: string[] = [];
    try {
      entries = await fs.readdir(this.root);
    } catch {
      return;
    }
    for (const name of entries) {
      if (name === keep || name === "current.json") continue;
      await fs
        .rm(path.join(this.root, name), { recursive: true, force: true })
        .catch(() => {});
    }
  }

  private async latestRelease(): Promise<GithubRelease> {
    const res = await net.fetch(RELEASES_URL, {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "Lumiere-Git",
      },
    });
    if (!res.ok)
      throw new Error(`Could not reach GitHub releases (HTTP ${res.status})`);
    return (await res.json()) as GithubRelease;
  }

  /** Streams url to file, reporting progress. Resolves to the SHA-256 hex of the bytes written. */
  private async download(
    url: string,
    file: string,
    expectedSize: number,
  ): Promise<string> {
    const res = await net.fetch(url, {
      headers: { "User-Agent": "Lumiere-Git" },
    });
    if (!res.ok || !res.body)
      throw new Error(`Download failed (HTTP ${res.status})`);
    const total = Number(res.headers.get("content-length")) || expectedSize;
    const hash = createHash("sha256");
    const out = createWriteStream(file);
    const reader = res.body.getReader();
    let received = 0;
    let lastReport = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        hash.update(value);
        received += value.length;
        if (!out.write(value))
          await new Promise<void>((r) => out.once("drain", () => r()));
        if (Date.now() - lastReport > 100) {
          lastReport = Date.now();
          this.progress({ phase: "download", received, total });
        }
      }
    } finally {
      await new Promise<void>((resolve, reject) =>
        out.end((e?: Error | null) => (e ? reject(e) : resolve())),
      );
    }
    this.progress({ phase: "download", received, total });
    return hash.digest("hex");
  }

  private setInfo(patch: Partial<GitInfo>): GitInfo {
    this.info = { ...this.info, ...patch };
    broadcast("git:info", this.info);
    return this.info;
  }

  private progress(p: GitSetupProgress) {
    broadcast("git:progress", p);
  }
}

function broadcast(channel: string, payload: unknown) {
  for (const win of BrowserWindow.getAllWindows())
    if (!win.isDestroyed()) win.webContents.send(channel, payload);
}

/** Windows 10 1803+ ships bsdtar, which reads zips; PowerShell is the fallback. */
function extractZip(zip: string, dest: string): Promise<void> {
  const tar = path.join(
    process.env.SystemRoot ?? "C:\\Windows",
    "System32",
    "tar.exe",
  );
  const run = (cmd: string, args: string[]) =>
    new Promise<void>((resolve, reject) =>
      execFile(
        cmd,
        args,
        { windowsHide: true, maxBuffer: 16 * 1024 * 1024 },
        (err, _out, stderr) =>
          err ? reject(new Error(stderr || err.message)) : resolve(),
      ),
    );
  return run(tar, ["-xf", zip, "-C", dest]).catch(() =>
    run("powershell.exe", [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      `Expand-Archive -LiteralPath '${zip.replace(/'/g, "''")}' -DestinationPath '${dest.replace(/'/g, "''")}' -Force`,
    ]),
  );
}
