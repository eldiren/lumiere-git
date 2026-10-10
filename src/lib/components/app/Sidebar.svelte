<script lang="ts">
  import { filter as fuzzyFilter } from "fuzzaldrin-plus";
  import gitUrlParse from "git-url-parse";
  import ChevronRightIcon from "@lucide/svelte/icons/chevron-right";
  import ChevronLeftIcon from "@lucide/svelte/icons/chevron-left";
  import LaptopIcon from "@lucide/svelte/icons/laptop";
  import CloudIcon from "@lucide/svelte/icons/cloud";
  import ArchiveIcon from "@lucide/svelte/icons/archive";
  import TagIcon from "@lucide/svelte/icons/tag";
  import GitBranchIcon from "@lucide/svelte/icons/git-branch";
  import SearchIcon from "@lucide/svelte/icons/search";
  import PlusIcon from "@lucide/svelte/icons/plus";
  import EllipsisVerticalIcon from "@lucide/svelte/icons/ellipsis-vertical";
  import CheckIcon from "@lucide/svelte/icons/check";
  import FolderIcon from "@lucide/svelte/icons/folder";
  import * as DropdownMenu from "$lib/components/ui/dropdown-menu";
  import { cn } from "$lib/utils";
  import type { RepoTab } from "$lib/stores/repo.svelte";
  import { appState } from "$lib/stores/app.svelte";
  import * as actions from "$lib/actions";
  import type { Ref, Stash } from "$shared/types";

  let { repo }: { repo: RepoTab } = $props();

  let open = $state<Record<string, boolean>>({
    local: true,
    remote: false,
    stashes: false,
    tags: false,
  });
  let remoteUrls = $state<Record<string, string>>({});
  // Remote whose actions menu is open (opened by the ⋮ button or a right-click).
  let remoteMenu = $state<string | null>(null);
  // Full name of the ref whose actions menu is open (⋮ button or right-click).
  let refMenu = $state<string | null>(null);
  const headRef = $derived(repo.refs?.branches.find((b) => b.isHead));

  $effect(() => {
    void repo.refs?.remoteNames;
    repo.api.remoteUrls().then(
      (u) => (remoteUrls = u),
      () => {},
    );
  });

  function matches<T>(list: T[], key: (t: T) => string): T[] {
    const q = repo.filter.trim();
    if (!q) return list;
    const wrapped = list.map((item) => ({ item, k: key(item) }));
    return fuzzyFilter(wrapped, q, { key: "k" }).map((w) => w.item);
  }

  const branches = $derived(
    matches(repo.refs?.branches ?? [], (b) => b.shortName),
  );
  const remotes = $derived(
    matches(repo.refs?.remotes ?? [], (r) => r.shortName),
  );
  const tags = $derived(matches(repo.refs?.tags ?? [], (t) => t.shortName));
  const stashes = $derived(matches(repo.refs?.stashes ?? [], (s) => s.message));
  const byRemote = $derived.by(() => {
    const m = new Map<string, Ref[]>();
    for (const name of repo.refs?.remoteNames ?? []) m.set(name, []);
    for (const r of remotes) {
      const list = m.get(r.remote!);
      if (list) list.push(r);
      else m.set(r.remote!, [r]);
    }
    return m;
  });
  // Auto-expand sections while filtering.
  const filtering = $derived(!!repo.filter.trim());
  const isOpen = (k: string) => filtering || open[k];

  function host(url?: string) {
    if (!url) return "";
    try {
      return gitUrlParse(url).resource;
    } catch {
      return "";
    }
  }

  function selectRef(r: Ref) {
    if (repo.indexByHash.has(r.hash)) repo.select(r.hash);
  }
  function selectStash(s: Stash) {
    repo.select(s.hash);
  }

  /** Nest branches by "/" (feature/a, feature/b → feature › a, b). */
  function folders(list: Ref[], prefix = "") {
    const flat: Ref[] = [];
    const groups = new Map<string, Ref[]>();
    for (const r of list) {
      const name = prefix ? r.shortName.slice(prefix.length) : r.shortName;
      const slash = name.indexOf("/");
      if (slash > 0 && !filtering) {
        const g = name.slice(0, slash);
        const list = groups.get(g);
        if (list) list.push(r);
        else groups.set(g, [r]);
      } else flat.push(r);
    }
    return { flat, groups };
  }
</script>

{#snippet section(
  key: string,
  label: string,
  Icon: any,
  count: number,
  body: any,
  extra?: any,
)}
  <div class="border-b">
    <div class="group flex h-8 items-center gap-1 pr-2 pl-1">
      <button
        class="flex flex-1 items-center gap-1.5 text-left text-xs font-semibold tracking-wide uppercase"
        onclick={() => (open[key] = !open[key])}
      >
        <ChevronRightIcon
          class={cn("size-4 transition-transform", isOpen(key) && "rotate-90")}
        />
        <Icon class="size-3.5" />
        {label}
      </button>
      {@render extra?.()}
      <span class="text-muted-foreground text-xs tabular-nums">{count}</span>
    </div>
    {#if isOpen(key)}
      <div class="pb-1">{@render body()}</div>
    {/if}
  </div>
{/snippet}

{#snippet branchRow(b: Ref, depth: number, label: string)}
  <div
    class={cn(
      "group hover:bg-row-hover flex h-7 cursor-default items-center gap-1.5 pr-1 text-[13px]",
      repo.selected === b.hash && "bg-row-selected/60",
    )}
    style="padding-left: {12 + depth * 12}px"
    role="button"
    tabindex="-1"
    title={b.shortName}
    onclick={() => selectRef(b)}
    ondblclick={() => actions.checkoutRef(repo, b)}
    onkeydown={(e) => e.key === "Enter" && actions.checkoutRef(repo, b)}
    oncontextmenu={(e) => {
      e.preventDefault();
      refMenu = b.name;
    }}
  >
    {#if b.kind === "branch"}
      {#if b.isHead}
        <CheckIcon class="text-status-added size-3.5 shrink-0" />
      {:else}
        <GitBranchIcon class="text-muted-foreground size-3.5 shrink-0" />
      {/if}
    {:else if b.kind === "tag"}
      <TagIcon class="text-muted-foreground size-3.5 shrink-0" />
    {:else}
      <GitBranchIcon class="text-muted-foreground size-3.5 shrink-0" />
    {/if}
    <span class={cn("min-w-0 flex-1 truncate", b.isHead && "font-semibold")}
      >{label}</span
    >
    {#if b.ahead || b.behind}
      <span class="text-muted-foreground shrink-0 text-[11px] tabular-nums">
        {#if b.ahead}↑{b.ahead}{/if}{#if b.behind}
          ↓{b.behind}{/if}
      </span>
    {/if}
    {#if b.upstreamGone}<span
        class="text-status-deleted text-[10px]"
        title="Upstream is gone">gone</span
      >{/if}
    <DropdownMenu.Root
      bind:open={
        () => refMenu === b.name, (v) => (refMenu = v ? b.name : null)
      }
    >
      <DropdownMenu.Trigger
        class="hover:bg-accent invisible rounded p-0.5 group-hover:visible data-[state=open]:visible"
        onclick={(e) => e.stopPropagation()}
      >
        <EllipsisVerticalIcon class="size-3.5" />
      </DropdownMenu.Trigger>
      <DropdownMenu.Content align="start" class="w-60">
        {#if !b.isHead}
          <DropdownMenu.Item onclick={() => actions.checkoutRef(repo, b)}
            >Checkout</DropdownMenu.Item
          >
        {/if}
        {#if b.kind === "branch"}
          {@const remoteNames = repo.refs?.remoteNames ?? []}
          {#if b.isHead && b.upstream && !b.upstreamGone}
            <DropdownMenu.Item onclick={() => actions.pull(repo)}
              >Pull (fast-forward)</DropdownMenu.Item
            >
          {/if}
          {#if b.upstream && !b.upstreamGone}
            <DropdownMenu.Item onclick={() => actions.pushBranch(repo, b)}
              >Push to {b.upstream}</DropdownMenu.Item
            >
          {:else if remoteNames.length === 1}
            <DropdownMenu.Item
              onclick={() => actions.pushBranch(repo, b, remoteNames[0])}
              >Push to {remoteNames[0]}</DropdownMenu.Item
            >
          {:else if remoteNames.length > 1}
            <DropdownMenu.Sub>
              <DropdownMenu.SubTrigger>Push to</DropdownMenu.SubTrigger>
              <DropdownMenu.SubContent class="min-w-40">
                {#each remoteNames as r (r)}
                  <DropdownMenu.Item
                    onclick={() => actions.pushBranch(repo, b, r)}
                    >{r}</DropdownMenu.Item
                  >
                {/each}
              </DropdownMenu.SubContent>
            </DropdownMenu.Sub>
          {/if}
          {#if !b.isHead || b.upstream || remoteNames.length}
            <DropdownMenu.Separator />
          {/if}
        {:else if b.kind === "remote" && headRef && headRef.upstream !== b.shortName}
          <DropdownMenu.Item
            onclick={() =>
              actions.setUpstream(repo, headRef.shortName, b.shortName)}
            >Track from {headRef.shortName}</DropdownMenu.Item
          >
        {/if}
        {#if b.kind !== "tag" && !b.isHead && repo.refs?.head.branch}
          <DropdownMenu.Item
            onclick={() => actions.mergeInto(repo, b.shortName)}
            >Merge into {repo.refs.head.branch}</DropdownMenu.Item
          >
          <DropdownMenu.Item
            onclick={() => actions.rebaseOnto(repo, b.shortName)}
            >Rebase {repo.refs.head.branch} onto this</DropdownMenu.Item
          >
        {/if}
        <DropdownMenu.Item onclick={() => actions.createBranch(repo, b.hash)}
          >Create branch here…</DropdownMenu.Item
        >
        <DropdownMenu.Separator />
        {#if b.kind === "branch"}
          <DropdownMenu.Sub>
            <DropdownMenu.SubTrigger>
              Tracking
              {#if b.upstream}<span
                  class="text-muted-foreground ml-auto max-w-28 truncate pl-2 text-xs"
                  >{b.upstream}</span
                >{/if}
            </DropdownMenu.SubTrigger>
            <DropdownMenu.SubContent
              class="max-h-80 min-w-44 overflow-y-auto"
            >
              {#each repo.refs?.remotes ?? [] as r (r.name)}
                <DropdownMenu.Item
                  onclick={() =>
                    r.shortName !== b.upstream &&
                    actions.setUpstream(repo, b.shortName, r.shortName)}
                >
                  <CheckIcon
                    class={cn(
                      "size-3.5",
                      r.shortName !== b.upstream && "invisible",
                    )}
                  />
                  {r.shortName}
                </DropdownMenu.Item>
              {:else}
                <DropdownMenu.Item disabled>No remote branches</DropdownMenu.Item>
              {/each}
              {#if b.upstream}
                <DropdownMenu.Separator />
                <DropdownMenu.Item
                  onclick={() => actions.setUpstream(repo, b.shortName, null)}
                  >Stop tracking {b.upstream}</DropdownMenu.Item
                >
              {/if}
            </DropdownMenu.SubContent>
          </DropdownMenu.Sub>
          <DropdownMenu.Item onclick={() => actions.renameBranch(repo, b)}
            >Rename…</DropdownMenu.Item
          >
          {#if !b.isHead}<DropdownMenu.Item
              class="text-destructive"
              onclick={() => actions.deleteBranch(repo, b)}
              >Delete</DropdownMenu.Item
            >{/if}
        {:else if b.kind === "remote"}
          <DropdownMenu.Item
            class="text-destructive"
            onclick={() => actions.deleteBranch(repo, b)}
            >Delete on remote</DropdownMenu.Item
          >
        {:else}
          {@const remoteNames = repo.refs?.remoteNames ?? []}
          {#if remoteNames.length === 1}
            <DropdownMenu.Item
              onclick={() => actions.pushTag(repo, b, remoteNames[0])}
              >Push to {remoteNames[0]}</DropdownMenu.Item
            >
          {:else if remoteNames.length > 1}
            <DropdownMenu.Sub>
              <DropdownMenu.SubTrigger>Push to</DropdownMenu.SubTrigger>
              <DropdownMenu.SubContent class="min-w-40">
                {#each remoteNames as r (r)}
                  <DropdownMenu.Item
                    onclick={() => actions.pushTag(repo, b, r)}
                    >{r}</DropdownMenu.Item
                  >
                {/each}
              </DropdownMenu.SubContent>
            </DropdownMenu.Sub>
          {/if}
          <DropdownMenu.Item
            class="text-destructive"
            onclick={() => actions.deleteTag(repo, b)}
            >Delete tag…</DropdownMenu.Item
          >
        {/if}
        <DropdownMenu.Separator />
        <DropdownMenu.Item
          onclick={() => actions.copyText(b.shortName, "Name copied")}
          >Copy name</DropdownMenu.Item
        >
      </DropdownMenu.Content>
    </DropdownMenu.Root>
  </div>
{/snippet}

{#snippet refTree(list: Ref[], depth: number, prefix: string)}
  {@const f = folders(list, prefix)}
  {#each [...f.groups] as [g, refs] (g)}
    {@const key = `folder:${prefix}${g}`}
    <button
      class="hover:bg-row-hover text-muted-foreground flex h-7 w-full items-center gap-1 text-[13px]"
      style="padding-left: {8 + depth * 12}px"
      onclick={() => (open[key] = !(open[key] ?? true))}
    >
      <ChevronRightIcon
        class={cn(
          "size-3.5 transition-transform",
          (open[key] ?? true) && "rotate-90",
        )}
      />
      <FolderIcon class="size-3.5" />{g}
    </button>
    {#if open[key] ?? true}
      {@render refTree(refs, depth + 1, `${prefix}${g}/`)}
    {/if}
  {/each}
  {#each f.flat as b (b.name)}
    {@render branchRow(
      b,
      depth,
      filtering ? b.shortName : b.shortName.slice(prefix.length),
    )}
  {/each}
{/snippet}

{#if appState.sidebarOpen}
  <div class="bg-panel flex h-full min-h-0 flex-col">
    <div class="flex h-10 shrink-0 items-center gap-2 border-b px-2">
      <button
        class="hover:bg-accent rounded p-1"
        title="Collapse panel (Ctrl+J)"
        onclick={() => (appState.sidebarOpen = false)}
      >
        <ChevronLeftIcon class="size-4" />
      </button>
      <div
        class="bg-background flex h-7 min-w-0 flex-1 items-center gap-1 rounded border px-2"
      >
        <input
          class="placeholder:text-muted-foreground min-w-0 flex-1 bg-transparent text-xs outline-none"
          placeholder="Filter"
          bind:value={repo.filter}
          spellcheck="false"
        />
        <SearchIcon class="text-muted-foreground size-3.5" />
      </div>
    </div>
    <div class="min-h-0 flex-1 overflow-auto">
      {#snippet localBody()}
        {#if branches.length}{@render refTree(branches, 0, "")}{:else}<div
            class="text-muted-foreground px-4 py-1 text-xs"
          >
            No branches
          </div>{/if}
      {/snippet}
      {@render section(
        "local",
        "Local",
        LaptopIcon,
        repo.refs?.branches.length ?? 0,
        localBody,
      )}

      {#snippet remoteBody()}
        {#each [...byRemote] as [name, refs] (name)}
          {@const key = `remote:${name}`}
          <div
            class="group hover:bg-row-hover flex h-7 w-full cursor-default items-center gap-1.5 pr-1 pl-3 text-[13px]"
            role="button"
            tabindex="-1"
            title={remoteUrls[name]}
            onclick={() => (open[key] = !(open[key] ?? true))}
            onkeydown={(e) =>
              e.key === "Enter" && (open[key] = !(open[key] ?? true))}
            oncontextmenu={(e) => {
              e.preventDefault();
              remoteMenu = name;
            }}
          >
            <ChevronRightIcon
              class={cn(
                "size-3.5 shrink-0 transition-transform",
                (filtering || (open[key] ?? true)) && "rotate-90",
              )}
            />
            <CloudIcon class="size-3.5 shrink-0" />
            <span class="truncate">{name}</span>
            <span
              class="text-muted-foreground ml-auto truncate pr-1 text-[11px]"
              >{host(remoteUrls[name])}</span
            >
            <DropdownMenu.Root
              bind:open={
                () => remoteMenu === name, (v) => (remoteMenu = v ? name : null)
              }
            >
              <DropdownMenu.Trigger
                class="hover:bg-accent invisible shrink-0 rounded p-0.5 group-hover:visible data-[state=open]:visible"
                title="Remote actions"
                onclick={(e) => e.stopPropagation()}
              >
                <EllipsisVerticalIcon class="size-3.5" />
              </DropdownMenu.Trigger>
              <DropdownMenu.Content align="start" class="w-56">
                <DropdownMenu.Item
                  onclick={() => actions.fetchRemote(repo, name)}
                  >Fetch {name}</DropdownMenu.Item
                >
                {#if repo.usesLfs}
                  <DropdownMenu.Item
                    onclick={() => actions.lfsFetch(repo, name)}
                    >Fetch LFS objects from {name}</DropdownMenu.Item
                  >
                {/if}
                <DropdownMenu.Separator />
                <DropdownMenu.Item
                  onclick={() => actions.editRemote(repo, name)}
                  >Edit {name}…</DropdownMenu.Item
                >
                <DropdownMenu.Item
                  class="text-destructive"
                  onclick={() => actions.removeRemote(repo, name)}
                  >Remove {name}</DropdownMenu.Item
                >
                {#if remoteUrls[name]}
                  <DropdownMenu.Separator />
                  <DropdownMenu.Item
                    onclick={() =>
                      actions.copyText(remoteUrls[name], "Remote URL copied")}
                    >Copy remote URL</DropdownMenu.Item
                  >
                {/if}
              </DropdownMenu.Content>
            </DropdownMenu.Root>
          </div>
          {#if filtering || (open[key] ?? true)}
            {#each refs as r (r.name)}
              {@render branchRow(r, 2, r.shortName.slice(name.length + 1))}
            {/each}
          {/if}
        {:else}
          <div class="text-muted-foreground px-4 py-1 text-xs">
            No remotes · <button
              class="text-primary hover:underline"
              onclick={() => actions.addRemote(repo)}>Add remote</button
            >
          </div>
        {/each}
      {/snippet}
      {#snippet remoteExtra()}
        <button
          class="hover:bg-accent invisible rounded p-0.5 group-hover:visible"
          title="Add remote"
          onclick={() => actions.addRemote(repo)}
        >
          <PlusIcon class="size-3.5" />
        </button>
      {/snippet}
      {@render section(
        "remote",
        "Remote",
        CloudIcon,
        repo.refs?.remoteNames.length ?? 0,
        remoteBody,
        remoteExtra,
      )}

      {#snippet stashBody()}
        {#each stashes as s (s.hash)}
          <div
            class={cn(
              "group hover:bg-row-hover flex h-7 cursor-default items-center gap-1.5 pr-1 pl-3 text-[13px]",
              repo.selected === s.hash && "bg-row-selected/60",
            )}
            role="button"
            tabindex="-1"
            title={s.message}
            onclick={() => selectStash(s)}
            ondblclick={() => actions.stashApply(repo, s.index)}
            onkeydown={(e) => e.key === "Enter" && selectStash(s)}
          >
            <ArchiveIcon class="text-muted-foreground size-3.5 shrink-0" />
            <span class="min-w-0 flex-1 truncate">{s.message}</span>
            <DropdownMenu.Root>
              <DropdownMenu.Trigger
                class="hover:bg-accent invisible rounded p-0.5 group-hover:visible"
                onclick={(e) => e.stopPropagation()}
              >
                <EllipsisVerticalIcon class="size-3.5" />
              </DropdownMenu.Trigger>
              <DropdownMenu.Content align="start">
                <DropdownMenu.Item
                  onclick={() => actions.stashApply(repo, s.index)}
                  >Apply</DropdownMenu.Item
                >
                <DropdownMenu.Item
                  onclick={() => actions.stashPop(repo, s.index)}
                  >Pop</DropdownMenu.Item
                >
                <DropdownMenu.Item
                  class="text-destructive"
                  onclick={() => actions.stashDrop(repo, s.index)}
                  >Delete</DropdownMenu.Item
                >
              </DropdownMenu.Content>
            </DropdownMenu.Root>
          </div>
        {:else}
          <div class="text-muted-foreground px-4 py-1 text-xs">No stashes</div>
        {/each}
      {/snippet}
      {@render section(
        "stashes",
        "Stashes",
        ArchiveIcon,
        repo.refs?.stashes.length ?? 0,
        stashBody,
      )}

      {#snippet tagBody()}
        {#each tags as t (t.name)}
          {@render branchRow(t, 0, t.shortName)}
        {:else}
          <div class="text-muted-foreground px-4 py-1 text-xs">No tags</div>
        {/each}
      {/snippet}
      {@render section(
        "tags",
        "Tags",
        TagIcon,
        repo.refs?.tags.length ?? 0,
        tagBody,
      )}
    </div>
  </div>
{:else}
  <!-- Collapsed icon rail -->
  <div
    class="bg-panel flex h-full w-11 flex-col items-center gap-3 border-r py-2"
  >
    <button
      class="hover:bg-accent rounded p-1"
      title="Expand panel (Ctrl+J)"
      onclick={() => (appState.sidebarOpen = true)}
    >
      <ChevronRightIcon class="size-4" />
    </button>
    {#each [["local", LaptopIcon, repo.refs?.branches.length], ["remote", CloudIcon, repo.refs?.remoteNames.length], ["stashes", ArchiveIcon, repo.refs?.stashes.length], ["tags", TagIcon, repo.refs?.tags.length]] as const as [k, Icon, n] (k)}
      <button
        class="text-muted-foreground hover:text-foreground flex flex-col items-center text-[10px]"
        title={k}
        onclick={() => {
          appState.sidebarOpen = true;
          open[k] = true;
        }}
      >
        <Icon class="size-4" />{n ?? 0}
      </button>
    {/each}
  </div>
{/if}
