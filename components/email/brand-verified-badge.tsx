'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { BadgeCheck } from '@/components/icons';
import { cn } from '@/lib/utils';
import { IS_LITE } from '@/lib/lite';
import { withBasePath } from '@/lib/browser-navigation';
import { senderFaviconsAllowed } from '@/lib/outgoing-hosts';
import { useNoThirdPartyTraffic } from '@/hooks/use-third-party-mode';
import { useSettingsStore } from '@/stores/settings-store';
import type { BimiInfo } from '@/lib/bimi/types';

// One request per domain and tab; the answer is the same for every message.
const infoByDomain = new Map<string, Promise<BimiInfo>>();

function fetchInfo(domain: string): Promise<BimiInfo> {
  let pending = infoByDomain.get(domain);
  if (!pending) {
    pending = fetch(withBasePath(`/api/bimi?domain=${encodeURIComponent(domain)}&format=json`))
      .then((response) => (response.ok ? (response.json() as Promise<BimiInfo>) : { status: 'none' as const }))
      .catch(() => {
        infoByDomain.delete(domain);
        return { status: 'none' as const };
      });
    infoByDomain.set(domain, pending);
  }
  return pending;
}

/**
 * A check mark beside the sender's name when a Verified Mark or Common Mark
 * Certificate backs the domain's BIMI logo. A logo the sender only published
 * in DNS gets none: anyone can do that for a lookalike domain.
 *
 * `domain` comes from brandIndicatorDomain (the message passed DMARC for it).
 * A tap opens a line naming who the logo is verified for and by whom.
 */
export function BrandVerifiedBadge({ domain, className }: { domain?: string; className?: string }) {
  const t = useTranslations('email_viewer.brand_logo');
  const senderFavicons = useSettingsStore((s) => s.senderFavicons);
  useNoThirdPartyTraffic();
  const enabled = !!domain && !IS_LITE && senderFavicons && senderFaviconsAllowed();
  const [info, setInfo] = useState<{ domain: string; info: BimiInfo } | null>(null);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLSpanElement>(null);
  const popoverId = useId();

  useEffect(() => {
    if (!enabled || !domain) return;
    let cancelled = false;
    void fetchInfo(domain).then((result) => {
      if (!cancelled) setInfo({ domain, info: result });
    });
    return () => { cancelled = true; };
  }, [enabled, domain]);

  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', close);
    document.addEventListener('focusin', close);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('focusin', close);
    };
  }, [open]);

  const current = enabled && info?.domain === domain ? info.info : null;
  if (!current || current.status !== 'verified') return null;

  const organization = current.organization || domain!;
  const description = current.issuer
    ? t('verified_by', { organization, issuer: current.issuer })
    : t('verified', { organization });

  return (
    <span ref={wrapRef} className={cn('relative inline-flex flex-shrink-0', className)}>
      <button
        type="button"
        data-brand-verified=""
        title={description}
        aria-label={`${t('verified_label')}: ${description}`}
        aria-expanded={open}
        aria-controls={open ? popoverId : undefined}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && open) {
            e.stopPropagation();
            setOpen(false);
          }
        }}
        className="inline-flex items-center rounded-full text-primary hover:opacity-80 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary/40"
      >
        <BadgeCheck className="h-4 w-4" aria-hidden="true" />
      </button>
      {open && (
        <span
          id={popoverId}
          role="status"
          className="absolute start-0 top-full z-30 mt-1 w-max max-w-[16rem] whitespace-normal rounded-md border border-border bg-popover px-2.5 py-1.5 text-xs text-popover-foreground shadow-md"
        >
          {description}
        </span>
      )}
    </span>
  );
}
