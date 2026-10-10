<script lang="ts">
  import ListIcon from "@lucide/svelte/icons/list";
  import ListTreeIcon from "@lucide/svelte/icons/list-tree";
  import { cn } from "$lib/utils";
  let { value = $bindable() }: { value: "path" | "tree" } = $props();
</script>

<div class="inline-flex overflow-hidden rounded border text-xs">
  {#each [["path", "Path", ListIcon], ["tree", "Tree", ListTreeIcon]] as const as [v, label, Icon] (v)}
    <button
      class={cn(
        "flex items-center gap-1 px-2.5 py-1",
        value === v
          ? "bg-accent text-accent-foreground"
          : "text-muted-foreground hover:bg-accent/50",
      )}
      onclick={() => (value = v)}
    >
      <Icon class="size-3.5" />{label}
    </button>
  {/each}
</div>
