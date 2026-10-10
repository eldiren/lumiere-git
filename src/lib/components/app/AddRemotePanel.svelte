<script lang="ts">
  import { untrack } from "svelte";
  import { filter as fuzzyFilter } from "fuzzaldrin-plus";
  import CloudIcon from "@lucide/svelte/icons/cloud";
  import XIcon from "@lucide/svelte/icons/x";
  import GlobeIcon from "@lucide/svelte/icons/globe";
  import LockIcon from "@lucide/svelte/icons/lock";
  import LogOutIcon from "@lucide/svelte/icons/log-out";
  import RefreshCwIcon from "@lucide/svelte/icons/refresh-cw";
  import LoaderIcon from "@lucide/svelte/icons/loader-circle";
  import CircleCheckIcon from "@lucide/svelte/icons/circle-check";
  import CircleXIcon from "@lucide/svelte/icons/circle-x";
  import { Button } from "$lib/components/ui/button";
  import { Input } from "$lib/components/ui/input";
  import { Label } from "$lib/components/ui/label";
  import { Checkbox } from "$lib/components/ui/checkbox";
  import { cn } from "$lib/utils";
  import type { RepoTab } from "$lib/stores/repo.svelte";
  import { validateRefName } from "$lib/stores/dialogs.svelte";
  import { hostingState } from "$lib/stores/hosting.svelte";
  import * as actions from "$lib/actions";
  import type { HostingProvider, HostingRepo } from "$shared/types";
  import HostingSignIn from "./HostingSignIn.svelte";
  import BrandIcon from "./BrandIcon.svelte";

  let { repo }: { repo: RepoTab } = $props();

  type Tab = "url" | HostingProvider;
  const TABS: { id: Tab; label: string }[] = [
    { id: "url", label: "URL" },
    { id: "github", label: "GitHub" },
    { id: "gitlab", label: "GitLab" },
    { id: "bitbucket", label: "Bitbucket" },
    { id: "azure", label: "Azure DevOps" },
    { id: "gitea", label: "Gitea" },
  ];

  let tab = $state<Tab>("url");
  // Set when editing an existing remote (the panel is re-created per remote).
  const editing = untrack(() => repo.editRemoteName);
  // Suggest "origin" only when the repository has no remotes yet.
  const hasRemotes = untrack(() => !!repo.refs?.remoteNames.length);
  let name = $state(editing ?? (hasRemotes ? "" : "origin"));
  let nameTouched = $state(false);
  let url = $state("");
  let pushUrl = $state("");
  let fetchAfter = $state(!editing);
  let submitting = $state(false);
  let loadError = $state<string | null>(null);

  if (editing) {
    untrack(() => repo.api)
      .remoteInfo(editing)
      .then(
        (info) => {
          url = info.url;
          pushUrl = info.pushUrl ?? "";
        },
        (e) => (loadError = (e as Error).message),
      );
  }

  // Test connection: result for the URLs that were tested; stale once they change.
  type TestResult = { url: string; ok: boolean; message: string };
  let testing = $state(false);
  let testResults = $state<TestResult[]>([]);
  let testedKey = $state("");

  // Provider tabs
  let query = $state("");
  let picked = $state<HostingRepo | null>(null);
  let protocol = $state<"https" | "ssh">("https");

  $effect(() => {
    hostingState.load().catch((e) => console.warn(e));
  });

  const provider = $derived(tab === "url" ? null : tab);
  const account = $derived(
    provider ? hostingState.accounts[provider] : undefined,
  );
  const repos = $derived(provider ? hostingState.repos[provider] : undefined);

  $effect(() => {
    if (provider && account) void hostingState.loadRepos(provider);
  });

  const filtered = $derived.by(() => {
    const list = repos ?? [];
    const q = query.trim();
    return (q ? fuzzyFilter(list, q, { key: "fullName" }) : list).slice(0, 300);
  });

  const pickedUrl = $derived(
    picked
      ? protocol === "ssh" && picked.sshUrl
        ? picked.sshUrl
        : picked.httpsUrl
      : "",
  );

  function switchTab(t: Tab) {
    tab = t;
    picked = null;
    query = "";
  }

  function pick(r: HostingRepo) {
    picked = r;
    if (!r.sshUrl) protocol = "https";
    // With an origin already present, name the new remote after the repository owner.
    if (!nameTouched && hasRemotes) name = r.fullName.split("/")[0];
  }

  const nameError = $derived.by(() => {
    const n = name.trim();
    if (!n) return null;
    if (n !== editing && repo.refs?.remoteNames.includes(n))
      return `A remote named "${n}" already exists`;
    return validateRefName(n);
  });
  const targetUrl = $derived(tab === "url" ? url.trim() : pickedUrl);
  const canSubmit = $derived(
    !!name.trim() && !nameError && !!targetUrl && !submitting,
  );

  const testUrls = $derived.by(() => {
    const push = tab === "url" ? pushUrl.trim() : "";
    return targetUrl
      ? [targetUrl, ...(push && push !== targetUrl ? [push] : [])]
      : [];
  });
  const testKey = $derived(testUrls.join("\n"));

  async function testConnection() {
    if (!testUrls.length || testing) return;
    const key = testKey;
    testing = true;
    testResults = [];
    testedKey = key;
    const results = await Promise.all(
      testUrls.map((u) =>
        repo.api.testRemote(u).then(
          (r): TestResult => ({
            url: u,
            ok: true,
            message: `Connected · ${r.branches} branch${r.branches === 1 ? "" : "es"}`,
          }),
          (e): TestResult => ({
            url: u,
            ok: false,
            message: (e as Error).message,
          }),
        ),
      ),
    );
    if (testedKey === key) testResults = results;
    testing = false;
  }

  function close() {
    repo.addRemoteOpen = false;
  }

  async function submit(e: Event) {
    e.preventDefault();
    if (!canSubmit) return;
    submitting = true;
    const v = {
      name,
      url: targetUrl,
      pushUrl: tab === "url" ? pushUrl : "",
      fetch: fetchAfter,
    };
    const ok = editing
      ? await actions.saveRemote(repo, editing, v)
      : await actions.submitRemote(repo, v);
    submitting = false;
    if (ok) close();
  }
</script>

{#snippet nameField()}
  <div class="flex flex-col gap-1.5">
    <Label for="remote-name">Name</Label>
    <!-- svelte-ignore a11y_autofocus -->
    <Input
      id="remote-name"
      bind:value={name}
      oninput={() => (nameTouched = true)}
      placeholder="origin"
      autofocus={tab === "url"}
      autocomplete="off"
      spellcheck="false"
      aria-invalid={!!nameError}
    />
    {#if nameError}<p class="text-destructive text-xs">{nameError}</p>{/if}
  </div>
{/snippet}

{#snippet testRow()}
  <div class="flex flex-col gap-1">
    <button
      type="button"
      class="text-primary flex items-center gap-1.5 self-start text-xs hover:underline disabled:pointer-events-none disabled:opacity-50"
      disabled={!testUrls.length || testing}
      onclick={testConnection}
    >
      {#if testing}<LoaderIcon class="size-3.5 animate-spin" />Testing
        connection…{:else}Test connection{/if}
    </button>
    {#if !testing && testedKey === testKey}
      {#each testResults as r (r.url)}
        <p
          class={cn(
            "flex items-start gap-1.5 text-xs",
            r.ok ? "text-status-added" : "text-destructive",
          )}
        >
          {#if r.ok}<CircleCheckIcon
              class="mt-px size-3.5 shrink-0"
            />{:else}<CircleXIcon class="mt-px size-3.5 shrink-0" />{/if}
          <span class="min-w-0 break-words">
            {#if testResults.length > 1}<span class="font-medium"
                >{r.url === targetUrl ? "Pull" : "Push"}:</span
              >{/if}
            {r.message}
          </span>
        </p>
      {/each}
    {/if}
  </div>
{/snippet}

{#snippet submitRow()}
  <label class="flex items-center gap-2 text-sm">
    <Checkbox bind:checked={fetchAfter} />
    {editing ? "Fetch after saving" : "Fetch after adding"}
  </label>
  <Button type="submit" disabled={!canSubmit}>
    {#if editing}{submitting ? "Saving…" : "Save Remote"}{:else}{submitting
        ? "Adding…"
        : "Add Remote"}{/if}
  </Button>
{/snippet}

<div
  class="bg-panel flex h-full w-[460px] max-w-full flex-col border-r shadow-xl"
  role="dialog"
  aria-label={editing ? "Edit remote" : "Add remote"}
>
  <div class="flex h-12 shrink-0 items-center gap-2 border-b px-4">
    <CloudIcon class="text-muted-foreground size-4" />
    <h2 class="min-w-0 flex-1 truncate text-sm font-semibold">
      {editing ? `Edit Remote: ${editing}` : "Add Remote"}
    </h2>
    <button
      class="hover:bg-accent rounded p-1"
      title="Close (Esc)"
      onclick={close}
    >
      <XIcon class="size-4" />
    </button>
  </div>

  {#if !editing}<div class="flex shrink-0 border-b px-2" role="tablist">
      {#each TABS as t (t.id)}
        <button
          role="tab"
          aria-selected={tab === t.id}
          class={cn(
            "text-muted-foreground hover:text-foreground relative flex flex-1 flex-col items-center gap-1 px-1 py-2.5 text-[11px]",
            tab === t.id &&
              "text-foreground after:bg-primary after:absolute after:inset-x-3 after:bottom-0 after:h-0.5",
          )}
          onclick={() => switchTab(t.id)}
        >
          <span class="relative">
            {#if t.id === "url"}<GlobeIcon class="size-5" />{:else}<BrandIcon
                provider={t.id}
                class="size-5"
              />{/if}
            {#if t.id !== "url" && hostingState.accounts[t.id]}
              <span
                class="bg-status-added ring-panel absolute -right-1 -bottom-0.5 size-2 rounded-full ring-2"
                title="Signed in"
              ></span>
            {/if}
          </span>
          {t.label}
        </button>
      {/each}
    </div>{/if}

  <div class="min-h-0 flex-1 overflow-auto p-4">
    {#if tab === "url"}
      <form class="flex flex-col gap-4" onsubmit={submit}>
        {#if loadError}<p class="text-destructive text-xs">{loadError}</p>{/if}
        {@render nameField()}
        <div class="flex flex-col gap-1.5">
          <Label for="remote-url">Pull URL</Label>
          <Input
            id="remote-url"
            bind:value={url}
            placeholder="git@host:owner/repo.git"
            autocomplete="off"
            spellcheck="false"
          />
        </div>
        <div class="flex flex-col gap-1.5">
          <Label for="remote-push-url"
            >Push URL <span class="text-muted-foreground font-normal"
              >(optional)</span
            ></Label
          >
          <Input
            id="remote-push-url"
            bind:value={pushUrl}
            placeholder={url.trim() || "Same as pull URL"}
            autocomplete="off"
            spellcheck="false"
          />
        </div>
        {@render testRow()}
        {@render submitRow()}
      </form>
    {:else if provider && !account}
      {#key provider}<HostingSignIn {provider} />{/key}
    {:else if provider && account}
      <form class="flex flex-col gap-4" onsubmit={submit}>
        <div class="flex items-center gap-2.5">
          {#if account.avatarUrl}
            <img
              src={account.avatarUrl}
              alt=""
              class="size-8 rounded-md"
              referrerpolicy="no-referrer"
            />
          {:else}
            <div
              class="bg-accent flex size-8 items-center justify-center rounded-md text-sm font-semibold"
            >
              {account.displayName.slice(0, 1).toUpperCase()}
            </div>
          {/if}
          <div class="min-w-0 flex-1">
            <div class="truncate text-sm font-medium">
              {account.displayName}
            </div>
            <div class="text-muted-foreground truncate text-xs">
              {account.login} · {account.baseUrl.replace(/^https:\/\//, "")}
            </div>
          </div>
          <button
            type="button"
            class="hover:bg-accent text-muted-foreground rounded p-1"
            title="Sign out"
            onclick={() => hostingState.signOut(provider)}
          >
            <LogOutIcon class="size-4" />
          </button>
        </div>
        {#if !account.persisted}
          <p class="text-muted-foreground text-xs">
            No system keyring is available, so this sign-in lasts until Lumiere
            Git quits.
          </p>
        {/if}

        <div class="flex flex-col gap-1.5">
          <div class="flex items-center">
            <Label for="repo-search" class="flex-1">Repository</Label>
            <button
              type="button"
              class="hover:bg-accent text-muted-foreground rounded p-0.5"
              title="Reload repositories"
              onclick={() => hostingState.loadRepos(provider, true)}
            >
              <RefreshCwIcon
                class={cn(
                  "size-3.5",
                  hostingState.loadingRepos[provider] && "animate-spin",
                )}
              />
            </button>
          </div>
          <Input
            id="repo-search"
            bind:value={query}
            placeholder="Search repositories"
            autocomplete="off"
            spellcheck="false"
          />
          <div
            class="bg-background h-56 overflow-auto rounded-lg border"
            role="listbox"
            aria-label="Repositories"
          >
            {#if hostingState.repoErrors[provider]}
              <p class="text-destructive p-3 text-xs">
                {hostingState.repoErrors[provider]}
              </p>
            {:else if !repos}
              <div
                class="text-muted-foreground flex items-center gap-2 p-3 text-xs"
              >
                <LoaderIcon class="size-3.5 animate-spin" />Loading
                repositories…
              </div>
            {:else}
              {#each filtered as r (r.fullName)}
                <button
                  type="button"
                  role="option"
                  aria-selected={picked?.fullName === r.fullName}
                  class={cn(
                    "hover:bg-row-hover flex w-full items-center gap-1.5 px-2.5 py-1.5 text-left text-[13px]",
                    picked?.fullName === r.fullName && "bg-row-selected",
                  )}
                  title={r.description ?? r.fullName}
                  onclick={() => pick(r)}
                >
                  <span class="min-w-0 flex-1 truncate">{r.fullName}</span>
                  {#if r.private}<LockIcon
                      class="text-muted-foreground size-3 shrink-0"
                    />{/if}
                </button>
              {:else}
                <p class="text-muted-foreground p-3 text-xs">
                  {query ? "No matching repositories" : "No repositories found"}
                </p>
              {/each}
            {/if}
          </div>
        </div>

        {@render nameField()}

        <div class="flex flex-col gap-1.5">
          <div class="flex items-center">
            <Label class="flex-1">URL</Label>
            <div class="flex rounded-md border text-xs">
              {#each ["https", "ssh"] as const as p (p)}
                <button
                  type="button"
                  class={cn(
                    "px-2 py-0.5 uppercase first:rounded-l-md last:rounded-r-md disabled:opacity-40",
                    protocol === p
                      ? "bg-accent text-foreground"
                      : "text-muted-foreground",
                  )}
                  disabled={p === "ssh" && !!picked && !picked.sshUrl}
                  onclick={() => (protocol = p)}>{p}</button
                >
              {/each}
            </div>
          </div>
          <Input
            value={pickedUrl}
            placeholder="Pick a repository"
            readonly
            class="text-muted-foreground"
          />
        </div>
        {@render testRow()}
        {@render submitRow()}
      </form>
    {/if}
  </div>
</div>
