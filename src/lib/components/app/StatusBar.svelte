<script lang="ts">
  import LoaderIcon from "@lucide/svelte/icons/loader-circle";
  import ZoomInIcon from "@lucide/svelte/icons/zoom-in";
  import ZoomOutIcon from "@lucide/svelte/icons/zoom-out";
  import GitBranchIcon from "@lucide/svelte/icons/git-branch";
  import { appState } from "$lib/stores/app.svelte";
  import { gitState } from "$lib/stores/git.svelte";

  const git = $derived(gitState.info);

  const repo = $derived(appState.activeRepo);
  const st = $derived(repo?.status);
</script>

<div
  class="bg-panel text-muted-foreground flex h-6 shrink-0 items-center gap-4 border-t px-3 text-[11px]"
>
  {#if repo?.busy}
    <span class="text-foreground flex items-center gap-1.5"
      ><LoaderIcon class="size-3 animate-spin" />{repo.busy}…</span
    >
  {/if}
  {#if st}
    <span class="flex items-center gap-1">
      <GitBranchIcon class="size-3" />{st.branch ?? "detached"}
      {#if st.upstream}<span class="opacity-70">→ {st.upstream}</span>{/if}
      {#if st.ahead}<span>↑{st.ahead}</span>{/if}
      {#if st.behind}<span>↓{st.behind}</span>{/if}
    </span>
    {#if repo}<span
        >{repo.commits.length.toLocaleString()}{repo.hasMore ? "+" : ""} commits</span
      >{/if}
  {/if}
  <span class="flex-1"></span>
  <span class="flex items-center gap-1">
    <button
      class="hover:text-foreground"
      title="Zoom out (Ctrl+-)"
      onclick={() => appState.setZoom(appState.zoom - 0.1)}
      ><ZoomOutIcon class="size-3.5" /></button
    >
    <button
      class="hover:text-foreground w-9 tabular-nums"
      title="Reset zoom (Ctrl+0)"
      onclick={() => appState.setZoom(1)}
      >{Math.round(appState.zoom * 100)}%</button
    >
    <button
      class="hover:text-foreground"
      title="Zoom in (Ctrl+=)"
      onclick={() => appState.setZoom(appState.zoom + 0.1)}
      ><ZoomInIcon class="size-3.5" /></button
    >
  </span>
  {#if git}
    <button
      class="hover:text-foreground flex items-center gap-1"
      class:text-destructive={git.source === "none" || !git.supported}
      title={git.path
        ? `${git.path} (${git.source}). Click for Git setup`
        : "Git not found. Click to set up"}
      onclick={() => (gitState.open = true)}
    >
      {git.version ? `git ${git.version}` : "git not found"}
      {#if git.update}<span
          class="bg-primary size-1.5 rounded-full"
          title="Git update available"
        ></span>{/if}
    </button>
  {/if}
  <span>Lumiere Git 0.0.1</span>
</div>
