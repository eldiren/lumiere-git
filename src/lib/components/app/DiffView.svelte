<script lang="ts">
  import { tick, untrack } from "svelte";
  import XIcon from "@lucide/svelte/icons/x";
  import ArrowUpIcon from "@lucide/svelte/icons/arrow-up";
  import ArrowDownIcon from "@lucide/svelte/icons/arrow-down";
  import RowsIcon from "@lucide/svelte/icons/rows-3";
  import AlignJustifyIcon from "@lucide/svelte/icons/align-justify";
  import ColumnsIcon from "@lucide/svelte/icons/columns-2";
  import LoaderIcon from "@lucide/svelte/icons/loader-circle";
  import { Button } from "$lib/components/ui/button";
  import { cn } from "$lib/utils";
  import { highlightLine, languageFor } from "$lib/highlight";
  import type { RepoTab, OpenDiff } from "$lib/stores/repo.svelte";
  import { dialogs } from "$lib/stores/dialogs.svelte";
  import type {
    DiffHunk,
    DiffLine,
    FileContent,
    FileDiff,
  } from "$shared/types";
  import StatusGlyph from "./StatusGlyph.svelte";

  let { repo, target }: { repo: RepoTab; target: OpenDiff } = $props();

  type Mode = "hunk" | "inline" | "split";
  let view = $state<"diff" | "file">("diff");
  let mode = $state<Mode>("hunk");
  let diff = $state.raw<FileDiff | null>(null);
  let content = $state.raw<FileContent | null>(null);
  let loading = $state(true);
  let error = $state<string | null>(null);
  let scroller = $state<HTMLDivElement | null>(null);

  const MAX_LINES = 20000;
  const file = $derived(target.file);
  const lang = $derived(languageFor(file.path));
  const canStageHunks = $derived(
    target.source.kind !== "commit" &&
      !(target.source.kind === "unstaged" && target.source.untracked) &&
      file.status !== "U",
  );
  // Lines are picked by line number, so this also works for untracked files and in inline mode.
  const canStageLines = $derived(
    target.source.kind !== "commit" && file.status !== "U",
  );

  // Reload whenever the target, mode or repo status changes.
  let token = 0;
  let lastKey = "";
  $effect(() => {
    const t = target;
    const m = mode;
    const v = view;
    // Working-tree diffs change as files change on disk.
    if (t.source.kind !== "commit") void repo.status;
    const my = ++token;
    const key = t.file.path + JSON.stringify(t.source);
    untrack(() => {
      if (key !== lastKey) {
        // Switched to another file: drop the old content and scroll to the top.
        lastKey = key;
        diff = null;
        content = null;
        scroller?.scrollTo({ top: 0 });
      }
      loading = true;
      error = null;
    });
    const load = v === "file" ? loadFile(t) : loadDiff(t, m);
    load
      .catch((e) => {
        if (my === token) error = (e as Error).message;
      })
      .finally(() => {
        if (my === token) loading = false;
      });

    async function loadDiff(t: OpenDiff, m: Mode) {
      const d = await repo.api.diffFile(
        t.source,
        t.file.path,
        t.file.oldPath,
        m === "inline" ? 1_000_000 : 3,
      );
      if (my === token) diff = d;
    }
    async function loadFile(t: OpenDiff) {
      const rev =
        t.source.kind === "commit"
          ? t.source.hash
          : t.source.kind === "staged"
            ? ":"
            : undefined;
      if (t.file.status === "D") {
        const parent =
          t.source.kind === "commit"
            ? (t.source.parent ?? `${t.source.hash}^`)
            : "HEAD";
        const c = await repo.api.readFile(
          t.file.oldPath ?? t.file.path,
          parent,
        );
        if (my === token) content = c;
      } else {
        const c = await repo.api.readFile(t.file.path, rev);
        if (my === token) content = c;
      }
    }
  });

  interface SplitRow {
    left?: DiffLine;
    right?: DiffLine;
    /** First row of a block of changes (used by prev/next navigation). */
    start?: boolean;
  }

  function splitRows(h: DiffHunk): SplitRow[] {
    const rows: SplitRow[] = [];
    let dels: DiffLine[] = [];
    let adds: DiffLine[] = [];
    const flush = () => {
      const n = Math.max(dels.length, adds.length);
      for (let i = 0; i < n; i++)
        rows.push({ left: dels[i], right: adds[i], start: i === 0 });
      dels = [];
      adds = [];
    };
    for (const l of h.lines) {
      if (l.type === "del") dels.push(l);
      else if (l.type === "add") adds.push(l);
      else if (l.type === "noeol") continue;
      else {
        flush();
        rows.push({ left: l, right: l });
      }
    }
    flush();
    return rows;
  }

  const lineCount = $derived(
    diff?.hunks.reduce((n, h) => n + h.lines.length, 0) ?? 0,
  );

  function jump(dir: 1 | -1) {
    if (!scroller) return;
    const marks = [
      ...scroller.querySelectorAll<HTMLElement>("[data-change-start]"),
    ];
    const top = scroller.scrollTop + 4;
    const offsets = marks.map((m) => m.offsetTop - 40);
    const next =
      dir === 1
        ? offsets.find((o) => o > top)
        : [...offsets].reverse().find((o) => o < top - 8);
    if (next !== undefined)
      scroller.scrollTo({ top: next, behavior: "smooth" });
  }

  async function hunkAction(
    index: number,
    action: "stage" | "unstage" | "discard",
  ) {
    const labels = {
      stage: "Stage hunk",
      unstage: "Unstage hunk",
      discard: "Discard hunk",
    };
    await repo.run(labels[action], (api) =>
      api.applyHunk(target.source, file.path, index, action),
    );
  }

  /** The changed lines covered by the text selection, and where to draw the box around them. */
  interface PickedLines {
    old: number[];
    new: number[];
    top: number;
    height: number;
  }
  let picked = $state.raw<PickedLines | null>(null);
  let dragging = false;
  let selectionFrame = 0;

  function readSelection() {
    picked = null;
    if (!scroller || !canStageLines || view !== "diff" || dragging) return;
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || !selection.rangeCount) return;
    const range = selection.getRangeAt(0);
    if (!scroller.contains(range.commonAncestorContainer)) return;
    const rows = [
      ...scroller.querySelectorAll<HTMLElement>("tr[data-row]"),
    ].filter((r) => range.intersectsNode(r));
    // A selection that ends at the very start of a line (a triple click, say) does not cover it.
    const last = rows.at(-1);
    if (last && rows.length > 1) {
      const tail = range.cloneRange();
      tail.setStart(last.querySelector("[data-code]") ?? last, 0);
      if (tail.collapsed) rows.pop();
    }
    const old: number[] = [];
    const added: number[] = [];
    for (const r of rows) {
      if (r.dataset.old) old.push(Number(r.dataset.old));
      if (r.dataset.new) added.push(Number(r.dataset.new));
    }
    if (!old.length && !added.length) return;
    const box = scroller.getBoundingClientRect();
    const first = rows[0].getBoundingClientRect();
    const end = rows[rows.length - 1].getBoundingClientRect();
    picked = {
      old,
      new: added,
      top: first.top - box.top + scroller.scrollTop,
      height: end.bottom - first.top,
    };
  }

  function onSelectionChange() {
    cancelAnimationFrame(selectionFrame);
    selectionFrame = requestAnimationFrame(readSelection);
  }

  // The rows under a selection change when the diff reloads or is laid out differently.
  $effect(() => {
    void diff;
    void mode;
    void view;
    tick().then(readSelection);
  });

  async function lineAction(action: "stage" | "unstage" | "discard") {
    const lines = picked;
    if (!lines) return;
    const count = lines.old.length + lines.new.length;
    const what = count === 1 ? "line" : `${count} lines`;
    if (action === "discard") {
      const ok = await dialogs.confirm({
        title: `Discard ${count === 1 ? "this line" : `these ${what}`}?`,
        description: `Your changes to ${count === 1 ? "this line" : "these lines"} of ${file.path} will be lost.`,
        confirmLabel: "Discard",
        destructive: true,
      });
      if (!ok) return;
    }
    const source = target.source;
    const path = file.path;
    const labels = {
      stage: `Stage ${what}`,
      unstage: `Unstage ${what}`,
      discard: `Discard ${what}`,
    };
    const ok = await repo.run(labels[action], (api) =>
      api.applyLines(source, path, { old: lines.old, new: lines.new }, action),
    );
    if (!ok) return;
    window.getSelection()?.removeAllRanges();
    picked = null;
    if (source.kind === "unstaged" && source.untracked) {
      // Staging part of an untracked file makes it tracked; discarding all of it removes it.
      const now = repo.status?.unstaged.find((f) => f.path === path);
      if (!now) repo.closeDiff();
      else if (now.status !== "?") repo.openDiff({ kind: "unstaged" }, now);
    }
  }

  function lineClass(t: DiffLine["type"]) {
    return t === "add"
      ? "bg-[var(--diff-add)]"
      : t === "del"
        ? "bg-[var(--diff-del)]"
        : "";
  }
  function gutterClass(t: DiffLine["type"]) {
    return t === "add"
      ? "bg-[var(--diff-add-strong)]"
      : t === "del"
        ? "bg-[var(--diff-del-strong)]"
        : "";
  }
  const sign = (t: DiffLine["type"]) =>
    t === "add" ? "+" : t === "del" ? "-" : " ";
  const isChangeStart = (lines: DiffLine[], i: number) =>
    lines[i].type !== "context" &&
    lines[i].type !== "noeol" &&
    (i === 0 || lines[i - 1].type === "context");
</script>

<svelte:document onselectionchange={onSelectionChange} />
<svelte:window
  onmouseup={() => {
    if (!dragging) return;
    dragging = false;
    readSelection();
  }}
/>

<div class="bg-background flex h-full min-h-0 flex-col">
  <!-- Header -->
  <div class="flex h-9 shrink-0 items-center gap-2 border-b px-3">
    <StatusGlyph status={file.status} />
    <span
      class="selectable min-w-0 flex-1 truncate font-medium"
      title={file.path}
    >
      {#if file.oldPath}<span class="text-muted-foreground"
          >{file.oldPath} →
        </span>{/if}{file.path}
    </span>
    {#if diff?.encoding || content?.encoding}
      <span class="text-muted-foreground text-[11px]"
        >{view === "file" ? content?.encoding : diff?.encoding}</span
      >
    {/if}
    <Button
      variant="ghost"
      size="icon"
      class="size-7"
      title="Close (Esc)"
      onclick={() => repo.closeDiff()}
    >
      <XIcon class="size-4" />
    </Button>
  </div>

  <!-- Toolbar -->
  <div class="flex h-10 shrink-0 items-center gap-2 border-b px-3">
    <span class="text-muted-foreground text-xs">
      {#if target.source.kind === "commit"}commit {target.source.hash.slice(
          0,
          7,
        )}{:else if target.source.kind === "staged"}staged changes{:else}working
        directory{/if}
    </span>
    <div class="flex-1"></div>
    <div class="inline-flex overflow-hidden rounded border text-xs">
      {#each [["file", "File View"], ["diff", "Diff View"]] as const as [v, label] (v)}
        <button
          class={cn(
            "px-3 py-1",
            view === v
              ? "bg-accent"
              : "text-muted-foreground hover:bg-accent/50",
          )}
          onclick={() => (view = v)}>{label}</button
        >
      {/each}
    </div>
    <div class="flex-1"></div>
    {#if view === "diff"}
      <div class="inline-flex overflow-hidden rounded border">
        <button
          class="hover:bg-accent/60 px-2 py-1"
          title="Previous change"
          onclick={() => jump(-1)}><ArrowUpIcon class="size-4" /></button
        >
        <button
          class="hover:bg-accent/60 border-l px-2 py-1"
          title="Next change"
          onclick={() => jump(1)}><ArrowDownIcon class="size-4" /></button
        >
      </div>
      <div class="inline-flex overflow-hidden rounded border">
        {#each [["hunk", "Hunk view", RowsIcon], ["inline", "Inline view (whole file)", AlignJustifyIcon], ["split", "Split view", ColumnsIcon]] as const as [m, label, Icon] (m)}
          <button
            class={cn(
              "border-l px-2 py-1 first:border-l-0",
              mode === m
                ? "bg-accent"
                : "text-muted-foreground hover:bg-accent/50",
            )}
            title={label}
            onclick={() => (mode = m)}
          >
            <Icon class="size-4" />
          </button>
        {/each}
      </div>
    {/if}
  </div>

  <!-- Body -->
  <div
    bind:this={scroller}
    class="code selectable min-h-0 flex-1 overflow-auto font-mono text-[12.5px] leading-[20px]"
    onmousedown={(e) => {
      // The buttons stay out of the way while a selection is being dragged out.
      if (e.button !== 0 || (e.target as Element).closest("button")) return;
      dragging = true;
      picked = null;
    }}
    role="presentation"
  >
    {#if picked && view === "diff"}
      <!-- Zero-height anchor that follows horizontal scrolling, so the box spans the visible width. -->
      <div class="pointer-events-none sticky left-0 z-[5] h-0 select-none">
        <div
          class="border-ring bg-ring/15 absolute inset-x-0 border"
          style:top="{picked.top}px"
          style:height="{picked.height}px"
        >
          <div class="sticky top-8 flex justify-end gap-1 p-1 font-sans">
            {#if target.source.kind === "unstaged"}
              <Button
                size="sm"
                variant="secondary"
                class="pointer-events-auto h-6 px-2 text-xs shadow"
                onmousedown={(e) => e.preventDefault()}
                onclick={() => lineAction("stage")}>Stage</Button
              >
              <Button
                size="sm"
                variant="secondary"
                class="text-destructive pointer-events-auto h-6 px-2 text-xs shadow"
                onmousedown={(e) => e.preventDefault()}
                onclick={() => lineAction("discard")}>Discard Changes…</Button
              >
            {:else}
              <Button
                size="sm"
                variant="secondary"
                class="pointer-events-auto h-6 px-2 text-xs shadow"
                onmousedown={(e) => e.preventDefault()}
                onclick={() => lineAction("unstage")}>Unstage</Button
              >
            {/if}
          </div>
        </div>
      </div>
    {/if}
    {#if error}
      <div class="text-destructive p-4 text-sm whitespace-pre-wrap">
        {error}
      </div>
    {:else if loading && !diff && !content}
      <div class="text-muted-foreground flex items-center gap-2 p-4 text-sm">
        <LoaderIcon class="size-4 animate-spin" /> Loading…
      </div>
    {:else if view === "file"}
      {#if content?.binary}
        <div class="text-muted-foreground p-4 font-sans text-sm">
          Binary file — no preview.
        </div>
      {:else if content}
        {@const lines = content.text.split("\n")}
        <table class="w-full border-collapse">
          <tbody>
            {#each lines.slice(0, MAX_LINES) as l, i (i)}
              <tr>
                <td
                  class="text-muted-foreground w-12 pr-2 text-right align-top select-none"
                  >{i + 1}</td
                >
                <td class="pl-2 whitespace-pre"
                  >{@html highlightLine(l, lang)}</td
                >
              </tr>
            {/each}
          </tbody>
        </table>
      {/if}
    {:else if diff}
      {#if diff.binary}
        <div class="text-muted-foreground p-4 font-sans text-sm">
          Binary file changed.
        </div>
      {:else if !diff.hunks.length}
        <div class="text-muted-foreground p-4 font-sans text-sm">
          {file.status === "R"
            ? "File renamed without content changes."
            : "No content changes (mode change or empty file)."}
        </div>
      {:else}
        {#if lineCount > MAX_LINES}
          <div class="bg-status-modified/15 p-2 font-sans text-xs">
            Large diff — showing the first {MAX_LINES.toLocaleString()} lines.
          </div>
        {/if}
        {#if diff.tooLarge}
          <div class="bg-status-modified/15 p-2 font-sans text-xs">
            Diff output was truncated.
          </div>
        {/if}
        {#each diff.hunks as h, hi (hi)}
          <div
            class="bg-[var(--diff-hunk)] text-muted-foreground sticky top-0 z-10 flex h-7 items-center gap-2 border-y px-3 font-mono text-xs"
          >
            <span class="flex-1 truncate">{h.header}</span>
            {#if canStageHunks && mode !== "inline"}
              {#if target.source.kind === "unstaged"}
                <Button
                  size="sm"
                  variant="outline"
                  class="text-destructive h-5 px-1.5 font-sans text-[11px]"
                  onclick={() => hunkAction(hi, "discard")}>Discard Hunk</Button
                >
                <Button
                  size="sm"
                  variant="outline"
                  class="border-status-added/60 text-status-added h-5 px-1.5 font-sans text-[11px]"
                  onclick={() => hunkAction(hi, "stage")}>Stage Hunk</Button
                >
              {:else}
                <Button
                  size="sm"
                  variant="outline"
                  class="border-status-deleted/60 text-status-deleted h-5 px-1.5 font-sans text-[11px]"
                  onclick={() => hunkAction(hi, "unstage")}>Unstage Hunk</Button
                >
              {/if}
            {/if}
          </div>
          {#if mode === "split"}
            <table class="w-full table-fixed border-collapse">
              <tbody>
                {#each splitRows(h) as r, ri (ri)}
                  <tr
                    data-row
                    data-old={r.left?.type === "del"
                      ? r.left.oldLine
                      : undefined}
                    data-new={r.right?.type === "add"
                      ? r.right.newLine
                      : undefined}
                    data-change-start={r.start ? "" : undefined}
                  >
                    <td
                      class={cn(
                        "text-muted-foreground w-12 pr-2 text-right align-top select-none",
                        r.left &&
                          gutterClass(
                            r.left.type === "context" ? "context" : r.left.type,
                          ),
                      )}>{r.left?.oldLine ?? ""}</td
                    >
                    <td
                      data-code
                      class={cn(
                        "overflow-hidden border-r pl-2 align-top whitespace-pre",
                        r.left?.type === "del" && lineClass("del"),
                        !r.left && "bg-muted/40",
                      )}
                      >{#if r.left}{@html highlightLine(
                          r.left.content,
                          lang,
                        )}{/if}</td
                    >
                    <td
                      class={cn(
                        "text-muted-foreground w-12 pr-2 text-right align-top select-none",
                        r.right &&
                          gutterClass(
                            r.right.type === "context"
                              ? "context"
                              : r.right.type,
                          ),
                      )}>{r.right?.newLine ?? ""}</td
                    >
                    <td
                      class={cn(
                        "overflow-hidden pl-2 align-top whitespace-pre",
                        r.right?.type === "add" && lineClass("add"),
                        !r.right && "bg-muted/40",
                      )}
                      >{#if r.right}{@html highlightLine(
                          r.right.content,
                          lang,
                        )}{/if}</td
                    >
                  </tr>
                {/each}
              </tbody>
            </table>
          {:else}
            <table class="w-full border-collapse">
              <tbody>
                {#each h.lines as l, li (li)}
                  {#if l.type === "noeol"}
                    <tr
                      ><td
                        colspan="4"
                        class="text-muted-foreground pl-28 font-sans text-xs italic"
                        >{l.content}</td
                      ></tr
                    >
                  {:else}
                    <tr
                      class={lineClass(l.type)}
                      data-row
                      data-old={l.type === "del" ? l.oldLine : undefined}
                      data-new={l.type === "add" ? l.newLine : undefined}
                      data-change-start={isChangeStart(h.lines, li)
                        ? ""
                        : undefined}
                    >
                      <td
                        class={cn(
                          "text-muted-foreground w-12 pr-2 text-right align-top select-none",
                          gutterClass(l.type),
                        )}>{l.oldLine ?? ""}</td
                      >
                      <td
                        class={cn(
                          "text-muted-foreground w-12 pr-2 text-right align-top select-none",
                          gutterClass(l.type),
                        )}>{l.newLine ?? ""}</td
                      >
                      <td
                        class="w-5 text-center align-top select-none opacity-70"
                        >{sign(l.type)}</td
                      >
                      <td data-code class="pr-4 whitespace-pre"
                        >{@html highlightLine(l.content, lang)}</td
                      >
                    </tr>
                  {/if}
                {/each}
              </tbody>
            </table>
          {/if}
        {/each}
      {/if}
    {/if}
  </div>
</div>
