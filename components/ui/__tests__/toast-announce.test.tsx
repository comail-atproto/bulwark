import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastContainer } from '../toast';
import { toast, toastAnnouncement, useToastStore } from '@/stores/toast-store';
import { LIVE_REGION_IDS, resetAnnouncerForTests } from '@/lib/announce';

function Toasts() {
  const toasts = useToastStore((s) => s.toasts);
  const removeToast = useToastStore((s) => s.removeToast);
  return <ToastContainer toasts={toasts} onClose={removeToast} />;
}

const region = (kind: 'polite' | 'assertive') => document.getElementById(LIVE_REGION_IDS[kind]);
const container = () => document.querySelector('[data-toast-container]') as HTMLElement;

describe('toast announcements', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetAnnouncerForTests();
    useToastStore.setState({ toasts: [] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('reads a toast out politely, title and message as one sentence', () => {
    render(<Toasts />);
    act(() => { toast.success('Email moved', 'Moved to Archive'); });
    act(() => { vi.advanceTimersByTime(100); });
    expect(region('polite')?.textContent).toBe('Email moved. Moved to Archive');
    expect(region('assertive')?.textContent).toBe('');
  });

  it('reads an error out assertively', () => {
    render(<Toasts />);
    act(() => { toast.error('Failed to delete email'); });
    act(() => { vi.advanceTimersByTime(100); });
    expect(region('assertive')?.textContent).toBe('Failed to delete email');
    expect(region('polite')?.textContent).toBe('');
  });

  it('keeps the toast stack out of the live regions, as a labelled region while toasts are up', () => {
    render(<Toasts />);
    expect(container()).not.toHaveAttribute('aria-live');
    expect(container()).not.toHaveAttribute('role');
    act(() => { toast.info('Saved'); });
    expect(container()).not.toHaveAttribute('aria-live');
    expect(container()).toHaveAttribute('role', 'region');
    expect(container()).toHaveAttribute('aria-label', 'title');
  });

  it('does not double the full stop after a title that has one', () => {
    expect(toastAnnouncement({ title: 'Saved.', message: 'All good' })).toBe('Saved. All good');
    expect(toastAnnouncement({ title: 'Saved', message: '' })).toBe('Saved');
  });
});
