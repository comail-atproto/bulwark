/**
 * Screen reader announcements: short status messages ("Moved to Archive",
 * "3 new messages") read out without moving the focus.
 *
 * Two live regions are shared by the whole app, one polite and one
 * assertive. They sit at the end of <body>, visually hidden, and are created
 * on first use or by <LiveRegions /> when an app starts, so a region already
 * exists when the first message arrives (some screen readers ignore a region
 * that appears together with its text).
 *
 * Errors go to the assertive region, everything else to the polite one. The
 * helper keeps the chatter down: the same message is not repeated within a
 * couple of seconds, messages that arrive together are read as one, and a
 * caller can debounce a message under a key so only the last one of a burst
 * is read (a folder that loads in two steps, a count that changes while
 * typing).
 */

export type Politeness = 'polite' | 'assertive';

export const LIVE_REGION_IDS: Record<Politeness, string> = {
  polite: 'a11y-live-polite',
  assertive: 'a11y-live-assertive',
};

/** The same text again within this time is not read a second time. */
const REPEAT_WINDOW_MS = 2000;
/**
 * The region is emptied first and filled a moment later: screen readers read
 * a change, and an unchanged text written again is no change.
 */
const WRITE_DELAY_MS = 60;
/** Old text is cleared, so browsing the page later doesn't land on it. */
const CLEAR_AFTER_MS = 7000;

export interface AnnounceOptions {
  /** Interrupts the screen reader. For errors only. */
  assertive?: boolean;
  /**
   * Waits this long and reads only the last message given under `key` in
   * that time.
   */
  debounceMs?: number;
  /** Groups messages for `debounceMs`; also the repeat check's key. Defaults to the message. */
  key?: string;
}

interface RegionState {
  queue: string[];
  writeTimer: ReturnType<typeof setTimeout> | null;
  clearTimer: ReturnType<typeof setTimeout> | null;
}

const regions: Record<Politeness, RegionState> = {
  polite: { queue: [], writeTimer: null, clearTimer: null },
  assertive: { queue: [], writeTimer: null, clearTimer: null },
};
const lastSaid = new Map<string, number>();
const debounced = new Map<string, ReturnType<typeof setTimeout>>();

// Visually hidden, but read by screen readers (the usual "sr-only" rules,
// inline so the regions don't depend on the app's stylesheet).
const HIDDEN_STYLE =
  'position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0;';

/** Creates the two regions when they aren't in the page yet. */
export function ensureLiveRegions(doc: Document | undefined = typeof document === 'undefined' ? undefined : document): void {
  // A timer can outlive the page (a test's DOM torn down, server code).
  if (!doc?.body) return;
  for (const politeness of ['polite', 'assertive'] as const) {
    if (doc.getElementById(LIVE_REGION_IDS[politeness])) continue;
    const el = doc.createElement('div');
    el.id = LIVE_REGION_IDS[politeness];
    el.setAttribute('role', politeness === 'assertive' ? 'alert' : 'status');
    el.setAttribute('aria-live', politeness);
    el.setAttribute('aria-atomic', 'true');
    el.setAttribute('style', HIDDEN_STYLE);
    doc.body.appendChild(el);
  }
}

function regionElement(politeness: Politeness): HTMLElement | null {
  if (typeof document === 'undefined') return null;
  ensureLiveRegions();
  return document.getElementById(LIVE_REGION_IDS[politeness]);
}

function flush(politeness: Politeness): void {
  const state = regions[politeness];
  state.writeTimer = null;
  const text = state.queue.join(' ');
  state.queue = [];
  const el = regionElement(politeness);
  if (!el || !text) return;
  el.textContent = text;
  if (state.clearTimer) clearTimeout(state.clearTimer);
  state.clearTimer = setTimeout(() => {
    state.clearTimer = null;
    if (el.textContent === text) el.textContent = '';
  }, CLEAR_AFTER_MS);
}

function say(message: string, politeness: Politeness, key: string): void {
  const now = Date.now();
  const last = lastSaid.get(`${politeness}\u0000${key}\u0000${message}`);
  if (last !== undefined && now - last < REPEAT_WINDOW_MS) return;
  lastSaid.set(`${politeness}\u0000${key}\u0000${message}`, now);
  if (lastSaid.size > 50) {
    for (const [k, at] of lastSaid) if (now - at >= REPEAT_WINDOW_MS) lastSaid.delete(k);
  }

  const state = regions[politeness];
  if (!state.queue.includes(message)) state.queue.push(message);
  if (state.writeTimer) return;
  const el = regionElement(politeness);
  if (el) el.textContent = '';
  state.writeTimer = setTimeout(() => flush(politeness), WRITE_DELAY_MS);
}

/**
 * Reads `message` out to screen reader users. Use plain, short text that
 * makes sense on its own; never message content (subjects, senders).
 */
export function announce(message: string, options: AnnounceOptions = {}): void {
  if (typeof document === 'undefined') return;
  const text = message.replace(/\s+/g, ' ').trim();
  if (!text) return;
  const politeness: Politeness = options.assertive ? 'assertive' : 'polite';
  const key = options.key ?? text;
  if (options.debounceMs && options.debounceMs > 0) {
    const timerKey = `${politeness}\u0000${key}`;
    const pending = debounced.get(timerKey);
    if (pending) clearTimeout(pending);
    debounced.set(timerKey, setTimeout(() => {
      debounced.delete(timerKey);
      say(text, politeness, key);
    }, options.debounceMs));
    return;
  }
  say(text, politeness, key);
}

/** Drops a debounced message that hasn't been read yet. */
export function cancelAnnouncement(key: string, assertive = false): void {
  const timerKey = `${assertive ? 'assertive' : 'polite'}\u0000${key}`;
  const pending = debounced.get(timerKey);
  if (pending) clearTimeout(pending);
  debounced.delete(timerKey);
}

/** Tests only: forget what was said and drop pending writes. */
export function resetAnnouncerForTests(): void {
  for (const state of Object.values(regions)) {
    if (state.writeTimer) clearTimeout(state.writeTimer);
    if (state.clearTimer) clearTimeout(state.clearTimer);
    state.queue = [];
    state.writeTimer = null;
    state.clearTimer = null;
  }
  for (const timer of debounced.values()) clearTimeout(timer);
  debounced.clear();
  lastSaid.clear();
  if (typeof document === 'undefined') return;
  for (const id of Object.values(LIVE_REGION_IDS)) {
    const el = document.getElementById(id);
    if (el) el.textContent = '';
  }
}
