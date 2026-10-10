<script lang="ts">
  import Undo2Icon from "@lucide/svelte/icons/undo-2";
  import Redo2Icon from "@lucide/svelte/icons/redo-2";
  import ArrowDownToLineIcon from "@lucide/svelte/icons/arrow-down-to-line";
  import ArrowUpFromLineIcon from "@lucide/svelte/icons/arrow-up-from-line";
  import GitBranchPlusIcon from "@lucide/svelte/icons/git-branch-plus";
  import ArchiveIcon from "@lucide/svelte/icons/archive";
  import ArchiveRestoreIcon from "@lucide/svelte/icons/archive-restore";
  import TerminalIcon from "@lucide/svelte/icons/square-terminal";
  import SearchIcon from "@lucide/svelte/icons/search";
  import ChevronDownIcon from "@lucide/svelte/icons/chevron-down";
  import ChevronRightIcon from "@lucide/svelte/icons/chevron-right";
  import FolderOpenIcon from "@lucide/svelte/icons/folder-open";
  import CheckIcon from "@lucide/svelte/icons/check";
  import * as DropdownMenu from "$lib/components/ui/dropdown-menu";
  import * as Popover from "$lib/components/ui/popover";
  import * as Command from "$lib/components/ui/command";
  import type { RepoTab } from "$lib/stores/repo.svelte";
  import { appState } from "$lib/stores/app.svelte";
  import * as actions from "$lib/actions";
  import { app as appApi } from "$lib/api";
  import ToolButton from "./ToolButton.svelte";

  let {
    repo,
    searchOpen = $bindable(false),
  }: { repo: RepoTab; searchOpen?: boolean } = $props();

  let branchOpen = $state(false);
  const head = $derived(repo.refs?.head);
  const branchLabel = $derived(
    head?.branch ?? (head?.hash ? `${head.hash.slice(0, 7)} (detached)` : "—"),
  );
  const current = $derived(repo.refs?.branches.find((b) => b.isHead));
  const noRemotes = $derived(!repo.refs?.remoteNames.length);
</script>

<div class="bg-toolbar flex h-14 shrink-0 items-center gap-1 border-b px-3">
  <!-- Repository / branch pickers -->
  <div class="flex min-w-0 items-center gap-2">
    <DropdownMenu.Root>
      <DropdownMenu.Trigger
        class="hover:bg-accent flex min-w-0 flex-col items-start rounded px-2 py-0.5 text-left"
      >
        <span class="text-muted-foreground text-[10px]">repository</span>
        <span
          class="flex max-w-56 items-center gap-1 truncate text-[15px] font-semibold"
        >
          <span class="truncate">{repo.name}</span><ChevronDownIcon
            class="size-3.5 shrink-0"
          />
        </span>
      </DropdownMenu.Trigger>
      <DropdownMenu.Content class="w-72" align="start">
        <DropdownMenu.Label class="text-muted-foreground text-xs"
          >Recent repositories</DropdownMenu.Label
        >
        {#each appState.settings?.recent ?? [] as r (r.path)}
          <DropdownMenu.Item
            onclick={() => appState.openRepo(r.path)}
            title={r.path}
          >
            <span class="truncate">{r.name}</span>
            <span
              class="text-muted-foreground ml-auto max-w-32 truncate text-[11px]"
              >{r.path}</span
            >
          </DropdownMenu.Item>
        {/each}
        <DropdownMenu.Separator />
        <DropdownMenu.Item onclick={() => appState.openRepoDialog()}
          ><FolderOpenIcon class="size-4" /> Open repository…</DropdownMenu.Item
        >
        <DropdownMenu.Item onclick={() => appApi.showInFolder(repo.root)}
          >Show in file manager</DropdownMenu.Item
        >
      </DropdownMenu.Content>
    </DropdownMenu.Root>

    <ChevronRightIcon class="text-muted-foreground size-4 shrink-0" />

    <Popover.Root bind:open={branchOpen}>
      <Popover.Trigger
        class="hover:bg-accent flex min-w-0 flex-col items-start rounded px-2 py-0.5 text-left"
      >
        <span class="text-muted-foreground text-[10px]">branch</span>
        <span class="flex max-w-56 items-center gap-1 text-[15px]">
          <span class="truncate">{branchLabel}</span><ChevronDownIcon
            class="size-3.5 shrink-0"
          />
        </span>
      </Popover.Trigger>
      <Popover.Content class="w-80 p-0" align="start">
        <Command.Root>
          <Command.Input placeholder="Checkout branch…" />
          <Command.List class="max-h-80">
            <Command.Empty>No branches found.</Command.Empty>
            <Command.Group heading="Local">
              {#each repo.refs?.branches ?? [] as b (b.name)}
                <Command.Item
                  value={b.shortName}
                  onSelect={() => {
                    branchOpen = false;
                    actions.checkoutRef(repo, b);
                  }}
                >
                  <CheckIcon class="size-4 {b.isHead ? '' : 'opacity-0'}" />
                  <span class="truncate">{b.shortName}</span>
                  {#if b.ahead || b.behind}
                    <span class="text-muted-foreground ml-auto text-[11px]"
                      >{b.ahead ? `↑${b.ahead}` : ""}
                      {b.behind ? `↓${b.behind}` : ""}</span
                    >
                  {/if}
                </Command.Item>
              {/each}
            </Command.Group>
            {#if repo.refs?.remotes.length}
              <Command.Group heading="Remote">
                {#each repo.refs.remotes as r (r.name)}
                  <Command.Item
                    value={r.shortName}
                    onSelect={() => {
                      branchOpen = false;
                      actions.checkoutRef(repo, r);
                    }}
                  >
                    <span class="w-4"></span><span class="truncate"
                      >{r.shortName}</span
                    >
                  </Command.Item>
                {/each}
              </Command.Group>
            {/if}
          </Command.List>
        </Command.Root>
      </Popover.Content>
    </Popover.Root>
  </div>

  <div class="flex-1"></div>

  <!-- Actions -->
  <div class="flex items-center gap-0.5">
    <ToolButton
      label="Undo"
      icon={Undo2Icon}
      title={repo.journal.undoLabel
        ? `Undo ${repo.journal.undoLabel}`
        : "Nothing to undo"}
      disabled={!repo.journal.canUndo}
      onclick={() => actions.undo(repo)}
    />
    <ToolButton
      label="Redo"
      icon={Redo2Icon}
      title={repo.journal.redoLabel
        ? `Redo ${repo.journal.redoLabel}`
        : "Nothing to redo"}
      disabled={!repo.journal.canRedo}
      onclick={() => actions.redo(repo)}
    />
    <div class="bg-border mx-1 h-8 w-px"></div>
    <ToolButton
      label="Pull"
      icon={ArrowDownToLineIcon}
      title={current?.behind
        ? `Pull (${current.behind} behind)`
        : "Pull (fast-forward if possible)"}
      disabled={noRemotes}
      onclick={() => actions.pull(repo)}
    >
      {#if current?.behind}
        <span
          class="bg-primary absolute top-0 right-3 rounded-full px-1 text-[9px] text-white"
          >{current.behind}</span
        >
      {/if}
      <DropdownMenu.Root>
        <DropdownMenu.Trigger
          class="text-muted-foreground hover:bg-accent -ml-1 self-end rounded px-0.5 pb-1.5"
          disabled={noRemotes}
          aria-label="Pull options"
        >
          <ChevronDownIcon class="size-3" />
        </DropdownMenu.Trigger>
        <DropdownMenu.Content align="end">
          <DropdownMenu.Item onclick={() => actions.fetchAll(repo)}
            >Fetch all</DropdownMenu.Item
          >
          <DropdownMenu.Item onclick={() => actions.pull(repo, "ff-only")}
            >Pull (fast-forward only)</DropdownMenu.Item
          >
          <DropdownMenu.Item onclick={() => actions.pull(repo, "merge")}
            >Pull (merge)</DropdownMenu.Item
          >
          <DropdownMenu.Item onclick={() => actions.pull(repo, "rebase")}
            >Pull (rebase)</DropdownMenu.Item
          >
          {#if repo.usesLfs}
            <DropdownMenu.Separator />
            <DropdownMenu.Item onclick={() => actions.lfsFetch(repo)}
              >Fetch LFS objects</DropdownMenu.Item
            >
            <DropdownMenu.Item onclick={() => actions.lfsFetch(repo, undefined, true)}
              >Fetch LFS objects (all refs)</DropdownMenu.Item
            >
            <DropdownMenu.Item onclick={() => actions.lfsPull(repo)}
              >Pull LFS objects</DropdownMenu.Item
            >
          {/if}
        </DropdownMenu.Content>
      </DropdownMenu.Root>
    </ToolButton>
    <ToolButton
      label="Push"
      icon={ArrowUpFromLineIcon}
      title={current?.ahead ? `Push (${current.ahead} ahead)` : "Push"}
      disabled={noRemotes || !head?.branch}
      onclick={() => actions.pushDialog(repo)}
    >
      {#if current?.ahead}
        <span
          class="bg-primary absolute top-0 right-3 rounded-full px-1 text-[9px] text-white"
          >{current.ahead}</span
        >
      {/if}
      <DropdownMenu.Root>
        <DropdownMenu.Trigger
          class="text-muted-foreground hover:bg-accent -ml-1 self-end rounded px-0.5 pb-1.5"
          disabled={noRemotes || !head?.branch}
          aria-label="Push options"
        >
          <ChevronDownIcon class="size-3" />
        </DropdownMenu.Trigger>
        <DropdownMenu.Content align="end">
          <DropdownMenu.Item onclick={() => actions.pushDialog(repo)}
            >Push…</DropdownMenu.Item
          >
          <DropdownMenu.Item onclick={() => actions.push(repo)}
            >Push now</DropdownMenu.Item
          >
          <DropdownMenu.Item
            class="text-destructive"
            onclick={() => actions.push(repo, true)}
            >Force push (with lease)</DropdownMenu.Item
          >
        </DropdownMenu.Content>
      </DropdownMenu.Root>
    </ToolButton>
    <ToolButton
      label="Branch"
      icon={GitBranchPlusIcon}
      disabled={!head?.hash}
      onclick={() => actions.createBranch(repo)}
    />
    <ToolButton
      label="Stash"
      icon={ArchiveIcon}
      disabled={!repo.changeCount}
      onclick={() => actions.stash(repo)}
    />
    <ToolButton
      label="Pop"
      icon={ArchiveRestoreIcon}
      disabled={!repo.refs?.stashes.length}
      onclick={() => actions.stashPop(repo)}
    />
    <div class="bg-border mx-1 h-8 w-px"></div>
    <ToolButton
      label="Terminal"
      icon={TerminalIcon}
      active={appState.terminalOpen}
      onclick={() => (appState.terminalOpen = !appState.terminalOpen)}
    />
  </div>

  <div class="flex-1"></div>

  <ToolButton
    label="Search"
    icon={SearchIcon}
    active={searchOpen}
    onclick={() => (searchOpen = !searchOpen)}
  />
</div>
