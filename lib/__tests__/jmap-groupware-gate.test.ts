import { afterEach, describe, expect, it, vi } from 'vitest';
import { JMAPClient } from '@/lib/jmap/client';
import { useAccountStore } from '@/stores/account-store';

afterEach(() => { vi.unstubAllGlobals(); useAccountStore.setState({ accounts: [], activeAccountId: null }); });

describe('JMAP groupware transport', () => {
  it('uses the selected account server gate and cannot fall back after denial', async () => {
    const id = useAccountStore.getState().addAccount({ label: 'Owner', authMode: 'basic', rememberMe: true, username: 'owner@example.test', serverUrl: 'https://mail.example.test', displayName: 'Owner', email: 'owner@example.test', lastLoginAt: 0, isConnected: true, hasError: false, isDefault: true });
    useAccountStore.getState().updateAccount(id, { cookieSlot: 2 });
    const client = new JMAPClient('https://mail.example.test', 'owner@example.test', 'synthetic');
    const session = { apiUrl: 'https://mail.example.test/jmap', accounts: { a: { name: 'Owner', isPersonal: true, accountCapabilities: {} } }, primaryAccounts: { 'urn:ietf:params:jmap:mail': 'a', 'urn:ietf:params:jmap:contacts': 'a' }, capabilities: {}, downloadUrl: '', uploadUrl: '', eventSourceUrl: '' };
    const fetchMock = vi.fn().mockResolvedValueOnce(Response.json(session));
    vi.stubGlobal('fetch', fetchMock);
    await client.connect();
    fetchMock.mockReset().mockResolvedValue(new Response('{"error":"Not found"}', { status: 404 }));
    try {
      await expect(client.getAddressBooks({ throwOnError: true })).rejects.toThrow();
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock.mock.calls[0][0]).toBe('/api/account/stalwart/jmap');
      expect(fetchMock.mock.calls[0][1].headers).toMatchObject({ 'X-JMAP-Cookie-Slot': '2' });
      expect(fetchMock.mock.calls[0][1].headers.Authorization).toBeUndefined();
    } finally { client.disconnect(); }
  });
});
