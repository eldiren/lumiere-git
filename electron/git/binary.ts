import { execFile } from "node:child_process";
import semver from "semver";

// Pure helpers for finding and versioning git binaries. No Electron imports, so tests can load this.

/** Oldest git the parsers are known to work with (porcelain v2, `--end-of-options`, …). */
export const MIN_GIT_VERSION = "2.35.0";

/** `git version 2.51.0.windows.1` → `2.51.0`. */
export function parseGitVersion(out: string): string | null {
  return /(\d+\.\d+\.\d+)/.exec(out)?.[1] ?? null;
}

export function isSupportedVersion(version: string): boolean {
  return semver.valid(version) !== null && semver.gte(version, MIN_GIT_VERSION);
}

/** Runs `<bin> --version`. Resolves to the full version string, or null if the binary is missing or broken. */
export function probeGit(
  bin: string,
  timeoutMs = 5000,
): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(
      bin,
      ["--version"],
      {
        timeout: timeoutMs,
        windowsHide: true,
        env: { ...process.env, LANG: "C", LC_ALL: "C" },
      },
      (err, stdout) => {
        if (err) return resolve(null);
        resolve(stdout.trim().replace(/^git version\s+/, "") || null);
      },
    );
  });
}

/** Numeric parts of a git-for-windows tag or version: `v2.51.0.windows.2` → [2, 51, 0, 2]. */
export function versionParts(tagOrVersion: string): number[] {
  return (tagOrVersion.match(/\d+/g) ?? []).map(Number);
}

/** True when tag `a` is a newer release than `b` (e.g. `v2.51.0.windows.2` > `2.51.0.windows.1`). */
export function isNewerRelease(a: string, b: string): boolean {
  const pa = versionParts(a);
  const pb = versionParts(b);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d > 0;
  }
  return false;
}

export interface GithubAsset {
  name: string;
  browser_download_url: string;
  size: number;
  /** `sha256:<hex>`, present on assets uploaded since mid-2025. */
  digest?: string | null;
}

export interface GithubRelease {
  tag_name: string;
  body?: string | null;
  draft?: boolean;
  prerelease?: boolean;
  assets: GithubAsset[];
}

export interface MinGitAsset {
  tag: string;
  name: string;
  url: string;
  size: number;
  sha256: string;
}

/**
 * Picks the MinGit zip for this CPU from a git-for-windows release and finds its SHA-256,
 * from the asset `digest` or, for older releases, from the hash table in the release notes.
 */
export function pickMinGitAsset(
  release: GithubRelease,
  arch: string,
): MinGitAsset | null {
  const suffix =
    arch === "arm64" ? "arm64" : arch === "ia32" ? "32-bit" : "64-bit";
  // The busybox variants are experimental; skip them.
  const re = new RegExp(`^MinGit-[\\d.]+(?:\\.\\d+)?-${suffix}\\.zip$`);
  const asset = release.assets.find((a) => re.test(a.name));
  if (!asset) return null;
  let sha256 = asset.digest?.startsWith("sha256:")
    ? asset.digest.slice(7)
    : null;
  if (!sha256 && release.body) {
    const escaped = asset.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    sha256 =
      new RegExp(`${escaped}\\s*\\|\\s*([0-9a-f]{64})`, "i").exec(
        release.body,
      )?.[1] ?? null;
  }
  if (!sha256) return null;
  return {
    tag: release.tag_name,
    name: asset.name,
    url: asset.browser_download_url,
    size: asset.size,
    sha256: sha256.toLowerCase(),
  };
}

/**
 * Joins PATH lists (each may itself be delimiter-separated) into one, dropping blanks and
 * later duplicates. Duplicates are compared case-insensitively on Windows.
 */
export function mergeSearchPath(
  parts: (string | null | undefined)[],
  delimiter: string,
  caseInsensitive = false,
): string {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of parts) {
    for (const dir of (part ?? "").split(delimiter)) {
      const d = dir.trim();
      const key = caseInsensitive ? d.toLowerCase() : d;
      if (!d || seen.has(key)) continue;
      seen.add(key);
      out.push(d);
    }
  }
  return out.join(delimiter);
}

/** Pulls the PATH printed between `marker`s out of a login shell's (possibly noisy) output. */
export function parseShellPath(output: string, marker: string): string | null {
  const start = output.indexOf(marker);
  if (start < 0) return null;
  const end = output.indexOf(marker, start + marker.length);
  if (end < 0) return null;
  return output.slice(start + marker.length, end).trim() || null;
}

/** True when git failed because a repo's LFS filter or hook couldn't find `git-lfs`. */
export function isMissingLfsError(stderr: string): boolean {
  return /git-lfs(\.exe)?: (command )?not found|'git-lfs' is not recognized|git-lfs(\.exe)?: No such file|'git-lfs' was not found/i.test(
    stderr,
  );
}

export const MISSING_LFS_MESSAGE =
  "This repository uses Git LFS, but the git-lfs command was not found. Install Git LFS (https://git-lfs.com), then use Help › Git Setup… › Re-detect or restart Lumiere Git.";
