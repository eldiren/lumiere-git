// Signed-in hosting accounts (one per provider). Tokens are encrypted with the OS keyring via
// safeStorage and never leave the main process; without a real keyring they stay in memory only.
import path from "node:path";
import fs from "fs-extra";
import { net, safeStorage } from "electron";
import { canPersistSecrets, decryptSecret, encryptSecret } from "../secrets";
import type {
  HostingAccount,
  HostingProvider,
  HostingRepo,
  HostingSignIn,
} from "../shared/types";
import {
  credentialsFor,
  listRepos,
  tokenPageUrl,
  verify,
  type Credentials,
  type FetchFn,
} from "./providers";

interface Stored {
  account: Omit<HostingAccount, "persisted">;
  credentials: Credentials;
  persisted: boolean;
}

interface FileEntry {
  account: Omit<HostingAccount, "persisted">;
  credentials: Omit<Credentials, "token">;
  /** base64 of safeStorage.encryptString(token). */
  token: string;
}

const netFetch: FetchFn = (url, init) => net.fetch(url, init);

export class HostingAccounts {
  private accounts = new Map<HostingProvider, Stored>();
  private repoCache = new Map<HostingProvider, HostingRepo[]>();
  private file: string;

  constructor(userData: string) {
    this.file = path.join(userData, "accounts.json");
  }

  async load() {
    let entries: FileEntry[] = [];
    try {
      entries = (await fs.readJson(this.file)).accounts ?? [];
    } catch {
      return;
    }
    if (!safeStorage.isEncryptionAvailable()) return;
    for (const e of entries) {
      try {
        const token = decryptSecret(e.token);
        this.accounts.set(e.account.provider, {
          account: e.account,
          credentials: { ...e.credentials, token },
          persisted: true,
        });
      } catch (err) {
        console.warn(`Could not decrypt the ${e.account.provider} token`, err);
      }
    }
  }

  private async save() {
    const entries: FileEntry[] = [];
    if (canPersistSecrets()) {
      for (const s of this.accounts.values()) {
        if (!s.persisted) continue;
        const { token, ...credentials } = s.credentials;
        entries.push({
          account: s.account,
          credentials,
          token: encryptSecret(token),
        });
      }
    }
    await fs.outputJson(this.file, { accounts: entries }, { spaces: 2 });
  }

  list(): HostingAccount[] {
    return [...this.accounts.values()].map((s) => ({
      ...s.account,
      persisted: s.persisted,
    }));
  }

  async signIn(req: HostingSignIn): Promise<HostingAccount> {
    const credentials = credentialsFor(req);
    const account = await verify(netFetch, credentials);
    const persisted = canPersistSecrets();
    this.accounts.set(req.provider, { account, credentials, persisted });
    this.repoCache.delete(req.provider);
    await this.save();
    return { ...account, persisted };
  }

  async signOut(provider: HostingProvider) {
    this.accounts.delete(provider);
    this.repoCache.delete(provider);
    await this.save();
  }

  async repos(
    provider: HostingProvider,
    refresh = false,
  ): Promise<HostingRepo[]> {
    const s = this.accounts.get(provider);
    if (!s) throw new Error("Not signed in");
    if (!refresh) {
      const cached = this.repoCache.get(provider);
      if (cached) return cached;
    }
    const repos = await listRepos(netFetch, s.credentials);
    this.repoCache.set(provider, repos);
    return repos;
  }

  /** Tokens for answering git's HTTPS credential requests (electron/credentials/broker.ts). */
  gitTokens() {
    return [...this.accounts.values()].map((s) => ({
      provider: s.account.provider,
      baseUrl: s.account.baseUrl,
      login: s.account.login,
      token: s.credentials.token,
    }));
  }

  tokenPage(
    provider: HostingProvider,
    baseUrl?: string,
    organization?: string,
  ) {
    return tokenPageUrl(provider, baseUrl, organization);
  }
}
