<script lang="ts">
  import type { Snippet } from "svelte";
  import ChevronRightIcon from "@lucide/svelte/icons/chevron-right";
  import FolderIcon from "@lucide/svelte/icons/folder";
  import { cn } from "$lib/utils";
  import type { FileChange } from "$shared/types";
  import StatusGlyph from "./StatusGlyph.svelte";

  interface Props {
    files: FileChange[];
    mode: "path" | "tree";
    selected?: string | null;
    onselect?: (f: FileChange) => void;
    /** Right-click on a file or folder. Receives the files it applies to: the whole selection when the file is part of it, otherwise just that file (or every file under the folder), which then becomes the selection. */
    oncontext?: (files: FileChange[], e: MouseEvent) => void;
    actions?: Snippet<[FileChange]>;
    showStats?: boolean;
    /** Multi-selection (paths). When bound, Ctrl/Cmd-click toggles a file and Shift-click selects a range. */
    selection?: Set<string>;
  }
  let {
    files,
    mode,
    selected = null,
    onselect,
    oncontext,
    actions,
    showStats = false,
    selection = $bindable(),
  }: Props = $props();

  interface TreeNode {
    name: string;
    path: string;
    children: Map<string, TreeNode>;
    file?: FileChange;
  }

  const tree = $derived.by(() => {
    const root: TreeNode = { name: "", path: "", children: new Map() };
    for (const f of files) {
      const parts = f.path.split("/");
      let node = root;
      parts.forEach((part, i) => {
        const p = parts.slice(0, i + 1).join("/");
        let child = node.children.get(part);
        if (!child) {
          child = { name: part, path: p, children: new Map() };
          node.children.set(part, child);
        }
        if (i === parts.length - 1) child.file = f;
        node = child;
      });
    }
    // Collapse single-child directory chains (a/b/c → "a/b/c").
    const compact = (n: TreeNode): TreeNode => {
      for (const [k, c] of n.children) n.children.set(k, compact(c));
      if (!n.file && n.children.size === 1 && n.name) {
        const [only] = n.children.values();
        if (!only.file) return { ...only, name: `${n.name}/${only.name}` };
      }
      return n;
    };
    return compact(root);
  });

  let collapsed = $state<Set<string>>(new Set());
  function toggle(p: string) {
    const s = new Set(collapsed);
    if (s.has(p)) s.delete(p);
    else s.add(p);
    collapsed = s;
  }

  /** Every folder path in the tree, for Expand All / Collapse All. */
  const folders = $derived.by(() => {
    const out: string[] = [];
    const walk = (n: TreeNode) => {
      for (const c of n.children.values()) {
        if (!c.file) {
          out.push(c.path);
          walk(c);
        }
      }
    };
    walk(tree);
    return out;
  });
  const anyExpanded = $derived(folders.some((p) => !collapsed.has(p)));
  function toggleAll() {
    collapsed = anyExpanded ? new Set(folders) : new Set();
  }

  const sorted = (n: TreeNode) =>
    [...n.children.values()].sort((a, b) =>
      !!a.file === !!b.file ? a.name.localeCompare(b.name) : a.file ? 1 : -1,
    );

  /** Files in on-screen order (tree order, skipping collapsed folders), for Shift-click ranges. */
  const visible = $derived.by(() => {
    if (mode === "path") return files;
    const out: FileChange[] = [];
    const walk = (n: TreeNode) => {
      for (const c of sorted(n)) {
        if (c.file) out.push(c.file);
        else if (!collapsed.has(c.path)) walk(c);
      }
    };
    walk(tree);
    return out;
  });

  let anchor: string | null = null;

  function click(f: FileChange, e: MouseEvent) {
    if (selection && (e.ctrlKey || e.metaKey)) {
      const s = new Set(selection);
      if (s.has(f.path)) s.delete(f.path);
      else s.add(f.path);
      selection = s;
      anchor = f.path;
      return;
    }
    if (selection && e.shiftKey && anchor) {
      const a = visible.findIndex((v) => v.path === anchor);
      const b = visible.findIndex((v) => v.path === f.path);
      if (a >= 0 && b >= 0) {
        const [lo, hi] = a < b ? [a, b] : [b, a];
        selection = new Set(visible.slice(lo, hi + 1).map((v) => v.path));
        return;
      }
    }
    if (selection) selection = new Set([f.path]);
    anchor = f.path;
    onselect?.(f);
  }

  function context(targets: FileChange[], e: MouseEvent) {
    if (!oncontext) return;
    if (selection) selection = new Set(targets.map((t) => t.path));
    oncontext(targets, e);
  }

  function fileContext(f: FileChange, e: MouseEvent) {
    if (!oncontext) return;
    if (selection?.has(f.path)) {
      oncontext(
        files.filter((t) => selection!.has(t.path)),
        e,
      );
      return;
    }
    anchor = f.path;
    context([f], e);
  }

  function filesUnder(n: TreeNode): FileChange[] {
    const out: FileChange[] = [];
    const walk = (m: TreeNode) => {
      for (const c of sorted(m)) {
        if (c.file) out.push(c.file);
        else walk(c);
      }
    };
    walk(n);
    return out;
  }

  const isSelected = (f: FileChange) =>
    selection?.size ? selection.has(f.path) : selected === f.path;

  function split(p: string) {
    const i = p.lastIndexOf("/");
    return i < 0
      ? { dir: "", base: p }
      : { dir: p.slice(0, i + 1), base: p.slice(i + 1) };
  }
</script>

{#snippet fileRow(f: FileChange, depth: number, label: Snippet)}
  <div
    class={cn(
      "group hover:bg-row-hover flex h-7 cursor-default items-center gap-1.5 pr-2 text-[13px] select-none",
      isSelected(f) && "bg-row-selected hover:bg-row-selected",
    )}
    style="padding-left: {8 + depth * 14}px"
    role="button"
    tabindex="-1"
    title={f.oldPath ? `${f.oldPath} → ${f.path}` : f.path}
    onclick={(e) => click(f, e)}
    oncontextmenu={(e) => fileContext(f, e)}
    onkeydown={(e) => e.key === "Enter" && onselect?.(f)}
  >
    <StatusGlyph status={f.status} />
    <span class="min-w-0 flex-1 truncate">{@render label()}</span>
    {#if showStats && (f.additions || f.deletions)}
      <span class="shrink-0 font-mono text-[11px] group-hover:hidden">
        <span class="text-status-added">+{f.additions}</span>
        <span class="text-status-deleted">-{f.deletions}</span>
      </span>
    {/if}
    {#if actions}
      <span class="hidden shrink-0 items-center gap-1 group-hover:flex"
        >{@render actions(f)}</span
      >
    {/if}
  </div>
{/snippet}

{#snippet node(n: TreeNode, depth: number)}
  {#each sorted(n) as c (c.path)}
    {#if c.file}
      {#snippet name()}{c.name}{/snippet}
      {@render fileRow(c.file, depth, name)}
    {:else}
      <div
        class="hover:bg-row-hover text-muted-foreground flex h-7 cursor-default items-center gap-1 text-[13px]"
        style="padding-left: {4 + depth * 14}px"
        role="button"
        tabindex="-1"
        onclick={() => toggle(c.path)}
        oncontextmenu={(e) => context(filesUnder(c), e)}
        onkeydown={(e) => e.key === "Enter" && toggle(c.path)}
      >
        <ChevronRightIcon
          class={cn(
            "size-3.5 transition-transform",
            !collapsed.has(c.path) && "rotate-90",
          )}
        />
        <FolderIcon class="size-3.5" />
        <span class="truncate">{c.name}</span>
      </div>
      {#if !collapsed.has(c.path)}
        {@render node(c, depth + 1)}
      {/if}
    {/if}
  {/each}
{/snippet}

<div class="flex flex-col">
  {#if mode === "tree"}
    {#if folders.length}
      <button
        class="text-muted-foreground hover:text-foreground self-start px-2 py-1 text-xs"
        onclick={toggleAll}
      >
        {anyExpanded ? "Collapse All" : "Expand All"}
      </button>
    {/if}
    {@render node(tree, 0)}
  {:else}
    {#each files as f (f.path + f.status)}
      {@const s = split(f.path)}
      {#snippet name()}<span class="text-muted-foreground">{s.dir}</span
        >{s.base}{/snippet}
      {@render fileRow(f, 0, name)}
    {/each}
  {/if}
</div>
