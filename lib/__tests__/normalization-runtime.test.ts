// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { normalizeRelayUrl } from '@/lib/push-relays';
import { parseDomainBranding } from '@/lib/admin/domain-branding';
import { parseDomainList } from '@/lib/admin/organisation-policy';
import { sanitizeScopes } from '@/lib/admin/policy-scopes';
import { normalizeJmapServerUrl } from '@/lib/auth/verify-jmap-auth';

describe('normalization of long untrusted inputs', () => {
  const domain = `example.test${'.'.repeat(10_000)}x`;

  it.each([
    ['absolute login URL', () => {
      const url = `https://example.test/${'/'.repeat(10_000)}x`;
      expect(normalizeJmapServerUrl(url)).toBe(url);
    }],
    ['relative login URL', () => {
      const url = `/api/${'/'.repeat(10_000)}x`;
      expect(normalizeJmapServerUrl(url)).toBe(url);
    }],
    ['relay URL', () => {
      const url = `https://example.test/${'/'.repeat(10_000)}x`;
      expect(normalizeRelayUrl(url)).toBe(url);
    }],
    ['branding domain', () => {
      expect(parseDomainBranding([{ host: domain }])).toEqual([]);
    }],
    ['organisation domain', () => {
      expect(parseDomainList([domain])).toEqual({ domains: [], rejected: [domain] });
    }],
    ['scope domain', () => {
      expect(sanitizeScopes([{ id: 'test', match: { domains: [domain] } }])[0].match).toEqual({});
    }],
  ] as const)('processes a long %s without repeated suffix scans', (_name, normalize) => {
    const start = performance.now();
    normalize();
    // A linear scan needs only milliseconds; the repeated-suffix regression takes seconds.
    expect(performance.now() - start).toBeLessThan(500);
  });
});
