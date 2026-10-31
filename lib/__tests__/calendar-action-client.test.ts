import { afterEach, describe, expect, it } from 'vitest';
import type { IJMAPClient } from '@/lib/jmap/client-interface';
import { resolveCalendarActionClient } from '@/lib/calendar-action-client';
import { setClientLookup } from '@/stores/client-registry';

const accountClient = (name: string) => ({ accountName: name }) as IJMAPClient & { accountName: string };

afterEach(() => setClientLookup(() => undefined));

describe('calendar action client routing', () => {
  it('loads Space principals from the account that owns the selected calendar', () => {
    const active = accountClient('active');
    const owner = accountClient('owner');
    setClientLookup((accountId) => accountId === 'owner-slot' ? owner : undefined);

    expect(resolveCalendarActionClient({ localAccountId: 'owner-slot' }, active)).toBe(owner);
  });

  it('uses the active client when the calendar has no local account binding', () => {
    const active = accountClient('active');
    expect(resolveCalendarActionClient({}, active)).toBe(active);
  });

  it('fails closed for a Space calendar when its owning account client is unavailable', () => {
    const active = accountClient('active');
    setClientLookup(() => undefined);

    expect(resolveCalendarActionClient({ source: 'atproto-space', localAccountId: 'owner-slot' }, active)).toBeUndefined();
  });

  it('preserves the active-client fallback for ordinary calendars with a stale account binding', () => {
    const active = accountClient('active');
    setClientLookup(() => undefined);

    expect(resolveCalendarActionClient({ source: 'jmap', localAccountId: 'owner-slot' }, active)).toBe(active);
  });
});
