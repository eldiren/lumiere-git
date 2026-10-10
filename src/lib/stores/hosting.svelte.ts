// Signed-in hosting accounts and their repository lists (shared across tabs).
import { hosting as api, inElectron } from "$lib/api";
import type {
  HostingAccount,
  HostingProvider,
  HostingRepo,
  HostingSignIn,
} from "$shared/types";

export const PROVIDERS: { id: HostingProvider; name: string }[] = [
  { id: "github", name: "GitHub" },
  { id: "gitlab", name: "GitLab" },
  { id: "bitbucket", name: "Bitbucket" },
  { id: "azure", name: "Azure DevOps" },
  { id: "gitea", name: "Gitea" },
];

class HostingState {
  accounts = $state.raw<Partial<Record<HostingProvider, HostingAccount>>>({});
  repos = $state.raw<Partial<Record<HostingProvider, HostingRepo[]>>>({});
  loadingRepos = $state<Partial<Record<HostingProvider, boolean>>>({});
  repoErrors = $state<Partial<Record<HostingProvider, string>>>({});
  private loaded = false;

  async load() {
    if (this.loaded || !inElectron) return;
    this.loaded = true;
    const list = await api.accounts();
    this.accounts = Object.fromEntries(list.map((a) => [a.provider, a]));
  }

  async signIn(req: HostingSignIn) {
    const account = await api.signIn(req);
    this.accounts = { ...this.accounts, [req.provider]: account };
    this.repos = { ...this.repos, [req.provider]: undefined };
    return account;
  }

  async signOut(provider: HostingProvider) {
    await api.signOut(provider);
    this.accounts = { ...this.accounts, [provider]: undefined };
    this.repos = { ...this.repos, [provider]: undefined };
  }

  async loadRepos(provider: HostingProvider, refresh = false) {
    if (this.loadingRepos[provider] || (!refresh && this.repos[provider]))
      return;
    this.loadingRepos[provider] = true;
    this.repoErrors[provider] = undefined;
    try {
      const list = await api.repos(provider, refresh);
      this.repos = { ...this.repos, [provider]: list };
    } catch (e) {
      this.repoErrors[provider] = (e as Error).message;
    } finally {
      this.loadingRepos[provider] = false;
    }
  }
}

export const hostingState = new HostingState();
