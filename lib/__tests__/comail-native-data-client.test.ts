// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createComailClient, createComailBearerClient } from '@/lib/jmap/comail-client';
import { JMAPClient } from '@/lib/jmap/client';
import { useAccountStore, type AccountEntry } from '@/stores/account-store';
import { useContactStore } from '@/stores/contact-store';
import { useFileStore } from '@/stores/file-store';
import { useCalendarStore } from '@/stores/calendar-store';
import { setClientLookup } from '@/stores/client-registry';
import { clearAllStores } from '@/lib/account-state-manager';
import { generateAccountId } from '@/lib/account-utils';
import type { SpaceFile, SpaceFileInventory } from '@/lib/space-files/wire';
import type { Calendar, CalendarEvent } from '@/lib/jmap/types';

const server = 'https://mail.example.test';
const contactId = 'urn:uuid:11111111-1111-4111-8111-111111111111';
const fileId = `file-${'a'.repeat(64)}`;
const emptyHash = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
const actors = ['did:plc:abcdefghijklmnopqrstuvwx', 'did:plc:bcdefghijklmnopqrstuvwxy'];
const names = ['Alice', 'Bob'];

function book(slot: number) {
  return { actorDID: actors[slot], addressBookId: 'personal', state: 'one', contacts: [{
    id: contactId, card: { '@type': 'Card', version: '1.0', uid: contactId, name: { full: names[slot] } },
  }] };
}
function inventory(slot: number): SpaceFileInventory {
  return { actorDID: actors[slot], files: [{
    $type: 'email.atmos.filePersonal.file', fileId, operationId: `op-${'b'.repeat(64)}`,
    revisionId: `revision-${'c'.repeat(64)}`, name: `${names[slot]}.txt`, mimeType: 'text/plain',
    size: 0, sha256: emptyHash, parents: [], blob: { cid: 'synthetic', mimeType: 'text/plain', size: 0 },
  }] };
}
function client(slot: number) {
  const value = createComailClient(server, `${names[slot].toLowerCase()}@example.test`, 'unused');
  Object.assign(value, { accountId: 'same-account', accounts: {}, session: { accounts: {}, primaryAccounts: {} } });
  return value;
}
function backend() {
  const fetcher = vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input), 'https://bulwark.example.test');
    const slot = Number(url.searchParams.get('slot'));
    if (url.pathname === '/api/contacts/book') return Response.json(book(slot));
    if (url.pathname === '/api/files/inventory') return Response.json(inventory(slot));
    throw new Error(`Unexpected native request: ${url.pathname}`);
  });
  vi.stubGlobal('fetch', fetcher);
  return fetcher;
}

beforeEach(() => {
  clearAllStores();
  const accounts: AccountEntry[] = names.map((name, cookieSlot) => {
    const username = `${name.toLowerCase()}@example.test`;
    return { id: generateAccountId(username, server), label: name, username, serverUrl: server,
      cookieSlot, authMode: 'basic', rememberMe: false, displayName: name, email: username,
      avatarColor: '', lastLoginAt: 0, isConnected: true, hasError: false, isDefault: cookieSlot === 0 };
  });
  useAccountStore.setState({ accounts, activeAccountId: accounts[0].id });
});
afterEach(() => { clearAllStores(); setClientLookup(() => undefined); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('Comail data through the native client and stores', () => {
  it('loads account-specific contacts through the native contact store with overlapping IDs', async () => {
    const requests = backend();
    const alice = client(0); const bob = client(1);
    await useContactStore.getState().fetchAllAccountsContacts([
      { localAccountId: 'alice', client: alice }, { localAccountId: 'bob', client: bob },
    ]);
    expect(useContactStore.getState().contacts).toMatchObject([
      { id: `alice::${contactId}`, localAccountId: 'alice', name: { full: 'Alice' } },
      { id: `bob::${contactId}`, localAccountId: 'bob', name: { full: 'Bob' } },
    ]);
    expect(requests.mock.calls.map(([url]) => String(url))).toEqual(expect.arrayContaining([
      '/api/contacts/book?slot=0', '/api/contacts/book?slot=1',
    ]));
  });

  it('loads only the selected account through the native Files store', async () => {
    backend();
    useFileStore.getState().initClient(client(0), 'alice');
    await useFileStore.getState().navigate(null, '');
    expect(useFileStore.getState().resources).toMatchObject([{ name: 'Alice.txt' }]);
    useFileStore.getState().clearClient();
    useFileStore.getState().initClient(client(1), 'bob');
    await useFileStore.getState().navigate(null, '');
    expect(useFileStore.getState().resources).toMatchObject([{ name: 'Bob.txt' }]);
  });

  it('keeps ordinary mail attachment uploads on the upstream client', async () => {
    const upload = vi.spyOn(JMAPClient.prototype, 'uploadBlob').mockResolvedValue({ blobId: 'mail-blob', size: 0, type: 'text/plain' });
    const file = new File([], 'attachment.txt', { type: 'text/plain' });
    expect(await client(0).uploadBlob(file)).toMatchObject({ blobId: 'mail-blob' });
    expect(upload).toHaveBeenCalledWith(file);
  });

  it('uses private staging for native Files uploads without using the mail uploader', async () => {
    const source = inventory(0);
    const requests = backend();
    requests.mockImplementation(async (input, init?: RequestInit) => {
      const url = new URL(String(input), 'https://bulwark.example.test');
      if (url.pathname === '/api/files/inventory') return Response.json(source);
      if (url.pathname === '/api/files/put') {
        const { bytes: _bytes, ...put } = JSON.parse(String(init?.body)) as SpaceFile & { bytes: string };
        const saved: SpaceFile = { ...put, $type: 'email.atmos.filePersonal.file',
          revisionId: `revision-${'d'.repeat(64)}`, size: 0, sha256: emptyHash,
          blob: { cid: 'synthetic', mimeType: put.mimeType, size: 0 } };
        source.files.push(saved);
        return Response.json(saved);
      }
      throw new Error(`Unexpected request: ${url.pathname}`);
    });
    const mail = vi.spyOn(JMAPClient.prototype, 'uploadBlob').mockRejectedValue(new Error('Mail uploader used for private file'));
    useFileStore.getState().initClient(client(0), 'alice');
    await useFileStore.getState().uploadFile(new File([], 'empty.txt', { type: 'text/plain' }));
    expect(source.files.map(file => file.name)).toEqual(['Alice.txt', 'empty.txt']);
    expect(requests.mock.calls.some(([url]) => String(url) === '/api/files/put?slot=0')).toBe(true);
    expect(mail).not.toHaveBeenCalled();
  });

  it.each(['contacts', 'files'] as const)('keeps a validated %s consent link in its native store', async resource => {
    const authorizationUrl = `https://inbox.comail.at/oauth/${resource}/tickets/${'A'.repeat(43)}`;
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => String(input).includes('/authorization')
      ? Response.json({ status: 'authorization_required', authorizationUrl })
      : Response.json({ error: 'authorization_required' }, { status: 409 })));
    const active = client(0);
    if (resource === 'contacts') {
      await useContactStore.getState().fetchContacts(active);
      expect(useContactStore.getState().spaceContactsAuthorizationUrl).toBe(authorizationUrl);
      expect(useContactStore.getState().contacts).toEqual([]);
    } else {
      useFileStore.getState().initClient(active, 'alice');
      await expect(useFileStore.getState().checkSupport()).resolves.toBe(false);
      expect(useFileStore.getState().spaceFilesAuthorizationUrl).toBe(authorizationUrl);
    }
  });

  it('drops a slow Files listing after selecting the other account', async () => {
    const pending = Promise.withResolvers<Response>();
    const started = Promise.withResolvers<void>();
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).endsWith('slot=0')) { started.resolve(); return pending.promise.then(response => response.clone()); }
      return Response.json(inventory(1));
    }));
    useFileStore.getState().initClient(client(0), 'alice');
    const old = useFileStore.getState().navigate(null, '');
    await started.promise;
    useFileStore.getState().clearClient();
    useFileStore.getState().initClient(client(1), 'bob');
    await useFileStore.getState().navigate(null, '');
    pending.resolve(Response.json(inventory(0)));
    await old;
    expect(useFileStore.getState().resources).toMatchObject([{ name: 'Bob.txt' }]);
  });

  it('drops slow contacts after the existing account-switch reset', async () => {
    const pending = Promise.withResolvers<Response>();
    const started = Promise.withResolvers<void>();
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).endsWith('slot=0')) { started.resolve(); return pending.promise.then(response => response.clone()); }
      return Response.json(book(1));
    }));
    const old = useContactStore.getState().fetchContacts(client(0));
    await started.promise;
    clearAllStores();
    await useContactStore.getState().fetchContacts(client(1));
    pending.resolve(Response.json(book(0)));
    await old;
    expect(useContactStore.getState().contacts).toMatchObject([{ name: { full: 'Bob' } }]);
  });

  it('refuses another account and a changed cookie slot before a contact write', async () => {
    const requests = backend(); const active = client(0);
    await active.getContacts();
    await expect(active.createContact({}, 'other-account')).rejects.toMatchObject({ code: 'unsupported_account' });
    const account = useAccountStore.getState().accounts[0];
    useAccountStore.getState().updateAccount(account.id, { cookieSlot: 1 });
    await expect(active.updateContact(contactId, {})).rejects.toMatchObject({ code: 'account_changed' });
    expect(requests.mock.calls.every(([url]) => String(url).includes('/book?slot=0'))).toBe(true);
  });

  it('falls back only when private contacts are explicitly not configured', async () => {
    const native = vi.spyOn(JMAPClient.prototype, 'getAllContacts').mockResolvedValue([]);
    const requests = vi.fn(async () => Response.json({ error: 'not_configured' }, { status: 404 }));
    vi.stubGlobal('fetch', requests);
    await client(0).getAllContacts();
    expect(native).toHaveBeenCalledOnce();
    requests.mockImplementation(async () => Response.json({ error: 'not_found' }, { status: 404 }));
    await expect(client(1).getAllContacts()).rejects.toMatchObject({ code: 'not_found' });
    expect(native).toHaveBeenCalledOnce();
  });

  it('uses the owned client for bearer-token sessions too', async () => {
    backend();
    const active = createComailBearerClient(server, 'synthetic-token', 'alice@example.test');
    expect(active.getAuthHeader()).toBe('Bearer synthetic-token');
    expect(await active.getAllContacts()).toMatchObject([{ name: { full: 'Alice' } }]);
  });

  it.each([
    ['shared', true], ['private', true], ['shared', false], ['private', false],
  ] as const)('routes %s calendar edits only while the owning account is connected (%s)', async (audience, connected) => {
    const alice = client(0); const bob = client(1);
    const accounts = useAccountStore.getState().accounts;
    setClientLookup(id => id === accounts[0].id && connected ? alice : id === accounts[1].id ? bob : undefined);
    const calendars: Calendar[] = accounts.map(account => ({
      id: `${account.id}::space:one`, originalId: 'one', source: 'atproto-space', spaceRole: 'editor',
      name: account.label, localAccountId: account.id, accountId: 'same-account',
      myRights: { mayReadFreeBusy: false, mayReadItems: true, mayWriteAll: true, mayWriteOwn: false,
        mayUpdatePrivate: true, mayRSVP: true, mayShare: false, mayDelete: false },
    } as Calendar));
    const events = calendars.map((calendar, index) => ({
      id: `${accounts[index].id}::space-event:event`, originalId: 'event', source: 'atproto-space',
      localAccountId: accounts[index].id, accountId: 'same-account', calendarIds: { [calendar.id]: true },
      spaceRevisionId: 'shared-one', spacePersonalRevisionId: 'private-one', title: names[index],
      start: '2030-03-11T10:00:00', duration: 'PT1H', color: 'red',
    } as CalendarEvent));
    useCalendarStore.setState({ calendars, events, dateRange: null });
    const canonical = { ...events[0], title: audience === 'shared' ? 'Changed' : 'Alice',
      color: audience === 'private' ? 'blue' : 'red', spaceRevisionId: audience === 'shared' ? 'shared-two' : 'shared-one',
      spacePersonalRevisionId: audience === 'private' ? 'private-two' : 'private-one' };
    const shared = vi.spyOn(alice, 'updateAtprotoSpaceCalendarEvent').mockResolvedValue(canonical);
    const personal = vi.spyOn(alice, 'updateAtprotoSpaceCalendarPrivateEvent').mockResolvedValue(canonical);
    const native = vi.spyOn(alice, 'updateCalendarEvent').mockRejectedValue(new Error('Private event sent to JMAP'));
    const wrongShared = vi.spyOn(bob, 'updateAtprotoSpaceCalendarEvent').mockResolvedValue(canonical);
    const wrongPersonal = vi.spyOn(bob, 'updateAtprotoSpaceCalendarPrivateEvent').mockResolvedValue(canonical);
    const change = audience === 'shared' ? { title: 'Changed' } : { color: 'blue' };
    if (!connected) {
      await expect(useCalendarStore.getState().updateEvent(bob, events[0].id, change)).rejects.toThrow(/owning account/i);
      expect(wrongShared).not.toHaveBeenCalled();
      expect(wrongPersonal).not.toHaveBeenCalled();
      expect(useCalendarStore.getState().events).toEqual(events);
      return;
    }
    expect(await useCalendarStore.getState().updateEvent(bob, events[0].id, change)).toBe(true);
    if (audience === 'shared') {
      expect(shared).toHaveBeenCalledWith('event', 'shared-one', change);
      expect(personal).not.toHaveBeenCalled();
    } else {
      expect(personal).toHaveBeenCalledWith('event', 'private-one', change, undefined);
      expect(shared).not.toHaveBeenCalled();
    }
    expect(native).not.toHaveBeenCalled();
    expect(useCalendarStore.getState().events[0]).toMatchObject(canonical);
    expect(useCalendarStore.getState().events[1]).toEqual(events[1]);
  });

  it('refuses a contact edit when its owning account has no client', async () => {
    const bob = client(1);
    const owner = useAccountStore.getState().accounts[0].id;
    const id = `${owner}::${contactId}`;
    useContactStore.setState({ contacts: [{ id, originalId: contactId, localAccountId: owner,
      addressBookIds: { personal: true }, name: { full: 'Alice' } }] });
    setClientLookup(() => undefined);
    const wrongWrite = vi.spyOn(bob, 'updateContact').mockResolvedValue(undefined);
    vi.spyOn(bob, 'getAllContacts').mockResolvedValue([]);
    await expect(useContactStore.getState().updateContact(bob, id, { name: { full: 'Changed' } })).rejects.toThrow(/owning account/i);
    expect(wrongWrite).not.toHaveBeenCalled();
    expect(useContactStore.getState().contacts[0].name?.full).toBe('Alice');
  });
});
