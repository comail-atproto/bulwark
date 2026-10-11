import type { CalendarRecurrenceRule } from '@/lib/jmap/types';

type Frequency = CalendarRecurrenceRule['frequency'];

/**
 * A plain Gregorian recurrence rule with all by-parts unset. `rscale`/`skip`
 * are intentionally omitted: they only matter for non-Gregorian scales /
 * invalid-date handling, and defaulting them made Stalwart serialise
 * `RSCALE=GREGORIAN;SKIP=OMIT` into the RRULE, which DAVx5 rejects (#805).
 */
export function createRecurrenceRule(
  frequency: Frequency,
  overrides: Partial<CalendarRecurrenceRule> = {},
): CalendarRecurrenceRule {
  return {
    '@type': 'RecurrenceRule',
    frequency,
    interval: 1,
    firstDayOfWeek: 'mo',
    byDay: null,
    byMonthDay: null,
    byMonth: null,
    byYearDay: null,
    byWeekNo: null,
    byHour: null,
    byMinute: null,
    bySecond: null,
    bySetPosition: null,
    count: null,
    until: null,
    ...overrides,
  };
}
