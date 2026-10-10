<script lang="ts">
  import moment from "moment";
  import FolderOpenIcon from "@lucide/svelte/icons/folder-open";
  import DownloadIcon from "@lucide/svelte/icons/download";
  import FolderPlusIcon from "@lucide/svelte/icons/folder-plus";
  import GitBranchIcon from "@lucide/svelte/icons/git-branch";
  import appIcon from "../../../../assets/appIcon.png";
  import { Button } from "$lib/components/ui/button";
  import { Input } from "$lib/components/ui/input";
  import { app as appApi, inElectron } from "$lib/api";
  import { appState } from "$lib/stores/app.svelte";

  let cloneUrl = $state("");
  let cloneDir = $state("");
  let showClone = $state(false);

  async function pickCloneDir() {
    const d = await appApi.pickDirectory("Clone into…");
    if (d) cloneDir = d;
  }
</script>

<div class="flex h-full items-center justify-center overflow-auto p-8">
  <div class="w-full max-w-3xl">
    <div class="mb-8 flex items-center gap-3">
      <img src={appIcon} alt="" class="size-12 shrink-0" />
      <div>
        <h1 class="text-2xl font-semibold">Lumiere Git</h1>
        <p class="text-muted-foreground text-sm">
          Open, clone, or create a repository to get started.
        </p>
      </div>
    </div>

    {#if !inElectron}
      <p class="text-destructive mb-4 text-sm">
        The Electron bridge isn't available — run the app with <code
          >pnpm dev</code
        >.
      </p>
    {/if}

    <div class="mb-8 grid grid-cols-3 gap-3">
      <button
        class="bg-card hover:border-primary flex flex-col items-start gap-2 rounded-lg border p-4 text-left"
        onclick={() => appState.openRepoDialog()}
      >
        <FolderOpenIcon class="text-primary size-6" />
        <span class="font-medium">Open a repository</span>
        <span class="text-muted-foreground text-xs"
          >Browse to an existing Git repository</span
        >
      </button>
      <button
        class="bg-card hover:border-primary flex flex-col items-start gap-2 rounded-lg border p-4 text-left"
        onclick={() => (showClone = !showClone)}
      >
        <DownloadIcon class="text-primary size-6" />
        <span class="font-medium">Clone a repository</span>
        <span class="text-muted-foreground text-xs"
          >From a URL (HTTPS or SSH)</span
        >
      </button>
      <button
        class="bg-card hover:border-primary flex flex-col items-start gap-2 rounded-lg border p-4 text-left"
        onclick={() => appState.initRepoDialog()}
      >
        <FolderPlusIcon class="text-primary size-6" />
        <span class="font-medium">Start a new repository</span>
        <span class="text-muted-foreground text-xs">git init in a folder</span>
      </button>
    </div>

    {#if showClone}
      <form
        class="bg-card mb-8 flex flex-col gap-3 rounded-lg border p-4"
        onsubmit={(e) => {
          e.preventDefault();
          if (cloneUrl && cloneDir) appState.clone(cloneUrl.trim(), cloneDir);
        }}
      >
        <Input
          placeholder="https://github.com/owner/repo.git"
          bind:value={cloneUrl}
          spellcheck="false"
        />
        <div class="flex gap-2">
          <Input
            placeholder="Parent folder"
            bind:value={cloneDir}
            class="flex-1"
            spellcheck="false"
          />
          <Button type="button" variant="outline" onclick={pickCloneDir}
            >Browse…</Button
          >
          <Button type="submit" disabled={!cloneUrl || !cloneDir}>Clone</Button>
        </div>
      </form>
    {/if}

    {#if appState.settings?.recent.length}
      <h2
        class="text-muted-foreground mb-2 text-xs font-semibold tracking-wide uppercase"
      >
        Recent
      </h2>
      <div class="bg-card overflow-hidden rounded-lg border">
        {#each appState.settings.recent as r (r.path)}
          <button
            class="hover:bg-accent flex w-full items-center gap-3 border-b px-4 py-2.5 text-left last:border-b-0"
            onclick={() => appState.openRepo(r.path)}
          >
            <GitBranchIcon class="text-muted-foreground size-4" />
            <span class="font-medium">{r.name}</span>
            <span class="text-muted-foreground min-w-0 flex-1 truncate text-xs"
              >{r.path}</span
            >
            <span class="text-muted-foreground text-xs"
              >{moment(r.openedAt).fromNow()}</span
            >
          </button>
        {/each}
      </div>
    {/if}
  </div>
</div>
