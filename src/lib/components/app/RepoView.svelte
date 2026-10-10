<script lang="ts">
  import LoaderIcon from "@lucide/svelte/icons/loader-circle";
  import * as Resizable from "$lib/components/ui/resizable";
  import { appState } from "$lib/stores/app.svelte";
  import { WIP, type RepoTab } from "$lib/stores/repo.svelte";
  import Toolbar from "./Toolbar.svelte";
  import Sidebar from "./Sidebar.svelte";
  import GraphView from "./GraphView.svelte";
  import DiffView from "./DiffView.svelte";
  import CommitPanel from "./CommitPanel.svelte";
  import WipPanel from "./WipPanel.svelte";
  import TerminalPanel from "./TerminalPanel.svelte";
  import AddRemotePanel from "./AddRemotePanel.svelte";

  let { repo, active }: { repo: RepoTab; active: boolean } = $props();
  let searchOpen = $state(false);

  function onKey(e: KeyboardEvent) {
    if (!active) return;
    if (e.key === "Escape" && repo.addRemoteOpen) {
      repo.addRemoteOpen = false;
    } else if (e.key === "Escape" && repo.diff) {
      repo.closeDiff();
    } else if (
      (e.ctrlKey || e.metaKey) &&
      e.key.toLowerCase() === "f" &&
      !e.shiftKey
    ) {
      e.preventDefault();
      searchOpen = true;
    }
  }
</script>

<svelte:window onkeydown={onKey} />

<div class="flex h-full min-h-0 flex-col">
  <Toolbar {repo} bind:searchOpen />
  {#if repo.error}
    <div
      class="text-destructive flex flex-1 items-center justify-center p-8 text-sm whitespace-pre-wrap"
    >
      {repo.error}
    </div>
  {:else}
    <div class="flex min-h-0 flex-1">
      {#if !appState.sidebarOpen}<Sidebar {repo} />{/if}
      <Resizable.PaneGroup
        direction="horizontal"
        autoSaveId="lumiere-layout-{appState.sidebarOpen ? 's' : 'n'}"
      >
        {#if appState.sidebarOpen}
          <Resizable.Pane
            id="sidebar"
            order={1}
            defaultSize={16}
            minSize={10}
            maxSize={35}
          >
            <Sidebar {repo} />
          </Resizable.Pane>
          <Resizable.Handle />
        {/if}
        <Resizable.Pane id="center" order={2} defaultSize={54} minSize={25}>
          <Resizable.PaneGroup direction="vertical" autoSaveId="lumiere-center">
            <Resizable.Pane id="main" order={1} defaultSize={70} minSize={20}>
              <div class="relative h-full">
                <!-- Keep the graph mounted (scroll position) while a diff is open. -->
                <div class="h-full" class:hidden={!!repo.diff}>
                  <GraphView {repo} bind:searchOpen />
                </div>
                {#if repo.diff}
                  <div class="absolute inset-0">
                    <DiffView {repo} target={repo.diff} />
                  </div>
                {/if}
                {#if repo.addRemoteOpen}
                  {#key repo.editRemoteName}
                    <div class="absolute inset-y-0 left-0 z-10 max-w-full">
                      <AddRemotePanel {repo} />
                    </div>
                  {/key}
                {/if}
                {#if repo.loading}
                  <div
                    class="bg-background/60 absolute inset-0 flex items-center justify-center"
                  >
                    <LoaderIcon
                      class="text-muted-foreground size-6 animate-spin"
                    />
                  </div>
                {/if}
              </div>
            </Resizable.Pane>
            {#if appState.terminalOpen && active}
              <Resizable.Handle />
              <Resizable.Pane
                id="terminal"
                order={2}
                defaultSize={30}
                minSize={10}
              >
                <TerminalPanel cwd={repo.root} />
              </Resizable.Pane>
            {/if}
          </Resizable.PaneGroup>
        </Resizable.Pane>
        <Resizable.Handle />
        <Resizable.Pane
          id="detail"
          order={3}
          defaultSize={30}
          minSize={18}
          maxSize={55}
        >
          <div class="bg-panel h-full">
            {#if repo.selected === WIP}
              <WipPanel {repo} />
            {:else}
              <CommitPanel {repo} />
            {/if}
          </div>
        </Resizable.Pane>
      </Resizable.PaneGroup>
    </div>
  {/if}
</div>
