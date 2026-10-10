<script lang="ts">
  import { onMount } from "svelte";
  import { Toaster } from "$lib/components/ui/sonner";
  import * as Tooltip from "$lib/components/ui/tooltip";
  import { onEvent } from "$lib/api";
  import { appState } from "$lib/stores/app.svelte";
  import * as actions from "$lib/actions";
  import TabBar from "$lib/components/app/TabBar.svelte";
  import StatusBar from "$lib/components/app/StatusBar.svelte";
  import RepoView from "$lib/components/app/RepoView.svelte";
  import Welcome from "$lib/components/app/Welcome.svelte";
  import Dialogs from "$lib/components/app/Dialogs.svelte";
  import PushDialog from "$lib/components/app/PushDialog.svelte";
  import GitSetupDialog from "$lib/components/app/GitSetupDialog.svelte";
  import CredentialDialog from "$lib/components/app/CredentialDialog.svelte";
  import { gitState } from "$lib/stores/git.svelte";

  onMount(() => {
    appState.init();
    return onEvent("menu", (action: string) => {
      const repo = appState.activeRepo;
      switch (action) {
        case "tab:new":
          return appState.newTab();
        case "tab:close":
          return appState.closeTab(appState.activeId);
        case "repo:open":
          return appState.openRepoDialog();
        case "repo:init":
          return appState.initRepoDialog();
        case "repo:clone":
          appState.newTab();
          return;
        case "view:sidebar":
          appState.sidebarOpen = !appState.sidebarOpen;
          return;
        case "view:terminal":
          appState.terminalOpen = !appState.terminalOpen;
          return;
        case "view:theme":
          return appState.toggleTheme();
        case "view:zoomIn":
          return appState.setZoom(appState.zoom + 0.1);
        case "view:zoomOut":
          return appState.setZoom(appState.zoom - 0.1);
        case "view:zoomReset":
          return appState.setZoom(1);
        case "app:git":
          gitState.open = true;
          return;
      }
      if (!repo) return;
      // Let native text editing keep Ctrl+Z / Ctrl+Y inside inputs.
      const el = document.activeElement;
      const inText =
        el instanceof HTMLInputElement ||
        el instanceof HTMLTextAreaElement ||
        (el as HTMLElement)?.isContentEditable;
      switch (action) {
        case "git:fetch":
          return actions.fetchAll(repo);
        case "git:pull":
          return actions.pull(repo);
        case "git:push":
          return actions.pushDialog(repo);
        case "git:branch":
          return actions.createBranch(repo);
        case "git:stash":
          return actions.stash(repo);
        case "git:pop":
          return actions.stashPop(repo);
        case "git:undo":
          if (inText) return document.execCommand("undo");
          return actions.undo(repo);
        case "git:redo":
          if (inText) return document.execCommand("redo");
          return actions.redo(repo);
      }
    });
  });
</script>

<Tooltip.Provider>
  <div class="flex h-screen flex-col">
    <TabBar />
    <div class="relative min-h-0 flex-1">
      {#each appState.tabs as tab (tab.id)}
        <div
          class="absolute inset-0"
          class:hidden={tab.id !== appState.activeId}
        >
          {#if tab.kind === "repo"}
            <RepoView repo={tab.repo} active={tab.id === appState.activeId} />
          {:else}
            <Welcome />
          {/if}
        </div>
      {/each}
    </div>
    <StatusBar />
  </div>
  <Dialogs />
  <PushDialog />
  <GitSetupDialog />
  <CredentialDialog />
  <Toaster position="bottom-right" richColors />
</Tooltip.Provider>
