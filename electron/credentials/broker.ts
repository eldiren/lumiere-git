// Answers git's HTTPS credential requests. Every git process gets `credential.helper` pointing at
// helper.ts, after any helpers the user configured, which relays get/store/erase here over a local
// socket. A `get` is answered from a signed-in hosting account, then from credentials saved in the
// OS keyring, and finally by asking the user in the focused window ('git:credential').
import crypto from "node:crypto";
import fs from "fs-extra";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { BrowserWindow, safeStorage } from "electron";
import type { CredentialAnswer, CredentialRequest } from "../shared/types";
import { setCredentialHelper } from "../git/exec";
import type { HostingAccounts } from "../hosting/accounts";
import { canPersistSecrets, decryptSecret, encryptSecret } from "../secrets";
import {
  credentialKey,
  credentialOrigin,
  formatCredential,
  matchHosting,
  parseCredential,
  tokenUsername,
  type CredentialFields,
} from "./protocol";

interface SavedEntry {
  key: string;
  username: string;
  /** base64 of safeStorage.encryptString(password). */
  secret: string;
}

/** Quote for the POSIX shell git runs `!` helpers with (Git for Windows ships its own sh). */
function shq(s: string) {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

export class CredentialBroker {
  private server: net.Server | null = null;
  private socketPath = "";
  private readonly token = crypto.randomBytes(24).toString("hex");
  private readonly file: string;
  private saved = new Map<string, { username: string; password: string }>();
  /** Answers typed into the dialog, kept until git reports whether they worked (store/erase). */
  private pending = new Map<string, { password: string; remember: boolean }>();
  /** Hosting tokens git reported as rejected; skipped until the user signs in again. */
  private rejected = new Set<string>();
  private inflight = new Map<string, Promise<CredentialFields | null>>();
  private waiting = new Map<string, (a: CredentialAnswer | null) => void>();

  constructor(
    userData: string,
    private readonly hosting: HostingAccounts,
  ) {
    this.file = path.join(userData, "git-credentials.json");
  }

  async start() {
    await this.load();
    const id = `lumiere-git-${process.pid}-${crypto.randomBytes(6).toString("hex")}`;
    if (process.platform === "win32") {
      this.socketPath = `\\\\.\\pipe\\${id}`;
    } else {
      // Unix socket paths are capped at ~104 bytes; a deep TMPDIR won't fit.
      const inTmp = path.join(os.tmpdir(), `${id}.sock`);
      this.socketPath =
        inTmp.length < 100 ? inTmp : path.join("/tmp", `${id}.sock`);
    }
    this.server = net.createServer((sock) => this.onConnection(sock));
    await new Promise<void>((resolve, reject) => {
      this.server!.once("error", reject);
      this.server!.listen(this.socketPath, () => resolve());
    });
    if (process.platform !== "win32") await fs.chmod(this.socketPath, 0o600);
    const helper = path.join(__dirname, "helper.js");
    setCredentialHelper(
      `!ELECTRON_RUN_AS_NODE=1 ${shq(process.execPath)} ${shq(helper)}`,
      {
        LUMIERE_CRED_SOCKET: this.socketPath,
        LUMIERE_CRED_TOKEN: this.token,
      },
    );
  }

  stop() {
    this.server?.close();
    this.server = null;
    if (process.platform !== "win32" && this.socketPath)
      fs.removeSync(this.socketPath);
    for (const resolve of this.waiting.values()) resolve(null);
    this.waiting.clear();
  }

  /** The renderer's answer to a 'git:credential' event; null when the user cancelled. */
  reply(id: string, answer: CredentialAnswer | null) {
    const resolve = this.waiting.get(id);
    this.waiting.delete(id);
    resolve?.(answer);
  }

  // ---------------------------------------------------------------- socket

  private onConnection(sock: net.Socket) {
    let buf = "";
    sock.setEncoding("utf8");
    sock.on("error", () => {});
    sock.on("data", async (d: string) => {
      buf += d;
      const nl = buf.indexOf("\n");
      if (nl < 0) return;
      sock.removeAllListeners("data");
      let output = "";
      try {
        const msg = JSON.parse(buf.slice(0, nl));
        const a = Buffer.from(String(msg.token));
        const b = Buffer.from(this.token);
        if (a.length !== b.length || !crypto.timingSafeEqual(a, b))
          throw new Error("bad token");
        output = await this.handle(
          String(msg.op),
          parseCredential(String(msg.input ?? "")),
        );
      } catch (e) {
        console.warn("Credential helper request failed", e);
      }
      sock.end(JSON.stringify({ output }));
    });
  }

  private async handle(op: string, fields: CredentialFields): Promise<string> {
    if (op === "get") {
      const res = await this.get(fields);
      return res ? formatCredential(res) : "";
    }
    if (op === "store" && fields.username && fields.password !== undefined) {
      const key = credentialKey(fields);
      const p = this.pending.get(key);
      this.pending.delete(key);
      if (p?.remember && p.password === fields.password) {
        this.saved.set(key, {
          username: fields.username,
          password: fields.password,
        });
        await this.save();
      }
    } else if (op === "erase") {
      const key = credentialKey(fields);
      this.pending.delete(key);
      if (fields.password) this.rejected.add(fields.password);
      if (this.saved.delete(key)) await this.save();
    }
    return "";
  }

  private get(fields: CredentialFields): Promise<CredentialFields | null> {
    const key = credentialKey(fields);
    // `fetch --all` can ask for the same host from several remotes at once; show one dialog.
    let p = this.inflight.get(key);
    if (!p) {
      p = this.resolve(fields).finally(() => this.inflight.delete(key));
      this.inflight.set(key, p);
    }
    return p;
  }

  private async resolve(
    fields: CredentialFields,
  ): Promise<CredentialFields | null> {
    const base = { protocol: fields.protocol, host: fields.host };
    const accounts = this.hosting
      .gitTokens()
      .filter((a) => !this.rejected.has(a.token));
    const account = matchHosting(fields, accounts);
    if (account)
      return {
        ...base,
        username: fields.username || tokenUsername(account),
        password: account.token,
      };

    const saved = fields.username
      ? this.saved.get(credentialKey(fields))
      : [...this.saved.entries()].find(([k]) =>
          k.startsWith(`${credentialOrigin(fields)}#`),
        )?.[1];
    if (saved && !this.rejected.has(saved.password))
      return { ...base, username: saved.username, password: saved.password };

    const answer = await this.ask(fields);
    if (!answer) return { quit: "1" };
    this.rejected.delete(answer.password);
    this.pending.set(credentialKey(fields, answer.username), {
      password: answer.password,
      remember: answer.remember,
    });
    return { ...base, username: answer.username, password: answer.password };
  }

  private ask(fields: CredentialFields): Promise<CredentialAnswer | null> {
    const win =
      BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
    if (!win || win.isDestroyed()) return Promise.resolve(null);
    const id = crypto.randomUUID();
    const req: CredentialRequest = {
      id,
      origin: credentialOrigin(fields),
      path: fields.path ?? null,
      username: fields.username ?? null,
      canRemember: canPersistSecrets(),
    };
    return new Promise((resolve) => {
      const onGone = () => this.reply(id, null);
      win.webContents.once("destroyed", onGone);
      this.waiting.set(id, (a) => {
        if (!win.isDestroyed()) win.webContents.off("destroyed", onGone);
        resolve(a);
      });
      if (win.isMinimized()) win.restore();
      win.focus();
      win.webContents.send("git:credential", req);
    });
  }

  // ---------------------------------------------------------------- storage

  private async load() {
    let entries: SavedEntry[] = [];
    try {
      entries = (await fs.readJson(this.file)).entries ?? [];
    } catch {
      return;
    }
    if (!safeStorage.isEncryptionAvailable()) return;
    for (const e of entries) {
      try {
        this.saved.set(e.key, {
          username: e.username,
          password: decryptSecret(e.secret),
        });
      } catch (err) {
        console.warn(
          `Could not decrypt the saved credential for ${e.key}`,
          err,
        );
      }
    }
  }

  private async save() {
    const entries: SavedEntry[] = [];
    if (canPersistSecrets()) {
      for (const [key, v] of this.saved)
        entries.push({
          key,
          username: v.username,
          secret: encryptSecret(v.password),
        });
    }
    await fs.outputJson(this.file, { entries }, { spaces: 2 });
  }
}
