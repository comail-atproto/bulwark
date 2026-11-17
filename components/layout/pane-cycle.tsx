"use client";

import { useEffect } from "react";
import { focusTemporarily, isKeyboardLayerOpen } from "@/lib/keyboard";

/**
 * F6 and Shift+F6 move the focus between an app's main panes, as in desktop
 * mail clients: Mail's folders, message list and reading pane; the sidebar
 * and the content elsewhere. A pane is any visible element marked
 * `data-pane`, in page order.
 */

function isShown(el: HTMLElement): boolean {
  if (el.closest("[hidden], [inert], [aria-hidden='true']")) return false;
  // checkVisibility() sees display:none and closed drawers; older engines
  // (and jsdom) don't have it and count every pane.
  const check = (el as HTMLElement & { checkVisibility?: () => boolean }).checkVisibility;
  return typeof check === "function" ? check.call(el) : true;
}

/** Focuses a pane's selected item (the open folder), else the pane itself. */
function focusPane(pane: HTMLElement): void {
  const preferred = pane.querySelector<HTMLElement>(
    "[data-pane-focus], [aria-current='page'], [aria-current='true'], [aria-selected='true']",
  );
  if (preferred && isShown(preferred) && preferred.matches("a[href], button, input, select, textarea, [tabindex]")) {
    preferred.focus();
    return;
  }
  focusTemporarily(pane);
}

export function panesInOrder(root: ParentNode = document): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>("[data-pane]")).filter(isShown);
}

/** Moves the focus to the next pane (or the previous one with `back`). */
export function cyclePane(back: boolean, root: ParentNode = document): boolean {
  const panes = panesInOrder(root);
  if (panes.length === 0) return false;
  const active = document.activeElement;
  // The innermost pane holding the focus, so a pane inside another counts.
  let current = -1;
  panes.forEach((pane, i) => {
    if (active && pane.contains(active)) current = i;
  });
  const next = current === -1
    ? (back ? panes.length - 1 : 0)
    : (current + (back ? -1 : 1) + panes.length) % panes.length;
  focusPane(panes[next]);
  return true;
}

export function PaneCycleHost() {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "F6" || event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.defaultPrevented) return;
      // A dialog keeps the focus inside it.
      if (isKeyboardLayerOpen()) return;
      if (cyclePane(event.shiftKey)) event.preventDefault();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
  return null;
}
