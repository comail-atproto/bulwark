import { mergeMessages } from './merge-messages';

type Messages = Record<string, unknown>;

/**
 * Plain-language mode (CO-14): simpler wording for settings and error
 * messages. English, German and Vietnamese have plain versions; every
 * other locale keeps its normal strings when the setting is on.
 *
 * The plain strings live in `locales/<code>/plain.json`, outside common.json,
 * so the translation parity test doesn't ask every locale for them. Each file
 * holds only the keys that get a simpler version, under the same key paths as
 * common.json; anything it leaves out falls back to the normal string.
 */
export const PLAIN_LANGUAGE_LOADERS: Record<string, () => Promise<Messages>> = {
  en: () => import('@/locales/en/plain.json').then((m) => m.default as Messages),
  de: () => import('@/locales/de/plain.json').then((m) => m.default as Messages),
  vi: () => import('@/locales/vi/plain.json').then((m) => m.default as Messages),
};

export function hasPlainLanguage(locale: string): boolean {
  return Object.prototype.hasOwnProperty.call(PLAIN_LANGUAGE_LOADERS, locale);
}

/** The catalog with the plain strings laid over it, or the catalog unchanged. */
export function withPlainLanguage(messages: Messages, plain: Messages | undefined): Messages {
  return plain ? mergeMessages(messages, plain) : messages;
}
