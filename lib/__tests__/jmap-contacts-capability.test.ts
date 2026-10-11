import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { JMAPClient } from '../jmap/client';
import { jmapSession } from './fixtures/jmap-session';

// The server advertises Contacts globally while the per-account
// accountCapabilities independently includes or omits it.
async function connect(accountCapabilities: Record<string, unknown>, isPersonal = true, serverAdvertises = true, sessionCapabilities: Record<string, unknown> = {}): Promise<JMAPClient> {
  const fetchSpy = vi.spyOn(globalThis, 'fetch');
  fetchSpy.mockResolvedValueOnce(Response.json(jmapSession({
    accountCapabilities,
    isPersonal,
    serverCapabilities: {
      ...(serverAdvertises ? { 'urn:ietf:params:jmap:contacts': {} } : {}),
      ...sessionCapabilities,
    },
  })));
  const client = new JMAPClient('https://mail.example.com', 'user@test.com', 'pass123');
  await client.connect();
  fetchSpy.mockReset();
  return client;
}

describe('JMAPClient.supportsContacts (account-scoped capability)', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it.each([
    { name: 'returns true when the account advertises the contacts capability', accountCapabilities: { 'urn:ietf:params:jmap:contacts': {} }, isPersonal: true, serverAdvertises: true, supported: true },
    { name: 'returns false when the server advertises contacts but the account does not', accountCapabilities: { 'urn:ietf:params:jmap:mail': {} }, isPersonal: true, serverAdvertises: true, supported: false },
    { name: 'treats non-personal (shared/group) accounts as capable even without per-account advertisement', accountCapabilities: {}, isPersonal: false, serverAdvertises: true, supported: true },
    { name: 'returns false for a shared account when the server does not advertise contacts', accountCapabilities: {}, isPersonal: false, serverAdvertises: false, supported: false },
  ].map(({ name, ...permissions }) => [name, permissions] as const))('%s', async (_name, { accountCapabilities, isPersonal, serverAdvertises, supported }) => {
    const client = await connect(accountCapabilities, isPersonal, serverAdvertises);
    expect(client.supportsContacts()).toBe(supported);
  });
});

describe('contactUsing (principals:owner declaration)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function addressBooksUsing(sessionCapabilities: Record<string, unknown>): Promise<string[]> {
    const client = await connect({ 'urn:ietf:params:jmap:contacts': {} }, true, true, sessionCapabilities);
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      Response.json({ methodResponses: [['AddressBook/get', { list: [] }, '0']] }),
    );
    await client.getAddressBooks();
    return JSON.parse((spy.mock.calls[0][1] as RequestInit).body as string).using;
  }

  it('omits principals:owner when the server advertises only base principals', async () => {
    const using = await addressBooksUsing({ 'urn:ietf:params:jmap:principals': {} });
    expect(using).not.toContain('urn:ietf:params:jmap:principals:owner');
  });

  it('declares principals:owner when the server advertises it', async () => {
    const using = await addressBooksUsing({
      'urn:ietf:params:jmap:principals': {},
      'urn:ietf:params:jmap:principals:owner': {},
    });
    expect(using).toContain('urn:ietf:params:jmap:principals:owner');
  });
});
