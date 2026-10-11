"use client";

import { useId, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useHandleTypeahead } from "@/hooks/use-handle-typeahead";
import type { ActorSuggestion } from "@/lib/atproto/handle";

interface HandleComboboxProps {
  value: string;
  onChange: (value: string) => void;
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  id?: string;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  autoFocus?: boolean;
  debounceMs?: number;
  "aria-invalid"?: boolean;
  "aria-describedby"?: string;
}

function ActorAvatar({ actor }: { actor: ActorSuggestion }) {
  const [failedAvatar, setFailedAvatar] = useState<string | null>(null);
  const avatar = actor.avatar?.startsWith("https://") ? actor.avatar : null;

  return (
    <span
      aria-hidden="true"
      className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted text-xs text-muted-foreground"
    >
      {avatar && avatar !== failedAvatar ? (
        <img
          src={avatar}
          alt=""
          referrerPolicy="no-referrer"
          className="h-full w-full object-cover"
          onError={() => setFailedAvatar(avatar)}
        />
      ) : (
        actor.handle.slice(0, 1).toUpperCase()
      )}
    </span>
  );
}

/**
 * Accessible atproto handle combobox.
 *
 * Implements the WAI-ARIA combobox pattern (`role=combobox` +
 * `role=listbox`/`role=option`) over the debounced `useHandleTypeahead` hook,
 * with arrow-key/Enter/Escape navigation. The input value is fully controlled
 * by the parent so the typed handle can still be forwarded to the relay on
 * submit even when no suggestion is chosen.
 */
export function HandleCombobox({
  value,
  onChange,
  onKeyDown,
  id,
  placeholder,
  className,
  disabled,
  autoFocus,
  debounceMs,
  "aria-invalid": ariaInvalid,
  "aria-describedby": ariaDescribedBy,
}: HandleComboboxProps) {
  const reactId = useId();
  const inputId = id ?? `handle-combobox-${reactId}`;
  const listboxId = `${inputId}-listbox`;
  const optionId = (index: number) => `${inputId}-option-${index}`;
  const listboxRef = useRef<HTMLUListElement>(null);

  const select = (actor: ActorSuggestion) => onChange(actor.handle);

  const {
    suggestions,
    isOpen,
    activeIndex,
    onQueryChange,
    onKeyDown: typeaheadKeyDown,
    select: commitSelection,
    setActiveIndex,
    close,
  } = useHandleTypeahead({
    debounceMs,
    onSelect: select,
  });

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onChange(e.target.value);
    onQueryChange(e.target.value);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    typeaheadKeyDown(e);
    // Let the parent see keys the typeahead didn't consume (e.g. form submit).
    if (!e.defaultPrevented) onKeyDown?.(e);
  };

  return (
    <div className="relative">
      <Input
        id={inputId}
        type="text"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={isOpen}
        aria-controls={listboxId}
        aria-activedescendant={
          isOpen && activeIndex >= 0 ? optionId(activeIndex) : undefined
        }
        aria-invalid={ariaInvalid}
        aria-describedby={ariaDescribedBy}
        autoComplete="off"
        spellCheck={false}
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onBlur={() => {
          // Delay so a click on an option registers before the list closes.
          window.setTimeout(close, 120);
        }}
        placeholder={placeholder}
        className={className}
        disabled={disabled}
        autoFocus={autoFocus}
      />

      <ul
        ref={listboxRef}
        id={listboxId}
        role="listbox"
        aria-label="Handle suggestions"
        className={cn(
          "absolute top-full mt-1.5 w-full bg-background border border-border rounded-xl shadow-lg z-50 overflow-hidden",
          (!isOpen || suggestions.length === 0) && "hidden",
        )}
      >
        {suggestions.map((actor, index) => (
          <li
            key={actor.did}
            id={optionId(index)}
            role="option"
            aria-selected={index === activeIndex}
            className={cn(
              "px-3.5 py-2.5 flex items-center gap-2.5 cursor-pointer transition-colors hover:bg-muted",
              index === activeIndex && "bg-muted",
            )}
            onMouseEnter={() => setActiveIndex(index)}
            // preventDefault on mousedown keeps focus on the input so its
            // blur-driven close doesn't fire before the click selects.
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => commitSelection(actor)}
          >
            <ActorAvatar actor={actor} />
            <span className="flex min-w-0 flex-col">
              <span className="truncate text-sm text-foreground">{actor.handle}</span>
              {actor.displayName && (
                <span className="text-xs text-muted-foreground truncate">
                  {actor.displayName}
                </span>
              )}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
