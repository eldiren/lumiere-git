<script lang="ts">
  import { onMount } from "svelte";
  import { Terminal } from "@xterm/xterm";
  import { FitAddon } from "@xterm/addon-fit";
  import { WebLinksAddon } from "@xterm/addon-web-links";
  import "@xterm/xterm/css/xterm.css";
  import XIcon from "@lucide/svelte/icons/x";
  import RotateCcwIcon from "@lucide/svelte/icons/rotate-ccw";
  import { onEvent, pty, app as appApi } from "$lib/api";
  import { appState } from "$lib/stores/app.svelte";

  let { cwd }: { cwd: string } = $props();

  let host: HTMLDivElement;
  let error = $state<string | null>(null);
  let exited = $state(false);
  let term: Terminal | null = null;
  let fit: FitAddon | null = null;
  let id = "";

  function cssVar(name: string) {
    return getComputedStyle(document.documentElement)
      .getPropertyValue(name)
      .trim();
  }

  function theme() {
    return {
      background: cssVar("--background"),
      foreground: cssVar("--foreground"),
      cursor: cssVar("--primary"),
      selectionBackground: cssVar("--row-selected"),
    };
  }

  async function start() {
    exited = false;
    error = null;
    id = crypto.randomUUID();
    term?.reset();
    try {
      await pty.spawn(id, cwd, term!.cols, term!.rows);
    } catch (e) {
      error = (e as Error).message;
    }
  }

  onMount(() => {
    term = new Terminal({
      fontFamily: cssVar("--font-mono") || "monospace",
      fontSize: 12.5,
      cursorBlink: true,
      scrollback: 5000,
      theme: theme(),
      allowProposedApi: true,
    });
    fit = new FitAddon();
    term.loadAddon(fit);
    term.loadAddon(new WebLinksAddon((_e, url) => appApi.openExternal(url)));
    term.open(host);
    fit.fit();

    const offData = onEvent(
      "pty:data",
      (pid: string, data: string) => pid === id && term?.write(data),
    );
    const offExit = onEvent("pty:exit", (pid: string) => {
      if (pid === id) exited = true;
    });
    term.onData((d) => id && !exited && pty.write(id, d));
    term.onResize(({ cols, rows }) => id && pty.resize(id, cols, rows));

    const ro = new ResizeObserver(() => {
      if (host.offsetParent) fit?.fit();
    });
    ro.observe(host);
    const mo = new MutationObserver(
      () => term && (term.options.theme = theme()),
    );
    mo.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });

    start();
    term.focus();

    return () => {
      offData();
      offExit();
      ro.disconnect();
      mo.disconnect();
      if (id) pty.kill(id);
      term?.dispose();
    };
  });
</script>

<div class="flex h-full min-h-0 flex-col">
  <div
    class="bg-panel text-muted-foreground flex h-7 shrink-0 items-center gap-2 border-b px-2 text-xs"
  >
    <span class="font-semibold tracking-wide uppercase">Terminal</span>
    <span class="truncate">{cwd}</span>
    <span class="flex-1"></span>
    {#if exited}
      <button
        class="hover:text-foreground flex items-center gap-1"
        onclick={start}><RotateCcwIcon class="size-3.5" /> Restart</button
      >
    {/if}
    <button
      class="hover:text-foreground"
      title="Close terminal"
      onclick={() => (appState.terminalOpen = false)}
      ><XIcon class="size-3.5" /></button
    >
  </div>
  {#if error}
    <div class="text-destructive p-2 text-xs">{error}</div>
  {/if}
  <div bind:this={host} class="min-h-0 flex-1 px-2 pt-1"></div>
</div>
