<script lang="ts">
  import XIcon from "@lucide/svelte/icons/x";
  import PlusIcon from "@lucide/svelte/icons/plus";
  import GitBranchIcon from "@lucide/svelte/icons/git-branch";
  import HouseIcon from "@lucide/svelte/icons/house";
  import SunMoonIcon from "@lucide/svelte/icons/sun-moon";
  import FolderOpenIcon from "@lucide/svelte/icons/folder-open";
  import { cn } from "$lib/utils";
  import { appState } from "$lib/stores/app.svelte";
</script>

<div class="bg-panel flex h-9 shrink-0 items-stretch border-b">
  <button
    class="text-muted-foreground hover:text-foreground hover:bg-accent px-3"
    title="Open repository (Ctrl+O)"
    onclick={() => appState.openRepoDialog()}
  >
    <FolderOpenIcon class="size-4" />
  </button>
  <div class="flex min-w-0 flex-1 items-stretch overflow-x-auto">
    {#each appState.tabs as tab (tab.id)}
      {@const active = tab.id === appState.activeId}
      <div
        class={cn(
          "group flex max-w-60 min-w-32 cursor-default items-center gap-2 border-r px-3 text-[13px]",
          active
            ? "bg-background text-foreground"
            : "text-muted-foreground hover:bg-accent/50",
        )}
        role="tab"
        tabindex="0"
        aria-selected={active}
        onclick={() => appState.activate(tab.id)}
        onauxclick={(e) => e.button === 1 && appState.closeTab(tab.id)}
        onkeydown={(e) => e.key === "Enter" && appState.activate(tab.id)}
      >
        {#if tab.kind === "repo"}
          <GitBranchIcon class="size-3.5 shrink-0" />
          <span class="min-w-0 flex-1 truncate" title={tab.repo.root}
            >{tab.repo.name}</span
          >
        {:else}
          <HouseIcon class="size-3.5 shrink-0" />
          <span class="min-w-0 flex-1 truncate">New Tab</span>
        {/if}
        <button
          class={cn(
            "hover:bg-accent rounded p-0.5",
            !active && "invisible group-hover:visible",
          )}
          title="Close tab (Ctrl+W)"
          onclick={(e) => {
            e.stopPropagation();
            appState.closeTab(tab.id);
          }}
        >
          <XIcon class="size-3.5" />
        </button>
      </div>
    {/each}
    <button
      class="text-muted-foreground hover:text-foreground px-3"
      title="New tab (Ctrl+T)"
      onclick={() => appState.newTab()}
    >
      <PlusIcon class="size-4" />
    </button>
  </div>
  <button
    class="text-muted-foreground hover:text-foreground hover:bg-accent px-3"
    title="Toggle light/dark theme"
    onclick={() => appState.toggleTheme()}
  >
    <SunMoonIcon class="size-4" />
  </button>
</div>
