import { describe, expect, it } from 'vitest';
import { localeFromAcceptLanguage, matchSupportedLocale } from '../locale-matcher';

const supported = ['en', 'fr', 'zh', 'zh-TW'] as const;

describe('matchSupportedLocale', () => {
  it.each([
    ['zh-TW', 'zh-TW'],
    ['zh_Hant', 'zh-TW'],
    ['zh-Hant-HK', 'zh-TW'],
    ['zh-HK', 'zh-TW'],
    ['zh-MO', 'zh-TW'],
    ['zh-Hans-TW', 'zh'],
    ['zh-Hans', 'zh'],
    ['zh-CN', 'zh'],
    ['zh-SG', 'zh'],
    ['zh', 'zh'],
    ['fr-CA', 'fr'],
  ])('maps %s to %s', (tag, expected) => {
    expect(matchSupportedLocale(tag, supported)).toBe(expected);
  });

  it('returns null for unsupported and wildcard tags', () => {
    expect(matchSupportedLocale('eo', supported)).toBeNull();
    expect(matchSupportedLocale('*', supported)).toBeNull();
  });
});

describe('localeFromAcceptLanguage', () => {
  it('prefers the highest-quality supported locale', () => {
    expect(localeFromAcceptLanguage('zh-CN;q=0.7, zh-TW;q=0.9, fr;q=0.8', supported)).toBe('zh-TW');
  });

  it('uses original order to break equal q-values', () => {
    expect(localeFromAcceptLanguage('fr-CA, zh-Hant', supported)).toBe('fr');
  });

  it('skips disabled, malformed, wildcard, and unsupported entries', () => {
    expect(localeFromAcceptLanguage('zh-TW;q=0, *;q=1, eo;q=0.9, zh-CN;q=oops, en;q=0.5', supported)).toBe('en');
  });

  it('returns null when no supported preference remains', () => {
    expect(localeFromAcceptLanguage('eo, *;q=0', supported)).toBeNull();
    expect(localeFromAcceptLanguage(null, supported)).toBeNull();
  });
});
