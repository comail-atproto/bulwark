"use client";

import { useEffect } from "react";
import { focusTemporarily } from "@/lib/keyboard";

/**
 * Puts the focus somewhere sensible when the element that had it goes away:
 * the Delete button of a message that is gone, the Send button of a closed
 * composer, a rail link of the app just left, the Undo of a toast. Without
 * this the focus drops to <body> and a keyboard or screen reader user has to
 * start again from the top of the page (WCAG 2.4.3).
 *
 * Where it goes:
 * - out of a layer (the composer, a dialog or side panel, a toast): back to
 *   what was focused before it opened (the Compose or Reply button), found
 *   again by its name when the page has redrawn it;
 * - out of the page itself: the app's fallback (`data-focus-fallback`: Mail's
 *   message list, the calendar grid), else the pane, else the app's <main>.
 *
 * It never moves a focus the user put somewhere else: only when the focus is
 * on <body> and the element that had it is gone or hidden.
 */

const LAYER_SELECTOR = '[role="dialog"], [role="alertdialog"], [data-tour="composer"], [role="status"], [data-focus-layer]';

interface FocusRecord {
  el: HTMLElement;
  /** Tag and accessible label, to find the element again after a redraw. */
  tag: string;
  label: string;
  layer: Element | null;
  pane: HTMLElement | null;
  main: HTMLElement | null;
}

const HISTORY_SIZE = 8;
/** How long a lost focus waits for the page to draw something to land on. */
const PENDING_MS = 3000;

function labelOf(el: HTMLElement): string {
  return (el.getAttribute("aria-label") ?? el.textContent ?? "").trim();
}

function isShown(el: Element): boolean {
  if (!el.isConnected) return false;
  if (el.closest("[hidden], [inert], [aria-hidden='true']")) return false;
  const check = (el as HTMLElement & { checkVisibility?: () => boolean }).checkVisibility;
  return typeof check === "function" ? check.call(el) : true;
}

function mainOf(el: Element): HTMLElement | null {
  return el.closest<HTMLElement>('main, [data-pane="main"]');
}

export function recordFor(el: HTMLElement): FocusRecord {
  return {
    el,
    tag: el.tagName.toLowerCase(),
    label: labelOf(el),
    layer: el.closest(LAYER_SELECTOR),
    pane: el.closest<HTMLElement>("[data-pane]"),
    main: mainOf(el),
  };
}

/** The element itself, or one drawn in its place with the same tag and name. */
function resolve(record: FocusRecord): HTMLElement | null {
  if (isShown(record.el)) return record.el;
  if (!record.label) return null;
  const scope: ParentNode = record.main && record.main.isConnected ? record.main : document;
  for (const candidate of Array.from(scope.querySelectorAll<HTMLElement>(record.tag))) {
    if (labelOf(candidate) === record.label && isShown(candidate) && !candidate.closest(LAYER_SELECTOR)) return candidate;
  }
  return null;
}

/**
 * Where the focus should go after `lost` went away, given what was focused
 * before it (most recent last). Null when nothing fits yet.
 */
export function rescueTarget(lost: FocusRecord, history: FocusRecord[]): HTMLElement | null {
  if (lost.layer) {
    // Back to what opened the layer: the last focus outside it.
    for (let i = history.length - 1; i >= 0; i--) {
      const record = history[i];
      if (record.layer && (record.layer === lost.layer || lost.layer.contains(record.el))) continue;
      const found = resolve(record);
      if (found) return found;
      break;
    }
  }
  // Left the app (a rail link, the whole page redrawn): the new app's main.
  if (!lost.main || !lost.main.isConnected) {
    const main = document.querySelector<HTMLElement>("main");
    return main && isShown(main) ? main : null;
  }
  const fallback = lost.main.querySelector<HTMLElement>("[data-focus-fallback]");
  if (fallback && isShown(fallback)) return fallback;
  if (!lost.layer && lost.pane && isShown(lost.pane)) return lost.pane;
  return isShown(lost.main) ? lost.main : null;
}

function focusLost(): boolean {
  const active = document.activeElement;
  return !active || active === document.body || active === document.documentElement;
}

export function FocusRescueHost() {
  useEffect(() => {
    let history: FocusRecord[] = [];
    let pendingSince = 0;
    let frame = 0;

    const onFocusIn = (e: FocusEvent) => {
      const el = e.target;
      if (!(el instanceof HTMLElement) || el === document.body) return;
      pendingSince = 0;
      if (history[history.length - 1]?.el === el) return;
      history = [...history.slice(-(HISTORY_SIZE - 1)), recordFor(el)];
    };

    const check = () => {
      frame = 0;
      const lost = history[history.length - 1];
      if (!lost || !focusLost()) {
        pendingSince = 0;
        return;
      }
      // Still there: the user clicked somewhere that takes no focus.
      if (isShown(lost.el)) return;
      if (!pendingSince) pendingSince = Date.now();
      if (Date.now() - pendingSince > PENDING_MS) {
        history = [];
        pendingSince = 0;
        return;
      }
      const target = rescueTarget(lost, history.slice(0, -1));
      if (!target) return;
      pendingSince = 0;
      focusTemporarily(target, { preventScroll: true });
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(check);
    };

    const observer = new MutationObserver(schedule);
    // Removed nodes; a focused element hidden by CSS loses the focus with a
    // focusout, which is listened to as well.
    observer.observe(document.body, { childList: true, subtree: true });
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", schedule);
    return () => {
      observer.disconnect();
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", schedule);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);
  return null;
}
