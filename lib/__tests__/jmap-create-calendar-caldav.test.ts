import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Keep the CalDAV helper from pulling the account stores into the test.
vi.mock('@/lib/auth/active-account-slot', () => ({
  getActiveAccountSlotHeaders: () => ({}),
}));

import { JMAPClient } from '../jmap/client';
import type { Calendar } from '../jmap/types';

const SESSION = {
  capabilities: { 'urn:ietf:params:jmap:core': {}, 'urn:ietf:params:jmap:calendars': {} },
  accounts: { 'acct-1': { name: 'user@test.com', isPersonal: true, accountCapabilities: { 'urn:ietf:params:jmap:calendars': {} } } },
  primaryAccounts: { 'urn:ietf:params:jmap:mail': 'acct-1', 'urn:ietf:params:jmap:calendars': 'acct-1' },
  apiUrl: 'https://mail.example.com/jmap/api',
  downloadUrl: 'https://mail.example.com/jmap/download/{accountId}/{blobId}/{name}',
  uploadUrl: 'https://mail.example.com/jmap/upload/{accountId}/',
  eventSourceUrl: 'https://mail.example.com/jmap/eventsource',
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

const EXISTING: Partial<Calendar> = { id: 'old', name: 'Personal', color: '#111111' };
const CREATED: Partial<Calendar> = { id: 'new', name: 'Work', color: null };
const JMAP_CREATED: Partial<Calendar> = { id: 'jmap-created', name: 'Work', color: '#ff0000' };

interface Call { url: string; init: RequestInit }
interface JmapCall { method: string; args: Record<string, unknown> }

/**
 * Scripted Stalwart: the DAV proxy answers with `davStatus`; JMAP calls are
 * answered from a tiny in-memory model where the MKCALENDAR'd calendar only
 * shows up in Calendar/get once the DAV request succeeded.
 */
function scriptServer(fetchSpy: ReturnType<typeof vi.spyOn>, davStatus: number) {
  const calls: Call[] = [];
  const jmapCalls: JmapCall[] = [];
  let davCreated = false;
  let jmapCreated = false;
  let colour: string | null = null;
  fetchSpy.mockImplementation(async (input: unknown, init?: unknown) => {
    const url = String(input);
    const req = (init ?? {}) as RequestInit;
    calls.push({ url, init: req });
    if (url.endsWith('/api/webdav')) {
      if (davStatus === 201) davCreated = true;
      return new Response(null, { status: davStatus });
    }
    const [method, args] = JSON.parse(req.body as string).methodCalls[0] as [string, Record<string, unknown>];
    jmapCalls.push({ method, args });
    if (method === 'Calendar/get') {
      const created = { ...CREATED, color: colour };
      const all = [EXISTING, ...(davCreated ? [created] : []), ...(jmapCreated ? [JMAP_CREATED] : [])];
      const ids = args.ids as string[] | null;
      const list = ids ? all.filter((c) => ids.includes(c.id!)) : all;
      return json(200, { methodResponses: [['Calendar/get', { list }, '0']] });
    }
    if (method === 'Calendar/set') {
      const update = args.update as Record<string, Record<string, unknown>> | undefined;
      if (update) {
        for (const patch of Object.values(update)) if (typeof patch.color === 'string') colour = patch.color;
        return json(200, { methodResponses: [['Calendar/set', { updated: Object.fromEntries(Object.keys(update).map((k) => [k, null])) }, '0']] });
      }
      jmapCreated = true;
      return json(200, { methodResponses: [['Calendar/set', { created: { 'new-calendar': { id: 'jmap-created' } } }, '0']] });
    }
    throw new Error('unexpected JMAP method ' + method);
  });
  return { calls, jmapCalls, dav: () => calls.filter((c) => c.url.endsWith('/api/webdav')) };
}

describe('JMAPClient.createCalendar pins the CalDAV component set (#760)', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;
  let client: JMAPClient;

  beforeEach(async () => {
    fetchSpy = vi.spyOn(globalThis, 'fetch');
    fetchSpy.mockResolvedValueOnce(json(200, SESSION));
    client = new JMAPClient('https://mail.example.com', 'user@test.com', 'pass123');
    await client.connect();
    fetchSpy.mockReset();
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it('creates the collection with MKCALENDAR, then applies the other properties over JMAP', async () => {
    const server = scriptServer(fetchSpy, 201);

    const created = await client.createCalendar({ name: 'Work', color: '#ff0000' }, undefined, { components: ['VEVENT', 'VTODO'] });

    const dav = server.dav();
    expect(dav).toHaveLength(1);
    expect(dav[0].init.headers).toMatchObject({ 'X-WebDAV-Method': 'MKCALENDAR', 'X-WebDAV-Collection': 'cal' });
    expect(dav[0].init.body).toContain('<D:displayname>Work</D:displayname>');
    expect(dav[0].init.body).toContain('<C:comp name="VEVENT"/><C:comp name="VTODO"/>');

    // No JMAP create: the collection came from MKCALENDAR. The follow-up
    // Calendar/set only carries the properties MKCALENDAR could not.
    const sets = server.jmapCalls.filter((c) => c.method === 'Calendar/set');
    expect(sets).toHaveLength(1);
    expect(sets[0].args.create).toBeUndefined();
    expect(sets[0].args.update).toEqual({ new: { color: '#ff0000' } });

    expect(created.id).toBe('new');
    expect(created.color).toBe('#ff0000');
  });

  it('defaults to an events-only calendar', async () => {
    const server = scriptServer(fetchSpy, 201);
    await client.createCalendar({ name: 'Work' });
    const body = server.dav()[0].init.body as string;
    expect(body).toContain('<C:comp name="VEVENT"/>');
    expect(body).not.toContain('VTODO');
    // Nothing left to apply over JMAP once the name went in with MKCALENDAR.
    expect(server.jmapCalls.filter((c) => c.method === 'Calendar/set')).toHaveLength(0);
  });

  it('falls back to Calendar/set when the server refuses MKCALENDAR', async () => {
    const server = scriptServer(fetchSpy, 405);
    const created = await client.createCalendar({ name: 'Work', color: '#ff0000' });

    expect(server.dav()).toHaveLength(1);
    const sets = server.jmapCalls.filter((c) => c.method === 'Calendar/set');
    expect(sets).toHaveLength(1);
    expect(sets[0].args.create).toEqual({ 'new-calendar': { name: 'Work', color: '#ff0000' } });
    expect(created.id).toBe('jmap-created');
  });

  it('falls back to Calendar/set when the proxy is unreachable', async () => {
    const server = scriptServer(fetchSpy, 201);
    fetchSpy.mockImplementationOnce(async () => json(200, { methodResponses: [['Calendar/get', { list: [EXISTING] }, '0']] }));
    fetchSpy.mockImplementationOnce(async () => { throw new TypeError('Failed to fetch'); });

    const created = await client.createCalendar({ name: 'Work' });
    expect(created.id).toBe('jmap-created');
    expect(server.jmapCalls.filter((c) => c.method === 'Calendar/set' && c.args.create)).toHaveLength(1);
  });

  it('never touches CalDAV for calendars in another account', async () => {
    const server = scriptServer(fetchSpy, 201);
    const created = await client.createCalendar({ name: 'Work' }, 'acct-shared');
    expect(server.dav()).toHaveLength(0);
    expect(server.jmapCalls[0]).toMatchObject({ method: 'Calendar/set', args: { accountId: 'acct-shared' } });
    expect(created.id).toBe('jmap-created');
  });
});
