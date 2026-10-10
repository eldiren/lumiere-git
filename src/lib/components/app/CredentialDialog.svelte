<script lang="ts">
  import KeyRoundIcon from "@lucide/svelte/icons/key-round";
  import * as Dialog from "$lib/components/ui/dialog";
  import { Button } from "$lib/components/ui/button";
  import { Input } from "$lib/components/ui/input";
  import { Label } from "$lib/components/ui/label";
  import { Checkbox } from "$lib/components/ui/checkbox";
  import { gitState } from "$lib/stores/git.svelte";

  // Git asked for HTTPS credentials (electron/credentials/broker.ts). The git command waits until this answers.

  const req = $derived(gitState.credentialQueue[0] ?? null);

  let username = $state("");
  let password = $state("");
  let remember = $state(true);

  $effect(() => {
    username = req?.username ?? "";
    password = "";
    remember = true;
  });

  const canSubmit = $derived(!!username.trim() && !!password);

  function cancel() {
    if (req) gitState.answerCredential(req.id, null);
  }

  function submit(e: Event) {
    e.preventDefault();
    if (!req || !canSubmit) return;
    gitState.answerCredential(req.id, {
      username: username.trim(),
      password,
      remember,
    });
  }
</script>

<Dialog.Root open={!!req} onOpenChange={(o) => !o && cancel()}>
  <Dialog.Content class="sm:max-w-md" showCloseButton={false}>
    {#if req}
      <form onsubmit={submit} class="flex flex-col gap-4">
        <Dialog.Header>
          <Dialog.Title class="flex items-center gap-2"
            ><KeyRoundIcon class="size-4" /> Sign in to {req.origin}</Dialog.Title
          >
          <Dialog.Description>
            Git needs credentials for {req.origin}{req.path
              ? `/${req.path}`
              : ""}. Many hosts want a personal access token instead of your
            account password.
          </Dialog.Description>
        </Dialog.Header>
        <div class="flex flex-col gap-1.5">
          <Label for="cred-user">Username</Label>
          <!-- svelte-ignore a11y_autofocus -->
          <Input
            id="cred-user"
            bind:value={username}
            autocomplete="username"
            spellcheck="false"
            autofocus={!req.username}
          />
        </div>
        <div class="flex flex-col gap-1.5">
          <Label for="cred-pass">Password or token</Label>
          <!-- svelte-ignore a11y_autofocus -->
          <Input
            id="cred-pass"
            type="password"
            bind:value={password}
            autocomplete="current-password"
            autofocus={!!req.username}
          />
        </div>
        <label class="flex items-center gap-2 text-sm">
          <Checkbox bind:checked={remember} />
          {req.canRemember
            ? "Remember in the system keyring"
            : "Remember until Lumiere Git quits (no system keyring available)"}
        </label>
        <Dialog.Footer>
          <Button variant="ghost" type="button" onclick={cancel}>Cancel</Button>
          <Button type="submit" disabled={!canSubmit}>Sign in</Button>
        </Dialog.Footer>
      </form>
    {/if}
  </Dialog.Content>
</Dialog.Root>
