<script lang="ts">
  import { avatarColor, initials } from "$lib/graph/render";
  let {
    name,
    email,
    size = 36,
  }: { name: string; email: string; size?: number } = $props();
</script>

<div
  class="flex shrink-0 items-center justify-center rounded-md font-semibold text-white"
  style="width: {size}px; height: {size}px; background: {avatarColor(
    email,
  )}; font-size: {size * 0.38}px"
  title="{name} <{email}>"
>
  {initials(name)}
</div>
