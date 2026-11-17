import type { Email } from '@/lib/jmap/types';

/** A BCP 47 tag as mail carries it: "fr", "de-CH", "zh-Hant-TW". */
const LANGUAGE_TAG = /^[a-z]{2,3}(?:-[a-z0-9]{1,8})*$/i;

function cleanTag(value: string | null | undefined): string | null {
  if (!value) return null;
  // Content-Language may list several ("de, en"); the first one is the body's.
  const first = value.split(',')[0].trim();
  return LANGUAGE_TAG.test(first) ? first : null;
}

function headerValue(headers: Email['headers'], name: string): string | null {
  if (!headers || Array.isArray(headers)) return null;
  const key = Object.keys(headers).find((k) => k.toLowerCase() === name);
  if (!key) return null;
  const value = headers[key];
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

/** The `lang` an HTML body declares on its <html> or <body> element. */
export function htmlDeclaredLanguage(html: string | null | undefined): string | null {
  if (!html) return null;
  const head = html.slice(0, 20000);
  for (const tag of ['html', 'body']) {
    const match = new RegExp(`<${tag}\\b[^>]*?\\s(?:xml:)?lang\\s*=\\s*["']?([^"'\\s>]+)`, 'i').exec(head);
    const lang = cleanTag(match?.[1]);
    if (lang) return lang;
  }
  return null;
}

/**
 * The language a message body is written in, for `lang` on the frame it
 * renders in, so a screen reader reads a French mail with a French voice.
 * Taken from the body part's Content-Language, the message header, or the
 * HTML's own `lang`, in that order; null when the mail doesn't say.
 */
export function mailLanguage(
  email: Pick<Email, 'htmlBody' | 'textBody' | 'headers'> | null | undefined,
  html?: string | null,
): string | null {
  if (!email) return htmlDeclaredLanguage(html);
  const part = email.htmlBody?.[0] ?? email.textBody?.[0];
  return cleanTag(part?.language?.[0])
    ?? cleanTag(headerValue(email.headers, 'content-language'))
    ?? htmlDeclaredLanguage(html);
}
