import fs from "node:fs";
import path from "node:path";
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  shell,
  type WebContents,
} from "electron";
import type {
  CredentialAnswer,
  HostingProvider,
  HostingSignIn,
  IpcResult,
} from "./shared/types";
import type { CredentialBroker } from "./credentials/broker";
import type { HostingAccounts } from "./hosting/accounts";
import { Repo } from "./git/repo";
import type { GitManager } from "./gitManager";
import { ptyAvailable, ptyKill, ptyResize, ptySpawn, ptyWrite } from "./pty";
import type { SettingsStore } from "./settings";
import { RepoWatcher } from "./watcher";

/** Repo methods the renderer may call. Everything else on Repo is private to main. */
const REPO_METHODS = [
  "log",
  "refs",
  "status",
  "commitDetail",
  "diffFile",
  "readFile",
  "journalState",
  "stage",
  "stageAll",
  "unstage",
  "unstageAll",
  "discard",
  "discardAll",
  "applyHunk",
  "applyLines",
  "commit",
  "lastCommitMessage",
  "checkout",
  "createBranch",
  "deleteBranch",
  "deleteRemoteBranch",
  "renameBranch",
  "setUpstream",
  "merge",
  "rebase",
  "cherryPick",
  "revert",
  "reset",
  "abort",
  "continueOp",
  "createTag",
  "deleteTag",
  "pushTag",
  "fetch",
  "pull",
  "usesLfs",
  "lfsFetch",
  "lfsPull",
  "push",
  "addRemote",
  "removeRemote",
  "remoteUrls",
  "remoteInfo",
  "editRemote",
  "testRemote",
  "stash",
  "stashPop",
  "stashApply",
  "stashDrop",
  "undo",
  "redo",
] as const;

export type RepoMethod = (typeof REPO_METHODS)[number];

interface OpenRepo {
  repo: Repo;
  watcher: RepoWatcher;
  subscribers: Set<WebContents>;
}

const repos = new Map<string, OpenRepo>();

function wrap<A extends unknown[], T>(fn: (...args: A) => Promise<T> | T) {
  return async (
    _e: Electron.IpcMainInvokeEvent,
    ...args: A
  ): Promise<IpcResult<T>> => {
    try {
      return { ok: true, value: await fn(...args) };
    } catch (e) {
      return { ok: false, error: (e as Error).message ?? String(e) };
    }
  };
}

async function openRepo(dir: string, owner: WebContents): Promise<string> {
  const root = path.resolve(await Repo.resolveRoot(dir));
  let entry = repos.get(root);
  if (!entry) {
    const repo = new Repo(root);
    const subscribers = new Set<WebContents>();
    const watcher = new RepoWatcher(root, (info) => {
      for (const wc of subscribers)
        if (!wc.isDestroyed()) wc.send("repo:changed", root, info);
    });
    watcher.start();
    entry = { repo, watcher, subscribers };
    repos.set(root, entry);
  }
  entry.subscribers.add(owner);
  trackOwner(owner);
  return root;
}

// One "destroyed" listener per webContents (not per repo), so opening and
// closing many repos doesn't pile listeners onto the same emitter.
const trackedOwners = new WeakSet<WebContents>();
function trackOwner(owner: WebContents) {
  if (trackedOwners.has(owner)) return;
  trackedOwners.add(owner);
  owner.once("destroyed", () => {
    for (const root of [...repos.keys()]) closeRepo(root, owner);
  });
}

function closeRepo(root: string, owner: WebContents) {
  const entry = repos.get(root);
  if (!entry) return;
  entry.subscribers.delete(owner);
  if (entry.subscribers.size === 0) {
    entry.watcher.stop();
    repos.delete(root);
  }
}

function getRepo(root: string): Repo {
  const entry = repos.get(root);
  if (!entry) throw new Error(`Repository not open: ${root}`);
  return entry.repo;
}

export function registerIpc(
  settings: SettingsStore,
  gitManager: GitManager,
  hosting: HostingAccounts,
  credentials: CredentialBroker,
) {
  ipcMain.handle(
    "git:info",
    wrap(() => gitManager.get()),
  );
  ipcMain.handle(
    "git:refresh",
    wrap(() => gitManager.resolve()),
  );
  ipcMain.handle(
    "git:install",
    wrap(() => gitManager.install()),
  );
  ipcMain.handle(
    "git:checkUpdates",
    wrap(() => gitManager.checkForUpdates()),
  );
  ipcMain.handle(
    "git:locate",
    wrap(() => gitManager.locate()),
  );
  ipcMain.handle(
    "git:resetPath",
    wrap(() => gitManager.resetPath()),
  );
  ipcMain.handle(
    "git:removeManaged",
    wrap(() => gitManager.removeManaged()),
  );
  ipcMain.handle(
    "git:installSystemTools",
    wrap(() => gitManager.installSystemTools()),
  );
  ipcMain.handle(
    "git:credentialReply",
    wrap((id: string, answer: CredentialAnswer | null) =>
      credentials.reply(id, answer),
    ),
  );
  ipcMain.handle(
    "hosting:accounts",
    wrap(() => hosting.list()),
  );
  ipcMain.handle(
    "hosting:signIn",
    wrap((req: HostingSignIn) => hosting.signIn(req)),
  );
  ipcMain.handle(
    "hosting:signOut",
    wrap((provider: HostingProvider) => hosting.signOut(provider)),
  );
  ipcMain.handle(
    "hosting:repos",
    wrap((provider: HostingProvider, refresh?: boolean) =>
      hosting.repos(provider, refresh),
    ),
  );
  ipcMain.handle(
    "hosting:openTokenPage",
    wrap((provider: HostingProvider, baseUrl?: string, organization?: string) =>
      shell.openExternal(hosting.tokenPage(provider, baseUrl, organization)),
    ),
  );
  ipcMain.handle(
    "app:settings",
    wrap(() => settings.get()),
  );
  // Directories passed on the command line (`lumiere-git path/to/repo`).
  ipcMain.handle(
    "app:launchPaths",
    wrap(() => {
      const args = process.argv
        .slice(app.isPackaged ? 1 : 2)
        .filter((a) => !a.startsWith("-"));
      return args
        .map((a) => path.resolve(a))
        .filter((p) => fs.existsSync(p) && fs.statSync(p).isDirectory());
    }),
  );
  ipcMain.handle(
    "app:setSettings",
    wrap((patch) => settings.set(patch as never)),
  );
  ipcMain.handle(
    "app:pickDirectory",
    wrap(async (title: string) => {
      const win = BrowserWindow.getFocusedWindow();
      const opts: Electron.OpenDialogOptions = {
        title,
        properties: ["openDirectory", "createDirectory"],
      };
      const res = win
        ? await dialog.showOpenDialog(win, opts)
        : await dialog.showOpenDialog(opts);
      return res.canceled ? null : res.filePaths[0];
    }),
  );
  ipcMain.handle(
    "app:openExternal",
    wrap((url: string) => {
      if (!/^https?:\/\//.test(url))
        throw new Error("Only http(s) links can be opened");
      return shell.openExternal(url);
    }),
  );
  ipcMain.handle("app:setZoom", (e, factor: number) => {
    e.sender.setZoomFactor(Math.min(2, Math.max(0.5, factor)));
    settings.set({ zoom: e.sender.getZoomFactor() });
    return { ok: true, value: e.sender.getZoomFactor() };
  });
  ipcMain.handle(
    "app:showInFolder",
    wrap((p: string) => shell.showItemInFolder(p)),
  );

  ipcMain.handle("repo:open", async (e, dir: string) => {
    try {
      const root = await openRepo(dir, e.sender);
      settings.addRecent(root);
      return { ok: true, value: root };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  });
  ipcMain.handle("repo:close", (e, root: string) => {
    closeRepo(root, e.sender);
    return { ok: true, value: null };
  });
  ipcMain.handle(
    "repo:init",
    wrap(async (dir: string) => Repo.init(dir)),
  );
  ipcMain.handle(
    "repo:clone",
    wrap(async (url: string, dir: string) => Repo.clone(url, dir)),
  );
  ipcMain.handle(
    "repo:call",
    wrap(async (root: string, method: RepoMethod, ...args: unknown[]) => {
      if (!(REPO_METHODS as readonly string[]).includes(method))
        throw new Error(`Unknown method ${method}`);
      const repo = getRepo(root);
      return (repo[method] as (...a: unknown[]) => unknown).apply(repo, args);
    }),
  );

  ipcMain.handle(
    "pty:available",
    wrap(() => ptyAvailable()),
  );
  ipcMain.handle(
    "pty:spawn",
    async (e, id: string, cwd: string, cols: number, rows: number) => {
      try {
        ptySpawn(e.sender, id, cwd, cols, rows);
        return { ok: true, value: null };
      } catch (err) {
        return { ok: false, error: (err as Error).message };
      }
    },
  );
  ipcMain.on("pty:write", (_e, id: string, data: string) => ptyWrite(id, data));
  ipcMain.on("pty:resize", (_e, id: string, cols: number, rows: number) =>
    ptyResize(id, cols, rows),
  );
  ipcMain.on("pty:kill", (_e, id: string) => ptyKill(id));
}
