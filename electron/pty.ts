import fs from "node:fs";
import path from "node:path";
import type { WebContents } from "electron";
import type { IPty } from "node-pty";
import { getGitBinary } from "./git/exec";

// Compiled to CommonJS: node-pty is required lazily so a failed native build doesn't crash the app.

let ptyModule: typeof import("node-pty") | null | undefined;
let loadError: string | null = null;

function loadPty() {
  if (ptyModule !== undefined) return ptyModule;
  try {
    ptyModule = require("node-pty");
  } catch (e) {
    ptyModule = null;
    loadError = (e as Error).message;
    console.warn("node-pty unavailable:", loadError);
  }
  return ptyModule;
}

function defaultShell(): string {
  if (process.platform === "win32")
    return process.env.COMSPEC || "powershell.exe";
  let shell: string;
  try {
    shell = require("default-shell").default ?? require("default-shell");
  } catch {
    shell = process.env.SHELL || "/bin/bash";
  }
  // In a Flatpak, $SHELL names the host's shell, which the sandbox may not have (zsh, fish).
  if (path.isAbsolute(shell) && !fs.existsSync(shell))
    return fs.existsSync("/bin/bash") ? "/bin/bash" : "/bin/sh";
  return shell;
}

/** Puts the git the app uses (managed or user-picked) first on the shell's PATH, so `git` matches the UI. */
function shellEnv(): Record<string, string> {
  const env = {
    ...process.env,
    TERM: "xterm-256color",
    COLORTERM: "truecolor",
  } as Record<string, string>;
  const bin = getGitBinary();
  if (path.isAbsolute(bin)) {
    const key =
      Object.keys(env).find((k) => k.toUpperCase() === "PATH") ?? "PATH";
    env[key] = [path.dirname(bin), env[key]]
      .filter(Boolean)
      .join(path.delimiter);
  }
  return env;
}

const sessions = new Map<string, { pty: IPty; owner: WebContents }>();

export function ptyAvailable(): { ok: boolean; error: string | null } {
  return { ok: !!loadPty(), error: loadError };
}

export function ptySpawn(
  owner: WebContents,
  id: string,
  cwd: string,
  cols: number,
  rows: number,
) {
  const mod = loadPty();
  if (!mod) throw new Error(`Terminal unavailable: ${loadError}`);
  const shell = defaultShell();
  const pty = mod.spawn(shell, [], {
    name: "xterm-256color",
    cols,
    rows,
    cwd,
    env: shellEnv(),
  });
  sessions.set(id, { pty, owner });
  pty.onData((data) => {
    if (!owner.isDestroyed()) owner.send("pty:data", id, data);
  });
  pty.onExit(({ exitCode }) => {
    sessions.delete(id);
    if (!owner.isDestroyed()) owner.send("pty:exit", id, exitCode);
  });
}

export function ptyWrite(id: string, data: string) {
  sessions.get(id)?.pty.write(data);
}

export function ptyResize(id: string, cols: number, rows: number) {
  const s = sessions.get(id);
  if (s && cols > 0 && rows > 0) s.pty.resize(cols, rows);
}

export function ptyKill(id: string) {
  const s = sessions.get(id);
  if (s) {
    s.pty.kill();
    sessions.delete(id);
  }
}

export function ptyKillAll() {
  // Deleting the current key while iterating a Map is safe.
  for (const id of sessions.keys()) ptyKill(id);
}
