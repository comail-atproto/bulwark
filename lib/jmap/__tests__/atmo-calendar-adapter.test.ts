import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ATMOSPHERE_CALENDAR_COLOR, AtmoCalendarAdapter } from '../atmo-calendar-adapter';
import * as timezone from '@/lib/timezone';
const actorDid = 'did:plc:alice';
const catalog = (enabled = true) => ({ actorDid, state: `source-state-${'a'.repeat(64)}`, sources: [{ id: 'atmo', type: 'atproto-community-calendar', actorDid, includeHosted: true, statuses: ['going', 'interested'], enabled }] });
const record = { uri: `at://${actorDid}/community.lexicon.calendar.event/3m5nykt5d3k2k`, cid: 'bafysynthetic', rsvpCid: 'bafyrsvpsynthetic', creatorDid: actorDid, name: 'Atmosphere meetup', startsAt: '2026-11-01T01:30:00-04:00', endsAt: '2026-11-01T02:30:00-05:00', status: 'scheduled', attendance: 'going', atmoUrl: `https://atmo.rsvp/p/${actorDid}/e/3m5nykt5d3k2k` };
describe('native Atmo calendar adapter', () => {
  beforeEach(() => localStorage.clear());
  it('preserves the actor RSVP CID on the CalendarEvent used by public actions', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json(catalog())).mockResolvedValueOnce(Response.json({
      actorDid, after: '2026-10-01T00:00:00Z', before: '2026-12-01T00:00:00Z', complete: true, events: [record],
    }));
    const adapter = new AtmoCalendarAdapter(() => 1, fetcher);

    await adapter.getCalendars();
    const [event] = await adapter.getEvents('2026-10-01T00:00:00Z', '2026-12-01T00:00:00Z');

    expect(event).toMatchObject({ atprotoUri: record.uri, atprotoCid: record.cid, atmoRsvpCid: record.rsvpCid });
  });
  it('starts the browser overlay disabled and retains explicit opt-in across reloads', async () => {
    const fetcher = vi.fn().mockImplementation(async (input: string) => {
      const query = new URL(input, 'https://bulwark.test').searchParams;
      return Response.json(query.has('after')
        ? { actorDid, after: query.get('after'), before: query.get('before'), events: [record], complete: true }
        : { actorDid, preferenceStorage: 'browser' });
    });
    const adapter = new AtmoCalendarAdapter(() => 2, fetcher);
    expect((await adapter.getCalendars())[0]).toMatchObject({
      isVisible: false,
      spaceConsentRequired: false,
      color: ATMOSPHERE_CALENDAR_COLOR,
    });
    expect(await adapter.getEvents('2026-11-01T00:00:00Z', '2026-11-03T00:00:00Z')).toEqual([]);
    expect(fetcher).toHaveBeenCalledTimes(1);
    await adapter.setEnabled(true);
    const reloaded = new AtmoCalendarAdapter(() => 2, fetcher);
    expect((await reloaded.getCalendars())[0]).toMatchObject({ isVisible: true, myRights: { mayRSVP: false, mayWriteAll: false } });
    expect(await reloaded.getEvents('2026-11-01T00:00:00Z', '2026-11-03T00:00:00Z')).toHaveLength(1);
    expect(fetcher.mock.calls.at(-1)![0]).toContain('enabled=true');
    expect(fetcher.mock.calls.every(call => !call[1]?.method || call[1].method === 'GET')).toBe(true);
    await reloaded.setEnabled(false);
    expect((await new AtmoCalendarAdapter(() => 2, fetcher).getCalendars())[0].isVisible).toBe(false);
  });
  it('isolates browser preferences by actor and defers to newly available PDS preferences', async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ actorDid, preferenceStorage: 'browser' }));
    const adapter = new AtmoCalendarAdapter(() => 0, fetcher);
    await adapter.getCalendars();
    await adapter.setEnabled(true);
    fetcher.mockResolvedValue(Response.json({ actorDid: 'did:plc:bob', preferenceStorage: 'browser' }));
    expect((await adapter.getCalendars())[0].isVisible).toBe(false);
    fetcher.mockResolvedValue(Response.json(catalog(false)));
    expect((await adapter.getCalendars())[0]).toMatchObject({ isVisible: false, atmoSourceState: catalog().state });
    expect(await adapter.getEvents('2026-11-01T00:00:00Z', '2026-11-03T00:00:00Z')).toEqual([]);
  });
  it('does not carry an overlay opt-in across a cookie slot switch', async () => {
    let slot = 0;
    const fetcher = vi.fn().mockResolvedValue(Response.json({ actorDid, preferenceStorage: 'browser' }));
    const adapter = new AtmoCalendarAdapter(() => slot, fetcher);
    await adapter.getCalendars();
    slot = 1;
    await expect(adapter.setEnabled(true)).rejects.toMatchObject({ code: 'invalid_request' });
    expect(await adapter.getEvents('2026-11-01T00:00:00Z', '2026-11-03T00:00:00Z')).toEqual([]);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('retains an opted-in source after its catalog refresh fails', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ actorDid, preferenceStorage: 'browser' }));
    const adapter = new AtmoCalendarAdapter(() => 0, fetcher);
    await adapter.getCalendars();
    await adapter.setEnabled(true);
    fetcher.mockResolvedValueOnce(Response.json({ error: 'provider_unavailable' }, { status: 502 }));
    await expect(adapter.getCalendars()).rejects.toMatchObject({ code: 'provider_unavailable' });
    fetcher.mockResolvedValueOnce(Response.json({ actorDid, after: '2026-11-01T00:00:00Z', before: '2026-11-03T00:00:00Z', events: [record], complete: true }));
    expect(await adapter.getEvents('2026-11-01T00:00:00Z', '2026-11-03T00:00:00Z')).toHaveLength(1);
  });
  it('stays disabled when browser storage is unavailable and reports a failed opt-in', async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ actorDid, preferenceStorage: 'browser' }));
    const read = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('Storage denied'); });
    const write = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Storage denied'); });
    try {
      const adapter = new AtmoCalendarAdapter(() => 0, fetcher);
      expect((await adapter.getCalendars())[0].isVisible).toBe(false);
      await expect(adapter.setEnabled(true)).rejects.toMatchObject({ code: 'provider_unavailable' });
      expect(await adapter.getEvents('2026-11-01T00:00:00Z', '2026-11-03T00:00:00Z')).toEqual([]);
      expect(fetcher).toHaveBeenCalledTimes(1);
    } finally { read.mockRestore(); write.mockRestore(); }
  });
  it('uses the selected cookie slot and private source state', async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json(catalog(false)));
    const adapter = new AtmoCalendarAdapter(() => 2, fetcher);
    const calendars = await adapter.getCalendars();
    expect(fetcher.mock.calls[0][0]).toBe('/api/atmo-calendar?slot=2&local=1');
    expect(calendars[0]).toMatchObject({ id: `atmo:${actorDid}`, source: 'atproto-public', isVisible: false, myRights: { mayWriteAll: false, mayWriteOwn: false, mayRSVP: false } });
  });
  it('keeps original URI identity and real elapsed duration over a DST offset change', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json(catalog())).mockResolvedValueOnce(Response.json({ actorDid, after: '2026-11-01T00:00:00Z', before: '2026-11-03T00:00:00Z', events: [record], complete: true }));
    const adapter = new AtmoCalendarAdapter(() => 0, fetcher);
    await adapter.getCalendars();
    const [event] = await adapter.getEvents('2026-11-01T00:00:00Z', '2026-11-03T00:00:00Z');
    expect(event).toMatchObject({ id: `atmo:${record.uri}`, uid: record.uri, atprotoCid: record.cid, duration: 'PT7200S', utcStart: '2026-11-01T05:30:00.000Z', utcEnd: '2026-11-01T07:30:00.000Z', isOrigin: false, links: { atmo: { href: record.atmoUrl.replace(actorDid, encodeURIComponent(actorDid)) } } });
  });
  it('does not invent a source end time', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json(catalog())).mockResolvedValueOnce(Response.json({ actorDid, after: '2026-11-01T00:00:00Z', before: '2026-11-03T00:00:00Z', events: [{ ...record, endsAt: undefined }], complete: true }));
    const adapter = new AtmoCalendarAdapter(() => 0, fetcher);
    await adapter.getCalendars();
    expect((await adapter.getEvents('2026-11-01T00:00:00Z', '2026-11-03T00:00:00Z'))[0]).toMatchObject({ duration: 'PT0S', utcEnd: null, atmoEndUnspecified: true });
  });
  it('keeps valid third-party events when another third-party record is malformed', async () => {
    const otherDid = 'did:plc:bob';
    const otherRecord = { ...record, uri: `at://${otherDid}/community.lexicon.calendar.event/3m5nykt5d3k2k`, creatorDid: otherDid };
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json(catalog())).mockResolvedValueOnce(Response.json({
      actorDid,
      after: '2026-11-01T00:00:00Z',
      before: '2026-11-03T00:00:00Z',
      complete: true,
      events: [otherRecord, { uri: `at://${otherDid}/community.lexicon.calendar.event/3m5nykt5d3k2n`, creatorDid: otherDid }],
    }));
    const adapter = new AtmoCalendarAdapter(() => 0, fetcher);
    await adapter.getCalendars();
    await expect(adapter.getEvents('2026-11-01T00:00:00Z', '2026-11-03T00:00:00Z')).resolves.toHaveLength(1);
    expect(adapter.isLastRefreshComplete()).toBe(false);
  });
  it('fails closed when an actor-owned public record is malformed', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json(catalog())).mockResolvedValueOnce(Response.json({
      actorDid,
      after: '2026-11-01T00:00:00Z',
      before: '2026-11-03T00:00:00Z',
      complete: true,
      events: [{ uri: record.uri, creatorDid: actorDid }],
    }));
    const adapter = new AtmoCalendarAdapter(() => 0, fetcher);
    await adapter.getCalendars();
    await expect(adapter.getEvents('2026-11-01T00:00:00Z', '2026-11-03T00:00:00Z')).rejects.toMatchObject({ code: 'invalid_response' });
  });
  it('does not fetch events when private source is disabled', async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json(catalog(false)));
    const adapter = new AtmoCalendarAdapter(() => 0, fetcher);
    await adapter.getCalendars();
    expect(await adapter.getEvents('2026-11-01T00:00:00Z', '2026-11-03T00:00:00Z')).toEqual([]);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('keeps missing consent visible without starting OAuth from a read', async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ error: 'authorization_required', authorizationProfile: 'member-source', actorDid }, { status: 409 }));
    const adapter = new AtmoCalendarAdapter(() => 1, fetcher);
    expect((await adapter.getCalendars())[0]).toMatchObject({ source: 'atproto-public', spaceConsentRequired: true, isVisible: false });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('rejects incomplete refreshes and mismatched actor records', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json(catalog())).mockResolvedValueOnce(Response.json({ actorDid: 'did:plc:other', events: [], complete: true }));
    const adapter = new AtmoCalendarAdapter(() => 0, fetcher);
    await adapter.getCalendars();
    await expect(adapter.getEvents('2026-11-01T00:00:00Z', '2026-11-03T00:00:00Z')).rejects.toMatchObject({ code: 'invalid_response' });
  });
  it('converts wall-clock window boundaries with the selected display timezone', async () => {
    vi.spyOn(timezone, 'getEffectiveTimeZone').mockReturnValue('America/New_York');
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json(catalog())).mockImplementation(async (input: string) => {
      const query = new URL(input, 'https://bulwark.test').searchParams;
      return Response.json({ actorDid, after: query.get('after'), before: query.get('before'), events: [], complete: true });
    });
    const adapter = new AtmoCalendarAdapter(() => 0, fetcher);
    await adapter.getCalendars();
    await adapter.getEvents('2026-11-01T00:00:00', '2026-11-03T00:00:00');
    expect(fetcher.mock.calls[1][0]).toContain('after=2026-11-01T04%3A00%3A00.000Z');
    vi.restoreAllMocks();
  });
  it('accepts an exact retry whose current private state includes a later preference', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json(catalog())).mockRejectedValueOnce(new Error('lost reply')).mockResolvedValueOnce(Response.json(catalog(true)));
    const adapter = new AtmoCalendarAdapter(() => 1, fetcher);
    await adapter.getCalendars();
    await expect(adapter.setEnabled(false)).rejects.toThrow('lost reply');
    const current = await adapter.setEnabled(false);
    expect(fetcher.mock.calls[2][1].body).toBe(fetcher.mock.calls[1][1].body);
    expect(current.isVisible).toBe(true);
  });

  it.each(['removed', 'rebound'])('drops an unconfirmed command when its source is %s', async (change) => {
    const nextActor = change === 'rebound' ? 'did:plc:bob' : actorDid;
    const nextCatalog = { ...catalog(), actorDid: nextActor, state: `source-state-${'b'.repeat(64)}`, sources: [{ ...catalog().sources[0], actorDid: nextActor }] };
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json(catalog())).mockRejectedValueOnce(new Error('lost reply'));
    if (change === 'removed') fetcher.mockResolvedValueOnce(Response.json({}, { status: 404 }));
    fetcher.mockResolvedValueOnce(Response.json(nextCatalog)).mockResolvedValueOnce(Response.json({ ...nextCatalog, sources: [{ ...nextCatalog.sources[0], enabled: false }] }));
    const adapter = new AtmoCalendarAdapter(() => 1, fetcher);
    await adapter.getCalendars();
    await expect(adapter.setEnabled(false)).rejects.toThrow('lost reply');
    const oldCommand = JSON.parse(fetcher.mock.calls[1][1].body);
    if (change === 'removed') await adapter.getCalendars();
    await adapter.getCalendars();
    await adapter.setEnabled(false);
    const command = JSON.parse(fetcher.mock.calls.at(-1)![1].body);
    expect(command.baseState).toBe(nextCatalog.state);
    expect(command.requestId).not.toBe(oldCommand.requestId);
  });

  it('writes an enabled preference with the recovered private base, not to JMAP', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json(catalog())).mockResolvedValueOnce(Response.json(catalog(false)));
    const adapter = new AtmoCalendarAdapter(() => 1, fetcher);
    await adapter.getCalendars();
    await adapter.setEnabled(false);
    expect(fetcher.mock.calls[1][0]).toBe('/api/calendar/sources/atmo?slot=1');
    expect(JSON.parse(fetcher.mock.calls[1][1].body)).toMatchObject({ baseState: catalog().state, enabled: false });
  });
});
