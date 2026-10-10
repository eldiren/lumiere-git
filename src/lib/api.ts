// Typed access to the Electron preload bridge.
import type { Repo } from "../../electron/git/repo";
import type { RepoMethod } from "../../electron/ipc";
import type {
  CredentialAnswer,
  GitInfo,
  HostingAccount,
  HostingProvider,
  HostingRepo,
  HostingSignIn,
  IpcResult,
  Settings,
} from "$shared/types";

interface Bridge {
  platform: string;
  invoke(channel: string, ...args: unknown[]): Promise<IpcResult<unknown>>;
  send(channel: string, ...args: unknown[]): void;
  on(channel: string, listener: (...args: any[]) => void): () => void;
}

declare global {
  interface Window {
    lumiere?: Bridge;
  }
}

function bridge(): Bridge {
  if (!window.lumiere)
    throw new Error("Lumiere bridge unavailable (not running inside Electron)");
  return window.lumiere;
}

export const inElectron = typeof window !== "undefined" && !!window.lumiere;

async function call<T>(channel: string, ...args: unknown[]): Promise<T> {
  const res = (await bridge().invoke(channel, ...args)) as IpcResult<T>;
  if (!res.ok) throw new Error(res.error);
  return res.value;
}

export const app = {
  settings: () => call<Settings>("app:settings"),
  launchPaths: () => call<string[]>("app:launchPaths"),
  setSettings: (patch: Partial<Settings>) =>
    call<Settings>("app:setSettings", patch),
  pickDirectory: (title: string) =>
    call<string | null>("app:pickDirectory", title),
  openExternal: (url: string) => call<void>("app:openExternal", url),
  showInFolder: (p: string) => call<void>("app:showInFolder", p),
  setZoom: (factor: number) => call<number>("app:setZoom", factor),
  openRepo: (dir: string) => call<string>("repo:open", dir),
  closeRepo: (root: string) => call<null>("repo:close", root),
  initRepo: (dir: string) => call<string>("repo:init", dir),
  cloneRepo: (url: string, dir: string) => call<string>("repo:clone", url, dir),
};

/** Finding, downloading and updating the git binary (electron/gitManager.ts). */
export const gitSetup = {
  info: () => call<GitInfo>("git:info"),
  refresh: () => call<GitInfo>("git:refresh"),
  install: () => call<GitInfo>("git:install"),
  checkUpdates: () => call<GitInfo>("git:checkUpdates"),
  locate: () => call<GitInfo | null>("git:locate"),
  resetPath: () => call<GitInfo>("git:resetPath"),
  removeManaged: () => call<GitInfo>("git:removeManaged"),
  installSystemTools: () => call<void>("git:installSystemTools"),
  /** Answer a 'git:credential' request; null cancels the git command that asked. */
  credentialReply: (id: string, answer: CredentialAnswer | null) =>
    call<void>("git:credentialReply", id, answer),
};

/** Hosting accounts (electron/hosting/). Tokens go in, but never come back out. */
export const hosting = {
  accounts: () => call<HostingAccount[]>("hosting:accounts"),
  signIn: (req: HostingSignIn) => call<HostingAccount>("hosting:signIn", req),
  signOut: (provider: HostingProvider) =>
    call<void>("hosting:signOut", provider),
  repos: (provider: HostingProvider, refresh = false) =>
    call<HostingRepo[]>("hosting:repos", provider, refresh),
  openTokenPage: (
    provider: HostingProvider,
    baseUrl?: string,
    organization?: string,
  ) => call<void>("hosting:openTokenPage", provider, baseUrl, organization),
};

type AnyFn = (...args: any[]) => any;
export type RepoApi = {
  [K in RepoMethod]: Repo[K] extends AnyFn
    ? (...args: Parameters<Repo[K]>) => Promise<Awaited<ReturnType<Repo[K]>>>
    : never;
};

export function repoApi(root: string): RepoApi {
  return new Proxy({} as RepoApi, {
    get:
      (_t, method: string) =>
      (...args: unknown[]) =>
        call("repo:call", root, method, ...args),
  });
}

export const pty = {
  available: () => call<{ ok: boolean; error: string | null }>("pty:available"),
  spawn: (id: string, cwd: string, cols: number, rows: number) =>
    call<null>("pty:spawn", id, cwd, cols, rows),
  write: (id: string, data: string) => bridge().send("pty:write", id, data),
  resize: (id: string, cols: number, rows: number) =>
    bridge().send("pty:resize", id, cols, rows),
  kill: (id: string) => bridge().send("pty:kill", id),
};

export function onEvent(
  channel: string,
  listener: (...args: any[]) => void,
): () => void {
  if (!window.lumiere) return () => {};
  return window.lumiere.on(channel, listener);
}
