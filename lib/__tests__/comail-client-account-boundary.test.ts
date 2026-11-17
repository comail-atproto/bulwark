// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createComailClient } from '@/lib/jmap/comail-client';
import { useAccountStore } from '@/stores/account-store';

const server = 'https://mail.example.test';
const username = 'member@example.test';
const actor = 'did:plc:abcdefghijklmnopqrstuvwx';
const range = ['2030-01-01T00:00:00Z', '2030-01-02T00:00:00Z'] as const;
let accountId: string;
let slot: number;

function makeClient() {
  const client = createComailClient(server, username, 'synthetic');
  Object.assign(client, {
    accountId: 'mail-account', apiUrl: `${server}/jmap`,
    accounts: { 'mail-account': { name: 'Member', isPersonal: true, accountCapabilities: {
      'urn:ietf:params:jmap:calendars': {}, 'urn:ietf:params:jmap:contacts': {}, 'urn:ietf:params:jmap:filenode': {},
    } } },
    capabilities: { 'urn:ietf:params:jmap:calendars': {}, 'urn:ietf:params:jmap:contacts': {}, 'urn:ietf:params:jmap:filenode': {} },
    session: { primaryAccounts: {}, accounts: {} },
  });
  return client;
}

beforeEach(() => {
  accountId = useAccountStore.getState().addAccount({ serverUrl: server, username, label: 'Member', email: username,
    displayName: 'Member', authMode: 'basic', rememberMe: false, lastLoginAt: 0, isConnected: true, hasError: false, isDefault: true });
  slot = useAccountStore.getState().getAccountById(accountId)!.cookieSlot;
});
afterEach(() => {
  useAccountStore.setState({ accounts: [], activeAccountId: null });
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Comail client account boundaries', () => {
  it.each(['disabled', 'changed slot'] as const)('loads only public calendars after %s', async (condition) => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), server);
      if (url.pathname === '/api/atmo-calendar') return Response.json({ error: 'not_found' }, { status: 404 });
      if (url.pathname === '/api/calendar/calendars') return Response.json({ calendars: [] });
      if (url.pathname === '/jmap' || url.pathname === '/api/account/stalwart/jmap') return Response.json({ methodResponses: [['Calendar/get', { list: [] }, '0']] });
      throw new Error(`Unexpected request ${url}`);
    });
    vi.stubGlobal('fetch', fetcher);
    const client = makeClient();
    const enabled = condition === 'changed slot';
    client.configurePrivateGroupware(slot, { calendar: enabled, contacts: enabled, files: enabled });
    if (enabled) useAccountStore.getState().updateAccount(accountId, { cookieSlot: slot + 1 });
    expect(client.supportsCalendars()).toBe(false);
    await client.getAllCalendarsWithFailures();
    const paths = fetcher.mock.calls.map(([input]) => new URL(String(input), server).pathname);
    expect(paths).toContain('/api/atmo-calendar');
    expect(paths).not.toContain('/api/calendar/calendars');
    expect(paths).not.toContain('/jmap');
    expect(paths).not.toContain('/api/account/stalwart/jmap');
  });

  it('does not query private or JMAP events when private calendar is disabled', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), server);
      if (url.pathname === '/api/calendar/calendars') return Response.json({ calendars: [] });
      if (url.pathname === '/jmap') return Response.json({ methodResponses: [['CalendarEvent/query', { ids: [] }, '0']] });
      throw new Error(`Unexpected request ${url}`);
    });
    vi.stubGlobal('fetch', fetcher);
    const client = makeClient();
    client.configurePrivateGroupware(slot, { calendar: false, contacts: false, files: false });
    const [result] = await Promise.allSettled([client.queryAllCalendarEvents({ after: range[0], before: range[1] })]);
    expect(fetcher).not.toHaveBeenCalled();
    expect(result.status).toBe('fulfilled');
  });

  it.each([['disabled', 'contacts'], ['disabled', 'files'], ['changed slot', 'contacts'], ['changed slot', 'files']] as const)(
    'refuses direct private %s / %s calls', async (condition, resource) => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), server);
      if (url.pathname === '/api/contacts/book') return Response.json({ actorDID: actor, addressBookId: 'personal', state: 'one', contacts: [] });
      if (url.pathname === '/api/files/inventory') return Response.json({ actorDID: actor, files: [] });
      throw new Error(`Unexpected request ${url}`);
    });
    vi.stubGlobal('fetch', fetcher);
    const client = makeClient();
    const enabled = condition === 'changed slot';
    client.configurePrivateGroupware(slot, { calendar: enabled, contacts: enabled, files: enabled });
    if (enabled) useAccountStore.getState().updateAccount(accountId, { cookieSlot: slot + 1 });
    expect(client.supportsContacts()).toBe(false);
    expect(client.supportsFiles()).toBe(false);
    await expect(resource === 'contacts' ? client.getAllContacts() : client.listAllFileNodes()).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('rejects a private file blob request for another account before reading an inventory', async () => {
    const fetcher = vi.fn(async () => Response.json({ actorDID: actor, files: [] }));
    vi.stubGlobal('fetch', fetcher);
    const client = makeClient();
    client.configurePrivateGroupware(slot, { calendar: true, contacts: true, files: true });
    await expect(client.fetchBlob('space-file:shared-id:shared-revision', 'name', 'text/plain', 'other-account'))
      .rejects.toMatchObject({ code: 'unsupported_account' });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each(['slot changed', 'disconnected'] as const)('does not reuse a cached owner role after the client is %s', async (condition) => {
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), server);
      if (url.pathname === '/api/calendar/calendars') return Response.json({ calendars: [{
        id: 'calendar', name: 'Calendar', source: 'atproto-space', myRole: 'owner', initialized: true, offerRole: 'viewer',
      }] });
      if (init?.method === 'DELETE') return Response.json({ error: 'forbidden' }, { status: 403 });
      throw new Error(`Unexpected request ${url}`);
    });
    vi.stubGlobal('fetch', fetcher);
    const client = makeClient();
    client.configurePrivateGroupware(slot, { calendar: true, contacts: true, files: true });
    await client.getAtprotoSpaceCalendars();
    if (condition === 'slot changed') useAccountStore.getState().updateAccount(accountId, { cookieSlot: slot + 1 });
    else client.disconnect();
    await expect(client.cancelAtprotoSpaceCalendarEvent('event', 'revision', 'calendar')).rejects.toThrow();
    expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'DELETE')).toHaveLength(0);
  });

  it('rejects Space events that finish after the account slot changes', async () => {
    const pending = Promise.withResolvers<Response>();
    const started = Promise.withResolvers<void>();
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), server);
      if (url.pathname === '/api/calendar/calendars') return Response.json({ calendars: [{
        id: 'calendar', name: 'Calendar', source: 'atproto-space', myRole: 'viewer', initialized: true,
      }] });
      if (url.pathname === '/api/calendar/events') { started.resolve(); return pending.promise; }
      throw new Error(`Unexpected request ${url}`);
    });
    vi.stubGlobal('fetch', fetcher);
    const client = makeClient();
    client.configurePrivateGroupware(slot, { calendar: true, contacts: true, files: true });
    await client.getAtprotoSpaceCalendars();
    const events = client.getAtprotoSpaceCalendarEvents(...range);
    await started.promise;
    useAccountStore.getState().updateAccount(accountId, { cookieSlot: slot + 1 });
    pending.resolve(Response.json({ events: [] }));
    await expect(events).rejects.toMatchObject({ code: 'account_changed' });
  });

  it('rejects a Space mutation result after the account slot changes', async () => {
    const pending = Promise.withResolvers<Response>();
    const started = Promise.withResolvers<void>();
    vi.stubGlobal('fetch', vi.fn(async () => { started.resolve(); return pending.promise; }));
    const client = makeClient();
    client.configurePrivateGroupware(slot, { calendar: true, contacts: true, files: true });
    const mutation = client.updateAtprotoSpaceCalendarEvent('event', 'revision', { title: 'Changed' });
    await started.promise;
    useAccountStore.getState().updateAccount(accountId, { cookieSlot: slot + 1 });
    pending.resolve(Response.json({ id: 'event', uid: 'uid', calendarId: 'calendar', revisionId: 'revision-2',
      title: 'Changed', description: '', start: '2030-01-01T10:00:00', timeZone: null, duration: 'PT1H', showWithoutTime: false, status: 'confirmed' }));
    await expect(mutation).rejects.toMatchObject({ code: 'account_changed' });
  });

  it('rejects a public calendar source that finishes after the account slot changes', async () => {
    const pending = Promise.withResolvers<Response>();
    const started = Promise.withResolvers<void>();
    vi.stubGlobal('fetch', vi.fn(async () => { started.resolve(); return pending.promise; }));
    const client = makeClient();
    const calendars = client.getAtmoPublicCalendars();
    await started.promise;
    useAccountStore.getState().updateAccount(accountId, { cookieSlot: slot + 1 });
    pending.resolve(Response.json({ actorDid: actor, state: `source-state-${'a'.repeat(64)}`,
      sources: [{ id: 'atmo', type: 'atproto-community-calendar', actorDid: actor, includeHosted: true, statuses: ['going', 'interested'], enabled: true }] }));
    await expect(calendars).rejects.toMatchObject({ code: 'account_changed' });
  });

  it('rejects a public calendar setting result after the account slot changes', async () => {
    const pending = Promise.withResolvers<Response>();
    const started = Promise.withResolvers<void>();
    const catalog = { actorDid: actor, state: `source-state-${'a'.repeat(64)}`,
      sources: [{ id: 'atmo', type: 'atproto-community-calendar', actorDid: actor, includeHosted: true, statuses: ['going', 'interested'], enabled: true }] };
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'PUT') { started.resolve(); return pending.promise; }
      return Response.json(catalog);
    }));
    const client = makeClient();
    await client.getAtmoPublicCalendars();
    const mutation = client.setAtmoCalendarEnabled(false);
    await started.promise;
    useAccountStore.getState().updateAccount(accountId, { cookieSlot: slot + 1 });
    pending.resolve(Response.json({ ...catalog, sources: [{ ...catalog.sources[0], enabled: false }] }));
    await expect(mutation).rejects.toMatchObject({ code: 'account_changed' });
  });

  it.each(['space', 'public'] as const)('rejects a pending %s calendar response after disconnect', async (source) => {
    const pending = Promise.withResolvers<Response>();
    const started = Promise.withResolvers<void>();
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), server);
      if (url.pathname === '/api/calendar/calendars') return Response.json({ calendars: [{
        id: 'calendar', name: 'Calendar', source: 'atproto-space', myRole: 'viewer', initialized: true,
      }] });
      started.resolve();
      return pending.promise;
    });
    vi.stubGlobal('fetch', fetcher);
    const client = makeClient();
    client.configurePrivateGroupware(slot, { calendar: true, contacts: true, files: true });
    if (source === 'space') await client.getAtprotoSpaceCalendars();
    const result = source === 'space' ? client.getAtprotoSpaceCalendarEvents(...range) : client.getAtmoPublicCalendars();
    await started.promise;
    client.disconnect();
    pending.resolve(source === 'space' ? Response.json({ events: [] }) : Response.json({
      actorDid: actor, state: `source-state-${'a'.repeat(64)}`,
      sources: [{ id: 'atmo', type: 'atproto-community-calendar', actorDid: actor, includeHosted: true, statuses: ['going', 'interested'], enabled: true }],
    }));
    await expect(result).rejects.toMatchObject({ code: 'account_changed' });
  });

  it('does not use a prior slot’s public-event cache after a failed refresh for the same range', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), server);
      if (url.pathname !== '/api/atmo-calendar') throw new Error(`Unexpected request ${url}`);
      if (url.searchParams.has('local')) return Response.json({ actorDid: actor, state: `source-state-${'a'.repeat(64)}`,
        sources: [{ id: 'atmo', type: 'atproto-community-calendar', actorDid: actor, includeHosted: true, statuses: ['going', 'interested'], enabled: true }] });
      if (url.searchParams.get('slot') !== String(slot)) return Response.json({ error: 'unavailable' }, { status: 503 });
      return Response.json({ actorDid: actor, after: url.searchParams.get('after'), before: url.searchParams.get('before'), complete: true,
        events: [{ uri: `at://${actor}/community.lexicon.calendar.event/3m3z2a2b3c4d5`, creatorDid: actor, cid: 'test-cid',
          name: 'First account event', startsAt: '2030-01-01T10:00:00Z', attendance: 'hosting', status: 'scheduled' }] });
    });
    vi.stubGlobal('fetch', fetcher);
    const client = makeClient();
    await client.getAtmoPublicCalendars();
    expect(await client.getAtmoPublicCalendarEvents(...range)).toHaveLength(1);
    useAccountStore.getState().updateAccount(accountId, { cookieSlot: slot + 1 });
    await client.getAtmoPublicCalendars();
    expect(await client.getAtmoPublicCalendarEvents(...range)).toEqual([]);
  });
});
