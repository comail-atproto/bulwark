import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useCalendarStore } from '../calendar-store';
import type { IJMAPClient } from '@/lib/jmap/client-interface';
import type { Calendar, CalendarEvent } from '@/lib/jmap/types';

const writable = { mayReadItems: true, mayWriteAll: true, mayWriteOwn: true, mayUpdatePrivate: true, mayRSVP: true, mayShare: true, mayDelete: true };
const calendar = { id: 'atmo:alice', source: 'atproto-public', name: 'Atmosphere', myRights: writable } as unknown as Calendar;
const event = { id: 'atmo:event', source: 'atproto-public', calendarIds: { [calendar.id]: true }, isOrigin: true,
  start: '2026-10-10T10:00:00', duration: 'PT1H', title: 'Public event', uid: 'public', '@type': 'Event' } as unknown as CalendarEvent;

function client() {
  const methods = ['createCalendarEvent', 'updateCalendarEvent', 'deleteCalendarEvent', 'setCalendarShare', 'updateCalendar',
    'setDefaultCalendar', 'deleteCalendar', 'getCalendarEvents', 'createCalendar', 'importCalendarEvents'];
  const spies = Object.fromEntries(methods.map(method => [method, vi.fn().mockResolvedValue([])]));
  return { api: spies as unknown as IJMAPClient, spies };
}

beforeEach(() => {
  useCalendarStore.getState().clearState();
  useCalendarStore.setState({ calendars: [calendar], events: [event] });
});

describe('public Atmosphere sources have no calendar write path', () => {
  it.each(['loaded', 'missing', 'namespaced', 'source-only'] as const)('rejects event mutations with %s identity', async mode => {
    let selected = event;
    if (mode === 'missing') useCalendarStore.setState({ calendars: [], events: [] });
    if (mode === 'namespaced') selected = { ...event, id: 'account::atmo:event', source: undefined, calendarIds: {} };
    if (mode === 'source-only') selected = { ...event, id: 'opaque', calendarIds: {} };
    if (mode === 'namespaced' || mode === 'source-only') useCalendarStore.setState({ calendars: [], events: [selected] });
    const { api, spies } = client();
    const store = useCalendarStore.getState();
    await expect(store.updateEvent(api, selected.id, { title: 'Changed' })).rejects.toMatchObject({ code: 'unsupported_operation' });
    await expect(store.deleteEvent(api, selected.id)).rejects.toMatchObject({ code: 'unsupported_operation' });
    await expect(store.rsvpEvent(api, selected.id, 'me', 'accepted')).rejects.toMatchObject({ code: 'unsupported_operation' });
    for (const spy of Object.values(spies)) expect(spy).not.toHaveBeenCalled();
  });

  it.each(['loaded', 'missing', 'namespaced', 'source-only'] as const)('rejects calendar mutations with %s identity', async mode => {
    const selected = mode === 'namespaced' ? { ...calendar, id: 'account::atmo:alice', source: undefined }
      : mode === 'source-only' ? { ...calendar, id: 'opaque' } : calendar;
    useCalendarStore.setState({ calendars: mode === 'missing' ? [] : [selected] });
    const { api, spies } = client();
    const store = useCalendarStore.getState();
    const actions = [() => store.updateCalendar(api, selected.id, { name: 'Changed' }), () => store.setDefaultCalendar(api, selected.id),
      () => store.shareCalendar(api, selected.id, 'other', null), () => store.removeCalendar(api, selected.id),
      () => store.clearCalendarEvents(api, selected.id), () => store.importEvents(api, [event], selected.id),
      () => store.createEvent(api, { title: 'New', calendarIds: { [selected.id]: true } })];
    for (const action of actions) await expect(action()).rejects.toMatchObject({ code: 'unsupported_operation' });
    for (const spy of Object.values(spies)) expect(spy).not.toHaveBeenCalled();
  });

  it('rejects moving a writable event into a public source', async () => {
    const local = { ...event, id: 'local', source: 'jmap', calendarIds: { local: true } } as CalendarEvent;
    useCalendarStore.setState({ events: [local] });
    const { api, spies } = client();
    await expect(useCalendarStore.getState().updateEvent(api, local.id, { calendarIds: { 'atmo:alice': true } })).rejects.toMatchObject({ code: 'unsupported_operation' });
    expect(spies.updateCalendarEvent).not.toHaveBeenCalled();
  });

  it('rejects importing public-source objects into a writable destination', async () => {
    const { api, spies } = client();
    await expect(useCalendarStore.getState().importEvents(api, [event], 'local')).rejects.toMatchObject({ code: 'unsupported_operation' });
    for (const spy of Object.values(spies)) expect(spy).not.toHaveBeenCalled();
  });

  it('rejects copying a public event into a writable calendar', async () => {
    const { api, spies } = client();
    await expect(useCalendarStore.getState().createEvent(api, { ...event, calendarIds: { local: true } })).rejects.toMatchObject({ code: 'unsupported_operation' });
    expect(spies.createCalendarEvent).not.toHaveBeenCalled();
  });

  it('shows the existing calendar error state when cached public events are stale', async () => {
    const { api } = client();
    Object.assign(api, {
      queryAllCalendarEvents: vi.fn().mockResolvedValue([event]),
      getAtmoCalendarStale: vi.fn().mockReturnValue(true),
    });

    await useCalendarStore.getState().fetchEvents(api, '2026-10-10T00:00:00Z', '2026-10-11T00:00:00Z');

    expect(useCalendarStore.getState().calendars).toContainEqual(expect.objectContaining({ id: calendar.id, atmoStale: true }));
    expect(useCalendarStore.getState().error).toBe('Some Atmosphere events may be missing or out of date.');
  });
});
