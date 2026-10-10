<script lang="ts">
  import LoaderIcon from "@lucide/svelte/icons/loader-circle";
  import TriangleAlertIcon from "@lucide/svelte/icons/triangle-alert";
  import * as Dialog from "$lib/components/ui/dialog";
  import { Button } from "$lib/components/ui/button";
  import { Checkbox } from "$lib/components/ui/checkbox";
  import { app as appApi } from "$lib/api";
  import { appState } from "$lib/stores/app.svelte";
  import { gitState, releaseVersion } from "$lib/stores/git.svelte";

  const info = $derived(gitState.info);
  const busy = $derived(gitState.busy);
  const progress = $derived(gitState.progress);

  const SOURCE_LABEL: Record<string, string> = {
    env: "LUMIERE_GIT_PATH",
    custom: "Chosen by you",
    managed: "Downloaded by Lumiere Git",
    system: "Installed on this system",
    none: "Not found",
  };

  const LINUX_COMMANDS = [
    ["Debian / Ubuntu", "sudo apt install git"],
    ["Fedora", "sudo dnf install git"],
    ["Arch", "sudo pacman -S git"],
    ["openSUSE", "sudo zypper install git"],
  ];

  const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

  const progressText = $derived.by(() => {
    if (!progress) return busy;
    if (progress.phase === "download")
      return `Downloading… ${mb(progress.received)}${progress.total ? ` of ${mb(progress.total)}` : ""}`;
    return {
      verify: "Verifying checksum…",
      extract: "Extracting…",
      done: "Done",
    }[progress.phase];
  });
  const progressPct = $derived(
    progress?.phase === "download" && progress.total
      ? Math.min(100, (progress.received / progress.total) * 100)
      : null,
  );

  async function setUpdateChecks(enabled: boolean) {
    appState.settings = await appApi.setSettings({ gitCheckUpdates: enabled });
  }
</script>

<Dialog.Root bind:open={gitState.open}>
  <Dialog.Content class="sm:max-w-lg">
    <Dialog.Header>
      <Dialog.Title>Git Setup</Dialog.Title>
      <Dialog.Description>
        Lumiere Git runs the <code>git</code> command-line tool for every
        repository operation.
        {#if info}Version {info.minVersion} or newer is required.{/if}
      </Dialog.Description>
    </Dialog.Header>

    {#if info}
      <div
        class="bg-muted/40 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 rounded-md border p-3 text-sm"
      >
        <span class="text-muted-foreground">Version</span>
        <span class:text-destructive={!info.supported}>
          {info.version ?? "Git was not found"}
          {#if info.version && !info.supported}(too old){/if}
        </span>
        <span class="text-muted-foreground">Source</span>
        <span>{SOURCE_LABEL[info.source]}</span>
        {#if info.path}
          <span class="text-muted-foreground">Path</span>
          <span class="font-mono text-xs break-all">{info.path}</span>
        {/if}
        {#if info.version}
          <span class="text-muted-foreground">Git LFS</span>
          <span>
            {#if info.lfsVersion}
              {info.lfsVersion.replace(/^git-lfs\//, "").split(" ")[0]}
            {:else}
              <span class="text-muted-foreground">
                Not installed. Repositories that use LFS need it:
                <a
                  class="underline"
                  href="https://git-lfs.com"
                  target="_blank"
                  rel="noreferrer">git-lfs.com</a
                >, then click Re-detect.
              </span>
            {/if}
          </span>
        {/if}
      </div>

      {#if info.warning}
        <p class="flex items-start gap-2 text-sm text-amber-500">
          <TriangleAlertIcon class="mt-0.5 size-4 shrink-0" />{info.warning}
        </p>
      {/if}

      {#if info.canDownload}
        <div class="flex flex-col gap-2">
          <h3 class="text-sm font-medium">Git managed by Lumiere Git</h3>
          <p class="text-muted-foreground text-sm">
            Downloads the official MinGit build from Git for Windows, checks its
            SHA-256, and keeps it in the app's data folder. It does not change
            your system Git.
          </p>
          {#if info.managedTag}
            <p class="text-sm">
              Installed: {releaseVersion(info.managedTag)}{info.source !==
              "managed"
                ? " (not in use; a higher-priority Git was found)"
                : ""}
            </p>
          {/if}
          {#if info.update}
            <p class="text-sm">
              Update available: <strong
                >{releaseVersion(info.update.tag)}</strong
              >
              ({mb(info.update.size)})
            </p>
          {/if}
          <div class="flex flex-wrap gap-2">
            {#if !info.managedTag}
              <Button
                size="sm"
                disabled={!!busy}
                onclick={() => gitState.install()}>Download Git</Button
              >
            {:else}
              {#if info.update}
                <Button
                  size="sm"
                  disabled={!!busy}
                  onclick={() => gitState.install()}>Update Git</Button
                >
              {/if}
              <Button
                size="sm"
                variant="outline"
                disabled={!!busy}
                onclick={() => gitState.checkUpdates()}
                >Check for Updates</Button
              >
              <Button
                size="sm"
                variant="ghost"
                disabled={!!busy}
                onclick={() => gitState.removeManaged()}>Remove</Button
              >
            {/if}
          </div>
          {#if info.managedTag}
            <label class="flex items-center gap-2 text-sm">
              <Checkbox
                checked={appState.settings?.gitCheckUpdates ?? true}
                onCheckedChange={(v) => setUpdateChecks(v === true)}
              />
              Check for Git updates once a day (contacts api.github.com)
            </label>
          {/if}
        </div>
      {:else if info.platform === "darwin" && info.source === "none"}
        <div class="flex flex-col gap-2 text-sm">
          <p>
            Install Apple's Command Line Tools, which include Git, or run <code
              >brew install git</code
            > if you use Homebrew.
          </p>
          <div>
            <Button
              size="sm"
              disabled={!!busy}
              onclick={() => gitState.installSystemTools()}
              >Install Command Line Tools</Button
            >
          </div>
          <p class="text-muted-foreground">
            When the installer finishes, click Re-detect.
          </p>
        </div>
      {:else if info.platform === "linux" && (info.source === "none" || !info.supported)}
        <div class="flex flex-col gap-2 text-sm">
          <p>Install or update Git with your package manager:</p>
          <div class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
            {#each LINUX_COMMANDS as [distro, cmd] (distro)}
              <span class="text-muted-foreground">{distro}</span><code
                class="select-text">{cmd}</code
              >
            {/each}
          </div>
          <p class="text-muted-foreground">Then click Re-detect.</p>
        </div>
      {/if}

      {#if busy}
        <div class="flex flex-col gap-1.5">
          <span class="text-muted-foreground flex items-center gap-2 text-sm"
            ><LoaderIcon class="size-3.5 animate-spin" />{progressText}</span
          >
          {#if progressPct !== null}
            <div class="bg-muted h-1.5 overflow-hidden rounded-full">
              <div
                class="bg-primary h-full transition-[width]"
                style="width: {progressPct}%"
              ></div>
            </div>
          {/if}
        </div>
      {/if}
    {/if}

    <Dialog.Footer class="gap-2 sm:justify-between">
      <div class="flex gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={!!busy}
          onclick={() => gitState.locate()}>Locate Git…</Button
        >
        {#if info?.customPath}
          <Button
            size="sm"
            variant="ghost"
            disabled={!!busy}
            onclick={() => gitState.resetPath()}>Use Auto-detect</Button
          >
        {:else}
          <Button
            size="sm"
            variant="ghost"
            disabled={!!busy}
            onclick={() => gitState.refresh()}>Re-detect</Button
          >
        {/if}
      </div>
      <Button size="sm" onclick={() => (gitState.open = false)}>Close</Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
