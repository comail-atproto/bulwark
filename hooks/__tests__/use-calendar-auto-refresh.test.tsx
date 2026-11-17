import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useCalendarAutoRefresh } from '../use-calendar-auto-refresh';

describe('calendar automatic refresh', () => {
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  it('refreshes visible calendars periodically and on returning to the tab', async () => {
    vi.useFakeTimers();
    const refresh = vi.fn().mockResolvedValue(undefined);
    const { unmount } = renderHook(() => useCalendarAutoRefresh(true, refresh));
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(refresh).toHaveBeenCalledTimes(1);
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(refresh).toHaveBeenCalledTimes(1);
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(refresh).toHaveBeenCalledTimes(2);
    unmount();
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it('does not overlap refreshes or run when disabled', async () => {
    vi.useFakeTimers();
    let finish!: () => void;
    const refresh = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    const { rerender } = renderHook(({ enabled }) => useCalendarAutoRefresh(enabled, refresh), { initialProps: { enabled: true } });
    await act(async () => { await vi.advanceTimersByTimeAsync(120_000); });
    expect(refresh).toHaveBeenCalledTimes(1);
    await act(async () => { finish(); });
    rerender({ enabled: false });
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});
