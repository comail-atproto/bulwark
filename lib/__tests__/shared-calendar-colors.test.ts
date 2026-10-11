import { describe, it, expect } from 'vitest';
import type { Calendar } from '@/lib/jmap/types';
import {
  CALENDAR_COLORS,
  sharedCalendarColorKey,
  pickUnusedCalendarColor,
} from '../shared-calendar-colors';

function makeCal(overrides: Partial<Calendar>): Calendar {
  return {
    id: 'cal-1',
    name: 'Cal',
    description: null,
    color: null,
    sortOrder: 0,
    isSubscribed: true,
    isVisible: true,
    isDefault: false,
    includeInAvailability: 'all',
    defaultAlertsWithTime: null,
    defaultAlertsWithoutTime: null,
    timeZone: null,
    shareWith: null,
    myRights: {} as Calendar['myRights'],
    ...overrides,
  };
}

describe('sharedCalendarColorKey', () => {
  it('is built from local account, JMAP account, and the original id', () => {
    const cal = makeCal({
      id: 'acct-9:cal-7',
      originalId: 'cal-7',
      accountId: 'acct-9',
      localAccountId: 'slot-2',
    });
    expect(sharedCalendarColorKey(cal)).toBe('slot-2|acct-9|cal-7');
  });

  it('is stable regardless of the Pro-shell id prefix', () => {
    // Same underlying calendar, shown once under the active account (bare id)
    // and once cross-account (prefixed id) - both must map to one key.
    const active = makeCal({ id: 'acct-9:cal-7', originalId: 'cal-7', accountId: 'acct-9', localAccountId: 'slot-2' });
    const prefixed = makeCal({ id: 'slot-2::acct-9:cal-7', originalId: 'cal-7', accountId: 'acct-9', localAccountId: 'slot-2' });
    expect(sharedCalendarColorKey(active)).toBe(sharedCalendarColorKey(prefixed));
  });

  it('falls back to the id when originalId is absent', () => {
    const cal = makeCal({ id: 'cal-7', accountId: 'acct-9' });
    expect(sharedCalendarColorKey(cal)).toBe('|acct-9|cal-7');
  });
});

describe('pickUnusedCalendarColor', () => {
  it('returns a palette color not present in usedColors', () => {
    const used = CALENDAR_COLORS.slice(0, CALENDAR_COLORS.length - 1);
    const picked = pickUnusedCalendarColor(used);
    expect(picked).toBe(CALENDAR_COLORS[CALENDAR_COLORS.length - 1]);
  });

  it('ignores case when comparing used colors', () => {
    const used = CALENDAR_COLORS.slice(0, -1).map((c) => c.toUpperCase());
    expect(pickUnusedCalendarColor(used)).toBe(CALENDAR_COLORS[CALENDAR_COLORS.length - 1]);
  });

  it('still returns a palette color once every color is taken', () => {
    expect(CALENDAR_COLORS).toContain(pickUnusedCalendarColor(CALENDAR_COLORS));
  });

  it('always returns a valid palette color for a small used set', () => {
    for (let i = 0; i < 50; i++) {
      const picked = pickUnusedCalendarColor(['#3b82f6']);
      expect(CALENDAR_COLORS).toContain(picked);
      expect(picked).not.toBe('#3b82f6');
    }
  });
});
