<script lang="ts">
  import type { Component, Snippet } from "svelte";
  import { cn } from "$lib/utils";

  interface Props {
    label: string;
    icon: Component<{ class?: string }>;
    title?: string;
    disabled?: boolean;
    active?: boolean;
    onclick?: () => void;
    children?: Snippet;
  }
  let {
    label,
    icon: Icon,
    title,
    disabled = false,
    active = false,
    onclick,
    children,
  }: Props = $props();
</script>

<div class="relative flex items-stretch">
  <button
    class={cn(
      "flex min-w-12 flex-col items-center justify-center gap-0.5 rounded px-2 py-1 text-[11px]",
      disabled
        ? "text-muted-foreground/50"
        : "text-muted-foreground hover:bg-accent hover:text-foreground",
      active && "bg-accent text-foreground",
    )}
    title={title ?? label}
    {disabled}
    {onclick}
  >
    <span>{label}</span>
    <Icon class="size-5" />
  </button>
  {@render children?.()}
</div>
