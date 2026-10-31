'use client';

import { useCallback, useEffect, useRef, type KeyboardEvent, type RefObject } from 'react';

/**
 * Explicit menu roles win over "any focusable child" so a menu that also holds
 * secondary controls (e.g. the per-row remove button in the account switcher)
 * keeps a predictable arrow order.
 */
const MENU_ITEM_SELECTOR =
  '[role="menuitem"],[role="menuitemradio"],[role="menuitemcheckbox"],[role="option"]';

const FOCUSABLE_SELECTOR =
  'button:not(:disabled),[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex]:not([tabindex="-1"])';

function isUsable(root: HTMLElement, el: HTMLElement): boolean {
  if (el.hasAttribute('disabled') || el.getAttribute('aria-disabled') === 'true') return false;
  if (typeof window === 'undefined' || typeof window.getComputedStyle !== 'function') return true;
  // Toolbar overflow and responsive variants hide items with `display: none`
  // on an ancestor; those must not become arrow-key targets.
  for (let node: HTMLElement | null = el; node && node !== root.parentElement; node = node.parentElement) {
    const style = window.getComputedStyle(node);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
  }
  return true;
}

interface UseMenuNavigationOptions {
  open: boolean;
  onClose: () => void;
  /** The button that opens the menu. Focus returns here when the menu closes. */
  triggerRef?: RefObject<HTMLElement | null>;
  /** Move focus to the first item on open. Default true. */
  autoFocus?: boolean;
}

/**
 * Keyboard and focus behaviour for popup menus.
 *
 * Menus here are either portalled to `<body>` or absolutely positioned, so
 * merely rendering them leaves screen reader and keyboard users stranded: the
 * items end up far from the trigger in the reading order, which reads as
 * "nothing happened". This moves focus into the menu on open, wires
 * arrow/Home/End/Escape/Tab, and hands focus back to the trigger on close.
 */
export function useMenuNavigation<T extends HTMLElement = HTMLDivElement>({
  open,
  onClose,
  triggerRef,
  autoFocus = true,
}: UseMenuNavigationOptions) {
  const menuRef = useRef<T>(null);
  // Only pull focus back to the trigger if we were the ones who moved it away.
  const focusMoved = useRef(false);

  const getItems = useCallback((): HTMLElement[] => {
    const menu = menuRef.current;
    if (!menu) return [];
    const explicit = Array.from(menu.querySelectorAll<HTMLElement>(MENU_ITEM_SELECTOR));
    const candidates = explicit.length > 0
      ? explicit
      : Array.from(menu.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
    return candidates.filter((el) => isUsable(menu, el));
  }, []);

  useEffect(() => {
    if (!open || !autoFocus) return;
    // A frame of slack lets portals mount and positioning settle first.
    const frame = requestAnimationFrame(() => {
      const first = getItems()[0];
      if (!first) return;
      first.focus();
      focusMoved.current = true;
    });
    return () => cancelAnimationFrame(frame);
  }, [open, autoFocus, getItems]);

  useEffect(() => {
    if (open || !focusMoved.current) return;
    focusMoved.current = false;
    const trigger = triggerRef?.current;
    if (!trigger || !document.contains(trigger)) return;
    // Closing usually drops focus onto <body>; if something else has already
    // claimed it (a dialog, a navigation) leave it alone.
    const active = document.activeElement;
    if (!active || active === document.body) trigger.focus();
  }, [open, triggerRef]);

  const onKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
      return;
    }
    if (e.key === 'Tab') {
      // Tabbing out of a popup menu dismisses it, mirroring a click away.
      onClose();
      return;
    }

    const items = getItems();
    if (items.length === 0) return;
    const current = items.indexOf(document.activeElement as HTMLElement);

    switch (e.key) {
      case 'ArrowDown':
      case 'ArrowUp': {
        e.preventDefault();
        const delta = e.key === 'ArrowDown' ? 1 : -1;
        const next = current === -1
          ? (delta === 1 ? 0 : items.length - 1)
          : (current + delta + items.length) % items.length;
        items[next]?.focus();
        break;
      }
      case 'Home':
        e.preventDefault();
        items[0]?.focus();
        break;
      case 'End':
        e.preventDefault();
        items[items.length - 1]?.focus();
        break;
    }
  }, [getItems, onClose]);

  return { menuRef, onKeyDown };
}
