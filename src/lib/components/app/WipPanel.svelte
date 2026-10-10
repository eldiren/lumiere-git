<script lang="ts">
  import Trash2Icon from "@lucide/svelte/icons/trash-2";
  import ChevronDownIcon from "@lucide/svelte/icons/chevron-down";
  import UndoIcon from "@lucide/svelte/icons/undo-2";
  import GitCommitIcon from "@lucide/svelte/icons/git-commit-horizontal";
  import TriangleAlertIcon from "@lucide/svelte/icons/triangle-alert";
  import { Button } from "$lib/components/ui/button";
  import { Checkbox } from "$lib/components/ui/checkbox";
  import { Textarea } from "$lib/components/ui/textarea";
  import * as ContextMenu from "$lib/components/ui/context-menu";
  import { cn } from "$lib/utils";
  import type { RepoTab } from "$lib/stores/repo.svelte";
  import { dialogs } from "$lib/stores/dialogs.svelte";
  import * as actions from "$lib/actions";
  import type { FileChange } from "$shared/types";
  import FileList from "./FileList.svelte";
  import ViewToggle from "./ViewToggle.svelte";

  let { repo }: { repo: RepoTab } = $props();

  const st = $derived(repo.status);
  let unstagedOpen = $state(true);
  let stagedOpen = $state(true);

  let unstagedSel = $state<Set<string>>(new Set());
  let stagedSel = $state<Set<string>>(new Set());
  // Only count selected paths that still exist after a status refresh.
  const unstagedPicked = $derived(
    st ? st.unstaged.filter((f) => unstagedSel.has(f.path)) : [],
  );
  const stagedPicked = $derived(
    st ? st.staged.filter((f) => stagedSel.has(f.path)) : [],
  );
  const plural = (n: number) => `${n} File${n === 1 ? "" : "s"}`;

  function stageSelected() {
    const paths = unstagedPicked.map((f) => f.path);
    unstagedSel = new Set();
    repo.run("Stage", (api) => api.stage(paths));
  }
  function unstageSelected() {
    const paths = stagedPicked.flatMap((f) =>
      f.oldPath ? [f.oldPath, f.path] : [f.path],
    );
    stagedSel = new Set();
    repo.run("Unstage", (api) => api.unstage(paths));
  }

  const selectedPath = $derived(
    repo.diff && repo.diff.source.kind !== "commit"
      ? repo.diff.file.path
      : null,
  );
  const canCommit = $derived(
    !!repo.draftSummary.trim() &&
      ((st?.staged.length ?? 0) > 0 || repo.amend || st?.state === "merging") &&
      !st?.conflicted.length,
  );

  // Prefill merge messages etc.
  $effect(() => {
    if (st?.pendingMessage && !repo.draftSummary) {
      const [first, ...rest] = st.pendingMessage.split("\n");
      repo.draftSummary = first;
      repo.draftBody = rest.join("\n").trim();
    }
  });

  async function toggleAmend(v: boolean) {
    repo.amend = v;
    if (v && !repo.draftSummary.trim()) {
      const msg = await repo.api.lastCommitMessage();
      const [first, ...rest] = msg.split("\n");
      repo.draftSummary = first;
      repo.draftBody = rest.join("\n").trim();
    }
  }

  async function commit() {
    if (!canCommit) return;
    const message = repo.draftBody.trim()
      ? `${repo.draftSummary.trim()}\n\n${repo.draftBody.trim()}`
      : repo.draftSummary.trim();
    const ok = await repo.run(repo.amend ? "Amend" : "Commit", (api) =>
      api.commit(message, { amend: repo.amend }),
    );
    if (ok) {
      repo.draftSummary = "";
      repo.draftBody = "";
      repo.amend = false;
      if (!repo.changeCount) repo.select(repo.refs?.head.hash ?? null);
    }
  }

  function stage(f: FileChange) {
    repo.run("Stage", (api) => api.stage([f.path]));
  }
  function unstage(f: FileChange) {
    repo.run("Unstage", (api) =>
      api.unstage(f.oldPath ? [f.oldPath, f.path] : [f.path]),
    );
  }
  async function discard(files: FileChange[]) {
    if (!files.length) return;
    const untracked = files.filter((f) => f.status === "?");
    const tracked = files.filter((f) => f.status !== "?");
    const ok = await dialogs.confirm({
      title:
        files.length === 1
          ? `Discard changes to ${files[0].path}?`
          : `Discard changes to ${plural(files.length).toLowerCase()}?`,
      description:
        files.length === 1
          ? untracked.length
            ? "The untracked file will be deleted."
            : "Your changes to this file will be lost."
          : untracked.length
            ? `Your changes will be lost and ${untracked.length} untracked file${untracked.length === 1 ? "" : "s"} will be deleted.`
            : "Your changes to these files will be lost.",
      confirmLabel: "Discard",
      destructive: true,
    });
    if (!ok) return;
    unstagedSel = new Set();
    repo.run("Discard", (api) =>
      api.discard(
        tracked.map((f) => f.path),
        untracked.map((f) => f.path),
      ),
    );
  }

  // Files the open context menu applies to (set by FileList's oncontext).
  let unstagedMenu = $state<FileChange[]>([]);
  let stagedMenu = $state<FileChange[]>([]);
  // Right-clicking empty space in a list shouldn't open an empty menu.
  // Reads the list lazily: FileList's handler fills it earlier in the same bubbling event.
  const skipEmpty = (files: () => FileChange[]) => (e: MouseEvent) => {
    if (!files().length) e.preventDefault();
  };

  const stateLabel: Record<string, string> = {
    merging: "Merge in progress",
    rebasing: "Rebase in progress",
    "cherry-picking": "Cherry-pick in progress",
    reverting: "Revert in progress",
    bisecting: "Bisect in progress",
  };
</script>

{#snippet sectionHeader(
  label: string,
  count: number,
  open: boolean,
  toggle: () => void,
  button?: { label: string; onclick: () => void; variant?: string },
)}
  <div class="flex h-9 shrink-0 items-center gap-1 px-2">
    <button
      class="flex flex-1 items-center gap-1 text-left text-sm"
      onclick={toggle}
    >
      <ChevronDownIcon
        class={cn("size-4 transition-transform", !open && "-rotate-90")}
      />
      {label} ({count})
    </button>
    {#if button && count > 0}
      <Button
        size="sm"
        variant="outline"
        class={cn(
          "h-6 px-2 text-xs",
          button.variant === "stage"
            ? "border-status-added/60 text-status-added hover:bg-status-added/10"
            : "border-status-deleted/60 text-status-deleted hover:bg-status-deleted/10",
        )}
        onclick={button.onclick}>{button.label}</Button
      >
    {/if}
  </div>
{/snippet}

{#if st}
  <div class="flex h-full min-h-0 flex-col">
    <div class="flex h-10 shrink-0 items-center gap-2 border-b px-2">
      <Button
        size="icon"
        variant="ghost"
        class="text-destructive size-7"
        title="Discard all changes"
        onclick={() => actions.discardAll(repo)}
      >
        <Trash2Icon class="size-4" />
      </Button>
      <div class="flex-1 text-center text-sm">
        {repo.changeCount} file change{repo.changeCount === 1 ? "" : "s"} on
        <span class="bg-ref-pill rounded px-1.5 py-0.5 text-white"
          >{st.branch ?? "detached HEAD"}</span
        >
      </div>
    </div>

    {#if st.state !== "clean"}
      <div
        class="bg-status-modified/15 flex shrink-0 items-center gap-2 border-b px-3 py-2 text-sm"
      >
        <TriangleAlertIcon class="text-status-modified size-4" />
        <span class="flex-1"
          >{stateLabel[st.state]}{st.conflicted.length
            ? ` — ${st.conflicted.length} conflicted`
            : ""}</span
        >
        <Button
          size="sm"
          variant="outline"
          class="h-6 px-2 text-xs"
          onclick={() => repo.run("Abort", (api) => api.abort(st.state))}
          >Abort</Button
        >
        {#if st.state !== "bisecting"}
          <Button
            size="sm"
            class="h-6 px-2 text-xs"
            disabled={st.conflicted.length > 0}
            onclick={() =>
              repo.run("Continue", (api) => api.continueOp(st.state))}
            >Continue</Button
          >
        {/if}
      </div>
    {/if}

    <div class="flex shrink-0 justify-center py-2">
      <ViewToggle bind:value={repo.fileView} />
    </div>

    <!-- Each section scrolls on its own; while both are open neither takes more than half the space. -->
    <div class="flex min-h-0 flex-1 flex-col">
      {#if st.conflicted.length}
        <section class="flex max-h-[30%] min-h-8 flex-col overflow-hidden">
          <div
            class="text-destructive flex h-8 shrink-0 items-center px-3 text-sm"
          >
            Conflicted Files ({st.conflicted.length})
          </div>
          <div class="min-h-0 overflow-auto">
            <FileList
              files={st.conflicted}
              mode={repo.fileView}
              selected={selectedPath}
              onselect={(f) => repo.openDiff({ kind: "unstaged" }, f)}
            >
              {#snippet actions(f)}
                <Button
                  size="sm"
                  variant="outline"
                  class="h-5 px-1.5 text-[11px]"
                  title="Mark resolved"
                  onclick={(e) => (e.stopPropagation(), stage(f))}
                  >Mark resolved</Button
                >
              {/snippet}
            </FileList>
          </div>
        </section>
      {/if}

      <section
        class={cn(
          "flex min-h-9 flex-col overflow-hidden",
          unstagedOpen ? stagedOpen && "max-h-[50%]" : "shrink-0",
        )}
      >
        {@render sectionHeader(
          "Unstaged Files",
          st.unstaged.length,
          unstagedOpen,
          () => (unstagedOpen = !unstagedOpen),
          unstagedPicked.length > 1
            ? {
                label: `Stage ${plural(unstagedPicked.length)}`,
                variant: "stage",
                onclick: stageSelected,
              }
            : {
                label: "Stage All Changes",
                variant: "stage",
                onclick: () => repo.run("Stage all", (api) => api.stageAll()),
              },
        )}
        {#if unstagedOpen}
          <ContextMenu.Root onOpenChange={(o) => !o && (unstagedMenu = [])}>
            <ContextMenu.Trigger
              class="min-h-0 overflow-auto"
              oncontextmenu={skipEmpty(() => unstagedMenu)}
            >
              <FileList
                files={st.unstaged}
                mode={repo.fileView}
                selected={selectedPath}
                bind:selection={unstagedSel}
                oncontext={(files) => (
                  (stagedSel = new Set()),
                  (unstagedMenu = files)
                )}
                onselect={(f) => (
                  (stagedSel = new Set()),
                  repo.openDiff(
                    { kind: "unstaged", untracked: f.status === "?" },
                    f,
                  )
                )}
              >
                {#snippet actions(f)}
                  <button
                    class="text-muted-foreground hover:text-destructive p-0.5"
                    title="Discard changes"
                    onclick={(e) => (e.stopPropagation(), discard([f]))}
                  >
                    <UndoIcon class="size-3.5" />
                  </button>
                  <Button
                    size="sm"
                    variant="outline"
                    class="border-status-added/60 text-status-added h-5 px-1.5 text-[11px]"
                    onclick={(e) => (e.stopPropagation(), stage(f))}
                    >Stage File</Button
                  >
                {/snippet}
              </FileList>
            </ContextMenu.Trigger>
            <ContextMenu.Content class="w-56">
              <ContextMenu.Item
                onclick={() => {
                  const paths = unstagedMenu.map((f) => f.path);
                  unstagedSel = new Set();
                  repo.run("Stage", (api) => api.stage(paths));
                }}
              >
                Stage {unstagedMenu.length === 1
                  ? "File"
                  : plural(unstagedMenu.length)}
              </ContextMenu.Item>
              <ContextMenu.Separator />
              <ContextMenu.Item
                variant="destructive"
                onclick={() => discard(unstagedMenu)}
              >
                Discard Changes{unstagedMenu.length > 1
                  ? ` to ${plural(unstagedMenu.length)}`
                  : ""}
              </ContextMenu.Item>
            </ContextMenu.Content>
          </ContextMenu.Root>
        {/if}
      </section>

      <div class="mt-1 shrink-0 border-t"></div>
      <section
        class={cn(
          "flex min-h-9 flex-col overflow-hidden",
          stagedOpen ? unstagedOpen && "max-h-[50%]" : "shrink-0",
        )}
      >
        {@render sectionHeader(
          "Staged Files",
          st.staged.length,
          stagedOpen,
          () => (stagedOpen = !stagedOpen),
          stagedPicked.length > 1
            ? {
                label: `Unstage ${plural(stagedPicked.length)}`,
                onclick: unstageSelected,
              }
            : {
                label: "Unstage All",
                onclick: () =>
                  repo.run("Unstage all", (api) => api.unstageAll()),
              },
        )}
        {#if stagedOpen}
          <ContextMenu.Root onOpenChange={(o) => !o && (stagedMenu = [])}>
            <ContextMenu.Trigger
              class="min-h-0 overflow-auto"
              oncontextmenu={skipEmpty(() => stagedMenu)}
            >
              <FileList
                files={st.staged}
                mode={repo.fileView}
                selected={selectedPath}
                bind:selection={stagedSel}
                oncontext={(files) => (
                  (unstagedSel = new Set()),
                  (stagedMenu = files)
                )}
                onselect={(f) => (
                  (unstagedSel = new Set()),
                  repo.openDiff({ kind: "staged" }, f)
                )}
              >
                {#snippet actions(f)}
                  <Button
                    size="sm"
                    variant="outline"
                    class="border-status-deleted/60 text-status-deleted h-5 px-1.5 text-[11px]"
                    onclick={(e) => (e.stopPropagation(), unstage(f))}
                    >Unstage File</Button
                  >
                {/snippet}
              </FileList>
            </ContextMenu.Trigger>
            <ContextMenu.Content class="w-56">
              <ContextMenu.Item
                onclick={() => {
                  const paths = stagedMenu.flatMap((f) =>
                    f.oldPath ? [f.oldPath, f.path] : [f.path],
                  );
                  stagedSel = new Set();
                  repo.run("Unstage", (api) => api.unstage(paths));
                }}
              >
                Unstage {stagedMenu.length === 1
                  ? "File"
                  : plural(stagedMenu.length)}
              </ContextMenu.Item>
            </ContextMenu.Content>
          </ContextMenu.Root>
        {/if}
      </section>
    </div>

    <!-- Commit composer -->
    <div class="flex shrink-0 flex-col gap-2 border-t p-2">
      <div class="flex items-center gap-2 text-sm">
        <GitCommitIcon class="text-muted-foreground size-4" />
        <span class="flex-1 font-medium">Commit</span>
        <label class="text-muted-foreground flex items-center gap-1.5 text-xs">
          <Checkbox
            checked={repo.amend}
            onCheckedChange={(v) => toggleAmend(!!v)}
            disabled={!repo.refs?.head.hash}
          />
          Amend previous commit
        </label>
      </div>
      <div class="bg-card rounded-md border">
        <div class="relative">
          <input
            class="placeholder:text-muted-foreground h-9 w-full bg-transparent px-2.5 pr-10 text-sm outline-none"
            placeholder="Commit summary"
            bind:value={repo.draftSummary}
            spellcheck="true"
            onkeydown={(e) => {
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) commit();
            }}
          />
          <span
            class={cn(
              "absolute top-2.5 right-2 text-[11px] tabular-nums",
              repo.draftSummary.length > 72
                ? "text-status-deleted"
                : "text-muted-foreground",
            )}
          >
            {72 - repo.draftSummary.length}
          </span>
        </div>
        <Textarea
          class="min-h-20 resize-none rounded-none border-0 border-t bg-transparent! text-sm shadow-none focus-visible:ring-0"
          placeholder="Description"
          bind:value={repo.draftBody}
          onkeydown={(e) => {
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) commit();
          }}
        />
      </div>
      <Button
        class="w-full"
        disabled={!canCommit || !!repo.busy}
        onclick={commit}
      >
        {#if !st.staged.length && !repo.amend && st.state !== "merging"}
          Stage Changes to Commit
        {:else if !repo.draftSummary.trim()}
          Type a Commit Message
        {:else if repo.amend}
          Amend Previous Commit
        {:else}
          Commit Changes to {st.staged.length} File{st.staged.length === 1
            ? ""
            : "s"}
        {/if}
      </Button>
    </div>
  </div>
{/if}
