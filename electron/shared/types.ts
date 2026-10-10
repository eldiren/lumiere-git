// Types shared between the Electron main process and the renderer.

export interface Signature {
  name: string;
  email: string;
  /** Unix time in seconds */
  date: number;
}

export interface Commit {
  hash: string;
  parents: string[];
  author: Signature;
  committer: Signature;
  subject: string;
  body: string;
  /** Set for synthetic rows (stash entries rendered in the graph). */
  stashIndex?: number;
}

export type RefKind = "branch" | "remote" | "tag";

export interface Ref {
  /** Full ref name, e.g. refs/heads/main */
  name: string;
  /** Display name, e.g. main, origin/main, v1.0 */
  shortName: string;
  kind: RefKind;
  /** Commit the ref points at (peeled for annotated tags). */
  hash: string;
  /** Remote name for remote-tracking refs. */
  remote?: string;
  /** Upstream short name for local branches, e.g. origin/main */
  upstream?: string;
  ahead?: number;
  behind?: number;
  upstreamGone?: boolean;
  isHead?: boolean;
}

export interface Stash {
  index: number;
  /** stash@{n} */
  ref: string;
  hash: string;
  parents: string[];
  message: string;
  date: number;
}

export interface HeadInfo {
  /** Branch name, or null when detached / unborn with no name. */
  branch: string | null;
  hash: string | null;
  detached: boolean;
  unborn: boolean;
}

export interface RepoRefs {
  head: HeadInfo;
  branches: Ref[];
  remotes: Ref[];
  tags: Ref[];
  stashes: Stash[];
  remoteNames: string[];
}

export type ChangeStatus = "A" | "M" | "D" | "R" | "C" | "T" | "U" | "?";

export interface FileChange {
  path: string;
  oldPath?: string;
  status: ChangeStatus;
  additions?: number;
  deletions?: number;
  binary?: boolean;
}

export type RepoState =
  | "clean"
  | "merging"
  | "rebasing"
  | "cherry-picking"
  | "reverting"
  | "bisecting";

export interface WorkingStatus {
  branch: string | null;
  headHash: string | null;
  upstream: string | null;
  ahead: number;
  behind: number;
  staged: FileChange[];
  unstaged: FileChange[];
  conflicted: FileChange[];
  state: RepoState;
  /** Prefilled message when git has one (MERGE_MSG etc.). */
  pendingMessage: string | null;
}

export interface CommitDetail {
  commit: Commit;
  files: FileChange[];
}

export type DiffLineType = "context" | "add" | "del" | "noeol";

export interface DiffLine {
  type: DiffLineType;
  content: string;
  oldLine?: number;
  newLine?: number;
}

export interface DiffHunk {
  header: string;
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: DiffLine[];
}

export interface FileDiff {
  path: string;
  oldPath?: string;
  binary: boolean;
  hunks: DiffHunk[];
  encoding: string;
  /** Diff was truncated because the file is very large. */
  tooLarge?: boolean;
  isNew?: boolean;
  isDeleted?: boolean;
  /** File mode of a new or deleted file, e.g. "100644". */
  mode?: string;
}

/**
 * Changed lines picked in a diff: deleted lines by their old line number, added lines by their
 * new line number. Line numbers do not depend on how much context the diff was made with.
 */
export interface DiffLineSelection {
  old: number[];
  new: number[];
}

/** What a diff is being taken of. */
export type DiffSource =
  | { kind: "commit"; hash: string; parent?: string }
  | { kind: "staged" }
  | { kind: "unstaged"; untracked?: boolean };

export interface FileContent {
  text: string;
  encoding: string;
  binary: boolean;
}

export type ResetMode = "soft" | "mixed" | "hard";
export type PullMode = "ff-only" | "merge" | "rebase";

export interface JournalState {
  canUndo: boolean;
  canRedo: boolean;
  undoLabel?: string;
  redoLabel?: string;
}

export interface RecentRepo {
  path: string;
  name: string;
  openedAt: number;
}

export interface Settings {
  theme: "dark" | "light";
  zoom: number;
  openTabs: string[];
  activeTab: string | null;
  recent: RecentRepo[];
  graphPageSize: number;
  showStashesInGraph: boolean;
  diffMode: "hunk" | "inline" | "split";
  sidebarWidth: number;
  detailWidth: number;
  /** Git binary the user picked with "Locate Git…"; null means auto-detect. */
  gitPath: string | null;
  /** Check for updates to the app-managed Git (Windows only). */
  gitCheckUpdates: boolean;
  /** Unix ms of the last update check. */
  gitLastUpdateCheck: number;
}

/** Where the git binary in use came from, in resolution order. */
export type GitSource = "env" | "custom" | "managed" | "system" | "none";

export interface GitInfo {
  source: GitSource;
  /** Absolute path, or `git` when found on PATH. Null when no usable git was found. */
  path: string | null;
  /** Full version string, e.g. `2.51.0` or `2.51.0.windows.1`. */
  version: string | null;
  /** At least MIN_GIT_VERSION. */
  supported: boolean;
  minVersion: string;
  platform: string;
  /** The app can download and update its own Git on this platform (Windows). */
  canDownload: boolean;
  /** Path picked with "Locate Git…", even if it no longer works. */
  customPath: string | null;
  /** Release tag of the app-managed Git, if one is installed (even when another source wins). */
  managedTag: string | null;
  /** Newer managed Git release, set after an update check finds one. */
  update: { tag: string; size: number } | null;
  /** Problem worth showing, e.g. a custom path that no longer works. */
  warning: string | null;
  /** `git lfs version` output (e.g. `git-lfs/3.7.0 (…)`), or null when git-lfs isn't installed. */
  lfsVersion: string | null;
}

export type GitSetupProgress =
  | { phase: "download"; received: number; total: number }
  | { phase: "verify" | "extract" | "done" };

export type IpcResult<T> =
  { ok: true; value: T } | { ok: false; error: string };

// ------------------------------------------------------------------ hosting accounts

export type HostingProvider =
  "github" | "gitlab" | "bitbucket" | "azure" | "gitea";

/** What the renderer sends to sign in. The token never comes back out of the main process. */
export interface HostingSignIn {
  provider: HostingProvider;
  token: string;
  /** Self-hosted GitHub Enterprise / GitLab / Gitea origin; empty for the public service. */
  baseUrl?: string;
  /** Bitbucket: Atlassian account email (API token) or username (app password). */
  username?: string;
  /** Azure DevOps organization. */
  organization?: string;
}

export interface HostingAccount {
  provider: HostingProvider;
  /** Web origin, e.g. https://github.com or https://dev.azure.com/my-org. */
  baseUrl: string;
  login: string;
  displayName: string;
  avatarUrl: string | null;
  organization?: string;
  /** False when no secure OS keyring was available and the token lives only in memory. */
  persisted: boolean;
}

export interface HostingRepo {
  /** owner/name (Azure: project/name). */
  fullName: string;
  description: string | null;
  private: boolean;
  httpsUrl: string;
  sshUrl: string | null;
  webUrl: string | null;
}

/** Git asked for HTTPS credentials that no hosting account or saved entry could answer. */
export interface CredentialRequest {
  id: string;
  /** e.g. https://gitea.example.com */
  origin: string;
  path: string | null;
  /** Username from the remote URL, if it has one. */
  username: string | null;
  /** False when there is no OS keyring, so "remember" would only last until the app quits. */
  canRemember: boolean;
}

export interface CredentialAnswer {
  username: string;
  password: string;
  remember: boolean;
}
