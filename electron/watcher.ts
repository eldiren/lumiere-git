import fs from "node:fs";
import path from "node:path";
import debounce from "lodash/debounce";

// Paths inside .git whose changes don't affect what we display.
const IGNORED_GIT =
  /^\.git[\\/](objects|logs|lfs|hooks|modules)[\\/]|\.lock$|^\.git[\\/]fsmonitor/;
// Common heavy directories in the working tree; status is re-read on focus anyway.
const IGNORED_WORKTREE =
  /(^|[\\/])(node_modules|\.venv|__pycache__|target|dist|build|\.svelte-kit)([\\/]|$)/;

/**
 * Recursive fs.watch for a repository. Emits a debounced callback with whether
 * the change touched .git (refs/HEAD/index) or only the working tree.
 */
export class RepoWatcher {
  private watchers: fs.FSWatcher[] = [];
  private gitChanged = false;
  private fire: ReturnType<typeof debounce>;

  constructor(
    readonly root: string,
    onChange: (info: { git: boolean }) => void,
  ) {
    this.fire = debounce(
      () => {
        const git = this.gitChanged;
        this.gitChanged = false;
        onChange({ git });
      },
      300,
      { maxWait: 1500 },
    );
  }

  start() {
    try {
      const w = fs.watch(this.root, { recursive: true }, (_event, filename) => {
        if (!filename) return this.fire();
        const f = filename.toString();
        if (f === ".git" || f.startsWith(".git" + path.sep)) {
          if (IGNORED_GIT.test(f)) return;
          this.gitChanged = true;
          this.fire();
        } else if (!IGNORED_WORKTREE.test(f)) {
          this.fire();
        }
      });
      w.on("error", (e) => console.warn("watcher error", this.root, e.message));
      this.watchers.push(w);
    } catch (e) {
      console.warn(
        "recursive watch unavailable for",
        this.root,
        (e as Error).message,
      );
    }
  }

  stop() {
    this.fire.cancel();
    for (const w of this.watchers) w.close();
    this.watchers = [];
  }
}
