import { toast } from "svelte-sonner";
import { app as appApi, inElectron, onEvent } from "$lib/api";
import type { Settings } from "$shared/types";
import { gitState } from "./git.svelte";
import { RepoTab } from "./repo.svelte";

export type Tab =
  { id: string; kind: "welcome" } | { id: string; kind: "repo"; repo: RepoTab };

let nextId = 1;
const newId = () => `tab-${nextId++}`;

class AppState {
  tabs = $state<Tab[]>([{ id: newId(), kind: "welcome" }]);
  activeId = $state<string>(this.tabs[0].id);
  settings = $state.raw<Settings | null>(null);
  sidebarOpen = $state(true);
  terminalOpen = $state(false);
  zoom = $state(1);

  active: Tab | undefined = $derived(
    this.tabs.find((t) => t.id === this.activeId),
  );
  activeRepo: RepoTab | null = $derived(
    this.active?.kind === "repo" ? this.active.repo : null,
  );

  async init() {
    if (!inElectron) return;
    this.settings = await appApi.settings();
    this.zoom = this.settings.zoom || 1;
    this.applyTheme(this.settings.theme);
    gitState
      .init()
      .catch((e) =>
        toast.error("Could not detect Git", {
          description: (e as Error).message,
        }),
      );
    onEvent("repo:changed", (root: string, info: { git: boolean }) => {
      for (const t of this.tabs)
        if (t.kind === "repo" && t.repo.root === root) t.repo.onChanged(info);
    });
    // Refresh the active repo when the window regains focus (catches changes the watcher missed).
    window.addEventListener("focus", () =>
      this.activeRepo?.refresh().catch(() => {}),
    );

    const { openTabs, activeTab } = this.settings;
    if (openTabs.length) {
      const restored: Tab[] = [];
      for (const p of openTabs) {
        try {
          const root = await appApi.openRepo(p);
          const repo = new RepoTab(root);
          restored.push({ id: newId(), kind: "repo", repo });
          repo.load();
        } catch {
          // Repo moved or deleted; drop it silently.
        }
      }
      if (restored.length) {
        this.tabs = restored;
        const act =
          restored.find(
            (t) => t.kind === "repo" && t.repo.root === activeTab,
          ) ?? restored[0];
        this.activeId = act.id;
      }
    }
    for (const p of await appApi.launchPaths()) await this.openRepo(p);
  }

  private persistTabs() {
    if (!inElectron) return;
    const openTabs = this.tabs.flatMap((t) =>
      t.kind === "repo" ? [t.repo.root] : [],
    );
    appApi.setSettings({ openTabs, activeTab: this.activeRepo?.root ?? null });
  }

  activate(id: string) {
    this.activeId = id;
    this.persistTabs();
  }

  newTab() {
    const tab: Tab = { id: newId(), kind: "welcome" };
    this.tabs.push(tab);
    this.activeId = tab.id;
  }

  async openRepo(dir: string) {
    let root: string;
    try {
      root = await appApi.openRepo(dir);
    } catch (e) {
      toast.error("Could not open repository", {
        description: (e as Error).message,
      });
      return;
    }
    const existing = this.tabs.find(
      (t) => t.kind === "repo" && t.repo.root === root,
    );
    if (existing) {
      this.activate(existing.id);
      return;
    }
    const repo = new RepoTab(root);
    const tab: Tab = { id: newId(), kind: "repo", repo };
    // Replace the active welcome tab if there is one.
    const idx = this.tabs.findIndex((t) => t.id === this.activeId);
    if (idx >= 0 && this.tabs[idx].kind === "welcome") this.tabs[idx] = tab;
    else this.tabs.push(tab);
    this.activeId = tab.id;
    this.persistTabs();
    await repo.load();
    this.settings = await appApi.settings();
  }

  async openRepoDialog() {
    const dir = await appApi.pickDirectory("Open a Git repository");
    if (dir) await this.openRepo(dir);
  }

  async initRepoDialog() {
    const dir = await appApi.pickDirectory(
      "Choose a folder for the new repository",
    );
    if (!dir) return;
    try {
      const root = await appApi.initRepo(dir);
      await this.openRepo(root);
      toast.success("Initialized empty repository");
    } catch (e) {
      toast.error("Init failed", { description: (e as Error).message });
    }
  }

  async clone(url: string, parentDir: string) {
    const name = url
      .replace(/\/+$/, "")
      .split(/[/:]/)
      .pop()!
      .replace(/\.git$/, "");
    const dir = `${parentDir.replace(/[\\/]+$/, "")}/${name}`;
    const id = toast.loading(`Cloning ${name}…`);
    try {
      const root = await appApi.cloneRepo(url, dir);
      toast.success(`Cloned ${name}`, { id });
      await this.openRepo(root);
    } catch (e) {
      toast.error("Clone failed", { id, description: (e as Error).message });
    }
  }

  closeTab(id: string) {
    const idx = this.tabs.findIndex((t) => t.id === id);
    if (idx < 0) return;
    const [tab] = this.tabs.splice(idx, 1);
    if (tab.kind === "repo") appApi.closeRepo(tab.repo.root).catch(() => {});
    if (!this.tabs.length) this.tabs.push({ id: newId(), kind: "welcome" });
    if (this.activeId === id)
      this.activeId = this.tabs[Math.max(0, idx - 1)].id;
    this.persistTabs();
  }

  applyTheme(theme: "dark" | "light") {
    document.documentElement.classList.toggle("dark", theme === "dark");
  }

  toggleTheme() {
    const theme = this.settings?.theme === "light" ? "dark" : "light";
    this.applyTheme(theme);
    appApi.setSettings({ theme }).then((s) => (this.settings = s));
  }

  async setZoom(z: number) {
    this.zoom = await appApi.setZoom(Math.round(z * 10) / 10);
  }
}

export const appState = new AppState();
