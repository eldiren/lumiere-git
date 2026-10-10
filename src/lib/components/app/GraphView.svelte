<script lang="ts">
  import { onMount, untrack } from "svelte";
  import moment from "moment";
  import { filter as fuzzyFilter } from "fuzzaldrin-plus";
  import * as ContextMenu from "$lib/components/ui/context-menu";
  import CheckIcon from "@lucide/svelte/icons/check";
  import LaptopIcon from "@lucide/svelte/icons/laptop";
  import CloudIcon from "@lucide/svelte/icons/cloud";
  import TagIcon from "@lucide/svelte/icons/tag";
  import PencilIcon from "@lucide/svelte/icons/pencil";
  import ArchiveIcon from "@lucide/svelte/icons/archive";
  import SearchIcon from "@lucide/svelte/icons/search";
  import XIcon from "@lucide/svelte/icons/x";
  import { cn } from "$lib/utils";
  import {
    paintGraph,
    ROW_H,
    LANE_W,
    GRAPH_PAD,
    laneColor,
    laneColorAlpha,
  } from "$lib/graph/render";
  import {
    WIP,
    type GraphItem,
    type RefGroup,
    type RepoTab,
  } from "$lib/stores/repo.svelte";
  import * as actions from "$lib/actions";
  import type { Ref } from "$shared/types";

  let {
    repo,
    searchOpen = $bindable(false),
  }: { repo: RepoTab; searchOpen?: boolean } = $props();

  const REF_W = 150;
  const PILL_END = REF_W - 6;

  let scroller: HTMLDivElement;
  let canvas: HTMLCanvasElement;
  let viewportH = $state(600);
  let width = $state(1200);
  let scrollTop = $state(0);
  let hoverIndex = $state(-1);
  let menuTarget = $state<{ index: number; group?: RefGroup } | null>(null);
  let search = $state("");
  let searchInput = $state<HTMLInputElement | null>(null);

  const items = $derived(repo.items);
  const layout = $derived(repo.layout);
  // Optional columns drop out as the pane narrows; the graph never takes more than ~30% of it.
  const showSha = $derived(width >= 1000);
  const showDate = $derived(width >= 860);
  const showAuthor = $derived(width >= 720);
  const graphW = $derived(
    Math.min(
      Math.max(96, Math.floor(width * 0.3)),
      Math.max(64, GRAPH_PAD * 2 + (layout.maxLanes - 1) * LANE_W + 10),
    ),
  );
  const totalH = $derived(items.length * ROW_H);
  const first = $derived(Math.max(0, Math.floor(scrollTop / ROW_H) - 1));
  const last = $derived(
    Math.min(items.length - 1, Math.ceil((scrollTop + viewportH) / ROW_H)),
  );
  const visible = $derived(
    Array.from({ length: Math.max(0, last - first + 1) }, (_, k) => first + k),
  );
  const selectedIndex = $derived(
    repo.selected ? (repo.indexByHash.get(repo.selected) ?? -1) : -1,
  );

  const refRows = $derived.by(() => {
    const s = new Set<number>();
    for (const [hash, _g] of repo.refsByHash) {
      const i = repo.indexByHash.get(hash);
      if (i !== undefined) s.add(i);
    }
    // Stashes don't have pills; WIP neither.
    return s;
  });

  // Search: match subject, body, author, or hash prefix.
  const searchMatches = $derived.by(() => {
    const q = search.trim();
    if (!q) return [] as number[];
    const lower = q.toLowerCase();
    const out: number[] = [];
    if (/^[0-9a-f]{4,}$/i.test(q)) {
      items.forEach((it, i) => it.hash.startsWith(lower) && out.push(i));
      if (out.length) return out;
    }
    const candidates = items
      .map((it, i) => ({
        i,
        text:
          it.kind === "commit"
            ? `${it.commit.subject} ${it.commit.author.name}`
            : it.kind === "stash"
              ? it.stash.message
              : "",
      }))
      .filter((c) => c.text);
    return fuzzyFilter(candidates, q, { key: "text", maxResults: 500 })
      .filter((c) => c.text.toLowerCase().includes(lower.split(" ")[0]))
      .map((c) => c.i)
      .sort((a, b) => a - b);
  });
  let matchCursor = $state(0);
  const matchSet = $derived(new Set(searchMatches));

  const dateCache = new Map<number, string>();
  function formatDate(t: number) {
    let s = dateCache.get(t);
    if (!s) {
      s = moment.unix(t).format("MMM D, YYYY h:mm A");
      dateCache.set(t, s);
    }
    return s;
  }

  // Read once per theme change: getComputedStyle in the paint loop forces a style recalc every frame.
  let background = "#1c1f26";
  function readBackground() {
    background =
      getComputedStyle(document.documentElement)
        .getPropertyValue("--background")
        .trim() || background;
  }

  let raf = 0;
  function schedulePaint() {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      paint();
    });
  }

  function paint() {
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const w = REF_W + graphW;
    const h = viewportH;
    if (
      canvas.width !== Math.round(w * dpr) ||
      canvas.height !== Math.round(h * dpr)
    ) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    const ctx = canvas.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    paintGraph({
      ctx,
      width: w,
      height: h,
      scrollTop,
      first,
      last,
      layout,
      items,
      graphX: REF_W,
      graphW,
      selectedIndex,
      hoverIndex,
      refRows,
      refPillEnd: PILL_END,
      background,
    });
  }

  $effect(() => {
    // Track everything paint() reads.
    void [
      layout,
      items,
      scrollTop,
      viewportH,
      selectedIndex,
      hoverIndex,
      graphW,
      refRows,
    ];
    // Paint in the same frame as the DOM rows update so lines never lag behind the rows.
    untrack(paint);
  });

  // Theme switches change the node background colour.
  onMount(() => {
    readBackground();
    const mo = new MutationObserver(() => {
      readBackground();
      schedulePaint();
    });
    mo.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
    const ro = new ResizeObserver(() => (viewportH = scroller.clientHeight));
    ro.observe(scroller);
    viewportH = scroller.clientHeight;
    return () => {
      mo.disconnect();
      ro.disconnect();
      cancelAnimationFrame(raf);
    };
  });

  function onScroll() {
    scrollTop = scroller.scrollTop;
    if (repo.hasMore && scrollTop + viewportH > totalH - ROW_H * 200)
      repo.loadMore();
  }

  function scrollToIndex(i: number) {
    if (!scroller || i < 0) return;
    const top = i * ROW_H;
    if (top < scroller.scrollTop) scroller.scrollTop = top;
    else if (top + ROW_H > scroller.scrollTop + viewportH)
      scroller.scrollTop = top - viewportH + ROW_H * 2;
  }

  // Keep the selection visible when it changes from elsewhere (sidebar clicks etc.).
  $effect(() => {
    const i = selectedIndex;
    untrack(() => scrollToIndex(i));
  });

  function onKey(e: KeyboardEvent) {
    if (
      e.target instanceof HTMLInputElement ||
      e.target instanceof HTMLTextAreaElement
    )
      return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const i = Math.min(
        items.length - 1,
        Math.max(0, selectedIndex + (e.key === "ArrowDown" ? 1 : -1)),
      );
      repo.select(items[i]?.hash ?? null);
    } else if (e.key === "Home") {
      repo.select(items[0]?.hash ?? null);
    } else if (e.key === "End") {
      repo.select(items[items.length - 1]?.hash ?? null);
    }
  }

  function localRefFor(group: RefGroup): Ref | undefined {
    return group.local ?? group.remotes[0] ?? group.tag;
  }

  function onDblClick(item: GraphItem) {
    if (item.kind !== "commit") return;
    const groups = repo.refsByHash.get(item.hash) ?? [];
    const branch =
      groups.find((g) => g.local && !g.isHead)?.local ??
      groups.find((g) => g.remotes.length && !g.local)?.remotes[0];
    if (branch) actions.checkoutRef(repo, branch);
    else if (repo.refs?.head.hash !== item.hash)
      actions.checkoutCommit(repo, item.hash);
  }

  function gotoMatch(delta: number) {
    if (!searchMatches.length) return;
    matchCursor =
      (matchCursor + delta + searchMatches.length) % searchMatches.length;
    repo.select(items[searchMatches[matchCursor]].hash);
  }

  $effect(() => {
    if (searchOpen) searchInput?.focus();
  });

  $effect(() => {
    void search;
    untrack(() => {
      matchCursor = 0;
      if (searchMatches.length) repo.select(items[searchMatches[0]].hash);
    });
  });

  const menuItem = $derived(menuTarget ? items[menuTarget.index] : undefined);
  const headBranch = $derived(repo.refs?.head.branch);
</script>

{#snippet refMenu(g: RefGroup)}
  {@const ref = localRefFor(g)}
  {@const remoteNames = repo.refs?.remoteNames ?? []}
  {#if ref}
    {#if !g.isHead}
      <ContextMenu.Item onclick={() => actions.checkoutRef(repo, ref)}
        >Checkout {ref.shortName}</ContextMenu.Item
      >
    {/if}
    {#if ref.kind !== "tag" && !g.isHead && headBranch}
      <ContextMenu.Item onclick={() => actions.mergeInto(repo, ref.shortName)}
        >Merge {ref.shortName} into {headBranch}</ContextMenu.Item
      >
      <ContextMenu.Item onclick={() => actions.rebaseOnto(repo, ref.shortName)}
        >Rebase {headBranch} onto {ref.shortName}</ContextMenu.Item
      >
    {/if}
    {#if !g.isHead}<ContextMenu.Separator />{/if}
    {#if g.local}
      {#if remoteNames.length}
        <ContextMenu.Item
          onclick={() => actions.pushDialog(repo, g.local!.shortName)}
          >Push {g.local.shortName}…</ContextMenu.Item
        >
      {/if}
      <ContextMenu.Item onclick={() => actions.renameBranch(repo, g.local!)}
        >Rename {g.local.shortName}…</ContextMenu.Item
      >
      {#if !g.isHead}
        <ContextMenu.Item
          class="text-destructive"
          onclick={() => actions.deleteBranch(repo, g.local!)}
          >Delete {g.local.shortName}</ContextMenu.Item
        >
      {/if}
    {/if}
    {#each g.remotes as r (r.name)}
      <ContextMenu.Item
        class="text-destructive"
        onclick={() => actions.deleteBranch(repo, r)}
        >Delete {r.shortName}</ContextMenu.Item
      >
    {/each}
    {#if g.tag}
      {@const tag = g.tag}
      {#if remoteNames.length === 1}
        <ContextMenu.Item
          onclick={() => actions.pushTag(repo, tag, remoteNames[0])}
          >Push to {remoteNames[0]}</ContextMenu.Item
        >
      {:else if remoteNames.length > 1}
        <ContextMenu.Sub>
          <ContextMenu.SubTrigger>Push to</ContextMenu.SubTrigger>
          <ContextMenu.SubContent class="min-w-40">
            {#each remoteNames as r (r)}
              <ContextMenu.Item onclick={() => actions.pushTag(repo, tag, r)}
                >{r}</ContextMenu.Item
              >
            {/each}
          </ContextMenu.SubContent>
        </ContextMenu.Sub>
      {/if}
      <ContextMenu.Item
        class="text-destructive"
        onclick={() => actions.deleteTag(repo, tag)}
        >Delete tag {tag.shortName}…</ContextMenu.Item
      >
    {/if}
    <ContextMenu.Separator />
    <ContextMenu.Item
      onclick={() =>
        actions.copyText(
          ref.shortName,
          ref.kind === "tag" ? "Tag name copied" : "Branch name copied",
        )}
      >{ref.kind === "tag"
        ? "Copy tag name"
        : "Copy branch name"}</ContextMenu.Item
    >
  {/if}
{/snippet}

<div
  class="flex h-full min-h-0 flex-col"
  role="grid"
  tabindex="0"
  onkeydown={onKey}
  aria-label="Commit graph"
  bind:clientWidth={width}
>
  <!-- Column headers -->
  <div
    class="text-muted-foreground flex h-6 shrink-0 items-center border-b text-[10px] font-semibold tracking-wider uppercase"
  >
    <div class="shrink-0 truncate px-2" style="width: {REF_W}px">
      Branch / Tag
    </div>
    <div class="shrink-0 truncate border-l px-2" style="width: {graphW}px">
      Graph
    </div>
    <div class="min-w-0 flex-1 truncate border-l px-2">Commit message</div>
    {#if showAuthor}<div class="w-36 shrink-0 border-l px-2">Author</div>{/if}
    {#if showDate}<div class="w-36 shrink-0 border-l px-2">Date</div>{/if}
    {#if showSha}<div class="w-20 shrink-0 border-l px-2">SHA</div>{/if}
  </div>

  {#if searchOpen}
    <div class="bg-panel flex h-9 shrink-0 items-center gap-2 border-b px-2">
      <SearchIcon class="text-muted-foreground size-4" />
      <input
        bind:this={searchInput}
        bind:value={search}
        class="placeholder:text-muted-foreground h-7 flex-1 bg-transparent text-sm outline-none"
        placeholder="Search commits by message, author or SHA"
        spellcheck="false"
        onkeydown={(e) => {
          if (e.key === "Enter") gotoMatch(e.shiftKey ? -1 : 1);
          if (e.key === "Escape") {
            searchOpen = false;
            search = "";
          }
        }}
      />
      <span class="text-muted-foreground text-xs tabular-nums">
        {search
          ? `${searchMatches.length ? matchCursor + 1 : 0} / ${searchMatches.length}`
          : ""}
      </span>
      <button
        class="hover:bg-accent rounded p-1"
        aria-label="Close search"
        onclick={() => ((searchOpen = false), (search = ""))}
      >
        <XIcon class="size-4" />
      </button>
    </div>
  {/if}

  <ContextMenu.Root onOpenChange={(o) => !o && (menuTarget = null)}>
    <ContextMenu.Trigger class="min-h-0 flex-1">
      <div
        bind:this={scroller}
        class="relative h-full overflow-auto"
        onscroll={onScroll}
      >
        <div style="height: {totalH}px; position: relative;">
          <div
            class="sticky top-0 overflow-hidden"
            style="height: {viewportH}px;"
          >
            <!-- Rows sit at fixed offsets inside one translated layer, so scrolling only updates the transform. -->
            <div
              class="absolute inset-x-0 top-0"
              style="transform: translateY({-scrollTop}px);"
            >
              {#each visible as i (items[i]?.hash ?? i)}
                {@const item = items[i]}
                {@const groups = repo.refsByHash.get(item.hash) ?? []}
                {@const row = layout.rows[i]}
                <div
                  class={cn(
                    "absolute right-0 left-0 flex cursor-default items-center",
                    i === selectedIndex
                      ? "bg-row-selected"
                      : i === hoverIndex
                        ? "bg-row-hover"
                        : "",
                    matchSet.has(i) && i !== selectedIndex && "bg-amber-500/10",
                  )}
                  style="top: {i * ROW_H}px; height: {ROW_H}px;"
                  role="row"
                  tabindex="-1"
                  aria-selected={i === selectedIndex}
                  onmouseenter={() => (hoverIndex = i)}
                  onmouseleave={() => hoverIndex === i && (hoverIndex = -1)}
                  onclick={() => repo.select(item.hash)}
                  onkeydown={(e) => e.key === "Enter" && onDblClick(item)}
                  ondblclick={() => onDblClick(item)}
                  oncontextmenu={() => {
                    menuTarget = { index: i };
                    repo.select(item.hash);
                  }}
                >
                  <!-- Refs -->
                  <div
                    class="relative z-[2] flex h-full shrink-0 items-center pl-1.5"
                    style="width: {REF_W}px"
                  >
                    {#if groups.length}
                      {@const g = groups[0]}
                      {@const color = row?.color ?? 0}
                      <div
                        class="flex h-5 min-w-0 items-center gap-1 rounded-sm px-1.5 text-xs text-white"
                        style="width: {PILL_END -
                          6}px; background: {laneColorAlpha(
                          color,
                          g.isHead ? 0.9 : 0.65,
                        )}; border: 1px solid {laneColor(color)};"
                        title={groups.map((x) => x.label).join("\n")}
                        role="button"
                        tabindex="-1"
                        oncontextmenu={(e) => {
                          e.stopPropagation();
                          menuTarget = { index: i, group: g };
                          repo.select(item.hash);
                        }}
                        ondblclick={(e) => {
                          e.stopPropagation();
                          const r = localRefFor(g);
                          if (r) actions.checkoutRef(repo, r);
                        }}
                      >
                        {#if g.isHead}<CheckIcon class="size-3 shrink-0" />{/if}
                        <span class="min-w-0 flex-1 truncate font-medium"
                          >{g.label}</span
                        >
                        {#if groups.length > 1}<span class="shrink-0 opacity-80"
                            >+{groups.length - 1}</span
                          >{/if}
                        {#if g.local}<LaptopIcon
                            class="size-3 shrink-0 opacity-90"
                          />{/if}
                        {#if g.remotes.length}<CloudIcon
                            class="size-3 shrink-0 opacity-90"
                          />{/if}
                        {#if g.tag}<TagIcon
                            class="size-3 shrink-0 opacity-90"
                          />{/if}
                      </div>
                    {/if}
                  </div>
                  <!-- Graph column (drawn on the canvas) -->
                  <div class="shrink-0" style="width: {graphW}px"></div>
                  <!-- Message -->
                  <div class="flex min-w-0 flex-1 items-center gap-2 px-2">
                    {#if item.kind === "wip"}
                      <span
                        class="border-input text-muted-foreground rounded border px-2 py-0.5 font-mono text-xs italic"
                        >// WIP</span
                      >
                      <span
                        class="text-muted-foreground flex items-center gap-1 text-xs"
                      >
                        <PencilIcon
                          class="text-status-modified size-3"
                        />{repo.changeCount}
                      </span>
                    {:else if item.kind === "stash"}
                      <ArchiveIcon
                        class="text-muted-foreground size-3.5 shrink-0"
                      />
                      <span class="truncate italic">{item.stash.message}</span>
                    {:else}
                      <span class="max-w-full shrink-0 truncate"
                        >{item.commit.subject}</span
                      >
                      {#if item.commit.body}
                        <span
                          class="text-muted-foreground min-w-0 flex-1 truncate"
                          >{item.commit.body
                            .split("\n")
                            .find((l) => l.trim())}</span
                        >
                      {/if}
                    {/if}
                  </div>
                  {#if showAuthor}
                    <div
                      class="text-muted-foreground w-36 shrink-0 truncate px-2 text-xs"
                    >
                      {item.kind === "commit" ? item.commit.author.name : ""}
                    </div>
                  {/if}
                  {#if showDate}
                    <div
                      class="text-muted-foreground w-36 shrink-0 truncate px-2 text-xs"
                      title={item.kind === "commit"
                        ? moment.unix(item.commit.author.date).format("LLLL")
                        : ""}
                    >
                      {#if item.kind === "commit"}{formatDate(
                          item.commit.author.date,
                        )}{:else if item.kind === "stash"}{moment
                          .unix(item.stash.date)
                          .fromNow()}{/if}
                    </div>
                  {/if}
                  {#if showSha}
                    <div
                      class="text-muted-foreground w-20 shrink-0 px-2 font-mono text-xs"
                    >
                      {item.kind === "commit" ? item.hash.slice(0, 7) : ""}
                    </div>
                  {/if}
                </div>
              {/each}
            </div>
            <canvas
              bind:this={canvas}
              class="pointer-events-none absolute top-0 left-0 z-[1]"
              style="width: {REF_W + graphW}px; height: {viewportH}px;"
            ></canvas>
          </div>
        </div>
        {#if !items.length && !repo.loading}
          <div
            class="text-muted-foreground absolute inset-0 flex items-center justify-center text-sm"
          >
            No commits yet — make your first commit from the panel on the right.
          </div>
        {/if}
      </div>
    </ContextMenu.Trigger>

    <ContextMenu.Content class="w-64">
      {#if menuTarget?.group}
        {@render refMenu(menuTarget.group)}
      {:else if menuItem?.kind === "commit"}
        {@const h = menuItem.hash}
        {@const groups = (repo.refsByHash.get(h) ?? []).filter(localRefFor)}
        {#each groups as g (g.label + (g.tag ? ":tag" : ""))}
          <ContextMenu.Sub>
            <ContextMenu.SubTrigger class="gap-2">
              {#if g.tag}<TagIcon class="size-3.5 shrink-0" />{/if}
              <span class="truncate">{g.label}</span>
            </ContextMenu.SubTrigger>
            <ContextMenu.SubContent class="w-64">
              {@render refMenu(g)}
            </ContextMenu.SubContent>
          </ContextMenu.Sub>
        {/each}
        {#if groups.length}<ContextMenu.Separator />{/if}
        <ContextMenu.Item onclick={() => actions.createBranch(repo, h)}
          >Create branch here…</ContextMenu.Item
        >
        <ContextMenu.Item onclick={() => actions.checkoutCommit(repo, h)}
          >Checkout this commit</ContextMenu.Item
        >
        <ContextMenu.Item onclick={() => actions.createTag(repo, h)}
          >Create tag here…</ContextMenu.Item
        >
        <ContextMenu.Separator />
        <ContextMenu.Item onclick={() => actions.cherryPick(repo, h)}
          >Cherry-pick commit</ContextMenu.Item
        >
        <ContextMenu.Item onclick={() => actions.revert(repo, h)}
          >Revert commit</ContextMenu.Item
        >
        <ContextMenu.Sub>
          <ContextMenu.SubTrigger
            >Reset {headBranch ?? "HEAD"} to this commit</ContextMenu.SubTrigger
          >
          <ContextMenu.SubContent>
            <ContextMenu.Item onclick={() => actions.reset(repo, h, "soft")}
              >Soft — keep all changes staged</ContextMenu.Item
            >
            <ContextMenu.Item onclick={() => actions.reset(repo, h, "mixed")}
              >Mixed — keep working copy, reset index</ContextMenu.Item
            >
            <ContextMenu.Item
              class="text-destructive"
              onclick={() => actions.reset(repo, h, "hard")}
              >Hard — discard all changes</ContextMenu.Item
            >
          </ContextMenu.SubContent>
        </ContextMenu.Sub>
        <ContextMenu.Separator />
        <ContextMenu.Item
          onclick={() => actions.copyText(h, "Commit SHA copied")}
          >Copy commit SHA</ContextMenu.Item
        >
        <ContextMenu.Item
          onclick={() =>
            actions.copyText(
              menuItem.commit.subject +
                (menuItem.commit.body ? "\n\n" + menuItem.commit.body : ""),
              "Message copied",
            )}>Copy commit message</ContextMenu.Item
        >
      {:else if menuItem?.kind === "stash"}
        {@const idx = menuItem.stash.index}
        <ContextMenu.Item onclick={() => actions.stashApply(repo, idx)}
          >Apply stash</ContextMenu.Item
        >
        <ContextMenu.Item onclick={() => actions.stashPop(repo, idx)}
          >Pop stash</ContextMenu.Item
        >
        <ContextMenu.Item
          class="text-destructive"
          onclick={() => actions.stashDrop(repo, idx)}
          >Delete stash</ContextMenu.Item
        >
      {:else if menuItem?.kind === "wip"}
        <ContextMenu.Item onclick={() => actions.stash(repo)}
          >Stash all changes…</ContextMenu.Item
        >
        <ContextMenu.Item
          onclick={() => repo.run("Stage all", (api) => api.stageAll())}
          >Stage all changes</ContextMenu.Item
        >
        <ContextMenu.Separator />
        <ContextMenu.Item
          class="text-destructive"
          onclick={() => actions.discardAll(repo)}
          >Discard all changes…</ContextMenu.Item
        >
      {/if}
    </ContextMenu.Content>
  </ContextMenu.Root>
</div>
