import { afterEach, describe, expect, it, vi } from 'vitest';
import { JMAPClient } from '@/lib/jmap/client';
import { AtmoCalendarAdapter } from '@/lib/jmap/atmo-calendar-adapter';
import { SpaceCalendarError } from '@/lib/jmap/space-calendar-adapter';
import type { Calendar, CalendarEvent } from '@/lib/jmap/types';
import { useAccountStore } from '@/stores/account-store';
import { useCalendarStore } from '@/stores/calendar-store';

const ACTOR_DID = 'did:plc:abcdefghijklmnopqrstuvwx';
const CALENDAR_ID = `atmo:${ACTOR_DID}`;
const EVENT_ID = `atmo:at://${ACTOR_DID}/community.lexicon.calendar.event/3m3z2a2b3c4d5`;
const calendar = { id: CALENDAR_ID, originalId: CALENDAR_ID, source: 'atproto-public', name: 'Atmosphere', myRights: { mayReadItems: true } } as unknown as Calendar;
const event = { id: EVENT_ID, originalId: EVENT_ID, source: 'atproto-public', calendarIds: { [CALENDAR_ID]: true } } as unknown as CalendarEvent;

function makeClient() {
  const client = new JMAPClient('https://mail.example.test', 'owner@example.test', 'synthetic');
  Object.assign(client, {
    accountId: 'acct-1',
    accounts: { 'acct-1': { name: 'Owner', isPersonal: true, accountCapabilities: { 'urn:ietf:params:jmap:calendars': {} } } },
    capabilities: { 'urn:ietf:params:jmap:calendars': {} },
    session: { accounts: { 'acct-1': {} }, primaryAccounts: {} },
  });
  vi.spyOn(client as unknown as { request: (...args: unknown[]) => Promise<unknown> }, 'request')
    .mockResolvedValue({ methodResponses: [['Calendar/get', { list: [] }, '0']] });
  vi.spyOn(client as unknown as { requestCalendars: (accountId: string) => Promise<unknown> }, 'requestCalendars')
    .mockResolvedValue({ methodResponses: [['Calendar/get', { list: [] }, '0']] });
  vi.spyOn(client as unknown as { getTasksOnlyCalendarIds: () => Promise<Set<string>> }, 'getTasksOnlyCalendarIds')
    .mockResolvedValue(new Set());
  vi.spyOn(client, 'queryCalendarEvents').mockResolvedValue([]);
  return client;
}

function adapterOf(client: JMAPClient) {
  return (client as unknown as { atmoCalendarAdapter: AtmoCalendarAdapter }).atmoCalendarAdapter;
}

afterEach(() => {
  useAccountStore.setState({ accounts: [], activeAccountId: null });
  useCalendarStore.getState().clearState();
});

describe('AT Protocol public calendar integration in JMAPClient', () => {
  it('starts private, Space, and Atmosphere calendar reads together', async () => {
    const client = makeClient();
    const started: string[] = [];
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    vi.spyOn(client as unknown as { requestCalendars: (accountId: string) => Promise<unknown> }, 'requestCalendars')
      .mockImplementation(async () => {
        started.push('private');
        await blocked;
        return { methodResponses: [['Calendar/get', { list: [] }, '0']] };
      });
    vi.spyOn(client, 'getAtprotoSpaceCalendars').mockImplementation(async () => {
      started.push('space');
      await blocked;
      return [];
    });
    vi.spyOn(client, 'getAtmoPublicCalendars').mockImplementation(async () => {
      started.push('atmosphere');
      await blocked;
      return [];
    });

    const pending = client.getAllCalendarsWithFailures();
    await vi.waitFor(() => expect(started).toEqual(expect.arrayContaining(['private', 'space', 'atmosphere'])));
    release();
    await pending;
  });

  it('starts private, Space, and Atmosphere event reads together', async () => {
    const client = makeClient();
    const started: string[] = [];
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    vi.spyOn(client, 'queryCalendarEvents').mockImplementation(async () => {
      started.push('private');
      await blocked;
      return [];
    });
    vi.spyOn(client, 'getAtprotoSpaceCalendarEvents').mockImplementation(async () => {
      started.push('space');
      await blocked;
      return [];
    });
    vi.spyOn(client, 'getAtmoPublicCalendarEvents').mockImplementation(async () => {
      started.push('atmosphere');
      await blocked;
      return [];
    });

    const pending = client.queryAllCalendarEvents({ after: '2026-10-08T00:00:00Z', before: '2026-10-09T00:00:00Z' });
    await vi.waitFor(() => expect(started).toEqual(expect.arrayContaining(['private', 'space', 'atmosphere'])));
    release();
    await pending;
  });

  it('uses the owning account cookie slot and annotates the calendar with that account ID', async () => {
    const slot = useAccountStore.getState().addAccount({
      label: 'Owner', authMode: 'basic', rememberMe: true, username: 'owner@example.test',
      serverUrl: 'https://mail.example.test', displayName: 'Owner', email: 'owner@example.test',
      lastLoginAt: 0, isConnected: true, hasError: false, isDefault: true,
    });
    useAccountStore.getState().updateAccount(slot, { cookieSlot: 4 });
    const client = makeClient();
    const fetcher = vi.fn().mockResolvedValue(Response.json({
      actorDid: ACTOR_DID,
      state: `source-state-${'a'.repeat(64)}`,
      sources: [{ id: 'atmo', type: 'atproto-community-calendar', actorDid: ACTOR_DID, includeHosted: true, statuses: ['going', 'interested'], enabled: true }],
    }));
    Object.assign(adapterOf(client), { fetcher });

    const [result] = await (client as unknown as { getAtmoPublicCalendars(): Promise<Calendar[]> }).getAtmoPublicCalendars();

    expect(fetcher).toHaveBeenCalledWith('/api/atmo-calendar?slot=4&local=1', { cache: 'no-store' });
    expect(result).toMatchObject({ id: CALENDAR_ID, source: 'atproto-public', accountId: 'acct-1' });
  });

  it('includes source calendars and public events through the existing aggregate client calls', async () => {
    const client = makeClient();
    const adapter = adapterOf(client);
    vi.spyOn(adapter, 'getCalendars').mockResolvedValue([calendar]);
    vi.spyOn(adapter, 'getEvents').mockResolvedValue([event]);

    const listed = await client.getAllCalendarsWithFailures();
    const queried = await client.queryAllCalendarEvents({ after: '2026-10-08T00:00:00Z', before: '2026-10-09T00:00:00Z' });

    expect(listed.calendars).toContainEqual(expect.objectContaining({ id: CALENDAR_ID, source: 'atproto-public' }));
    expect(queried).toContainEqual(expect.objectContaining({ ...event, accountId: 'acct-1', isShared: false }));
  });

  it('keeps JMAP and Space events refreshing when a public source read fails', async () => {
    const client = makeClient();
    const jmapEvent = { id: 'jmap-event', calendarIds: { calendar: true } } as unknown as CalendarEvent;
    vi.spyOn(client, 'queryCalendarEvents').mockResolvedValue([jmapEvent]);
    vi.spyOn(client, 'getAtprotoSpaceCalendarEvents').mockResolvedValue([]);
    vi.spyOn(adapterOf(client), 'getEvents').mockRejectedValue(new SpaceCalendarError('Public calendar unavailable', 'provider_unavailable', 503));

    await expect(client.queryAllCalendarEvents({ after: '2026-10-08T00:00:00Z', before: '2026-10-09T00:00:00Z' }))
      .resolves.toContainEqual(expect.objectContaining({ id: 'jmap-event' }));
    expect(client.queryCalendarEvents).toHaveBeenCalledTimes(1);
  });

  it('omits an unavailable public calendar without failing every account calendar', async () => {
    const client = makeClient();
    vi.spyOn(adapterOf(client), 'getCalendars').mockRejectedValue(new SpaceCalendarError('Public calendar unavailable', 'provider_unavailable', 503));

    await expect(client.getAllCalendarsWithFailures()).resolves.toEqual({ calendars: [], failedAccountIds: [] });
  });

  it('keeps last-good public events while JMAP continues after a source refresh failure', async () => {
    const client = makeClient();
    vi.spyOn(client, 'getAtprotoSpaceCalendarEvents').mockResolvedValue([]);
    const getEvents = vi.spyOn(adapterOf(client), 'getEvents')
      .mockResolvedValueOnce([event])
      .mockRejectedValueOnce(new SpaceCalendarError('Public calendar unavailable', 'provider_unavailable', 503));

    await client.queryAllCalendarEvents({ after: '2026-10-08T00:00:00Z', before: '2026-10-09T00:00:00Z' });

    const refreshed = await client.queryAllCalendarEvents({ after: '2026-10-08T00:00:00Z', before: '2026-10-09T00:00:00Z' });

    expect(refreshed).toContainEqual(expect.objectContaining({ id: EVENT_ID, accountId: 'acct-1' }));
    expect(getEvents).toHaveBeenCalledTimes(2);
  });

  it('marks a partial public-source response stale and retains its complete cache', async () => {
    const client = makeClient();
    const adapter = adapterOf(client);
    vi.spyOn(adapter, 'getEvents')
      .mockResolvedValueOnce([event])
      .mockResolvedValueOnce([{ ...event, id: `${EVENT_ID}-partial` }]);
    vi.spyOn(adapter, 'isLastRefreshComplete').mockReturnValueOnce(true).mockReturnValueOnce(false);
    const range = ['2026-10-08T00:00:00Z', '2026-10-09T00:00:00Z'] as const;

    await client.getAtmoPublicCalendarEvents(...range);
    await expect(client.getAtmoPublicCalendarEvents(...range)).resolves.toContainEqual(expect.objectContaining({ id: EVENT_ID }));

    expect(client.getAtmoCalendarStale()).toBe(true);
  });

  it('retains only the last complete public range and clears it at disconnect', async () => {
    const client = makeClient();
    const adapter = adapterOf(client);
    const getEvents = vi.spyOn(adapter, 'getEvents')
      .mockResolvedValueOnce([event])
      .mockResolvedValueOnce([{ ...event, id: `${EVENT_ID}-next` }])
      .mockRejectedValueOnce(new SpaceCalendarError('Public calendar unavailable', 'provider_unavailable', 503))
      .mockRejectedValueOnce(new SpaceCalendarError('Public calendar unavailable', 'provider_unavailable', 503));
    vi.spyOn(adapter, 'isLastRefreshComplete').mockReturnValue(true);
    const first = ['2026-10-08T00:00:00Z', '2026-10-09T00:00:00Z'] as const;
    const next = ['2026-10-09T00:00:00Z', '2026-10-10T00:00:00Z'] as const;

    await client.getAtmoPublicCalendarEvents(...first);
    const latest = await client.getAtmoPublicCalendarEvents(...next);
    await expect(client.getAtmoPublicCalendarEvents(...first)).resolves.toEqual([]);
    expect(client.getAtmoCalendarStale()).toBe(true);
    client.disconnect();
    await expect(client.getAtmoPublicCalendarEvents(...next)).resolves.toEqual([]);
    expect(latest).toContainEqual(expect.objectContaining({ id: `${EVENT_ID}-next` }));
    expect(getEvents).toHaveBeenCalledTimes(4);
  });

  it('rejects public calendar destinations supplied as JMAP patch pointers', async () => {
    const client = makeClient();
    const request = (client as unknown as { request: ReturnType<typeof vi.fn> }).request;
    await expect(client.updateCalendarEvent('local-event', { [`calendarIds/${CALENDAR_ID}`]: true } as Partial<CalendarEvent>)).rejects.toThrow();
    expect(request).not.toHaveBeenCalled();
  });

  it('rejects public-source IDs and source records before any JMAP mutation request', async () => {
    const client = makeClient();
    const request = (client as unknown as { request: ReturnType<typeof vi.fn> }).request;
    const publicEvent = { ...event, source: 'atproto-public' } as CalendarEvent;
    const publicCalendar = { ...calendar, source: 'atproto-public' } as Calendar;

    await expect(client.createCalendarEvent(publicEvent)).rejects.toThrow();
    await expect(client.updateCalendarEvent(EVENT_ID, { title: 'changed' })).rejects.toThrow();
    await expect(client.deleteCalendarEvent(EVENT_ID)).rejects.toThrow();
    await expect(client.createCalendar(publicCalendar)).rejects.toThrow();
    await expect(client.updateCalendar(CALENDAR_ID, { name: 'changed' })).rejects.toThrow();
    await expect(client.deleteCalendar(CALENDAR_ID)).rejects.toThrow();
    await expect(client.setDefaultCalendar(CALENDAR_ID)).rejects.toThrow();

    expect(request).not.toHaveBeenCalled();
  });
});
