import type { JournalState } from "../shared/types";

type Cmd = string[];

export interface JournalEntry {
  label: string;
  /** HEAD before the operation (checked before redo). */
  before: string | null;
  /** HEAD after the operation (checked before undo). */
  after: string | null;
  undo: Cmd | Cmd[];
  redo: Cmd | Cmd[];
  stashHash?: string;
}

const MAX_ENTRIES = 50;

/** Linear undo/redo history of reversible git operations performed through the app. */
export class Journal {
  private entries: JournalEntry[] = [];
  /** Number of entries currently applied (entries[cursor..] are redoable). */
  private cursor = 0;

  static commands(c: Cmd | Cmd[]): Cmd[] {
    return Array.isArray(c[0]) ? (c as Cmd[]) : [c as Cmd];
  }

  push(entry: JournalEntry) {
    this.entries.splice(this.cursor);
    this.entries.push(entry);
    if (this.entries.length > MAX_ENTRIES) this.entries.shift();
    this.cursor = this.entries.length;
  }

  peekUndo(): JournalEntry | undefined {
    return this.cursor > 0 ? this.entries[this.cursor - 1] : undefined;
  }

  peekRedo(): JournalEntry | undefined {
    return this.entries[this.cursor];
  }

  didUndo() {
    this.cursor--;
  }

  didRedo() {
    this.cursor++;
  }

  clear() {
    this.entries = [];
    this.cursor = 0;
  }

  state(): JournalState {
    const u = this.peekUndo();
    const r = this.peekRedo();
    return {
      canUndo: !!u,
      canRedo: !!r,
      undoLabel: u?.label,
      redoLabel: r?.label,
    };
  }
}
