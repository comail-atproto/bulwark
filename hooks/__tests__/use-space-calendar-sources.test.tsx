import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Calendar } from '@/lib/jmap/types';
import type { IJMAPClient } from '@/lib/jmap/client-interface';
import { useCalendarStore } from '@/stores/calendar-store';
import { setClientLookup } from '@/stores/client-registry';
import { useSpaceCalendarSources } from '../use-space-calendar-sources';

vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));
const { warning } = vi.hoisted(() => ({ warning: vi.fn() }));
vi.mock('@/stores/toast-store', () => ({ toast: { warning, error: vi.fn() } }));

const calendar = { id: 'other:space:one', source: 'atproto-space', localAccountId: 'other', spaceConsentRequired: true } as Calendar;
const refetchCurrentRange = vi.fn().mockResolvedValue(undefined);
const accountClients: [] = [];

beforeEach(() => {
  warning.mockClear();
  useCalendarStore.getState().clearState();
  useCalendarStore.setState({ calendars: [calendar], selectedCalendarIds: [] });
});
afterEach(() => { cleanup(); setClientLookup(() => undefined); });

it('requests consent only on selection and through the calendar account, without duplicate pending requests', async () => {
  let finish!: (url: string) => void;
  const start = vi.fn(() => new Promise<string>(resolve => { finish = resolve; }));
  const currentStart = vi.fn();
  const client = { startAtprotoSpaceCalendarConsent: currentStart } as unknown as IJMAPClient;
  setClientLookup(id => id === 'other' ? { startAtprotoSpaceCalendarConsent: start } as unknown as IJMAPClient : undefined);
  const { rerender } = renderHook(() => useSpaceCalendarSources({ client, multiAccountEnabled: false, accountClients, refetchCurrentRange }));
  expect(start).not.toHaveBeenCalled();
  await act(async () => { useCalendarStore.setState({ selectedCalendarIds: [calendar.id] }); });
  rerender();
  expect(start).toHaveBeenCalledTimes(1);
  expect(currentStart).not.toHaveBeenCalled();
  await act(async () => { finish('https://consent.example.test/authorize'); });
  expect(warning).toHaveBeenCalledOnce();
});

it('keeps public source consent out of the private-calendar selection effect', async () => {
  const start = vi.fn();
  const client = { startAtprotoSpaceCalendarConsent: start } as unknown as IJMAPClient;
  useCalendarStore.setState({ calendars: [{ ...calendar, source: 'atproto-public' }] });
  renderHook(() => useSpaceCalendarSources({ client, multiAccountEnabled: false, accountClients, refetchCurrentRange }));
  await act(async () => { useCalendarStore.setState({ selectedCalendarIds: [calendar.id] }); });
  expect(start).not.toHaveBeenCalled();
  expect(warning).not.toHaveBeenCalled();
});
