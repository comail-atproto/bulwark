import { describe, expect, it } from 'vitest';
import { trimTrailingSlashes } from '@/lib/url-normalization';

describe('trailing slash normalization', () => {
  it.each(['', '/', '///', 'https://example.test/path', 'https://example.test/path/', 'https://example.test/path///', '///x', ' / '])(
    'preserves the existing suffix rules for %j', (value) => {
      expect(trimTrailingSlashes(value)).toBe(value.replace(/\/+$/, ''));
      expect(trimTrailingSlashes(value, true)).toBe(value.replace(/\/{2,}$/, '/'));
    },
  );
});
