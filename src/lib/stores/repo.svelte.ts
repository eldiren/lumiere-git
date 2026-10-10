import { toast } from "svelte-sonner";
import { repoApi, type RepoApi } from "$lib/api";
import { layoutGraph, type GraphLayout } from "$lib/graph/layout";
import type {
  Commit,
  CommitDetail,
  DiffSource,
  FileChange,
  JournalState,
  Ref,
  RepoRefs,
  Stash,
  WorkingStatus,
} from "$shared/types";

export const WIP = "WIP";

export type GraphItem =
  | { kind: "wip"; hash: typeof WIP; parents: string[] }
  | { kind: "commit"; hash: string; parents: string[]; commit: Commit }
  | { kind: "stash"; hash: string; parents: string[]; stash: Stash };

/** Refs pointing at a commit, grouped for display (local + its remote counterpart = one pill). */
export interface RefGroup {
  label: string;
  local?: Ref;
  remotes: Ref[];
  tag?: Ref;
  isHead: boolean;
}

export interface OpenDiff {
  source: DiffSource;
  file: FileChange;
}

const PAGE = 2000;

export class RepoTab {
  readonly api: RepoApi;
  readonly name: string;

  commits = $state.raw<Commit[]>([]);
  refs = $state.raw<RepoRefs | null>(null);
  status = $state.raw<WorkingStatus | null>(null);
  journal = $state.raw<JournalState>({ canUndo: false, canRedo: false });
  hasMore = $state(false);
  /** The repo routes files through Git LFS (shows the LFS fetch/pull actions). */
  usesLfs = $state(false);
  loading = $state(true);
  error = $state<string | null>(null);

  selected = $state<string | null>(null);
  detail = $state.raw<CommitDetail | null>(null);
  diff = $state.raw<OpenDiff | null>(null);
  busy = $state<string | null>(null);
  filter = $state("");
  fileView = $state<"path" | "tree">("path");
  addRemoteOpen = $state(false);
  /** Remote being edited in the remote panel; null when it adds a new remote. */
  editRemoteName = $state<string | null>(null);

  // Commit composer draft (kept per tab).
  draftSummary = $state("");
  draftBody = $state("");
  amend = $state(false);

  /** Rows shown in the graph: WIP (if dirty), commits, and stashes placed above their base. */
  items: GraphItem[] = $derived.by(() =>
    buildItems(this.commits, this.refs, this.status),
  );
  layout: GraphLayout = $derived(layoutGraph(this.items));
  indexByHash: Map<string, number> = $derived(
    new Map(this.items.map((it, i) => [it.hash, i])),
  );
  refsByHash: Map<string, RefGroup[]> = $derived(groupRefs(this.refs));
  changeCount = $derived(
    this.status
      ? this.status.staged.length +
          this.status.unstaged.length +
          this.status.conflicted.length
      : 0,
  );

  private loadingMore = false;
  private statusTimer: ReturnType<typeof setTimeout> | null = null;
  private detailToken = 0;

  constructor(readonly root: string) {
    this.api = repoApi(root);
    this.name = root.split(/[\\/]/).filter(Boolean).pop() ?? root;
  }

  async load() {
    this.loading = true;
    try {
      await this.refresh();
      this.error = null;
      if (!this.selected)
        this.select(
          this.changeCount
            ? WIP
            : (this.refs?.head.hash ?? this.commits[0]?.hash ?? null),
        );
    } catch (e) {
      this.error = (e as Error).message;
    } finally {
      this.loading = false;
    }
  }

  /** Reload everything (refs, graph, status). */
  async refresh() {
    const limit = Math.max(PAGE, this.commits.length);
    const [refs, commits, status, journal] = await Promise.all([
      this.api.refs(),
      this.api.log({ limit }),
      this.api.status(),
      this.api.journalState(),
    ]);
    this.refs = refs;
    this.commits = commits;
    this.status = status;
    this.journal = journal;
    this.hasMore = commits.length >= limit;
    this.api
      .usesLfs()
      .then((v) => (this.usesLfs = v))
      .catch(() => (this.usesLfs = false));
    // Selection may have vanished (e.g. after undo).
    if (
      this.selected &&
      this.selected !== WIP &&
      !this.indexByHash.has(this.selected)
    ) {
      this.select(refs.head.hash);
    } else if (this.selected === WIP && !this.changeCount) {
      this.select(refs.head.hash);
    } else if (this.selected && this.selected !== WIP) {
      // Keep detail fresh.
      this.loadDetail(this.selected);
    }
  }

  async refreshStatus() {
    try {
      this.status = await this.api.status();
    } catch (e) {
      console.warn("status failed", e);
    }
  }

  /** Called by the fs watcher. Working-tree-only changes just refresh status. */
  onChanged(info: { git: boolean }) {
    if (this.busy) return; // the running op refreshes when it finishes
    if (info.git) this.refresh().catch((e) => console.warn(e));
    else {
      if (this.statusTimer) clearTimeout(this.statusTimer);
      this.statusTimer = setTimeout(() => this.refreshStatus(), 50);
    }
  }

  async loadMore() {
    if (!this.hasMore || this.loadingMore) return;
    this.loadingMore = true;
    try {
      const more = await this.api.log({
        skip: this.commits.length,
        limit: PAGE,
      });
      this.commits = [...this.commits, ...more];
      this.hasMore = more.length >= PAGE;
    } finally {
      this.loadingMore = false;
    }
  }

  select(hash: string | null) {
    this.selected = hash;
    this.diff = null;
    if (hash && hash !== WIP) this.loadDetail(hash);
    else this.detail = null;
  }

  private async loadDetail(hash: string) {
    const token = ++this.detailToken;
    try {
      const d = await this.api.commitDetail(hash);
      if (token === this.detailToken) this.detail = d;
    } catch (e) {
      if (token === this.detailToken) this.detail = null;
      console.warn(e);
    }
  }

  openDiff(source: DiffSource, file: FileChange) {
    this.diff = { source, file };
  }

  closeDiff() {
    this.diff = null;
  }

  /**
   * Run a mutating operation with a busy indicator, error toast, and a refresh afterwards.
   * Returns true on success.
   */
  async run(
    label: string,
    fn: (api: RepoApi) => Promise<unknown>,
    opts: { success?: string } = {},
  ): Promise<boolean> {
    if (this.busy) {
      toast.warning(`Please wait — ${this.busy.toLowerCase()} in progress`);
      return false;
    }
    this.busy = label;
    let ok = true;
    try {
      await fn(this.api);
      if (opts.success) toast.success(opts.success);
    } catch (e) {
      ok = false;
      toast.error(label + " failed", {
        description: (e as Error).message,
        duration: 8000,
      });
    } finally {
      this.busy = null;
      await this.refresh().catch((e) => console.warn(e));
    }
    return ok;
  }

  commitByHash(hash: string): Commit | undefined {
    const it = this.items[this.indexByHash.get(hash) ?? -1];
    return it?.kind === "commit" ? it.commit : undefined;
  }
}

function buildItems(
  commits: Commit[],
  refs: RepoRefs | null,
  status: WorkingStatus | null,
): GraphItem[] {
  const items: GraphItem[] = commits.map((c) => ({
    kind: "commit",
    hash: c.hash,
    parents: c.parents,
    commit: c,
  }));
  if (refs?.stashes.length) {
    const known = new Set(commits.map((c) => c.hash));
    // Oldest stash first so newer ones end up above older ones on the same base.
    for (const s of [...refs.stashes].reverse()) {
      if (!known.has(s.parents[0])) continue;
      const base = items.findIndex((it) => it.hash === s.parents[0]);
      // Place the stash where its date fits, but always above its base commit.
      let pos = base;
      while (pos > 0) {
        const prev = items[pos - 1];
        const date =
          prev.kind === "commit"
            ? prev.commit.committer.date
            : prev.kind === "stash"
              ? prev.stash.date
              : Infinity;
        if (date >= s.date) break;
        pos--;
      }
      items.splice(pos, 0, {
        kind: "stash",
        hash: s.hash,
        parents: [s.parents[0]],
        stash: s,
      });
    }
  }
  const dirty =
    status &&
    status.staged.length + status.unstaged.length + status.conflicted.length >
      0;
  if (dirty || (refs?.head.unborn && status)) {
    const head = refs?.head.hash;
    items.unshift({ kind: "wip", hash: WIP, parents: head ? [head] : [] });
  }
  return items;
}

function groupRefs(refs: RepoRefs | null): Map<string, RefGroup[]> {
  const map = new Map<string, RefGroup[]>();
  if (!refs) return map;
  const add = (hash: string, g: RefGroup) => {
    const list = map.get(hash);
    if (list) list.push(g);
    else map.set(hash, [g]);
  };
  const remoteByName = new Map(refs.remotes.map((r) => [r.shortName, r]));
  const usedRemotes = new Set<string>();
  for (const b of refs.branches) {
    const g: RefGroup = {
      label: b.shortName,
      local: b,
      remotes: [],
      isHead: !!b.isHead,
    };
    // Merge remotes with the same branch name pointing at the same commit.
    for (const remote of refs.remoteNames) {
      const r = remoteByName.get(`${remote}/${b.shortName}`);
      if (r && r.hash === b.hash) {
        g.remotes.push(r);
        usedRemotes.add(r.shortName);
      }
    }
    add(b.hash, g);
  }
  for (const r of refs.remotes) {
    if (usedRemotes.has(r.shortName)) continue;
    add(r.hash, { label: r.shortName, remotes: [r], isHead: false });
  }
  for (const t of refs.tags)
    add(t.hash, { label: t.shortName, tag: t, remotes: [], isHead: false });
  // HEAD branch first, then locals, remotes, tags.
  for (const list of map.values()) {
    list.sort((a, b) => rank(a) - rank(b));
  }
  if (refs.head.detached && refs.head.hash) {
    const list = map.get(refs.head.hash) ?? [];
    list.unshift({ label: "HEAD", remotes: [], isHead: true });
    map.set(refs.head.hash, list);
  }
  return map;
}

function rank(g: RefGroup) {
  if (g.isHead) return 0;
  if (g.local) return 1;
  if (g.remotes.length) return 2;
  return 3;
}
