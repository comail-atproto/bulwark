import { afterEach, expect, it, vi } from 'vitest';

afterEach(() => { vi.restoreAllMocks(); sessionStorage.clear(); localStorage.clear(); });

it('removes legacy plaintext unlocks at boot while preserving wrapped-key preferences', async () => {
  vi.resetModules();
  sessionStorage.setItem('smime-unlocked-session', '{"passphrase":"old secret"}');
  sessionStorage.setItem('unrelated', 'preserve');
  const preferences = JSON.stringify({ state: { accountPreferences: { alice: { defaultEncrypt: true } } }, version: 0 });
  localStorage.setItem('smime-store', preferences);
  await import('@/instrumentation-client');
  expect(sessionStorage.getItem('smime-unlocked-session')).toBeNull();
  expect(sessionStorage.getItem('unrelated')).toBe('preserve');
  expect(localStorage.getItem('smime-store')).toBe(preferences);
});

it('can boot when session storage is unavailable', async () => {
  vi.resetModules();
  vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new DOMException('Blocked'); });
  await expect(import('@/instrumentation-client')).resolves.toBeDefined();
});
