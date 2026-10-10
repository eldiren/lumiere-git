<script lang="ts">
  import { untrack } from "svelte";
  import GitBranchIcon from "@lucide/svelte/icons/git-branch";
  import CloudIcon from "@lucide/svelte/icons/cloud";
  import * as Dialog from "$lib/components/ui/dialog";
  import * as Select from "$lib/components/ui/select";
  import { Button } from "$lib/components/ui/button";
  import { Checkbox } from "$lib/components/ui/checkbox";
  import { Label } from "$lib/components/ui/label";
  import { dialogs } from "$lib/stores/dialogs.svelte";

  // Push with options: which branch, which remote, which remote branch, all tags, force.

  /** "To" value meaning the upstream (or same-named) branch; a colon can't appear in a ref name. */
  const DEFAULT = ":default";

  const req = $derived(dialogs.pushRequest);
  const refs = $derived(req?.repo.refs ?? null);
  const branches = $derived(refs?.branches ?? []);
  const remoteNames = $derived(refs?.remoteNames ?? []);

  let branch = $state("");
  let remote = $state("");
  let to = $state(DEFAULT);
  let tags = $state(false);
  let force = $state(false);

  /** The live upstream of a local branch, split into remote and branch name. */
  function upstreamOf(name: string) {
    const b = branches.find((r) => r.shortName === name);
    if (!b?.upstream || b.upstreamGone) return null;
    const r = remoteNames.find((n) => b.upstream!.startsWith(n + "/"));
    return r ? { remote: r, branch: b.upstream.slice(r.length + 1) } : null;
  }

  function pickBranch(name: string) {
    branch = name;
    remote =
      upstreamOf(name)?.remote ??
      (remoteNames.includes("origin") ? "origin" : (remoteNames[0] ?? ""));
    to = DEFAULT;
  }

  $effect(() => {
    if (!req) return;
    untrack(() => {
      pickBranch(
        req.branch ?? refs?.head.branch ?? branches[0]?.shortName ?? "",
      );
      tags = false;
      force = false;
    });
  });

  const defaultTarget = $derived.by(() => {
    const up = upstreamOf(branch);
    return up?.remote === remote ? up.branch : branch;
  });
  const otherTargets = $derived(
    (refs?.remotes ?? [])
      .filter((r) => r.remote === remote)
      .map((r) => r.shortName.slice(remote.length + 1))
      .filter((n) => n !== "HEAD" && n !== defaultTarget),
  );
  const canSubmit = $derived(!!branch && !!remote);

  function cancel() {
    dialogs.pushRequest = null;
  }

  function submit(e: Event) {
    e.preventDefault();
    if (!req || !canSubmit) return;
    const opts = {
      branch,
      remote,
      to: to === DEFAULT ? defaultTarget : to,
      tags,
      force,
    };
    const { repo } = req;
    dialogs.pushRequest = null;
    repo.run(`Push ${branch}`, (api) => api.push(opts), {
      success: `Pushed ${branch} to ${remote}/${opts.to}`,
    });
  }
</script>

<Dialog.Root open={!!req} onOpenChange={(o) => !o && cancel()}>
  <Dialog.Content class="sm:max-w-md" showCloseButton={false}>
    {#if req}
      <form onsubmit={submit} class="flex flex-col gap-4">
        <Dialog.Header>
          <Dialog.Title>Push</Dialog.Title>
          <Dialog.Description
            >Send local commits to a remote repository.</Dialog.Description
          >
        </Dialog.Header>
        <div class="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-2">
          <Label class="justify-self-end">Branch</Label>
          <Select.Root
            type="single"
            value={branch}
            onValueChange={(v) => pickBranch(v)}
          >
            <Select.Trigger class="w-full min-w-0" aria-label="Branch">
              <span class="flex min-w-0 items-center gap-1.5">
                <GitBranchIcon class="text-muted-foreground size-3.5" />
                <span class="truncate">{branch}</span>
              </span>
            </Select.Trigger>
            <Select.Content>
              {#each branches as b (b.name)}
                <Select.Item value={b.shortName} label={b.shortName}
                  >{b.shortName}</Select.Item
                >
              {/each}
            </Select.Content>
          </Select.Root>

          <Label class="justify-self-end">Remote</Label>
          <Select.Root
            type="single"
            value={remote}
            onValueChange={(v) => {
              remote = v;
              to = DEFAULT;
            }}
          >
            <Select.Trigger class="w-full min-w-0" aria-label="Remote">
              <span class="flex min-w-0 items-center gap-1.5">
                <CloudIcon class="text-muted-foreground size-3.5" />
                <span class="truncate">{remote}</span>
              </span>
            </Select.Trigger>
            <Select.Content>
              {#each remoteNames as r (r)}
                <Select.Item value={r} label={r}>{r}</Select.Item>
              {/each}
            </Select.Content>
          </Select.Root>

          <Label class="justify-self-end">To</Label>
          <Select.Root type="single" bind:value={to}>
            <Select.Trigger class="w-full min-w-0" aria-label="To">
              <span class="flex min-w-0 items-center gap-1.5">
                <GitBranchIcon class="text-muted-foreground size-3.5" />
                <span class="truncate"
                  >{to === DEFAULT
                    ? `default (${remote}/${defaultTarget})`
                    : `${remote}/${to}`}</span
                >
              </span>
            </Select.Trigger>
            <Select.Content>
              <Select.Item
                value={DEFAULT}
                label="default ({remote}/{defaultTarget})"
                >default ({remote}/{defaultTarget})</Select.Item
              >
              {#each otherTargets as t (t)}
                <Select.Item value={t} label="{remote}/{t}"
                  >{remote}/{t}</Select.Item
                >
              {/each}
            </Select.Content>
          </Select.Root>

          <label class="col-start-2 flex items-center gap-2 text-sm">
            <Checkbox bind:checked={tags} />
            Push all tags
          </label>
          <label class="col-start-2 flex items-center gap-2 text-sm">
            <Checkbox bind:checked={force} />
            Force push
          </label>
          {#if force}
            <p class="text-muted-foreground col-start-2 text-xs">
              Uses --force-with-lease. Remote commits not present locally may be
              overwritten.
            </p>
          {/if}
        </div>
        <Dialog.Footer>
          <Button variant="ghost" type="button" onclick={cancel}>Cancel</Button>
          <Button
            type="submit"
            variant={force ? "destructive" : "default"}
            disabled={!canSubmit}
          >
            {force ? "Force push" : "Push"}
          </Button>
        </Dialog.Footer>
      </form>
    {/if}
  </Dialog.Content>
</Dialog.Root>
