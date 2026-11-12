'use client';

import { useTranslations } from 'next-intl';
import { Accessibility, BookOpen, Flag, Hand, HelpCircle } from '@/components/icons';
import { useConfig } from '@/hooks/use-config';
import { helpLinksFrom, type HelpLink, type HelpLinkId } from '@/lib/help-links';
import { cn } from '@/lib/utils';

const ICONS: Record<HelpLinkId, typeof Accessibility> = {
  statement: Accessibility,
  feedback: Flag,
  help: HelpCircle,
  easy_read: BookOpen,
  sign_language: Hand,
};

/** The configured accessibility and help links, in their fixed order. */
export function useHelpLinks(): HelpLink[] {
  const { accessibilityStatementUrl, accessibilityFeedbackUrl, helpUrl, easyReadUrl, signLanguageUrl } = useConfig();
  return helpLinksFrom({ accessibilityStatementUrl, accessibilityFeedbackUrl, helpUrl, easyReadUrl, signLanguageUrl });
}

function LinkText({ link }: { link: HelpLink }) {
  const t = useTranslations('help_links');
  return (
    <>
      {t(link.id)}
      {link.external && <span className="sr-only"> ({t('new_tab')})</span>}
    </>
  );
}

/**
 * The links as a small navigation list, for the login page footer and the
 * settings sidebar. Renders nothing when the operator set none.
 */
export function HelpLinks({ className, listClassName, linkClassName }: { className?: string; listClassName?: string; linkClassName?: string }) {
  const t = useTranslations('help_links');
  const links = useHelpLinks();
  if (links.length === 0) return null;
  return (
    <nav aria-label={t('label')} className={className} data-testid="help-links">
      <ul className={cn('flex flex-wrap items-center gap-x-3 gap-y-1', listClassName)}>
        {links.map((link) => (
          <li key={link.id}>
            <a
              href={link.href}
              target={link.external ? '_blank' : undefined}
              rel={link.external ? 'noopener noreferrer' : undefined}
              className={cn('text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline', linkClassName)}
            >
              <LinkText link={link} />
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/**
 * The links as menu items, for the account menu. `onSelect` closes the
 * menu. Renders nothing when the operator set none.
 */
export function HelpMenuItems({ onSelect, className, itemClassName, iconClassName = 'w-4 h-4 shrink-0' }: {
  onSelect?: () => void;
  className?: string;
  itemClassName?: string;
  iconClassName?: string;
}) {
  const t = useTranslations('help_links');
  const links = useHelpLinks();
  if (links.length === 0) return null;
  return (
    <div role="group" aria-label={t('label')} className={className} data-testid="help-menu-items">
      {links.map((link) => {
        const Icon = ICONS[link.id];
        return (
          <a
            key={link.id}
            role="menuitem"
            href={link.href}
            target={link.external ? '_blank' : undefined}
            rel={link.external ? 'noopener noreferrer' : undefined}
            onClick={() => onSelect?.()}
            className={itemClassName}
          >
            <Icon className={iconClassName} aria-hidden="true" />
            <span><LinkText link={link} /></span>
          </a>
        );
      })}
    </div>
  );
}
