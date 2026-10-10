<script lang="ts">
  import PlusIcon from "@lucide/svelte/icons/plus";
  import MinusIcon from "@lucide/svelte/icons/minus";
  import PencilIcon from "@lucide/svelte/icons/pencil";
  import ArrowRightIcon from "@lucide/svelte/icons/arrow-right";
  import TriangleAlertIcon from "@lucide/svelte/icons/triangle-alert";
  import type { ChangeStatus } from "$shared/types";

  let { status }: { status: ChangeStatus } = $props();
</script>

{#if status === "A" || status === "?"}
  <PlusIcon class="text-status-added size-3.5 shrink-0" aria-label="Added" />
{:else if status === "D"}
  <MinusIcon
    class="text-status-deleted size-3.5 shrink-0"
    aria-label="Deleted"
  />
{:else if status === "R" || status === "C"}
  <ArrowRightIcon
    class="text-status-renamed size-3.5 shrink-0"
    aria-label="Renamed"
  />
{:else if status === "U"}
  <TriangleAlertIcon
    class="text-status-deleted size-3.5 shrink-0"
    aria-label="Conflicted"
  />
{:else}
  <PencilIcon
    class="text-status-modified size-3.5 shrink-0"
    aria-label="Modified"
  />
{/if}
