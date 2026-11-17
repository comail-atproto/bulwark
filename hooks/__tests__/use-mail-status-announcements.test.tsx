import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useMailStatusAnnouncements } from '../use-mail-status-announcements';
import { useEmailStore } from '@/stores/email-store';
import { useAuthStore } from '@/stores/auth-store';
import { LIVE_REGION_IDS, resetAnnouncerForTests } from '@/lib/announce';
import type { Mailbox } from '@/lib/jmap/types';

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) =>
    values ? `${key}:${JSON.stringify(values)}` : key,
}));

const polite = () => document.getElementById(LIVE_REGION_IDS.polite)?.textContent ?? '';
const assertive = () => document.getElementById(LIVE_REGION_IDS.assertive)?.textContent ?? '';
const mailbox = (id: string, name: string, role?: string) => ({ id, name, role }) as Mailbox;

/** A load of the list: loading, then done with `total` messages. */
const load = (patch: Record<string, unknown>, total: number) => {
  act(() => { useEmailStore.setState({ ...patch, isLoading: true }); });
  act(() => { useEmailStore.setState({ isLoading: false, totalEmails: total }); });
  act(() => { vi.advanceTimersByTime(800); });
};

describe('mail status announcements', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetAnnouncerForTests();
    useEmailStore.setState({
      mailboxes: [mailbox('in', 'INBOX', 'inbox'), mailbox('rc', 'Receipts')],
      selectedMailbox: 'in', isUnifiedView: false, unifiedRole: null, selectedKeyword: null,
      viewingAccountId: null, searchQuery: '', isLoading: false, error: null, totalEmails: 0,
    });
    useAuthStore.setState({ connectionLost: false, isRateLimited: false });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('reads out a folder that finished loading with its count, once per folder', () => {
    renderHook(() => useMailStatusAnnouncements());
    load({ selectedMailbox: 'rc' }, 12);
    expect(polite()).toBe('folder_loaded:{"folder":"Receipts","count":12}');

    // A refresh of the same folder says nothing new.
    resetAnnouncerForTests();
    load({}, 13);
    expect(polite()).toBe('');

    load({ selectedMailbox: 'in' }, 3);
    expect(polite()).toBe('folder_loaded:{"folder":"mailboxes.inbox","count":3}');
  });

  it('reads out how many messages a search found', () => {
    renderHook(() => useMailStatusAnnouncements());
    load({ searchQuery: 'invoice' }, 4);
    expect(polite()).toBe('search_results:{"count":4}');
  });

  it('says nothing when the load failed', () => {
    renderHook(() => useMailStatusAnnouncements());
    act(() => { useEmailStore.setState({ selectedMailbox: 'rc', isLoading: true }); });
    act(() => { useEmailStore.setState({ isLoading: false, error: 'Failed' }); });
    act(() => { vi.advanceTimersByTime(800); });
    expect(polite()).toBe('');
  });

  it('reads out the reconnecting banner assertively and the rate limit politely', () => {
    renderHook(() => useMailStatusAnnouncements());
    act(() => { useAuthStore.setState({ connectionLost: true }); });
    act(() => { vi.advanceTimersByTime(100); });
    expect(assertive()).toBe('reconnecting');
    act(() => { useAuthStore.setState({ isRateLimited: true }); });
    act(() => { vi.advanceTimersByTime(100); });
    expect(polite()).toBe('rate_limited_title');
  });
});
