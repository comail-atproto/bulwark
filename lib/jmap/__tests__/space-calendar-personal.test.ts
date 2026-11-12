import { describe, expect, it, vi } from 'vitest';
import { SpaceCalendarAdapter } from '../space-calendar-adapter';

const revision = `personal-state-${'a'.repeat(64)}`;
const stamp = '2030-03-11T10:00:00';
const properties = { color: 'blue', keywords: { own: true }, freeBusyStatus: 'free', useDefaultAlerts: true, alerts: null };
const record = { id: 'event-one', uid: 'synthetic@example.test', calendarId: 'calendar-one', revisionId: 'shared-one', personalRevisionId: revision,
  title: 'Shared event', description: '', start: '2030-03-04T10:00:00', timeZone: 'UTC', duration: 'PT1H', showWithoutTime: false, status: 'confirmed',
  actorDID: 'did:plc:member', ownerDID: 'did:plc:owner', personalProperties: properties,
  recurrenceOverrides: { [stamp]: { title: 'Shared exception', color: 'red', freeBusyStatus: null, useDefaultAlerts: null } },
};

describe('Space actor-private calendar adapter', () => {
  it('uses qualified private rights independently of the shared viewer role and keeps actor properties', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ calendars: [
      { id: 'calendar-one', name: 'Shared calendar', source: 'atproto-space', myRole: 'viewer', initialized: true, mayUpdatePrivate: true },
    ] })).mockResolvedValueOnce(Response.json({ events: [record] }));
    const adapter = new SpaceCalendarAdapter(() => 1, fetcher);
    const [calendar] = await adapter.getCalendars();
    const [event] = await adapter.getEvents('2030-03-01T00:00:00Z', '2030-03-30T00:00:00Z');
    expect(calendar.myRights).toMatchObject({ mayUpdatePrivate: true, mayWriteAll: false, mayRSVP: false });
    expect(event).toMatchObject({ ...properties, spaceRevisionId: 'shared-one', spacePersonalRevisionId: revision });
    expect(event.recurrenceOverrides![stamp]).toMatchObject({ title: 'Shared exception', color: 'red', freeBusyStatus: 'busy', useDefaultAlerts: false });
    expect(record.recurrenceOverrides[stamp].freeBusyStatus).toBeNull();
  });

  it('retries the exact private command and rejects shared fields before fetching', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(new Response('', { status: 503 })).mockResolvedValueOnce(Response.json(record));
    const adapter = new SpaceCalendarAdapter(() => 2, fetcher);
    const saved = await adapter.updatePrivateEvent('event-one', revision, { color: 'red' }, stamp);
    expect(saved.spacePersonalRevisionId).toBe(revision);
    expect(fetcher.mock.calls).toHaveLength(2);
    expect(fetcher.mock.calls[0][0]).toBe('/api/calendar/events/event-one/personal?slot=2');
    expect(fetcher.mock.calls[0][1]!.body).toBe(fetcher.mock.calls[1][1]!.body);
    expect(JSON.parse(fetcher.mock.calls[0][1]!.body as string)).toMatchObject({ basePersonalRevision: revision, patch: { color: 'red' }, recurrenceId: stamp });
    fetcher.mockClear();
    await expect(adapter.updatePrivateEvent('event-one', revision, { color: 'red', title: 'Shared' } as never)).rejects.toMatchObject({ code: 'unsupported_operation' });
    await expect(adapter.updatePrivateEvent('event-one', 'shared-one', { color: 'red' })).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(adapter.updateEvent('event-one', 'shared-one', { recurrenceOverrides: saved.recurrenceOverrides })).rejects.toMatchObject({ code: 'unsupported_operation' });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('omits empty optional reminder properties without changing the editor input or acknowledgements', async () => {
    const alerts = {
      newReminder: { '@type': 'Alert', trigger: { '@type': 'OffsetTrigger', offset: '-PT10M', relativeTo: 'start' },
        action: 'display', acknowledged: null, relatedTo: null },
      acknowledgedReminder: { '@type': 'Alert', trigger: { '@type': 'OffsetTrigger', offset: '-PT30M', relativeTo: 'end' },
        action: 'display', acknowledged: '2030-03-01T09:00:00Z', relatedTo: { previous: { relation: { snoozed: true } } } },
    };
    const fetcher = vi.fn().mockResolvedValue(Response.json(record));
    await new SpaceCalendarAdapter(() => 1, fetcher).updatePrivateEvent(record.id, revision, { alerts } as never, stamp);
    const command = JSON.parse(fetcher.mock.calls[0][1]!.body as string);
    expect(command.patch.alerts.newReminder).toEqual({ '@type': 'Alert', trigger: alerts.newReminder.trigger, action: 'display' });
    expect(command.patch.alerts.acknowledgedReminder).toEqual(alerts.acknowledgedReminder);
    expect(alerts.newReminder).toHaveProperty('acknowledged', null);
    expect(alerts.newReminder).toHaveProperty('relatedTo', null);
  });

  it.each(['owner-personal', 'member-personal'])('starts %s through the existing actor-bound ticket route', async (profile) => {
    const ticket = `https://host.example.test/oauth/calendar/tickets/${'A'.repeat(43)}`;
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ error: 'authorization_required', authorizationProfile: profile }, { status: 409 }))
      .mockResolvedValueOnce(Response.json({ status: 'authorization_required', authorizationUrl: ticket }, { status: 202 }));
    const adapter = new SpaceCalendarAdapter(() => 1, fetcher);
    await expect(adapter.updatePrivateEvent('event-one', revision, { color: 'red' })).rejects.toMatchObject({ code: 'authorization_required', authorizationUrl: ticket, message: 'Calendar access needs authorization. Authorize access, return to this page, and retry.' });
    expect(fetcher.mock.calls[1][0]).toBe('/api/calendar/personal/start?slot=1');
    const start = JSON.parse(fetcher.mock.calls[1][1]!.body as string);
    expect(Object.keys(start)).toEqual(['requestId']);
  });

  it('rejects inconsistent private projections and uninitialized private rights', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ calendars: [
      { id: 'calendar-one', name: 'Shared calendar', source: 'atproto-space', myRole: 'viewer', initialized: false, mayUpdatePrivate: true },
    ] })).mockResolvedValueOnce(Response.json({ events: [{ ...record, personalRevisionId: 'shared-one' }] }));
    const adapter = new SpaceCalendarAdapter(() => 1, fetcher);
    await expect(adapter.getCalendars()).rejects.toMatchObject({ code: 'invalid_response' });
    await expect(adapter.getEvents('2030-03-01T00:00:00Z', '2030-03-30T00:00:00Z')).rejects.toMatchObject({ code: 'invalid_response' });
  });
});

describe('shared recurrence private-pointer rejection', () => {
  it('rejects private JSON pointer keys before any shared request', async () => {
    const fetcher = vi.fn();
    const adapter = new SpaceCalendarAdapter(() => 1, fetcher);
    await expect(adapter.updateEvent('event-one', 'shared-one', {
      recurrenceOverrides: { [stamp]: { 'alerts/opaque': null } },
    } as never)).rejects.toMatchObject({ code: 'unsupported_operation' });
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe('authoritative private projection metadata', () => {
  it('requests canonical timestamps and retains the exact shared overrides independently of private values', async () => {
    const shared = { [stamp]: { title: 'Shared exception' }, '2030-03-18T10:00:00': {} };
    const projected = { ...record, sharedRecurrenceOverrides: shared,
      recurrenceOverrides: { ...record.recurrenceOverrides, '2030-03-25T10:00:00': { color: 'purple' }, '2030-03-18T10:00:00': { color: 'orange' } } };
    const metadata = { created: '2030-03-01T09:00:00Z', updated: '2030-03-03T09:00:00Z', sequence: 4 };
    const fetcher = vi.fn().mockResolvedValue(Response.json({ events: [projected], metadata: { [record.id]: metadata } }));
    const [event] = await new SpaceCalendarAdapter(() => 1, fetcher).getEvents('2030-03-01T00:00:00Z', '2030-03-30T00:00:00Z');
    expect(new URL(fetcher.mock.calls[0][0], 'https://comail.test').searchParams.get('includeMetadata')).toBe('true');
    expect(event).toMatchObject(metadata);
    expect(event).toHaveProperty('spaceSharedRecurrenceOverrides', shared);
    expect(event.recurrenceOverrides!['2030-03-25T10:00:00']).toEqual({ color: 'purple' });
    expect(shared).not.toHaveProperty('2030-03-25T10:00:00');
  });

  it.each([{ updated: 'shared-one' }, { sequence: -1 }, { sequence: Number.MAX_SAFE_INTEGER + 1 }])('rejects malformed metadata %s', async invalid => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ events: [record], metadata: { [record.id]: { sequence: 0, ...invalid } } }));
    await expect(new SpaceCalendarAdapter(() => 1, fetcher).getEvents('2030-03-01T00:00:00Z', '2030-03-30T00:00:00Z'))
      .rejects.toMatchObject({ code: 'invalid_response' });
  });

  it('rejects private fields in the authoritative shared snapshot', async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ ...record, sharedRecurrenceOverrides: { [stamp]: { color: 'red' } } }));
    await expect(new SpaceCalendarAdapter(() => 1, fetcher).updatePrivateEvent(record.id, revision, { color: 'red' }))
      .rejects.toMatchObject({ code: 'invalid_response' });
  });
});
