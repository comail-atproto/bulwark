import { describe, expect, it } from 'vitest';
import { htmlDeclaredLanguage, mailLanguage } from '@/lib/mail-language';

describe('mailLanguage', () => {
  it('prefers the body part Content-Language', () => {
    expect(mailLanguage({ htmlBody: [{ language: ['fr-CA'] } as never], textBody: [], headers: { 'Content-Language': 'de' } }, '<html lang="en">')).toBe('fr-CA');
  });

  it('falls back to the message header, first tag of a list', () => {
    expect(mailLanguage({ htmlBody: [], textBody: [], headers: { 'content-language': 'nl, en' } }, null)).toBe('nl');
  });

  it('falls back to the lang the HTML declares', () => {
    expect(mailLanguage({ htmlBody: [], textBody: [] }, '<html xmlns="x" lang="es"><body>hola')).toBe('es');
    // Word sets it on <body>.
    expect(htmlDeclaredLanguage('<html><body lang=DE link=blue>')).toBe('DE');
  });

  it('is null when the mail says nothing or something that is not a tag', () => {
    expect(mailLanguage({ htmlBody: [], textBody: [] }, '<p>hi</p>')).toBeNull();
    expect(mailLanguage({ htmlBody: [], textBody: [], headers: { 'Content-Language': '"><script>' } }, null)).toBeNull();
  });
});
