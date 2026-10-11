type SupportedLocales = readonly string[];

const TRADITIONAL_CHINESE_REGIONS = new Set(['tw', 'hk', 'mo']);

/**
 * Match a BCP-47 language tag to one of the locales shipped by Bulwark.
 * Chinese needs script/region-aware matching so Traditional Chinese does not
 * silently fall back to the Simplified Chinese catalog.
 */
export function matchSupportedLocale(tag: string, supportedLocales: SupportedLocales): string | null {
  const normalized = tag.trim().replace(/_/g, '-').toLowerCase();
  if (!normalized || normalized === '*') return null;

  const supported = new Map(supportedLocales.map((locale) => [locale.toLowerCase(), locale]));
  const exact = supported.get(normalized);
  if (exact) return exact;

  const parts = normalized.split('-');
  const base = parts[0];
  if (base !== 'zh') return supported.get(base) ?? null;

  const script = parts.find((part) => part === 'hans' || part === 'hant');
  const region = parts.find((part) => TRADITIONAL_CHINESE_REGIONS.has(part));
  const traditional = script === 'hant' || (!script && Boolean(region));

  if (traditional) return supported.get('zh-tw') ?? supported.get('zh') ?? null;
  return supported.get('zh') ?? supported.get('zh-tw') ?? null;
}

/** Resolve an Accept-Language header by q-value against shipped locales. */
export function localeFromAcceptLanguage(
  header: string | null,
  supportedLocales: SupportedLocales
): string | null {
  if (!header) return null;

  const ranked = header
    .split(',')
    .map((part, index) => {
      const [rawTag, ...parameters] = part.trim().split(';');
      const qParameter = parameters.find((parameter) => parameter.trim().toLowerCase().startsWith('q='));
      const parsedQ = qParameter ? Number.parseFloat(qParameter.split('=')[1]) : 1;
      const q = Number.isFinite(parsedQ) && parsedQ >= 0 && parsedQ <= 1 ? parsedQ : 0;
      return { tag: rawTag, q, index };
    })
    .filter(({ tag, q }) => Boolean(tag) && q > 0)
    .sort((a, b) => b.q - a.q || a.index - b.index);

  for (const { tag } of ranked) {
    const locale = matchSupportedLocale(tag, supportedLocales);
    if (locale) return locale;
  }
  return null;
}
