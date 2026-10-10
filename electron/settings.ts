import path from "node:path";
import fs from "fs-extra";
import type { Settings } from "./shared/types";

const DEFAULTS: Settings = {
  theme: "dark",
  zoom: 1,
  openTabs: [],
  activeTab: null,
  recent: [],
  graphPageSize: 2000,
  showStashesInGraph: true,
  diffMode: "hunk",
  sidebarWidth: 16,
  detailWidth: 30,
  gitPath: null,
  gitCheckUpdates: true,
  gitLastUpdateCheck: 0,
};

export class SettingsStore {
  private data: Settings = { ...DEFAULTS };
  private file: string;
  private saveTimer: NodeJS.Timeout | null = null;

  constructor(userData: string) {
    this.file = path.join(userData, "settings.json");
  }

  async load() {
    try {
      const raw = await fs.readJson(this.file);
      this.data = { ...DEFAULTS, ...raw };
    } catch {
      this.data = { ...DEFAULTS };
    }
    return this.data;
  }

  get(): Settings {
    return this.data;
  }

  set(patch: Partial<Settings>): Settings {
    this.data = { ...this.data, ...patch };
    this.scheduleSave();
    return this.data;
  }

  addRecent(repoPath: string) {
    const name = path.basename(repoPath);
    const recent = [
      { path: repoPath, name, openedAt: Date.now() },
      ...this.data.recent.filter((r) => r.path !== repoPath),
    ];
    this.set({ recent: recent.slice(0, 20) });
  }

  private scheduleSave() {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      fs.outputJson(this.file, this.data, { spaces: 2 }).catch((e) =>
        console.error("settings save failed", e),
      );
    }, 250);
  }

  async flush() {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    await fs.outputJson(this.file, this.data, { spaces: 2 });
  }
}
