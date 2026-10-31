import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useCalendarStore } from '../calendar-store';
import type { IJMAPClient } from '@/lib/jmap/client-interface';
import type { Calendar, CalendarEvent } from '@/lib/jmap/types';
import { SpaceCalendarError } from '@/lib/jmap/space-calendar-adapter';

const calendar: Calendar = {
  id: 'space:cal_space1', originalId: 'cal_space1', source: 'atproto-space', spaceRole: 'editor',
  name: 'Project', description: null, color: null, sortOrder: 0, isSubscribed: false,
  isVisible: true, isDefault: false, includeInAvailability: 'none', defaultAlertsWithTime: null,
  defaultAlertsWithoutTime: null, timeZone: null, shareWith: null,
  myRights: { mayReadFreeBusy: false, mayReadItems: true, mayWriteAll: true, mayWriteOwn: false, mayUpdatePrivate: false, mayRSVP: true, mayShare: false, mayDelete: false },
};

const event: CalendarEvent = {
  id: 'space-event:event1', originalId: 'event1', source: 'atproto-space', spaceRevisionId: 'rev1',
  calendarIds: { [calendar.id]: true }, originalCalendarIds: { [calendar.originalId!]: true },
  isDraft: false, isOrigin: false, utcStart: null, utcEnd: null, '@type': 'Event', uid: 'uid1',
  title: 'Review', description: '', descriptionContentType: 'text/plain', created: null, updated: 'rev1', sequence: 0,
  start: '2026-10-08T10:00:00', duration: 'PT1H', timeZone: 'America/New_York', showWithoutTime: false,
  status: 'confirmed', freeBusyStatus: 'busy', privacy: 'public', color: null, keywords: null, categories: null,
  locale: null, replyTo: null, organizerCalendarAddress: null,
  participants: { 'did:plc:member': { '@type': 'Participant', name: 'did:plc:member', email: '', did: 'did:plc:member', isCurrentUser: true, calendarAddress: null, description: null, sendTo: null, kind: 'individual', roles: {}, participationStatus: 'needs-action', participationComment: null, expectReply: false, scheduleAgent: 'none', scheduleForceSend: false, scheduleId: null, scheduleSequence: 0, scheduleStatus: null, scheduleUpdated: null, invitedBy: null, delegatedTo: null, delegatedFrom: null, memberOf: null, locationId: null, language: null, links: null } },
  mayInviteSelf: false, mayInviteOthers: false, hideAttendees: false, recurrenceId: null, recurrenceIdTimeZone: null,
  recurrenceRules: null, recurrenceOverrides: null, excludedRecurrenceRules: null, useDefaultAlerts: false,
  alerts: null, locations: null, virtualLocations: null, links: null, relatedTo: null,
};

function client(overrides: Partial<Record<keyof IJMAPClient, unknown>> = {}): IJMAPClient & Record<string, ReturnType<typeof vi.fn>> {
  return {
    updateAtprotoSpaceCalendarEvent: vi.fn(),
    rsvpAtprotoSpaceCalendarEvent: vi.fn(),
    cancelAtprotoSpaceCalendarEvent: vi.fn(),
    createAtprotoSpaceCalendarEvent: vi.fn(),
    shareAtprotoSpaceCalendar: vi.fn(),
    getAtprotoSpaceCalendars: vi.fn().mockResolvedValue([calendar]),
    updateCalendarEvent: vi.fn(),
    deleteCalendarEvent: vi.fn(),
    createCalendarEvent: vi.fn(),
    setCalendarShare: vi.fn(),
    updateCalendar: vi.fn(),
    ...overrides,
  } as never;
}

beforeEach(() => {
  useCalendarStore.getState().clearState();
  useCalendarStore.setState({ calendars: [calendar], events: [event], error: null });
});

describe('calendar store Space mutations', () => {
  it('surfaces configured Space calendar failures during multi-account reads', async () => {
    const api = client({
      queryAllCalendarEvents: vi.fn().mockRejectedValue(new SpaceCalendarError('Unavailable', 'calendar_unavailable', 503)),
    });

    await useCalendarStore.getState().fetchAllAccountsEvents([{ client: api, localAccountId: 'local-2' }], '2026-10-01T00:00:00Z', '2026-10-31T00:00:00Z');

    expect(useCalendarStore.getState().error).toBe('Failed to load events');
    expect(useCalendarStore.getState().events).toEqual([event]);
  });

  it('surfaces configured Space calendar failures during multi-account calendar discovery', async () => {
    const api = client({
      getAllCalendarsWithFailures: vi.fn().mockRejectedValue(new SpaceCalendarError('Unavailable', 'calendar_unavailable', 503)),
    });

    await useCalendarStore.getState().fetchAllAccountsCalendars([{ client: api, localAccountId: 'local-2' }]);

    expect(useCalendarStore.getState().error).toBe('Failed to load calendars');
    expect(useCalendarStore.getState().calendars).toEqual([calendar]);
  });

  it('creates the existing Space event from the current calendar control and stores only the canonical result', async () => {
    const created = { ...event, spaceRevisionId: 'rev1' };
    const refreshed = { ...calendar, spaceInitialized: true, spaceRevisionId: 'rev1', myRights: {
      ...calendar.myRights, mayWriteOwn: false, mayWriteAll: true, mayShare: true, mayDelete: true,
    } };
    const api = client({
      createAtprotoSpaceCalendarEvent: vi.fn().mockResolvedValue(created),
      getAtprotoSpaceCalendars: vi.fn().mockResolvedValue([refreshed]),
    });

    const result = await useCalendarStore.getState().createEvent(api, {
      title: 'Review', start: event.start, timeZone: event.timeZone, duration: event.duration,
      calendarIds: { [calendar.id]: true },
    });

    expect(api.createAtprotoSpaceCalendarEvent).toHaveBeenCalledWith('cal_space1', expect.objectContaining({ title: 'Review' }), undefined);
    expect(api.createCalendarEvent).not.toHaveBeenCalled();
    expect(result).toMatchObject({ id: event.id, source: 'atproto-space', spaceRevisionId: 'rev1' });
    expect(useCalendarStore.getState().events).toContainEqual(expect.objectContaining({ id: event.id }));
    expect(useCalendarStore.getState().calendars[0]).toMatchObject({ spaceInitialized: true, myRights: { mayShare: true } });
  });

  it('records sharing only after the adapter confirms the active canonical member', async () => {
    const active = { ...calendar, shareWith: { 'did:plc:guest': {
      ...calendar.myRights, mayWriteAll: false, mayRSVP: false, mayShare: false, mayDelete: false,
    } } };
    const api = client({
      shareAtprotoSpaceCalendar: vi.fn().mockResolvedValue({ status: 'shared' }),
      getAtprotoSpaceCalendars: vi.fn().mockResolvedValue([active]),
    });

    await useCalendarStore.getState().shareCalendar(api, calendar.id, 'did:plc:guest', active.shareWith['did:plc:guest']);

    expect(api.shareAtprotoSpaceCalendar).toHaveBeenCalledWith('cal_space1', 'did:plc:guest', active.shareWith['did:plc:guest']);
    expect(api.setCalendarShare).not.toHaveBeenCalled();
    expect(useCalendarStore.getState().calendars[0].shareWith).toEqual(active.shareWith);
  });

  it('uses the canonical revision returned by each successful edit', async () => {
    const first = { ...event, title: 'First edit', spaceRevisionId: 'rev2' };
    const second = { ...first, description: 'Second edit', spaceRevisionId: 'rev3' };
    const api = client({
      updateAtprotoSpaceCalendarEvent: vi.fn()
        .mockResolvedValueOnce(first)
        .mockResolvedValueOnce(second),
    });

    await useCalendarStore.getState().updateEvent(api, event.id, { title: 'First edit' });
    await useCalendarStore.getState().updateEvent(api, event.id, { description: 'Second edit' });

    const updateCalls = (api.updateAtprotoSpaceCalendarEvent as ReturnType<typeof vi.fn>).mock.calls as unknown[][];
    expect(updateCalls.map(([, revision]) => revision)).toEqual(['rev1', 'rev2']);
    expect(useCalendarStore.getState().events[0]).toMatchObject({ title: 'First edit', description: 'Second edit', spaceRevisionId: 'rev3' });
    expect(api.updateCalendarEvent).not.toHaveBeenCalled();
  });

  it('preserves the store account namespace while applying the canonical response', async () => {
    const scopedEvent = {
      ...event,
      id: 'local-2::space-event:event1',
      localAccountId: 'local-2',
      calendarIds: { 'local-2::space:cal_space1': true },
    } as CalendarEvent;
    useCalendarStore.setState({ events: [scopedEvent] });
    const canonical = { ...event, title: 'Scoped edit', spaceRevisionId: 'rev2' };
    const api = client({ updateAtprotoSpaceCalendarEvent: vi.fn().mockResolvedValue(canonical) });

    await useCalendarStore.getState().updateEvent(api, scopedEvent.id, { title: 'Scoped edit' });

    expect(useCalendarStore.getState().events[0]).toMatchObject({
      id: scopedEvent.id, localAccountId: 'local-2', calendarIds: scopedEvent.calendarIds,
      title: 'Scoped edit', spaceRevisionId: 'rev2',
    });
  });

  it('omits unchanged calendar membership from Space patches but rejects moving the event', async () => {
    const updated = { ...event, title: 'Edited', spaceRevisionId: 'rev2' };
    const api = client({ updateAtprotoSpaceCalendarEvent: vi.fn().mockResolvedValue(updated) });

    await useCalendarStore.getState().updateEvent(api, event.id, {
      title: 'Edited', calendarIds: { [calendar.id]: true },
    });

    expect(api.updateAtprotoSpaceCalendarEvent).toHaveBeenCalledWith('event1', 'rev1', { title: 'Edited' });
    await expect(useCalendarStore.getState().updateEvent(api, event.id, {
      calendarIds: { 'space:other': true },
    })).rejects.toMatchObject({ code: 'unsupported_operation' });
    expect(api.updateCalendarEvent).not.toHaveBeenCalled();
    expect(api.updateAtprotoSpaceCalendarEvent).toHaveBeenCalledTimes(1);
  });

  it('omits unchanged UI metadata but rejects unsupported metadata changes', async () => {
    const updated = { ...event, title: 'Edited', spaceRevisionId: 'rev2' };
    const api = client({ updateAtprotoSpaceCalendarEvent: vi.fn().mockResolvedValue(updated) });

    await useCalendarStore.getState().updateEvent(api, event.id, {
      title: 'Edited', status: 'confirmed', privacy: 'public', freeBusyStatus: 'busy',
    });

    expect(api.updateAtprotoSpaceCalendarEvent).toHaveBeenCalledWith('event1', 'rev1', { title: 'Edited' });
    await expect(useCalendarStore.getState().updateEvent(api, event.id, {
      privacy: 'private',
    })).rejects.toMatchObject({ code: 'unsupported_operation' });
    expect(api.updateAtprotoSpaceCalendarEvent).toHaveBeenCalledTimes(1);
  });

  it('keeps canonical cancellation tombstones in the store', async () => {
    useCalendarStore.setState({ calendars: [{ ...calendar, spaceRole: 'owner', myRights: { ...calendar.myRights, mayDelete: true } }] });
    const cancelled = { ...event, status: 'cancelled' as const, spaceRevisionId: 'rev2', updated: 'rev2' };
    const api = client({ cancelAtprotoSpaceCalendarEvent: vi.fn().mockResolvedValue(cancelled) });

    await useCalendarStore.getState().deleteEvent(api, event.id);

    expect(useCalendarStore.getState().events[0]).toMatchObject({ status: 'cancelled', spaceRevisionId: 'rev2' });
    expect(api.deleteCalendarEvent).not.toHaveBeenCalled();
  });

  it('does not write unsupported create or sharing actions to JMAP', async () => {
    const unsupported = new SpaceCalendarError('Unsupported', 'unsupported_operation', 501);
    const api = client({
      createAtprotoSpaceCalendarEvent: vi.fn().mockRejectedValue(unsupported),
      shareAtprotoSpaceCalendar: vi.fn().mockRejectedValue(unsupported),
    });

    await expect(useCalendarStore.getState().createEvent(api, { calendarIds: { [calendar.id]: true } })).rejects.toBe(unsupported);
    await expect(useCalendarStore.getState().shareCalendar(api, calendar.id, 'did:plc:other', null)).rejects.toBe(unsupported);

    expect(api.createCalendarEvent).not.toHaveBeenCalled();
    expect(api.setCalendarShare).not.toHaveBeenCalled();
  });

  it('rejects unsupported recurrence occurrence commands before any JMAP or Space write', async () => {
    const occurrence = {
      ...event,
      id: 'space-event:event1-occurrence',
      originalId: 'event1-occurrence',
      baseEventId: 'event1',
      recurrenceId: '2026-10-08T10:00:00',
      recurrenceRules: [{ '@type': 'RecurrenceRule', frequency: 'daily', count: 3 }],
    } as CalendarEvent;
    useCalendarStore.setState({ events: [occurrence] });
    const api = client();

    await expect(useCalendarStore.getState().updateEvent(api, occurrence.id, { title: 'Occurrence only' }))
      .rejects.toMatchObject({ code: 'unsupported_operation' });
    await expect(useCalendarStore.getState().rsvpEvent(api, occurrence.id, 'did:plc:member', 'accepted', undefined, 'occurrence'))
      .rejects.toMatchObject({ code: 'unsupported_operation' });
    await expect(useCalendarStore.getState().deleteEvent(api, occurrence.id))
      .rejects.toMatchObject({ code: 'unsupported_operation' });

    expect(api.updateCalendarEvent).not.toHaveBeenCalled();
    expect(api.deleteCalendarEvent).not.toHaveBeenCalled();
    expect(api.updateAtprotoSpaceCalendarEvent).not.toHaveBeenCalled();
    expect(api.rsvpAtprotoSpaceCalendarEvent).not.toHaveBeenCalled();
    expect(api.cancelAtprotoSpaceCalendarEvent).not.toHaveBeenCalled();
  });

  it('routes a series RSVP from an expanded Space occurrence through the canonical event command', async () => {
    const occurrence = {
      ...event,
      id: 'space-event:event1-occurrence',
      originalId: 'event1-occurrence',
      baseEventId: 'event1',
      recurrenceId: '2026-10-08T10:00:00',
      recurrenceRules: [{ '@type': 'RecurrenceRule', frequency: 'daily', count: 3 }],
    } as CalendarEvent;
    useCalendarStore.setState({ events: [occurrence] });
    const canonical = { ...event, spaceRevisionId: 'rev2', participants: {
      ...event.participants,
      'did:plc:member': { ...event.participants!['did:plc:member'], participationStatus: 'accepted' as const },
    } };
    const api = client({ rsvpAtprotoSpaceCalendarEvent: vi.fn().mockResolvedValue(canonical) });

    await useCalendarStore.getState().rsvpEvent(api, occurrence.id, 'did:plc:member', 'accepted');

    expect(api.rsvpAtprotoSpaceCalendarEvent).toHaveBeenCalledWith('event1', 'rev1', 'accepted');
    expect(api.updateCalendarEvent).not.toHaveBeenCalled();
  });
});
