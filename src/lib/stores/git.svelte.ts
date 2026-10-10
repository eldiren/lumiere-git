import { toast } from "svelte-sonner";
import { gitSetup, onEvent } from "$lib/api";
import type {
  CredentialAnswer,
  CredentialRequest,
  GitInfo,
  GitSetupProgress,
} from "$shared/types";

// State behind <GitSetupDialog />: which git is in use, and the managed-Git download/update flow.

class GitSetupState {
  info = $state.raw<GitInfo | null>(null);
  progress = $state.raw<GitSetupProgress | null>(null);
  open = $state(false);
  busy = $state<string | null>(null);
  /** HTTPS credential requests from git, answered one at a time by <CredentialDialog />. */
  credentialQueue = $state.raw<CredentialRequest[]>([]);

  async init() {
    onEvent("git:info", (info: GitInfo) => (this.info = info));
    onEvent("git:progress", (p: GitSetupProgress) => (this.progress = p));
    onEvent(
      "git:credential",
      (req: CredentialRequest) =>
        (this.credentialQueue = [...this.credentialQueue, req]),
    );
    const info = await gitSetup.info();
    this.info = info;
    if (info.source === "none") {
      this.open = true;
    } else if (!info.supported) {
      toast.warning(
        `Git ${info.version} is old. Some features need Git ${info.minVersion}+`,
        {
          action: { label: "Git Setup", onClick: () => (this.open = true) },
        },
      );
    }
    if (info.warning) toast.warning(info.warning);
    // The startup update check runs in the background; tell the user when it finds something.
    let notified = false;
    $effect.root(() => {
      $effect(() => {
        const u = this.info?.update;
        if (!u || notified || !this.info?.managedTag) return;
        notified = true;
        toast.info(`Git ${releaseVersion(u.tag)} is available`, {
          duration: 15000,
          action: { label: "Update", onClick: () => this.install() },
        });
      });
    });
  }

  /** Runs an action with a busy label, surfacing errors as toasts. */
  private async run<T>(
    label: string,
    fn: () => Promise<T>,
  ): Promise<T | undefined> {
    this.busy = label;
    try {
      return await fn();
    } catch (e) {
      toast.error(`${label} failed`, { description: (e as Error).message });
    } finally {
      this.busy = null;
      this.progress = null;
    }
  }

  answerCredential(id: string, answer: CredentialAnswer | null) {
    this.credentialQueue = this.credentialQueue.filter((r) => r.id !== id);
    gitSetup.credentialReply(id, answer).catch(() => {});
  }

  async install() {
    const updating = !!this.info?.managedTag;
    const info = await this.run(
      updating ? "Updating Git" : "Downloading Git",
      () => gitSetup.install(),
    );
    if (info) toast.success(`Now using Git ${info.version}`);
  }

  async checkUpdates() {
    const info = await this.run("Checking for updates", () =>
      gitSetup.checkUpdates(),
    );
    if (info && !info.update) toast.success("Git is up to date");
  }

  async locate() {
    await this.run("Locate Git", () => gitSetup.locate());
  }

  async resetPath() {
    await this.run("Auto-detect Git", () => gitSetup.resetPath());
  }

  async refresh() {
    await this.run("Detecting Git", () => gitSetup.refresh());
  }

  async removeManaged() {
    await this.run("Removing Git", () => gitSetup.removeManaged());
  }

  async installSystemTools() {
    await this.run("Install Command Line Tools", () =>
      gitSetup.installSystemTools(),
    );
  }
}

/** `v2.51.0.windows.2` → `2.51.0 (Windows build 2)`. */
export function releaseVersion(tag: string): string {
  const m = /^v?(\d+\.\d+\.\d+)(?:\.windows\.(\d+))?/.exec(tag);
  if (!m) return tag;
  return m[2] && m[2] !== "1" ? `${m[1]} (Windows build ${m[2]})` : m[1];
}

export const gitState = new GitSetupState();
