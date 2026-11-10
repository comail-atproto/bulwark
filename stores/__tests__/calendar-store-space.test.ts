import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useCalendarStore } from '../calendar-store';
import type { IJMAPClient } from '@/lib/jmap/client-interface';
import type { Calendar, CalendarEvent } from '@/lib/jmap/types';
import { SpaceCalendarError } from '@/lib/jmap/space-calendar-adapter';
import { createRecurrenceRule } from '@/lib/recurrence-rule';
import { setClientLookup } from '../client-registry';

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
    updateAtprotoSpaceCalendarPrivateEvent: vi.fn(),
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
  setClientLookup(() => undefined);
  useCalendarStore.getState().clearState();
  useCalendarStore.setState({ calendars: [calendar], events: [event], error: null });
});

describe('calendar store Space mutations', () => {
  it('rejects file imports into a Space calendar before making JMAP calls', async () => {
    const api = client({ getCalendarEvents: vi.fn().mockResolvedValue([]), batchCreateCalendarEvents: vi.fn() });
    await expect(useCalendarStore.getState().importEvents(api, [event], calendar.id))
      .rejects.toMatchObject({ code: 'unsupported_operation' });
    expect(api.getCalendarEvents).not.toHaveBeenCalled();
    expect(api.batchCreateCalendarEvents).not.toHaveBeenCalled();
  });

  it.each(['server', 'browser', 'extra'])('routes %s occurrence RSVP through the original Space recurrence key', async (kind) => {
    const stamp = '2026-10-08T10:00:00';
    const occurrence: CalendarEvent = { ...event, id: kind === 'server' ? 'space-event:server-occ' : `space-event:event1:${stamp}`,
      originalId: kind === 'server' ? 'server-occ' : 'event1', baseEventId: 'event1', recurrenceId: stamp,
      title: 'Moved', start: '2026-10-10T12:00:00', recurrenceRules: kind === 'extra' ? null : [createRecurrenceRule('daily', { count: 3 })],
      recurrenceOverrides: { [stamp]: { title: 'Moved', start: '2026-10-10T12:00:00' }, '2026-10-09T10:00:00': { title: 'Other' } } };
    occurrence.participants = { ...event.participants, 'did:plc:owner': {
      ...event.participants!['did:plc:member'], did: 'did:plc:owner', isCurrentUser: false, participationStatus: 'tentative',
    } };
    const sibling = { ...occurrence, id: 'space-event:sibling', originalId: 'sibling', recurrenceId: '2026-10-09T10:00:00', title: 'Other' };
    const foreign = { ...sibling, id: 'local_other:space-event:sibling', localAccountId: 'other' };
    useCalendarStore.setState({ events: [occurrence, sibling, foreign] });
    const overrides = { ...occurrence.recurrenceOverrides, [stamp]: { ...occurrence.recurrenceOverrides![stamp],
      participants: { 'did:plc:member': { ...event.participants!['did:plc:member'], participationStatus: 'declined' as const } } } };
    const api = client({ rsvpAtprotoSpaceCalendarEvent: vi.fn().mockResolvedValue({ ...event, spaceRevisionId: 'rev2', recurrenceOverrides: overrides }) });
    await useCalendarStore.getState().rsvpEvent(api, occurrence.id, 'did:plc:member', 'declined', undefined, 'occurrence');
    expect(api.rsvpAtprotoSpaceCalendarEvent).toHaveBeenCalledWith('event1', 'rev1', 'declined', stamp);
    expect(api.updateCalendarEvent).not.toHaveBeenCalled();
    expect(api.updateAtprotoSpaceCalendarEvent).not.toHaveBeenCalled();
    const [answered, other, isolated] = useCalendarStore.getState().events;
    expect(answered).toMatchObject({ title: 'Moved', start: occurrence.start, recurrenceId: stamp, spaceRevisionId: 'rev2' });
    expect(answered.participants!['did:plc:member'].participationStatus).toBe('declined');
    expect(answered.participants!['did:plc:owner'].participationStatus).toBe('tentative');
    expect(other).toMatchObject({ title: 'Other', spaceRevisionId: 'rev2', recurrenceOverrides: overrides });
    expect(other.participants!['did:plc:member'].participationStatus).toBe('needs-action');
    expect(isolated).toEqual(foreign);
  });

  it.each(['revision', 'history', 'adapter', 'foreign'])('rejects occurrence RSVP with missing %s authority before any write', async (missing) => {
    const occurrence = { ...event, id: 'space-event:server-occ', originalId: 'server-occ',
      recurrenceId: event.start, baseEventId: 'event1', recurrenceRules: [createRecurrenceRule('daily', { count: 3 })], recurrenceOverrides: {} };
    const api = client();
    if (missing === 'revision') occurrence.spaceRevisionId = undefined;
    if (missing === 'history') Reflect.deleteProperty(occurrence, 'recurrenceOverrides');
    if (missing === 'adapter') Reflect.deleteProperty(api, 'rsvpAtprotoSpaceCalendarEvent');
    useCalendarStore.setState({ events: [occurrence] });
    await expect(useCalendarStore.getState().rsvpEvent(api, occurrence.id, missing === 'foreign' ? 'did:plc:owner' : 'did:plc:member', 'declined', undefined, 'occurrence')).rejects.toMatchObject({ code: missing === 'foreign' ? 'unauthorized' : 'invalid_response' });
    expect(api.updateCalendarEvent).not.toHaveBeenCalled();
    if (api.rsvpAtprotoSpaceCalendarEvent) expect(api.rsvpAtprotoSpaceCalendarEvent).not.toHaveBeenCalled();
  });

  it('retains occurrence response and history when its canonical write fails', async () => {
    const occurrence = { ...event, id: 'space-event:server-occ', originalId: 'server-occ',
      recurrenceId: event.start, baseEventId: 'event1', recurrenceRules: [createRecurrenceRule('daily', { count: 3 })], recurrenceOverrides: {} };
    useCalendarStore.setState({ events: [occurrence] });
    const lost = new SpaceCalendarError('Lost provider reply', 'calendar_unavailable', 503);
    const api = client({ rsvpAtprotoSpaceCalendarEvent: vi.fn().mockRejectedValue(lost) });
    await expect(useCalendarStore.getState().rsvpEvent(api, occurrence.id, 'did:plc:member', 'declined', undefined, 'occurrence')).rejects.toBe(lost);
    expect(useCalendarStore.getState().events).toEqual([occurrence]);
    expect(api.updateCalendarEvent).not.toHaveBeenCalled();
  });

  it('retains occurrence state when the canonical reply does not confirm its actor response', async () => {
    const occurrence = { ...event, id: 'space-event:server-occ', originalId: 'server-occ',
      recurrenceId: event.start, baseEventId: 'event1', recurrenceRules: [createRecurrenceRule('daily', { count: 3 })], recurrenceOverrides: {} };
    useCalendarStore.setState({ events: [occurrence] });
    const api = client({ rsvpAtprotoSpaceCalendarEvent: vi.fn().mockResolvedValue({ ...event, spaceRevisionId: 'rev2' }) });
    await expect(useCalendarStore.getState().rsvpEvent(api, occurrence.id, 'did:plc:member', 'declined', undefined, 'occurrence'))
      .rejects.toMatchObject({ code: 'invalid_response' });
    expect(useCalendarStore.getState().events).toEqual([occurrence]);
    expect(api.updateCalendarEvent).not.toHaveBeenCalled();
  });

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

  it.each(['server', 'browser', 'extra'] as const)('writes one %s Space occurrence without changing the base event', async (mode) => {
    const occurrence: CalendarEvent = { ...event,
      id: mode === 'server' ? 'space-event:event1-occurrence' : 'space-event:event1:2026-10-08T10:00:00',
      originalId: mode === 'server' ? 'event1-occurrence' : 'event1',
      baseEventId: mode === 'server' ? 'event1' : null, recurrenceId: '2026-10-08T10:00:00',
      recurrenceRules: mode === 'extra' ? null : [createRecurrenceRule('daily', { count: 3 })],
      recurrenceOverrides: { '2026-10-09T10:00:00': { title: 'Another exception' } },
    };
    const overrides = { ...occurrence.recurrenceOverrides, '2026-10-08T10:00:00': {
      title: 'Occurrence only', start: occurrence.start, duration: occurrence.duration,
    } };
    useCalendarStore.setState({ events: [occurrence] });
    const api = client({ updateAtprotoSpaceCalendarEvent: vi.fn().mockResolvedValue({ ...event, spaceRevisionId: 'rev2', recurrenceOverrides: overrides }) });
    await useCalendarStore.getState().updateEvent(api, occurrence.id, { title: 'Occurrence only' });
    expect(api.updateAtprotoSpaceCalendarEvent).toHaveBeenCalledWith('event1', 'rev1', { recurrenceOverrides: overrides });
    expect(api.updateCalendarEvent).not.toHaveBeenCalled();
    expect(useCalendarStore.getState().events[0]).toMatchObject({ id: occurrence.id, title: 'Occurrence only', recurrenceId: occurrence.recurrenceId, spaceRevisionId: 'rev2' });
  });

  it.each(['server', 'browser', 'extra'] as const)('excludes one %s Space occurrence and retains other exceptions', async (mode) => {
    const stamp = '2026-10-08T10:00:00';
    const occurrence: CalendarEvent = { ...event,
      id: mode === 'server' ? 'space-event:instance' : `space-event:event1:${stamp}`,
      originalId: mode === 'server' ? 'instance' : 'event1',
      baseEventId: mode === 'server' ? 'event1' : null, recurrenceId: stamp,
      start: '2026-10-10T12:00:00',
      recurrenceRules: mode === 'extra' ? null : [createRecurrenceRule('daily', { count: 3 })],
      recurrenceOverrides: { [stamp]: { title: 'Moved occurrence', start: '2026-10-10T12:00:00' },
        '2026-10-09T10:00:00': { title: 'Other exception' } },
    };
    const sibling = { ...occurrence, id: 'space-event:other', recurrenceId: '2026-10-09T10:00:00', title: 'Other exception' };
    const foreign = { ...sibling, id: 'other-account::space-event:other', localAccountId: 'other-account' };
    useCalendarStore.setState({ calendars: [{ ...calendar, spaceRole: 'owner' }], events: [occurrence, sibling, foreign] });
    const overrides = { ...occurrence.recurrenceOverrides,
      [stamp]: { ...occurrence.recurrenceOverrides![stamp], excluded: true } };
    const api = client({ updateAtprotoSpaceCalendarEvent: vi.fn().mockResolvedValue({ ...event,
      spaceRevisionId: 'rev2', recurrenceOverrides: overrides }) });

    await useCalendarStore.getState().deleteEvent(api, occurrence.id, true);

    expect(api.updateAtprotoSpaceCalendarEvent).toHaveBeenCalledWith('event1', 'rev1', { recurrenceOverrides: overrides });
    expect(api.cancelAtprotoSpaceCalendarEvent).not.toHaveBeenCalled();
    expect(api.deleteCalendarEvent).not.toHaveBeenCalled();
    expect(api.updateCalendarEvent).not.toHaveBeenCalled();
    expect(useCalendarStore.getState().events.map(e => e.id)).toEqual([sibling.id, foreign.id]);
    expect(useCalendarStore.getState().events[0]).toMatchObject({ title: sibling.title, spaceRevisionId: 'rev2', recurrenceOverrides: overrides });
    expect(useCalendarStore.getState().events[1]).toEqual(foreign);
  });

  it.each(['revision', 'history', 'adapter'] as const)('rejects a Space occurrence with missing %s before cancellation', async (missing) => {
    const occurrence: CalendarEvent = { ...event, id: 'space-event:instance', originalId: 'instance', baseEventId: 'event1',
      recurrenceId: event.start, recurrenceRules: [createRecurrenceRule('daily', { count: 3 })], recurrenceOverrides: {} };
    if (missing === 'revision') occurrence.spaceRevisionId = undefined;
    if (missing === 'history') Reflect.deleteProperty(occurrence, 'recurrenceOverrides');
    useCalendarStore.setState({ calendars: [{ ...calendar, spaceRole: 'owner' }], events: [occurrence] });
    const api = client(missing === 'adapter' ? { updateAtprotoSpaceCalendarEvent: undefined } : {});
    await expect(useCalendarStore.getState().deleteEvent(api, occurrence.id)).rejects.toMatchObject({ code: 'invalid_response' });
    expect(api.deleteCalendarEvent).not.toHaveBeenCalled();
    expect(api.cancelAtprotoSpaceCalendarEvent).not.toHaveBeenCalled();
    expect(useCalendarStore.getState().events).toEqual([occurrence]);
  });

  it('does not remove a Space occurrence when its canonical exclusion fails', async () => {
    const occurrence: CalendarEvent = { ...event, id: 'space-event:instance', originalId: 'instance', baseEventId: 'event1',
      recurrenceId: event.start, recurrenceRules: [createRecurrenceRule('daily', { count: 3 })], recurrenceOverrides: {} };
    useCalendarStore.setState({ calendars: [{ ...calendar, spaceRole: 'owner' }], events: [occurrence] });
    const lost = new SpaceCalendarError('Lost provider reply', 'calendar_unavailable', 503);
    const api = client({ updateAtprotoSpaceCalendarEvent: vi.fn().mockRejectedValue(lost) });
    await expect(useCalendarStore.getState().deleteEvent(api, occurrence.id)).rejects.toBe(lost);
    expect(useCalendarStore.getState().events).toEqual([occurrence]);
    expect(api.cancelAtprotoSpaceCalendarEvent).not.toHaveBeenCalled();
    expect(api.deleteCalendarEvent).not.toHaveBeenCalled();
  });

  it('rejects non-owner occurrence cancellation before any write', async () => {
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

describe('Space actor-private event saves', () => {
  const privateRevision = `personal-state-${'a'.repeat(64)}`;
  const nextPrivateRevision = `personal-state-${'b'.repeat(64)}`;
  const privateEvent = { ...event, spacePersonalRevisionId: privateRevision };
  const privateCalendar = { ...calendar, spaceRole: 'viewer' as const,
    myRights: { ...calendar.myRights, mayWriteAll: false, mayRSVP: false, mayUpdatePrivate: true } };

  beforeEach(() => useCalendarStore.setState({ calendars: [privateCalendar], events: [privateEvent] }));

  it('saves a viewer’s own private values from the unchanged shared form without shared writes', async () => {
    const api = client({ updateAtprotoSpaceCalendarPrivateEvent: vi.fn().mockResolvedValue({
      ...privateEvent, color: '#123456', freeBusyStatus: 'free', spacePersonalRevisionId: nextPrivateRevision,
    }) });
    await useCalendarStore.getState().updateEvent(api, event.id, {
      title: event.title, description: event.description, start: event.start, duration: event.duration,
      timeZone: event.timeZone, showWithoutTime: event.showWithoutTime,
      calendarIds: event.calendarIds, status: event.status, privacy: event.privacy,
      color: '#123456', freeBusyStatus: 'free',
    }, true);
    expect(api.updateAtprotoSpaceCalendarPrivateEvent).toHaveBeenCalledWith('event1', privateRevision, {
      color: '#123456', freeBusyStatus: 'free',
    }, undefined);
    expect(api.updateAtprotoSpaceCalendarEvent).not.toHaveBeenCalled();
    expect(api.updateCalendarEvent).not.toHaveBeenCalled();
    expect(useCalendarStore.getState().events[0]).toMatchObject({
      title: event.title, start: event.start, sequence: event.sequence, spaceRevisionId: 'rev1',
      color: '#123456', freeBusyStatus: 'free', spacePersonalRevisionId: nextPrivateRevision,
    });
  });

  it.each(['mixed', 'rights', 'missing-calendar', 'revision', 'adapter'])('rejects %s private saves before either audience writes', async (missing) => {
    const api = client();
    const patch: Partial<CalendarEvent> = { color: '#123456' };
    if (missing === 'mixed') patch.title = 'Shared change';
    if (missing === 'rights') useCalendarStore.setState({ calendars: [calendar] });
    if (missing === 'missing-calendar') useCalendarStore.setState({ calendars: [] });
    if (missing === 'revision') useCalendarStore.setState({ events: [event] });
    const privateWrite = api.updateAtprotoSpaceCalendarPrivateEvent;
    if (missing === 'adapter') Reflect.deleteProperty(api, 'updateAtprotoSpaceCalendarPrivateEvent');
    await expect(useCalendarStore.getState().updateEvent(api, event.id, patch)).rejects.toBeInstanceOf(SpaceCalendarError);
    expect(api.updateAtprotoSpaceCalendarEvent).not.toHaveBeenCalled();
    expect(privateWrite).not.toHaveBeenCalled();
    expect(api.updateCalendarEvent).not.toHaveBeenCalled();
  });

  it('routes private values to the owning account and keeps its store namespace', async () => {
    const scopedCalendar = { ...privateCalendar, id: `local-2::${calendar.id}`, localAccountId: 'local-2' };
    const scopedEvent = { ...privateEvent, id: `local-2::${event.id}`, localAccountId: 'local-2', calendarIds: { [scopedCalendar.id]: true } };
    useCalendarStore.setState({ calendars: [scopedCalendar], events: [scopedEvent] });
    const active = client();
    const owner = client({ updateAtprotoSpaceCalendarPrivateEvent: vi.fn().mockResolvedValue({
      ...privateEvent, color: '#123456', spacePersonalRevisionId: nextPrivateRevision,
    }) });
    setClientLookup(id => id === 'local-2' ? owner : undefined);
    await useCalendarStore.getState().updateEvent(active, scopedEvent.id, { color: '#123456' });
    expect(active.updateAtprotoSpaceCalendarPrivateEvent).not.toHaveBeenCalled();
    expect(owner.updateAtprotoSpaceCalendarPrivateEvent).toHaveBeenCalledWith('event1', privateRevision, { color: '#123456' }, undefined);
    expect(useCalendarStore.getState().events[0]).toMatchObject({ id: scopedEvent.id, localAccountId: 'local-2', calendarIds: scopedEvent.calendarIds, color: '#123456' });
  });

  it.each(['server', 'browser'])('saves a moved %s occurrence using its original key without replacing shared details', async kind => {
    const stamp = event.start;
    const otherStamp = '2026-10-09T10:00:00';
    const overrides = { [stamp]: { title: 'Moved', start: '2026-10-10T12:00:00', color: '#123456' } };
    const occurrence = { ...privateEvent, id: kind === 'server' ? 'space-event:server-occ' : `space-event:event1:${stamp}`,
      originalId: kind === 'server' ? 'server-occ' : 'event1', baseEventId: 'event1', recurrenceId: stamp,
      title: 'Moved', start: '2026-10-10T12:00:00', recurrenceRules: [createRecurrenceRule('daily', { count: 3 })], recurrenceOverrides: {} };
    const sibling = { ...occurrence, id: 'space-event:sibling', originalId: 'sibling', recurrenceId: otherStamp, title: 'Other', start: otherStamp };
    const foreign = { ...sibling, id: 'foreign::space-event:sibling', localAccountId: 'foreign' };
    useCalendarStore.setState({ events: [occurrence, sibling, foreign] });
    const api = client({ updateAtprotoSpaceCalendarPrivateEvent: vi.fn().mockResolvedValue({
      ...privateEvent, color: '#abcdef', spacePersonalRevisionId: nextPrivateRevision, recurrenceOverrides: overrides,
    }) });
    await useCalendarStore.getState().updateEvent(api, occurrence.id, { color: '#123456' });
    expect(api.updateAtprotoSpaceCalendarPrivateEvent).toHaveBeenCalledWith('event1', privateRevision, { color: '#123456' }, stamp);
    const [updated, other, isolated] = useCalendarStore.getState().events;
    expect(updated).toMatchObject({ id: occurrence.id, title: 'Moved', start: occurrence.start, recurrenceId: stamp, color: '#123456', spacePersonalRevisionId: nextPrivateRevision, spaceRevisionId: 'rev1' });
    expect(other).toMatchObject({ title: 'Other', start: otherStamp, color: '#abcdef', spacePersonalRevisionId: nextPrivateRevision });
    expect(isolated).toEqual(foreign);
    expect(api.updateAtprotoSpaceCalendarEvent).not.toHaveBeenCalled();
  });

  it('does not write an unchanged private form or change store data on a failed private save', async () => {
    const api = client({ updateAtprotoSpaceCalendarPrivateEvent: vi.fn().mockRejectedValue(new SpaceCalendarError('Lost response', 'calendar_unavailable', 503)) });
    await useCalendarStore.getState().updateEvent(api, event.id, { title: event.title, color: null });
    expect(api.updateAtprotoSpaceCalendarPrivateEvent).not.toHaveBeenCalled();
    expect(api.updateAtprotoSpaceCalendarEvent).not.toHaveBeenCalled();
    await expect(useCalendarStore.getState().updateEvent(api, event.id, { color: '#123456' })).rejects.toMatchObject({ code: 'calendar_unavailable' });
    expect(useCalendarStore.getState().events).toEqual([privateEvent]);
  });

  it.each(['edit', 'cancel'])('keeps all projected private occurrence properties out of shared %s history', async action => {
    const stamp = event.start;
    const other = '2026-10-09T10:00:00';
    const projected = { [stamp]: { title: 'Moved', color: '#123456', alerts: null, useDefaultAlerts: false },
      [other]: { title: 'Other', keywords: { secret: true }, freeBusyStatus: 'free' as const } };
    const shared = { [stamp]: action === 'edit' ? { title: 'Edited', start: event.start, duration: event.duration } : { title: 'Moved', excluded: true }, [other]: { title: 'Other' } };
    const occurrence = { ...privateEvent, id: 'space-event:instance', originalId: 'instance', baseEventId: 'event1', recurrenceId: stamp,
      title: 'Moved', recurrenceRules: [createRecurrenceRule('daily', { count: 3 })], recurrenceOverrides: projected,
      spaceSharedRecurrenceOverrides: { [stamp]: { title: 'Moved' }, [other]: { title: 'Other' } } };
    useCalendarStore.setState({ calendars: [{ ...calendar, spaceRole: 'owner' }], events: [occurrence] });
    const api = client({ updateAtprotoSpaceCalendarEvent: vi.fn().mockResolvedValue({ ...event, spaceRevisionId: 'rev2', recurrenceOverrides: shared }) });
    if (action === 'edit') await useCalendarStore.getState().updateEvent(api, occurrence.id, { title: 'Edited' });
    else await useCalendarStore.getState().deleteEvent(api, occurrence.id);
    expect(api.updateAtprotoSpaceCalendarEvent).toHaveBeenCalledWith('event1', 'rev1', { recurrenceOverrides: shared });
    expect(projected[stamp]).toHaveProperty('color', '#123456');
    expect(projected[other]).toHaveProperty('keywords', { secret: true });
    expect(api.updateAtprotoSpaceCalendarPrivateEvent).not.toHaveBeenCalled();
  });
});

describe('Space private override audience boundaries', () => {
  it('rejects changed private override intent rather than silently discarding it during a shared save', async () => {
    const api = client();
    await expect(useCalendarStore.getState().updateEvent(api, event.id, {
      title: 'Shared edit', recurrenceOverrides: { [event.start]: { color: 'red' } },
    })).rejects.toMatchObject({ code: 'mixed_audiences' });
    expect(api.updateAtprotoSpaceCalendarEvent).not.toHaveBeenCalled();
    expect(api.updateAtprotoSpaceCalendarPrivateEvent).not.toHaveBeenCalled();
  });
});

describe('authoritative shared occurrence history', () => {
  it('removes private-only series exceptions when the shared snapshot is explicitly null', async () => {
    const projected = { [event.start]: { color: 'blue' } };
    const addedStamp = '2026-10-09T10:00:00';
    const privateEvent = { ...event, spacePersonalRevisionId: `personal-state-${'a'.repeat(64)}`,
      spaceSharedRecurrenceOverrides: null, recurrenceOverrides: projected };
    useCalendarStore.setState({ events: [privateEvent] });
    const api = client({ updateAtprotoSpaceCalendarEvent: vi.fn().mockResolvedValue(privateEvent) });
    await useCalendarStore.getState().updateEvent(api, event.id, { recurrenceOverrides: { ...projected, [addedStamp]: {} } });
    expect(api.updateAtprotoSpaceCalendarEvent).toHaveBeenCalledWith('event1', 'rev1', { recurrenceOverrides: { [addedStamp]: {} } });
  });

  it('keeps explicit shared exceptions while removing private-only projection entries from a series save', async () => {
    const sharedStamp = event.start;
    const privateStamp = '2026-10-09T10:00:00';
    const addedStamp = '2026-10-10T10:00:00';
    const shared = { [sharedStamp]: {} };
    const projected = { [sharedStamp]: { color: 'red' }, [privateStamp]: { color: 'blue' } };
    const privateEvent = { ...event, spacePersonalRevisionId: `personal-state-${'a'.repeat(64)}`,
      spaceSharedRecurrenceOverrides: shared, recurrenceOverrides: projected };
    useCalendarStore.setState({ events: [privateEvent] });
    const api = client({ updateAtprotoSpaceCalendarEvent: vi.fn().mockResolvedValue(privateEvent) });
    await useCalendarStore.getState().updateEvent(api, event.id, {
      recurrenceOverrides: { ...projected, [addedStamp]: {} },
    });
    expect(api.updateAtprotoSpaceCalendarEvent).toHaveBeenCalledWith('event1', 'rev1', {
      recurrenceOverrides: { ...shared, [addedStamp]: {} },
    });
    expect(projected[privateStamp]).toEqual({ color: 'blue' });
  });

  it.each(['edit', 'cancel'])('rejects %s when private history has no authoritative shared snapshot', async action => {
    const occurrence = { ...event, id: 'space-event:instance', originalId: 'instance', baseEventId: 'event1', recurrenceId: event.start,
      spacePersonalRevisionId: `personal-state-${'a'.repeat(64)}`,
      recurrenceRules: [createRecurrenceRule('daily', { count: 3 })], recurrenceOverrides: {} };
    useCalendarStore.setState({ events: [occurrence], calendars: [{ ...calendar, spaceRole: 'owner' }] });
    const api = client();
    const operation = action === 'edit'
      ? useCalendarStore.getState().updateEvent(api, occurrence.id, { title: 'Edited' })
      : useCalendarStore.getState().deleteEvent(api, occurrence.id);
    await expect(operation).rejects.toMatchObject({ code: 'invalid_response' });
    expect(api.updateAtprotoSpaceCalendarEvent).not.toHaveBeenCalled();
    expect(api.updateAtprotoSpaceCalendarPrivateEvent).not.toHaveBeenCalled();
  });

  it.each(['edit', 'cancel'])('preserves shared empty exceptions and excludes private-only exceptions during %s', async action => {
    const stamp = event.start;
    const emptySharedStamp = '2026-10-09T10:00:00';
    const privateOnlyStamp = '2026-10-10T10:00:00';
    const shared = { [stamp]: { title: 'Moved' }, [emptySharedStamp]: {} };
    const projected = { [stamp]: { title: 'Moved', color: 'red' }, [emptySharedStamp]: { color: 'blue' }, [privateOnlyStamp]: { color: 'green' } };
    const occurrence = { ...event, id: 'space-event:instance', originalId: 'instance', baseEventId: 'event1', recurrenceId: stamp, title: 'Moved',
      spacePersonalRevisionId: `personal-state-${'a'.repeat(64)}`, spaceSharedRecurrenceOverrides: shared,
      recurrenceRules: [createRecurrenceRule('daily', { count: 3 })], recurrenceOverrides: projected };
    const expected = { ...shared, [stamp]: action === 'edit' ? { title: 'Edited', start: event.start, duration: event.duration } : { title: 'Moved', excluded: true } };
    useCalendarStore.setState({ events: [occurrence], calendars: [{ ...calendar, spaceRole: 'owner' }] });
    const api = client({ updateAtprotoSpaceCalendarEvent: vi.fn().mockResolvedValue({ ...event, spaceRevisionId: 'rev2', recurrenceOverrides: expected }) });
    if (action === 'edit') await useCalendarStore.getState().updateEvent(api, occurrence.id, { title: 'Edited' });
    else await useCalendarStore.getState().deleteEvent(api, occurrence.id);
    expect(api.updateAtprotoSpaceCalendarEvent).toHaveBeenCalledWith('event1', 'rev1', { recurrenceOverrides: expected });
    expect(shared[emptySharedStamp]).toEqual({});
    expect(projected[privateOnlyStamp]).toEqual({ color: 'green' });
  });
});
