import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  app,
  BrowserWindow,
  Menu,
  net,
  protocol,
  shell,
  type MenuItemConstructorOptions,
} from "electron";
import { GitManager } from "./gitManager";
import { registerIpc } from "./ipc";
import { ptyKillAll } from "./pty";
import { SettingsStore } from "./settings";
import { HostingAccounts } from "./hosting/accounts";
import { CredentialBroker } from "./credentials/broker";

// Unpackaged runs load the Vite dev server (`pnpm start`); set LUMIERE_PROD=1 to load the built renderer instead.
const DEV_URL =
  app.isPackaged || process.env.LUMIERE_PROD
    ? undefined
    : (process.env.LUMIERE_DEV_URL ?? "http://localhost:5178");
const APP_ORIGIN = "app://lumiere";
const RENDERER_DIR = path.join(__dirname, "../../build");
let settings: SettingsStore;
let credentials: CredentialBroker | undefined;

// The built renderer is served from app://lumiere/ so its absolute /_app/ asset URLs resolve.
protocol.registerSchemesAsPrivileged([
  {
    scheme: "app",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      codeCache: true,
    },
  },
]);

function registerAppProtocol() {
  protocol.handle("app", (req) => {
    const { pathname } = new URL(req.url);
    const file = path.normalize(
      path.join(RENDERER_DIR, decodeURIComponent(pathname)),
    );
    if (!file.startsWith(RENDERER_DIR))
      return new Response("Forbidden", { status: 403 });
    // SPA: unknown paths fall back to index.html.
    const target = path.extname(file)
      ? file
      : path.join(RENDERER_DIR, "index.html");
    return net.fetch(pathToFileURL(target).toString());
  });
}

function send(win: BrowserWindow | undefined | null, action: string) {
  win?.webContents.send("menu", action);
}

function buildMenu() {
  const act = (
    label: string,
    action: string,
    accelerator?: string,
  ): MenuItemConstructorOptions => ({
    label,
    accelerator,
    click: (_item, win) => send(win as BrowserWindow, action),
  });
  const template: MenuItemConstructorOptions[] = [
    {
      label: "File",
      submenu: [
        act("New Tab", "tab:new", "CmdOrCtrl+T"),
        act("Open Repository…", "repo:open", "CmdOrCtrl+O"),
        act("Clone Repository…", "repo:clone"),
        act("Init Repository…", "repo:init"),
        { type: "separator" },
        act("Close Tab", "tab:close", "CmdOrCtrl+W"),
        { type: "separator" },
        { role: "quit" },
      ],
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
      ],
    },
    {
      label: "View",
      submenu: [
        act("Toggle Left Panel", "view:sidebar", "CmdOrCtrl+J"),
        act("Toggle Terminal", "view:terminal", "CmdOrCtrl+`"),
        act("Toggle Theme", "view:theme"),
        { type: "separator" },
        act("Zoom In", "view:zoomIn", "CmdOrCtrl+="),
        act("Zoom Out", "view:zoomOut", "CmdOrCtrl+-"),
        act("Reset Zoom", "view:zoomReset", "CmdOrCtrl+0"),
        { type: "separator" },
        { role: "reload" },
        { role: "toggleDevTools" },
      ],
    },
    {
      label: "Repository",
      submenu: [
        act("Fetch All", "git:fetch", "CmdOrCtrl+Shift+F"),
        act("Pull", "git:pull", "CmdOrCtrl+Shift+L"),
        act("Push", "git:push", "CmdOrCtrl+Shift+K"),
        act("New Branch…", "git:branch", "CmdOrCtrl+B"),
        act("Stash", "git:stash", "CmdOrCtrl+Shift+S"),
        act("Pop Stash", "git:pop", "CmdOrCtrl+Shift+P"),
        { type: "separator" },
        act("Undo", "git:undo", "CmdOrCtrl+Z"),
        act("Redo", "git:redo", "CmdOrCtrl+Y"),
      ],
    },
    {
      label: "Help",
      submenu: [
        act("Git Setup…", "app:git"),
        {
          label: "Git Documentation",
          click: () => shell.openExternal("https://git-scm.com/doc"),
        },
        { label: `Lumiere Git ${app.getVersion()}`, enabled: false },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

/** `start:electron` launches Electron alongside Vite, so wait for the dev server to come up. */
async function loadDevServer(win: BrowserWindow, url: string) {
  for (let attempt = 0; ; attempt++) {
    try {
      await win.loadURL(url);
      return;
    } catch (e) {
      if (attempt >= 60 || win.isDestroyed()) throw e;
      await new Promise((r) => setTimeout(r, 500));
    }
  }
}

async function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 560,
    backgroundColor: settings.get().theme === "light" ? "#f5f6f8" : "#1c1f26",
    title: "Lumiere Git",
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: true,
    },
  });
  win.once("ready-to-show", () => win.show());
  win.webContents.on("did-finish-load", () =>
    win.webContents.setZoomFactor(settings.get().zoom || 1),
  );

  // Keep navigation inside the app; open external links in the browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (e, url) => {
    const allowed = url.startsWith(DEV_URL ?? APP_ORIGIN);
    if (!allowed) e.preventDefault();
  });

  if (DEV_URL) await loadDevServer(win, DEV_URL);
  else await win.loadURL(`${APP_ORIGIN}/index.html`);
}

app.whenReady().then(async () => {
  settings = new SettingsStore(app.getPath("userData"));
  await settings.load();
  const gitManager = new GitManager(app.getPath("userData"), settings);
  await gitManager.resolve();
  registerAppProtocol();
  const hosting = new HostingAccounts(app.getPath("userData"));
  await hosting.load();
  credentials = new CredentialBroker(app.getPath("userData"), hosting);
  try {
    await credentials.start();
  } catch (e) {
    // Without it git still works; HTTPS remotes just can't ask for a password.
    console.error("Could not start the git credential helper", e);
  }
  registerIpc(settings, gitManager, hosting, credentials);
  buildMenu();
  await createWindow();
  void gitManager.maybeCheckForUpdates();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", async () => {
  ptyKillAll();
  credentials?.stop();
  await settings?.flush();
});
