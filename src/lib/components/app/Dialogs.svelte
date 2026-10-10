<script lang="ts">
  import * as Dialog from "$lib/components/ui/dialog";
  import { Button } from "$lib/components/ui/button";
  import { Input } from "$lib/components/ui/input";
  import { Textarea } from "$lib/components/ui/textarea";
  import { Label } from "$lib/components/ui/label";
  import { Checkbox } from "$lib/components/ui/checkbox";
  import { dialogs } from "$lib/stores/dialogs.svelte";

  let error = $state<string | null>(null);

  const req = $derived(dialogs.current);

  $effect(() => {
    void req;
    error = null;
  });

  function cancel() {
    const r = dialogs.current;
    dialogs.close();
    if (!r) return;
    if (r.kind === "prompt") r.resolve(null);
    else r.resolve(false);
  }

  function submit(e?: Event) {
    e?.preventDefault();
    const r = dialogs.current;
    if (!r) return;
    if (r.kind === "prompt") {
      const { values, checks } = r;
      const missing = r.fields.find(
        (f) => !f.optional && !values[f.key]?.trim(),
      );
      if (missing) {
        error = `${missing.label} is required`;
        return;
      }
      const v = r.validate?.(values);
      if (v) {
        error = v;
        return;
      }
      dialogs.close();
      r.resolve({
        values: $state.snapshot(values),
        checks: $state.snapshot(checks),
      });
    } else {
      dialogs.close();
      r.resolve(true);
    }
  }
</script>

<Dialog.Root open={!!req} onOpenChange={(o) => !o && cancel()}>
  <Dialog.Content class="sm:max-w-md" showCloseButton={false}>
    {#if req}
      <form onsubmit={submit} class="flex flex-col gap-4">
        <Dialog.Header>
          <Dialog.Title>{req.title}</Dialog.Title>
          {#if req.description}
            <Dialog.Description class="whitespace-pre-line"
              >{req.description}</Dialog.Description
            >
          {/if}
        </Dialog.Header>
        {#if req.kind === "prompt"}
          {#each req.fields as f, i (f.key)}
            <div class="flex flex-col gap-1.5">
              <Label for="dlg-{f.key}">{f.label}</Label>
              {#if f.multiline}
                <Textarea
                  id="dlg-{f.key}"
                  bind:value={req.values[f.key]}
                  placeholder={f.placeholder}
                  rows={3}
                />
              {:else}
                <!-- svelte-ignore a11y_autofocus -->
                <Input
                  id="dlg-{f.key}"
                  bind:value={req.values[f.key]}
                  placeholder={f.placeholder}
                  autofocus={i === 0}
                  autocomplete="off"
                  spellcheck="false"
                />
              {/if}
            </div>
          {/each}
          {#each req.checkboxes ?? [] as c (c.key)}
            <label class="flex items-center gap-2 text-sm">
              <Checkbox bind:checked={req.checks[c.key]} />
              {c.label}
            </label>
          {/each}
          {#if error}<p class="text-destructive text-sm">{error}</p>{/if}
        {/if}
        <Dialog.Footer>
          <Button variant="ghost" type="button" onclick={cancel}>Cancel</Button>
          <Button
            type="submit"
            variant={req.destructive ? "destructive" : "default"}
          >
            {req.confirmLabel ?? "OK"}
          </Button>
        </Dialog.Footer>
      </form>
    {/if}
  </Dialog.Content>
</Dialog.Root>
