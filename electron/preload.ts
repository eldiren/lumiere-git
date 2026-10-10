import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";

type Listener = (...args: unknown[]) => void;

const EVENT_CHANNELS = new Set([
  "repo:changed",
  "pty:data",
  "pty:exit",
  "menu",
  "git:info",
  "git:progress",
  "git:credential",
]);
const INVOKE_PREFIXES = ["app:", "repo:", "pty:", "git:", "hosting:"];
const SEND_CHANNELS = new Set(["pty:write", "pty:resize", "pty:kill"]);

const api = {
  platform: process.platform,
  invoke(channel: string, ...args: unknown[]) {
    if (!INVOKE_PREFIXES.some((p) => channel.startsWith(p)))
      throw new Error(`Blocked channel ${channel}`);
    return ipcRenderer.invoke(channel, ...args);
  },
  send(channel: string, ...args: unknown[]) {
    if (!SEND_CHANNELS.has(channel))
      throw new Error(`Blocked channel ${channel}`);
    ipcRenderer.send(channel, ...args);
  },
  on(channel: string, listener: Listener): () => void {
    if (!EVENT_CHANNELS.has(channel))
      throw new Error(`Blocked channel ${channel}`);
    const wrapped = (_e: IpcRendererEvent, ...args: unknown[]) =>
      listener(...args);
    ipcRenderer.on(channel, wrapped);
    return () => ipcRenderer.removeListener(channel, wrapped);
  },
};

contextBridge.exposeInMainWorld("lumiere", api);

export type LumiereBridge = typeof api;
