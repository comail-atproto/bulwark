import { toast } from '@/stores/toast-store';

/**
 * The mail actions that can still be undone, newest last: the moves, deletes
 * and archives a toast offered Undo for, and the read, flag and tag changes.
 * Ctrl+Z (or `z`) undoes them one after another, newest first, so an Undo
 * isn't lost when the next action's toast replaces it.
 */
export interface UndoEntry {
  id: string;
  /** What was done ("Email archived"), for the record. */
  label: string;
  /** Puts it back. Reports its own outcome (a toast). */
  run: () => void;
  /** The toast that offers this Undo, if one is still up. */
  toastId?: string;
}

/** How many actions are kept. */
export const MAX_UNDO_HISTORY = 10;

let entries: UndoEntry[] = [];
let nextId = 1;

/** Adds an action that can be undone; the oldest goes when there are too many. */
export function recordUndo(label: string, run: () => void): UndoEntry {
  const entry: UndoEntry = { id: `undo-${nextId++}`, label, run };
  entries = [...entries, entry].slice(-MAX_UNDO_HISTORY);
  return entry;
}

/** Remembers which toast offers an entry's Undo, so Ctrl+Z can close it. */
export function linkUndoToast(id: string, toastId: string | undefined): void {
  const entry = entries.find((e) => e.id === id);
  if (entry && toastId) entry.toastId = toastId;
}

/**
 * Undoes one entry and takes it off the list, so it can't run twice (the
 * toast's Undo after Ctrl+Z, or the other way round). False when it was
 * already undone or dropped.
 */
export function runUndo(id: string, options: { closeToast?: boolean } = {}): boolean {
  const entry = entries.find((e) => e.id === id);
  if (!entry) return false;
  entries = entries.filter((e) => e !== entry);
  if (options.closeToast && entry.toastId) toast.dismiss(entry.toastId);
  entry.run();
  return true;
}

/** Undoes the newest entry and closes its toast. Null when there is nothing to undo. */
export function undoLatest(): UndoEntry | null {
  const entry = entries.at(-1);
  if (!entry) return null;
  runUndo(entry.id, { closeToast: true });
  return entry;
}

export function undoHistory(): readonly UndoEntry[] {
  return entries;
}

/** Forgets everything, e.g. after signing out. */
export function clearUndoHistory(): void {
  entries = [];
}
