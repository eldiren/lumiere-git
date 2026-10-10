<script lang="ts">
  import moment from "moment";
  import CopyIcon from "@lucide/svelte/icons/copy";
  import { Button } from "$lib/components/ui/button";
  import { WIP, type RepoTab } from "$lib/stores/repo.svelte";
  import { copyText } from "$lib/actions";
  import Avatar from "./Avatar.svelte";
  import FileList from "./FileList.svelte";
  import ViewToggle from "./ViewToggle.svelte";

  let { repo }: { repo: RepoTab } = $props();

  const detail = $derived(repo.detail);
  const c = $derived(detail?.commit);
  const counts = $derived.by(() => {
    const out = { added: 0, modified: 0, deleted: 0, renamed: 0 };
    for (const f of detail?.files ?? []) {
      if (f.status === "A") out.added++;
      else if (f.status === "D") out.deleted++;
      else if (f.status === "R" || f.status === "C") out.renamed++;
      else out.modified++;
    }
    return out;
  });
  const stashItem = $derived.by(() => {
    const it = repo.items[repo.indexByHash.get(repo.selected ?? "") ?? -1];
    return it?.kind === "stash" ? it.stash : null;
  });
</script>

<div class="flex h-full min-h-0 flex-col">
  {#if repo.changeCount}
    <div
      class="bg-primary/25 flex h-9 shrink-0 items-center justify-center gap-3 text-sm"
    >
      {repo.changeCount} file change{repo.changeCount === 1 ? "" : "s"} in working
      directory
      <Button
        size="sm"
        variant="outline"
        class="h-6 bg-transparent px-2 text-xs"
        onclick={() => repo.select(WIP)}>View Changes</Button
      >
    </div>
  {/if}

  {#if c && detail}
    <div class="min-h-0 flex-1 overflow-auto p-3">
      <div class="text-muted-foreground mb-2 flex items-center gap-1.5 text-xs">
        {stashItem ? stashItem.ref : "commit"}:
        <span class="text-foreground selectable font-mono"
          >{c.hash.slice(0, 7)}</span
        >
        <button
          class="hover:text-foreground"
          title="Copy full SHA"
          onclick={() => copyText(c.hash, "Commit SHA copied")}
        >
          <CopyIcon class="size-3" />
        </button>
      </div>

      <div class="bg-card selectable mb-3 rounded-md border p-3">
        <div class="text-base leading-snug font-medium">{c.subject}</div>
        {#if c.body}
          <div
            class="text-muted-foreground mt-2 text-[13px] whitespace-pre-wrap"
          >
            {c.body}
          </div>
        {/if}
      </div>

      <div class="mb-3 flex items-start gap-2.5">
        <Avatar name={c.author.name} email={c.author.email} />
        <div class="min-w-0 flex-1">
          <div class="truncate font-medium">{c.author.name}</div>
          <div class="text-muted-foreground text-xs">
            authored {moment.unix(c.author.date).format("MM/DD/YYYY @ h:mm A")}
          </div>
          {#if c.committer.name !== c.author.name || Math.abs(c.committer.date - c.author.date) > 60}
            <div class="text-muted-foreground text-xs">
              committed by {c.committer.name}
              {moment.unix(c.committer.date).fromNow()}
            </div>
          {/if}
        </div>
        <div class="text-muted-foreground shrink-0 text-right text-xs">
          {#each c.parents as p, i (p)}
            <div>
              {c.parents.length > 1 ? `parent ${i + 1}` : "parent"}:
              <button
                class="text-foreground font-mono hover:underline"
                onclick={() => repo.select(p)}>{p.slice(0, 7)}</button
              >
            </div>
          {/each}
        </div>
      </div>

      <div class="mb-2 flex items-center gap-3 text-xs">
        {#if counts.modified}<span class="text-status-modified"
            >✎ {counts.modified} modified</span
          >{/if}
        {#if counts.added}<span class="text-status-added"
            >+ {counts.added} added</span
          >{/if}
        {#if counts.deleted}<span class="text-status-deleted"
            >− {counts.deleted} deleted</span
          >{/if}
        {#if counts.renamed}<span class="text-status-renamed"
            >→ {counts.renamed} renamed</span
          >{/if}
        <span class="flex-1"></span>
        <ViewToggle bind:value={repo.fileView} />
      </div>

      <div class="-mx-3">
        <FileList
          files={detail.files}
          mode={repo.fileView}
          showStats
          selected={repo.diff?.source.kind === "commit"
            ? repo.diff.file.path
            : null}
          onselect={(f) =>
            repo.openDiff(
              { kind: "commit", hash: c.hash, parent: c.parents[0] },
              f,
            )}
        />
      </div>
    </div>
  {:else}
    <div
      class="text-muted-foreground flex flex-1 items-center justify-center text-sm"
    >
      Select a commit
    </div>
  {/if}
</div>
