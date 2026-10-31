"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { searchActorsTypeahead, type ActorSuggestion } from "@/lib/atproto/handle";

interface UseHandleTypeaheadOptions {
  /** Debounce window before firing a typeahead request. Defaults to 300ms. */
  debounceMs?: number;
  /** Minimum query length before querying actor search. Defaults to 2. */
  minChars?: number;
  /** Called when the user commits a suggestion (Enter or click). */
  onSelect?: (actor: ActorSuggestion) => void;
}

interface UseHandleTypeaheadResult {
  suggestions: ActorSuggestion[];
  isOpen: boolean;
  activeIndex: number;
  /** Feed the current input value; schedules a debounced lookup. */
  onQueryChange: (value: string) => void;
  /** Keyboard handler for the combobox input (arrows / Enter / Escape). */
  onKeyDown: (e: React.KeyboardEvent) => void;
  /** Programmatically pick a suggestion (e.g. on mouse click). */
  select: (actor: ActorSuggestion) => void;
  /** Close the listbox without selecting (e.g. blur / outside click). */
  close: () => void;
  /** Move the active highlight (used by hover). */
  setActiveIndex: (index: number) => void;
}

/**
 * Debounced atproto handle typeahead with accessible keyboard navigation.
 *
 * The hook owns:
 * - debouncing keystrokes (≤ `debounceMs`) before hitting public actor search,
 * - aborting any in-flight request when a new keystroke supersedes it or the
 *   component unmounts,
 * - fail-open behaviour (a failed lookup simply yields no suggestions),
 * - arrow-key / Enter / Escape navigation over the suggestion list.
 *
 * It deliberately does NOT own the input value - the parent stays the source of
 * truth so the same string can be forwarded to the relay on submit.
 */
export function useHandleTypeahead(
  options: UseHandleTypeaheadOptions = {},
): UseHandleTypeaheadResult {
  const { debounceMs = 300, minChars = 2, onSelect } = options;

  const [suggestions, setSuggestions] = useState<ActorSuggestion[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  // Keep the latest onSelect without making the keydown handler identity churn.
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  const cancelInFlight = useCallback(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
  }, []);

  const close = useCallback(() => {
    cancelInFlight();
    setSuggestions([]);
    setIsOpen(false);
    setActiveIndex(-1);
  }, [cancelInFlight]);

  const select = useCallback(
    (actor: ActorSuggestion) => {
      cancelInFlight();
      setSuggestions([]);
      setIsOpen(false);
      setActiveIndex(-1);
      onSelectRef.current?.(actor);
    },
    [cancelInFlight],
  );

  const onQueryChange = useCallback(
    (value: string) => {
      // Any keystroke invalidates a pending debounce and an in-flight request.
      cancelInFlight();
      setActiveIndex(-1);

      const trimmed = value.trim().replace(/^@/, "");
      // Typeahead searches on prefixes, so we only gate on a minimum length -
      // not on `looksLikeHandle`, which requires a dot and would suppress
      // suggestions for a partial handle like "ali".
      if (trimmed.length < minChars) {
        setSuggestions([]);
        setIsOpen(false);
        return;
      }

      debounceRef.current = setTimeout(() => {
        debounceRef.current = null;
        const controller = new AbortController();
        abortRef.current = controller;
        searchActorsTypeahead(trimmed, controller.signal)
          .then((actors) => {
            if (controller.signal.aborted) return;
            setSuggestions(actors);
            setIsOpen(actors.length > 0);
            setActiveIndex(-1);
          })
          .catch(() => {
            /* AbortError or fail-open: leave state untouched. */
          })
          .finally(() => {
            if (abortRef.current === controller) abortRef.current = null;
          });
      }, debounceMs);
    },
    [cancelInFlight, debounceMs, minChars],
  );

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        if (isOpen || debounceRef.current || abortRef.current) {
          e.preventDefault();
          close();
        }
        return;
      }
      if (!isOpen || suggestions.length === 0) return;

      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIndex((prev) => (prev < suggestions.length - 1 ? prev + 1 : prev));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIndex((prev) => (prev > 0 ? prev - 1 : -1));
      } else if (e.key === "Enter") {
        if (activeIndex >= 0 && activeIndex < suggestions.length) {
          e.preventDefault();
          select(suggestions[activeIndex]);
        }
      }
    },
    [isOpen, suggestions, activeIndex, select, close],
  );

  // Abort any pending timer / request when the component unmounts.
  useEffect(() => cancelInFlight, [cancelInFlight]);

  return {
    suggestions,
    isOpen,
    activeIndex,
    onQueryChange,
    onKeyDown,
    select,
    close,
    setActiveIndex,
  };
}
