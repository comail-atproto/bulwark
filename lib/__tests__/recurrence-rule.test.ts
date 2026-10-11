import { describe, it, expect } from 'vitest';
import { createRecurrenceRule } from '@/lib/recurrence-rule';

describe('createRecurrenceRule (#805 — no default SKIP=OMIT)', () => {
  it('does not emit rscale or skip (which serialise to RSCALE=GREGORIAN;SKIP=OMIT)', () => {
    const rule = createRecurrenceRule('yearly');
    expect('skip' in rule).toBe(false);
    expect('rscale' in rule).toBe(false);
    expect(rule.skip).toBeUndefined();
    expect(rule.rscale).toBeUndefined();
  });

  it('builds a clean Gregorian default rule', () => {
    expect(createRecurrenceRule('daily')).toEqual({
      '@type': 'RecurrenceRule',
      frequency: 'daily',
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
    });
  });

  it('applies overrides (interval / count / until) without reintroducing skip', () => {
    const rule = createRecurrenceRule('yearly', { interval: 2, count: 100 });
    expect(rule.interval).toBe(2);
    expect(rule.count).toBe(100);
    expect(rule.until).toBeNull();
    expect('skip' in rule).toBe(false);
  });
});
