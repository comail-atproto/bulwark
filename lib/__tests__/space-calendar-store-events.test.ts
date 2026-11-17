import { describe, expect, it } from 'vitest';
import type { Calendar, CalendarEvent } from '@/lib/jmap/types';
import { prepareSpaceEventUpdate, requireWritableEvent } from '@/lib/space-calendar/store-events';

describe('Space event update boundary', () => {
  const calendar = { id: 'account:space:one', originalId: 'one', source: 'atproto-space' } as Calendar;
  const event = { id: 'space-event:one', source: 'atproto-space', calendarIds: { [calendar.id]: true }, title: 'Review', participants: { member: { name: 'Member', isCurrentUser: true } } } as unknown as CalendarEvent;

  it('drops unchanged editor fields and the same namespaced calendar without changing the event', () => {
    const before = structuredClone(event);
    const updates = { title: 'New title', participants: structuredClone(event.participants), calendarIds: { one: true } };
    prepareSpaceEventUpdate(event, updates, [calendar]);
    expect(updates).toEqual({ title: 'New title' });
    expect(event).toEqual(before);
  });

  it('rejects moving a Space event or changing unsupported fields', () => {
    expect(() => prepareSpaceEventUpdate(event, { calendarIds: { other: true } }, [calendar])).toThrow('Moving an event');
    expect(() => prepareSpaceEventUpdate(event, { participants: {} }, [calendar])).toThrow('does not support changing participants');
  });

  it('keeps public event writes read-only even with an ordinary calendar ID', () => {
    expect(() => requireWritableEvent({ ...event, source: 'atproto-public' } as CalendarEvent, [calendar])).toThrow('read-only');
  });
});
