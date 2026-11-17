"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { Info } from '@/components/icons';
import { TOUCH_HIT_AREA } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * Technical terms with a short explanation in `glossary.terms.<id>` (CO-14).
 * Keep this list in step with the glossary in locales/en/common.json; a test
 * checks both directions.
 */
export const GLOSSARY_IDS = [
  'jmap', 'imap', 'smtp', 'caldav', 'carddav', 'webdav', 'sieve', 'smime', 'pgp',
  'public_key', 'two_factor', 'totp', 'app_password', 'access_token', 'oauth',
  'identity', 'delegation', 'push', 'sync', 'cache', 'sub_addressing',
  'encryption_at_rest', 'vcard', 'icalendar', 'cors',
] as const;

export type GlossaryId = (typeof GLOSSARY_IDS)[number];

// Space kept between the explanation and the window edge.
const EDGE = 8;

interface TermInfoProps {
  id: GlossaryId;
  className?: string;
}

/**
 * A small info button that shows what a term means. It works without a
 * pointer: the button is in the tab order, toggles with Enter or Space, and
 * Escape closes it again. Screen readers get the explanation as the button's
 * description even while it is closed, so they never have to open it.
 *
 * Put it next to a label rather than inside one: a control named by that
 * label would otherwise read the button's name as part of its own.
 */
export function TermInfo({ id, className }: TermInfoProps) {
  const t = useTranslations('glossary');
  const [open, setOpen] = useState(false);
  const [shift, setShift] = useState(0);
  const panelId = useId();
  const explanationId = useId();
  const wrapperRef = useRef<HTMLSpanElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLSpanElement>(null);
  const term = t(`terms.${id}.term`);

  const close = useCallback((refocus: boolean) => {
    setOpen(false);
    if (refocus) buttonRef.current?.focus();
  }, []);

  // Keep the explanation inside the window on narrow screens.
  useLayoutEffect(() => {
    if (!open) {
      setShift(0);
      return;
    }
    const panel = panelRef.current;
    if (!panel) return;
    const rect = panel.getBoundingClientRect();
    const width = document.documentElement.clientWidth || window.innerWidth;
    if (rect.right > width - EDGE) setShift(width - EDGE - rect.right);
    else if (rect.left < EDGE) setShift(EDGE - rect.left);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!wrapperRef.current?.contains(event.target as Node)) close(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open, close]);

  return (
    <span
      ref={wrapperRef}
      className={cn('relative inline-flex align-middle', className)}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && open) {
          event.stopPropagation();
          close(true);
        }
      }}
    >
      <button
        ref={buttonRef}
        type="button"
        aria-label={t('what_is', { term })}
        aria-expanded={open}
        aria-controls={panelId}
        aria-describedby={explanationId}
        data-glossary-term={id}
        onClick={(event) => {
          // Rows and labels around the term must not react to it.
          event.preventDefault();
          event.stopPropagation();
          setOpen((value) => !value);
        }}
        className={cn(
          'inline-flex items-center justify-center rounded-full text-muted-foreground hover:text-foreground',
          TOUCH_HIT_AREA,
        )}
      >
        <Info size={14} aria-hidden="true" />
      </button>
      <span
        ref={panelRef}
        id={panelId}
        hidden={!open}
        style={shift ? { transform: `translateX(${shift}px)` } : undefined}
        className={cn(
          'absolute start-0 top-full z-50 mt-1 block w-72 max-w-[calc(100vw-1rem)]',
          'rounded-md border border-border bg-popover p-3 text-start text-xs font-normal normal-case leading-relaxed tracking-normal text-popover-foreground shadow-md whitespace-normal',
        )}
      >
        <span className="block font-medium text-foreground">{term}</span>
        <span id={explanationId} className="mt-1 block">{t(`terms.${id}.text`)}</span>
      </span>
    </span>
  );
}

interface TermProps {
  id: GlossaryId;
  /** The term as it appears in the sentence. */
  children: ReactNode;
}

/** A technical term in running text, followed by its info button. */
export function Term({ id, children }: TermProps) {
  return (
    <span className="whitespace-nowrap">
      {children}
      <TermInfo id={id} className="ms-0.5" />
    </span>
  );
}
