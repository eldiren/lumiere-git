import { spawn } from "node:child_process";
import { isMissingLfsError, MISSING_LFS_MESSAGE } from "./binary";

export class GitError extends Error {
  constructor(
    message: string,
    public readonly args: string[],
    public readonly exitCode: number | null,
    public readonly stderr: string,
  ) {
    super(message);
    this.name = "GitError";
  }
}

export interface ExecOptions {
  cwd: string;
  input?: string | Buffer;
  /** Exit codes treated as success (default [0]). */
  okCodes?: number[];
  env?: Record<string, string>;
  /** Abort after this many bytes of stdout (output is truncated, not an error). */
  maxBuffer?: number;
  signal?: AbortSignal;
}

export interface ExecResult {
  stdout: Buffer;
  stderr: string;
  exitCode: number;
  truncated: boolean;
}

let gitBinary = process.env.LUMIERE_GIT_PATH || "git";

export function setGitBinary(path: string) {
  gitBinary = path;
}

export function getGitBinary(): string {
  return gitBinary;
}

// The name of the PATH variable as this process has it (`Path` on Windows), so an override replaces it.
const PATH_KEY =
  Object.keys(process.env).find((k) => k.toUpperCase() === "PATH") ?? "PATH";
let searchPath: Record<string, string> = {};

/**
 * PATH for git and everything it runs (filters like `git-lfs`, hooks, credential helpers).
 * A GUI-launched app gets a minimal PATH, so electron/gitManager.ts widens it at startup.
 */
export function setSearchPath(value: string | null) {
  searchPath = value ? { [PATH_KEY]: value } : {};
}

let credentialArgs: string[] = [];
let credentialEnv: Record<string, string> = {};

/** Adds a credential helper after any the user configured (electron/credentials/broker.ts). */
export function setCredentialHelper(
  command: string,
  env: Record<string, string>,
) {
  credentialArgs = ["-c", `credential.helper=${command}`];
  credentialEnv = env;
}

const BASE_ENV: Record<string, string> = {
  // Keep output machine-readable and never block on a prompt.
  LANG: "C",
  LC_ALL: "C",
  GIT_TERMINAL_PROMPT: "0",
  GIT_PAGER: "cat",
  PAGER: "cat",
  GIT_OPTIONAL_LOCKS: "0",
  GIT_EDITOR: "true",
};

export function gitRaw(args: string[], opts: ExecOptions): Promise<ExecResult> {
  const okCodes = opts.okCodes ?? [0];
  return new Promise((resolve, reject) => {
    const child = spawn(
      gitBinary,
      [
        "-c",
        "core.quotepath=off",
        "-c",
        "color.ui=false",
        ...credentialArgs,
        ...args,
      ],
      {
        cwd: opts.cwd,
        env: {
          ...process.env,
          ...searchPath,
          ...BASE_ENV,
          ...credentialEnv,
          ...opts.env,
        },
        stdio: ["pipe", "pipe", "pipe"],
        signal: opts.signal,
        windowsHide: true,
      },
    );
    const out: Buffer[] = [];
    let outLen = 0;
    let truncated = false;
    const err: Buffer[] = [];

    child.stdout.on("data", (chunk: Buffer) => {
      if (truncated) return;
      if (opts.maxBuffer && outLen + chunk.length > opts.maxBuffer) {
        out.push(chunk.subarray(0, opts.maxBuffer - outLen));
        outLen = opts.maxBuffer;
        truncated = true;
        child.kill();
        return;
      }
      out.push(chunk);
      outLen += chunk.length;
    });
    child.stderr.on("data", (chunk: Buffer) => err.push(chunk));
    child.on("error", (e) =>
      reject(new GitError(`Failed to run git: ${e.message}`, args, null, "")),
    );
    child.on("close", (code) => {
      const stderr = Buffer.concat(err).toString("utf8");
      const stdout = Buffer.concat(out);
      if (truncated)
        return resolve({ stdout, stderr, exitCode: code ?? 0, truncated });
      if (code !== null && okCodes.includes(code))
        return resolve({ stdout, stderr, exitCode: code, truncated });
      const msg = isMissingLfsError(stderr)
        ? MISSING_LFS_MESSAGE
        : stderr.trim() ||
        stdout.toString("utf8").trim() ||
        `git ${args[0]} exited with code ${code}`;
      reject(new GitError(msg, args, code, stderr));
    });

    child.stdin.on("error", () => {
      // git may exit before reading stdin; ignore EPIPE.
    });
    if (opts.input !== undefined) child.stdin.end(opts.input);
    else child.stdin.end();
  });
}

export async function git(args: string[], opts: ExecOptions): Promise<string> {
  const res = await gitRaw(args, opts);
  return res.stdout.toString("utf8");
}
