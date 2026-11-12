// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';
import { encryptSession } from '@/lib/auth/crypto';
import { groupwareActor, groupwareAllowed, groupwareMailboxAllowed } from '@/lib/groupware/access';
import { jmapGroupwareFeatures } from '@/lib/groupware/jmap';

it.each(['urn:calendars:x\n', 'urn:contacts:x\r', 'urn:filenode:x\u2028'])(
  'rejects whitespace in a JMAP capability: %j', (capability) => {
    expect(jmapGroupwareFeatures({ using: [capability], methodCalls: [] })).toBeNull();
  },
);

vi.mock('@/lib/auth/session-secret', () => ({ getSessionSecret: () => 'x'.repeat(32) }));
vi.mock('@/lib/admin/config-manager', () => ({ configManager: {
  ensureLoaded: vi.fn(), get: (key: string) => config[key],
} }));
vi.mock('@/lib/auth/mailbox-session', () => ({
  mailboxSessionURL: () => 'https://inbox.example.test/webmail/session',
  signMailboxSessionToken: (mailbox: string) => `signed:${mailbox}`,
}));

const config: Record<string, unknown> = {};
const creds = { accountName: 'Synthetic', serverUrl: 'https://mail.example.test', username: 'owner@example.test', authHeader: `Basic ${Buffer.from('owner@example.test:synthetic').toString('base64')}`, slot: 1, hasSessionCookie: true, trusted: true };
const cookieValues = new Map<string, string>();
const request = { cookies: { get: (name: string) => cookieValues.has(name) ? { value: cookieValues.get(name)! } : undefined } } as NextRequest;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  cookieValues.clear();
  cookieValues.set('jmap_session_1', encryptSession(creds.serverUrl, creds.username, 'synthetic', { groupwareEnabled: true }));
  config.calendarEnabled = config.contactsEnabled = config.filesEnabled = true;
  fetchMock = vi.fn().mockImplementation(async () => Response.json({ did: 'did:plc:synthetic', groupware_enabled: true }));
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe('Groupware access', () => {
  it('requires both an encrypted account entitlement and the live Inbox flag', async () => {
    expect(await groupwareAllowed(request, creds, 'calendar')).toBe(true);
    fetchMock.mockResolvedValueOnce(Response.json({ did: 'did:plc:synthetic', groupware_enabled: false }));
    expect(await groupwareAllowed(request, creds, 'calendar')).toBe(false);
    expect(fetchMock.mock.calls[0][0]).toBe('https://inbox.example.test/webmail/session');
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ cache: 'no-store', redirect: 'error', headers: { Authorization: 'Bearer signed:owner@example.test' } });
  });

  it.each([false, undefined])('denies a missing or false account entitlement (%s)', async (groupwareEnabled) => {
    cookieValues.set('jmap_session_1', encryptSession(creds.serverUrl, creds.username, 'synthetic', { groupwareEnabled }));
    cookieValues.set('comail_groupware', '1');
    expect(await groupwareAllowed(request, creds, 'calendar')).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('cannot borrow the flag from another account slot', async () => {
    cookieValues.set('jmap_session', cookieValues.get('jmap_session_1')!);
    cookieValues.delete('jmap_session_1');
    expect(await groupwareAllowed(request, creds, 'calendar')).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects mismatched credentials before checking the flag', async () => {
    expect(await groupwareAllowed(request, { ...creds, username: 'other@example.test' }, 'calendar')).toBe(false);
    expect(await groupwareAllowed(request, { ...creds, authHeader: 'Basic other' }, 'calendar')).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(['calendar', 'contacts', 'files'] as const)('requires the existing %s operator switch', async (feature) => {
    config[`${feature}Enabled`] = false;
    expect(await groupwareAllowed(request, creds, feature)).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('denies editor credentials when the live flag is switched off', async () => {
    expect(await groupwareMailboxAllowed(creds.username, 'files')).toBe(true);
    fetchMock.mockResolvedValueOnce(Response.json({ did: 'did:plc:synthetic', groupware_enabled: false }));
    expect(await groupwareMailboxAllowed(creds.username, 'files')).toBe(false);
  });

  it.each([{}, { did: 'invalid', groupware_enabled: true }, { did: 'did:plc:synthetic', groupware_enabled: 'true' }])('denies incomplete or malformed entitlement replies', async (body) => {
    fetchMock.mockResolvedValueOnce(Response.json(body));
    expect(await groupwareMailboxAllowed(creds.username, 'files')).toBe(false);
  });

  it('fails closed on Inbox outages and oversized replies', async () => {
    fetchMock.mockRejectedValueOnce(new Error('unavailable'));
    expect(await groupwareMailboxAllowed(creds.username, 'files')).toBe(false);
    fetchMock.mockResolvedValueOnce(Response.json({ did: 'did:plc:synthetic', groupware_enabled: true, padding: 'x'.repeat(4096) }));
    expect(await groupwareMailboxAllowed(creds.username, 'files')).toBe(false);
  });
});

describe('JMAP feature boundaries', () => {
  it('recognizes free/busy and extension methods without a declared capability', () => {
    expect(jmapGroupwareFeatures({ using: [], methodCalls: [['Principal/getAvailability', {}, '1'], ['CalendarTask/get', {}, '2']] })).toEqual(['calendar']);
  });
  it('keeps mail, mail attachments and account management outside Groupware', () => {
    expect(jmapGroupwareFeatures({ using: ['urn:ietf:params:jmap:mail'], methodCalls: [['Email/get', {}, '1'], ['Blob/get', {}, '2'], ['x:AppPassword/get', {}, '3']] })).toEqual([]);
  });
});


describe('Groupware public-record actor', () => {
  it('returns the selected account DID only when its live identity still matches', async () => {
    cookieValues.set('jmap_session_1', encryptSession(creds.serverUrl, creds.username, 'synthetic', { groupwareEnabled: true, did: 'did:plc:synthetic' }));
    expect(await groupwareActor(request, creds, 'calendar')).toBe('did:plc:synthetic');
    fetchMock.mockResolvedValueOnce(Response.json({ did: 'did:plc:rebound', groupware_enabled: true }));
    expect(await groupwareActor(request, creds, 'calendar')).toBeNull();
  });

  it('does not borrow a DID from another slot or accept a session without a DID', async () => {
    cookieValues.set('jmap_session', encryptSession(creds.serverUrl, creds.username, 'synthetic', { groupwareEnabled: true, did: 'did:plc:synthetic' }));
    expect(await groupwareActor(request, creds, 'calendar')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('denies disabled flags and unavailable identity before public records can be read', async () => {
    cookieValues.set('jmap_session_1', encryptSession(creds.serverUrl, creds.username, 'synthetic', { groupwareEnabled: true, did: 'did:plc:synthetic' }));
    config.calendarEnabled = false;
    expect(await groupwareActor(request, creds, 'calendar')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    config.calendarEnabled = true;
    fetchMock.mockRejectedValueOnce(new Error('unavailable'));
    expect(await groupwareActor(request, creds, 'calendar')).toBeNull();
  });
});
