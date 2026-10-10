<script lang="ts">
  import ExternalLinkIcon from "@lucide/svelte/icons/external-link";
  import { Button } from "$lib/components/ui/button";
  import { Input } from "$lib/components/ui/input";
  import { Label } from "$lib/components/ui/label";
  import { hosting } from "$lib/api";
  import BrandIcon from "./BrandIcon.svelte";
  import { hostingState, PROVIDERS } from "$lib/stores/hosting.svelte";
  import type { HostingProvider } from "$shared/types";

  let { provider }: { provider: HostingProvider } = $props();

  let token = $state("");
  let baseUrl = $state("");
  let username = $state("");
  let organization = $state("");
  let busy = $state(false);
  let error = $state<string | null>(null);

  const name = $derived(PROVIDERS.find((p) => p.id === provider)!.name);
  const scopes: Record<HostingProvider, string> = {
    github: "Classic token with the repo and read:user scopes.",
    gitlab:
      "Personal access token with read_api, read_user, read_repository and write_repository.",
    bitbucket:
      "Atlassian API token with the read:user:bitbucket and read:repository:bitbucket scopes (add write:repository:bitbucket to push over HTTPS).",
    azure:
      "Personal access token with Code (Read & write) for the organization.",
    gitea:
      "Access token with the read:user and write:repository scopes (read:organization to list organization repositories).",
  };
  const baseUrlLabel: Record<string, string> = {
    github: "GitHub Enterprise host",
    gitlab: "Self-hosted GitLab URL",
    gitea: "Gitea server URL",
  };
  const baseUrlPlaceholder: Record<string, string> = {
    github: "github.com",
    gitlab: "gitlab.com",
    gitea: "gitea.com",
  };
  const canSubmit = $derived(
    !!token.trim() &&
      !busy &&
      (provider !== "bitbucket" || !!username.trim()) &&
      (provider !== "azure" || !!organization.trim()),
  );

  async function submit(e: Event) {
    e.preventDefault();
    if (!canSubmit) return;
    busy = true;
    error = null;
    try {
      await hostingState.signIn({
        provider,
        token,
        baseUrl,
        username,
        organization,
      });
      token = "";
    } catch (err) {
      error = (err as Error).message;
    } finally {
      busy = false;
    }
  }

  function openTokenPage() {
    hosting
      .openTokenPage(provider, baseUrl, organization)
      .catch((err) => (error = (err as Error).message));
  }
</script>

<form class="flex flex-col gap-4" onsubmit={submit}>
  <div class="flex justify-center pt-2">
    <BrandIcon {provider} class="text-foreground size-10" />
  </div>
  <p class="text-muted-foreground text-center text-sm">
    Sign in to {name} with a personal access token to pick a repository instead of
    pasting its URL.
  </p>
  {#if provider === "github" || provider === "gitlab" || provider === "gitea"}
    <div class="flex flex-col gap-1.5">
      <Label for="host-base"
        >{baseUrlLabel[provider]}
        <span class="text-muted-foreground font-normal">(optional)</span></Label
      >
      <Input
        id="host-base"
        bind:value={baseUrl}
        placeholder={baseUrlPlaceholder[provider]}
        autocomplete="off"
        spellcheck="false"
      />
    </div>
  {:else if provider === "bitbucket"}
    <div class="flex flex-col gap-1.5">
      <Label for="host-user">Atlassian account email</Label>
      <Input
        id="host-user"
        bind:value={username}
        placeholder="you@example.com"
        autocomplete="off"
        spellcheck="false"
      />
    </div>
  {:else}
    <div class="flex flex-col gap-1.5">
      <Label for="host-org">Organization</Label>
      <Input
        id="host-org"
        bind:value={organization}
        placeholder="my-organization"
        autocomplete="off"
        spellcheck="false"
      />
    </div>
  {/if}
  <div class="flex flex-col gap-1.5">
    <div class="flex items-center">
      <Label for="host-token" class="flex-1">Token</Label>
      <button
        type="button"
        class="text-primary flex items-center gap-1 text-xs hover:underline"
        onclick={openTokenPage}
      >
        Create a token <ExternalLinkIcon class="size-3" />
      </button>
    </div>
    <Input
      id="host-token"
      type="password"
      bind:value={token}
      autocomplete="off"
      spellcheck="false"
    />
    <p class="text-muted-foreground text-xs">{scopes[provider]}</p>
  </div>
  {#if error}<p class="text-destructive text-sm">{error}</p>{/if}
  <Button type="submit" disabled={!canSubmit}
    >{busy ? "Signing in…" : `Sign in to ${name}`}</Button
  >
</form>
