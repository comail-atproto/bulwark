import { afterEach, describe, expect, it, vi } from 'vitest';
import { JMAPClient } from '../jmap/client';

afterEach(() => { vi.restoreAllMocks(); });

describe('JMAP MFA challenge compatibility', () => {
  it.each([
    ['TOTP code required', 'TOTP_REQUIRED'],
    ['MFA code required', 'TOTP_REQUIRED'],
    ['Payment required', 'Failed to get session: 402'],
  ])('recognizes %s', async (title, error) => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ title }, { status: 402 }));
    const client = new JMAPClient('https://mail.example.test', 'user@example.test', 'synthetic-password');
    try {
      await expect(client.connect()).rejects.toThrow(error);
    } finally {
      client.disconnect();
    }
  });
});
