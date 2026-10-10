// High-level user actions shared by the toolbar, menus, context menus and sidebar.
import { toast } from "svelte-sonner";
import type { RepoTab } from "$lib/stores/repo.svelte";
import { appState } from "$lib/stores/app.svelte";
import { dialogs, validateRefName } from "$lib/stores/dialogs.svelte";
import type { PullMode, Ref, ResetMode } from "$shared/types";

const short = (h: string) => h.slice(0, 7);

export async function createBranch(repo: RepoTab, at?: string) {
  const res = await dialogs.prompt({
    title: "Create branch",
    description: at
      ? `Branch from ${short(at)}`
      : `Branch from ${repo.refs?.head.branch ?? "HEAD"}`,
    fields: [
      { key: "name", label: "Branch name", placeholder: "feature/my-change" },
    ],
    checkboxes: [
      { key: "checkout", label: "Check out after creating", initial: true },
    ],
    confirmLabel: "Create branch",
    validate: (v) => validateRefName(v.name),
  });
  if (!res) return;
  await repo.run("Create branch", (api) =>
    api.createBranch(res.values.name.trim(), at, res.checks.checkout),
  );
}

export async function checkoutRef(repo: RepoTab, ref: Ref) {
  if (ref.kind === "branch") {
    if (ref.isHead) return;
    await repo.run(`Checkout ${ref.shortName}`, (api) =>
      api.checkout(ref.shortName),
    );
  } else if (ref.kind === "remote") {
    await repo.run(`Checkout ${ref.shortName}`, (api) =>
      api.checkout(ref.shortName, { remote: true }),
    );
  } else {
    await checkoutCommit(repo, ref.hash, ref.shortName);
  }
}

export async function checkoutCommit(
  repo: RepoTab,
  hash: string,
  label = short(hash),
) {
  const ok = await dialogs.confirm({
    title: "Check out commit?",
    description: `This puts the repository in a detached HEAD state at ${label}.`,
    confirmLabel: "Checkout",
  });
  if (ok) await repo.run(`Checkout ${label}`, (api) => api.checkout(hash));
}

export async function deleteBranch(repo: RepoTab, ref: Ref) {
  if (ref.kind === "remote") {
    const ok = await dialogs.confirm({
      title: `Delete ${ref.shortName}?`,
      description:
        "The branch will be deleted on the remote. This affects everyone using the remote.",
      confirmLabel: "Delete remote branch",
      destructive: true,
    });
    if (ok)
      await repo.run("Delete remote branch", (api) =>
        api.deleteRemoteBranch(ref.shortName),
      );
    return;
  }
  const ok = await dialogs.confirm({
    title: `Delete ${ref.shortName}?`,
    description:
      "Unmerged commits on this branch are kept reachable only through the reflog. You can undo this.",
    confirmLabel: "Delete",
    destructive: true,
  });
  if (ok)
    await repo.run("Delete branch", (api) =>
      api.deleteBranch(ref.shortName, true),
    );
}

export async function renameBranch(repo: RepoTab, ref: Ref) {
  const name = await dialogs.ask("Rename branch", "New name", {
    initial: ref.shortName,
    confirmLabel: "Rename",
  });
  if (!name || name === ref.shortName) return;
  const err = validateRefName(name);
  if (err) return toast.error(err);
  await repo.run("Rename branch", (api) =>
    api.renameBranch(ref.shortName, name.trim()),
  );
}

export async function mergeInto(repo: RepoTab, target: string) {
  const head = repo.refs?.head.branch ?? "HEAD";
  const ok = await dialogs.confirm({
    title: `Merge ${target} into ${head}?`,
    confirmLabel: "Merge",
  });
  if (ok) await repo.run(`Merge ${target}`, (api) => api.merge(target));
}

export async function rebaseOnto(repo: RepoTab, target: string) {
  const head = repo.refs?.head.branch ?? "HEAD";
  const ok = await dialogs.confirm({
    title: `Rebase ${head} onto ${target}?`,
    description: "Commits on the current branch will be rewritten.",
    confirmLabel: "Rebase",
  });
  if (ok) await repo.run(`Rebase onto ${target}`, (api) => api.rebase(target));
}

export async function cherryPick(repo: RepoTab, hash: string) {
  await repo.run("Cherry-pick", (api) => api.cherryPick(hash), {
    success: `Cherry-picked ${short(hash)}`,
  });
}

export async function revert(repo: RepoTab, hash: string) {
  const ok = await dialogs.confirm({
    title: `Revert ${short(hash)}?`,
    description: "A new commit undoing these changes will be created.",
    confirmLabel: "Revert",
  });
  if (ok) await repo.run("Revert", (api) => api.revert(hash));
}

export async function reset(repo: RepoTab, hash: string, mode: ResetMode) {
  const branch = repo.refs?.head.branch ?? "HEAD";
  const desc: Record<ResetMode, string> = {
    soft: "Keeps all changes staged.",
    mixed: "Keeps all changes in the working directory, unstaged.",
    hard: "Discards ALL uncommitted changes and commits after this point. This cannot be undone.",
  };
  const ok = await dialogs.confirm({
    title: `Reset ${branch} to ${short(hash)} (${mode})?`,
    description: desc[mode],
    confirmLabel: `Reset ${mode}`,
    destructive: mode === "hard",
  });
  if (ok) await repo.run("Reset", (api) => api.reset(hash, mode));
}

export async function createTag(repo: RepoTab, hash: string) {
  const res = await dialogs.prompt({
    title: "Create tag",
    description: `Tag commit ${short(hash)}`,
    fields: [
      { key: "name", label: "Tag name", placeholder: "v1.0.0" },
      {
        key: "message",
        label: "Message (creates an annotated tag)",
        multiline: true,
        optional: true,
      },
    ],
    confirmLabel: "Create tag",
    validate: (v) => validateRefName(v.name),
  });
  if (!res) return;
  await repo.run("Create tag", (api) =>
    api.createTag(
      res.values.name.trim(),
      hash,
      res.values.message.trim() || undefined,
    ),
  );
}

/** Deletes a tag, asking whether to delete it on the remotes too. */
export async function deleteTag(repo: RepoTab, ref: Ref) {
  const remoteNames = repo.refs?.remoteNames ?? [];
  const res = await dialogs.prompt({
    title: `Delete tag ${ref.shortName}?`,
    description: remoteNames.length
      ? "The local tag is deleted. Deleting it on a remote affects everyone using that remote."
      : "The local tag is deleted.",
    fields: [],
    checkboxes: remoteNames.map((r) => ({
      key: r,
      label: `Also delete from ${r}`,
    })),
    confirmLabel: "Delete",
    destructive: true,
  });
  if (!res) return;
  const remotes = remoteNames.filter((r) => res.checks[r]);
  await repo.run(
    "Delete tag",
    (api) => api.deleteTag(ref.shortName, remotes),
    { success: `Deleted tag ${ref.shortName}` },
  );
}

export function pushTag(repo: RepoTab, ref: Ref, remote: string) {
  return repo.run(
    `Push tag ${ref.shortName}`,
    (api) => api.pushTag(ref.shortName, remote),
    { success: `Pushed tag ${ref.shortName} to ${remote}` },
  );
}

export function fetchAll(repo: RepoTab) {
  return repo.run("Fetch", (api) => api.fetch(), {
    success: "Fetched all remotes",
  });
}

/** `all` fetches LFS objects for every ref, not just the checked-out commit. */
export function lfsFetch(repo: RepoTab, remote?: string, all = false) {
  return repo.run(
    "Fetch LFS objects",
    (api) => api.lfsFetch({ remote, all }),
    { success: `Fetched LFS objects${remote ? ` from ${remote}` : ""}` },
  );
}

export function lfsPull(repo: RepoTab, remote?: string) {
  return repo.run("Pull LFS objects", (api) => api.lfsPull(remote), {
    success: "Pulled LFS objects",
  });
}

export function pull(repo: RepoTab, mode: PullMode = "ff-only") {
  return repo.run("Pull", (api) => api.pull(mode), { success: "Pulled" });
}

export async function push(repo: RepoTab, force = false) {
  if (force) {
    const ok = await dialogs.confirm({
      title: "Force push?",
      description:
        "Uses --force-with-lease. Remote commits not present locally may be overwritten.",
      confirmLabel: "Force push",
      destructive: true,
    });
    if (!ok) return;
  }
  return repo.run("Push", (api) => api.push({ force }), { success: "Pushed" });
}

/** Open the push dialog (branch, remote, target, tags, force). */
export function pushDialog(repo: RepoTab, branch?: string) {
  if (!repo.refs?.remoteNames.length)
    return toast.info("This repository has no remotes");
  dialogs.pushRequest = { repo, branch };
}

/** Push a local branch (checked out or not); `remote` picks where an untracked branch goes. */
export function pushBranch(repo: RepoTab, ref: Ref, remote?: string) {
  return repo.run(
    `Push ${ref.shortName}`,
    (api) => api.push({ branch: ref.shortName, remote }),
    { success: `Pushed ${ref.shortName}` },
  );
}

/** Make `branch` track `upstream` (e.g. origin/main), or stop tracking when null. */
export function setUpstream(
  repo: RepoTab,
  branch: string,
  upstream: string | null,
) {
  return repo.run(
    upstream ? "Set upstream" : "Stop tracking",
    (api) => api.setUpstream(branch, upstream),
    {
      success: upstream
        ? `${branch} now tracks ${upstream}`
        : `${branch} no longer tracks a remote branch`,
    },
  );
}

export async function stash(repo: RepoTab) {
  if (!repo.changeCount) return toast.info("No local changes to stash");
  const msg = await dialogs.ask("Stash changes", "Message (optional)", {
    placeholder: "WIP",
    confirmLabel: "Stash",
  });
  if (msg === null) return;
  await repo.run("Stash", (api) => api.stash(msg.trim() || undefined));
}

export function stashPop(repo: RepoTab, index = 0) {
  return repo.run("Pop stash", (api) => api.stashPop(index));
}

export function stashApply(repo: RepoTab, index = 0) {
  return repo.run("Apply stash", (api) => api.stashApply(index));
}

export async function stashDrop(repo: RepoTab, index = 0) {
  const ok = await dialogs.confirm({
    title: `Delete stash@{${index}}?`,
    confirmLabel: "Delete",
    destructive: true,
  });
  if (ok) await repo.run("Delete stash", (api) => api.stashDrop(index));
}

export function undo(repo: RepoTab) {
  if (!repo.journal.canUndo) return;
  return repo.run("Undo", (api) => api.undo(), {
    success: `Undid: ${repo.journal.undoLabel}`,
  });
}

export function redo(repo: RepoTab) {
  if (!repo.journal.canRedo) return;
  return repo.run("Redo", (api) => api.redo(), {
    success: `Redid: ${repo.journal.redoLabel}`,
  });
}

export async function discardAll(repo: RepoTab) {
  const ok = await dialogs.confirm({
    title: "Discard all changes?",
    description:
      "All staged, unstaged and untracked changes will be permanently lost.",
    confirmLabel: "Discard all",
    destructive: true,
  });
  if (ok) await repo.run("Discard", (api) => api.discardAll());
}

export function addRemote(repo: RepoTab) {
  appState.sidebarOpen = true;
  repo.editRemoteName = null;
  repo.addRemoteOpen = true;
}

export function editRemote(repo: RepoTab, name: string) {
  appState.sidebarOpen = true;
  repo.editRemoteName = name;
  repo.addRemoteOpen = true;
}

/** Save the Edit Remote panel: rename and/or change URLs, then optionally fetch. */
export async function saveRemote(
  repo: RepoTab,
  oldName: string,
  v: { name: string; url: string; pushUrl: string; fetch: boolean },
) {
  const name = v.name.trim();
  const ok = await repo.run(
    "Edit remote",
    (api) =>
      api.editRemote(oldName, {
        name,
        url: v.url.trim(),
        pushUrl: v.pushUrl.trim() || undefined,
      }),
    {
      success: `Saved remote ${name}`,
    },
  );
  if (!ok) return false;
  if (v.fetch)
    await repo.run(`Fetch ${name}`, (api) => api.fetch({ remote: name }));
  return true;
}

export async function removeRemote(repo: RepoTab, name: string) {
  const ok = await dialogs.confirm({
    title: `Remove remote ${name}?`,
    description:
      "The remote and its remote-tracking branches are removed from this repository. Nothing is deleted on the server.",
    confirmLabel: "Remove",
    destructive: true,
  });
  if (!ok) return;
  if (repo.editRemoteName === name) repo.addRemoteOpen = false;
  await repo.run("Remove remote", (api) => api.removeRemote(name), {
    success: `Removed remote ${name}`,
  });
}

export function fetchRemote(repo: RepoTab, name: string) {
  return repo.run(`Fetch ${name}`, (api) => api.fetch({ remote: name }), {
    success: `Fetched ${name}`,
  });
}

/** Add a remote from the Add Remote panel, then fetch it so its branches appear. */
export async function submitRemote(
  repo: RepoTab,
  v: { name: string; url: string; pushUrl: string; fetch: boolean },
) {
  const name = v.name.trim();
  const url = v.url.trim();
  const pushUrl = v.pushUrl.trim() || undefined;
  const ok = await repo.run(
    "Add remote",
    (api) => api.addRemote(name, url, pushUrl),
    { success: `Added remote ${name}` },
  );
  if (!ok) return false;
  if (v.fetch)
    await repo.run(`Fetch ${name}`, (api) => api.fetch({ remote: name }));
  return true;
}

export async function copyText(text: string, what = "Copied") {
  await navigator.clipboard.writeText(text);
  toast.success(what);
}
