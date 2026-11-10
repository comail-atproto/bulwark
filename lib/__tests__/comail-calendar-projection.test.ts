import { describe, expect, it } from 'vitest';
import { partitionByDisplayHours, resolveDisplayHours } from '../calendar-display-range';
import { expandRecurringEvents } from '../recurrence-expansion';
import type { CalendarEvent, CalendarRecurrenceRule } from '../jmap/types';

function timed(id: string, start: string, duration: string): CalendarEvent {
  return {
    id, "@type": "Event", uid: id, title: id, start, duration,
    showWithoutTime: false, calendarIds: { cal: true },
  } as unknown as CalendarEvent;
}

describe('public events without a declared end', () => {
  it.each([true, false])('keeps a public midnight point in its own day (end unspecified: %s)', async (atmoEndUnspecified) => {
    const { getEventEndDate, getTimedEventBoundsForDay, layoutOverlappingEvents } = await import('@/lib/calendar-utils');
    const event = { ...timed('atmo:midnight', '2026-09-09T00:00:00', 'PT0S'), source: 'atproto-public', atmoEndUnspecified } as CalendarEvent;
    const day = new Date(2026, 8, 9);
    expect(getTimedEventBoundsForDay(event, day)).toMatchObject({ startMinutes: 0, endMinutes: 0 });
    expect(layoutOverlappingEvents([event], day)).toHaveLength(1);
    expect(partitionByDisplayHours([event], day, resolveDisplayHours(true, 0, 8)).visible).toEqual([event]);
    expect(getTimedEventBoundsForDay(event, new Date(2026, 8, 8))).toBeNull();
    expect(getTimedEventBoundsForDay(event, new Date(2026, 8, 10))).toBeNull();
    expect(event.duration).toBe('PT0S');
    expect(getEventEndDate(event)).toEqual(new Date(2026, 8, 9));
  });

  it('preserves the existing midnight zero-duration behavior for other sources', async () => {
    const { getTimedEventBoundsForDay } = await import('@/lib/calendar-utils');
    expect(getTimedEventBoundsForDay(timed('local', '2026-09-09T00:00:00', 'PT0S'), new Date(2026, 8, 9))).toBeNull();
  });
});

describe('Space recurrence projection', () => {
  it('retains other Space actors when one occurrence has a sparse response', () => {
    const event: CalendarEvent = {
      ...timed('evt1', '2025-01-06T09:00:00', 'PT1H'),
      uid: 'uid1', title: 'Test Event', calendarIds: { cal1: true },
      excludedRecurrenceRules: null,
      source: 'atproto-space',
      recurrenceRules: [{ '@type': 'RecurrenceRule', frequency: 'daily', count: 3 } as CalendarRecurrenceRule],
      participants: {
        owner: { '@type': 'Participant', did: 'did:plc:owner', participationStatus: 'accepted' },
        member: { '@type': 'Participant', did: 'did:plc:member', participationStatus: 'needs-action' },
      } as unknown as CalendarEvent['participants'],
      recurrenceOverrides: {
        '2025-01-07T09:00:00': {
          start: '2025-01-08T12:00:00',
          participants: { member: { '@type': 'Participant', did: 'did:plc:member', participationStatus: 'declined' } } as unknown as CalendarEvent['participants'],
        },
      },
    };
    const answered = expandRecurringEvents([event], '2025-01-06T00:00:00', '2025-01-09T00:00:00').find(e => e.recurrenceId === '2025-01-07T09:00:00')!;
    expect(answered.start).toBe('2025-01-08T12:00:00');
    expect(answered.participants).toEqual({ ...event.participants, member: { ...event.participants!.member, participationStatus: 'declined' } });
    expect(event.participants!.member.participationStatus).toBe('needs-action');
  });
});
