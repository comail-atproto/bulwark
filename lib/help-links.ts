import type { ConfigData } from '@/hooks/use-config';

/**
 * The accessibility and help links an operator configures (OP-01): the
 * accessibility statement, where to report a barrier, help, Easy Read
 * (Leichte Sprache) and sign language pages. They show in the same order
 * in every place that lists them (WCAG 3.2.6): the login page footer, the
 * settings sidebar and the account menu. Links that aren't set are left out.
 */
export type HelpLinkId = 'statement' | 'feedback' | 'help' | 'easy_read' | 'sign_language';

export interface HelpLink {
  id: HelpLinkId;
  href: string;
  /** mailto: links open the mail app, not a new tab. */
  external: boolean;
}

export type HelpLinkConfig = Pick<
  ConfigData,
  'accessibilityStatementUrl' | 'accessibilityFeedbackUrl' | 'helpUrl' | 'easyReadUrl' | 'signLanguageUrl'
>;

const ORDER: ReadonlyArray<[HelpLinkId, keyof HelpLinkConfig]> = [
  ['statement', 'accessibilityStatementUrl'],
  ['feedback', 'accessibilityFeedbackUrl'],
  ['help', 'helpUrl'],
  ['easy_read', 'easyReadUrl'],
  ['sign_language', 'signLanguageUrl'],
];

/**
 * The configured links, in their fixed order. The values were checked when
 * the config was served (http(s) or mailto: only); this checks again so a
 * config from elsewhere can't put a script URL in a link.
 */
export function helpLinksFrom(config: Partial<HelpLinkConfig>): HelpLink[] {
  const out: HelpLink[] = [];
  for (const [id, key] of ORDER) {
    const href = typeof config[key] === 'string' ? config[key]!.trim() : '';
    if (!/^(https?:\/\/|mailto:)/i.test(href)) continue;
    out.push({ id, href, external: !/^mailto:/i.test(href) });
  }
  return out;
}
