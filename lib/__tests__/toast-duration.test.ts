import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { toast, useToastStore } from '@/stores/toast-store';
import { useSettingsStore } from '@/stores/settings-store';
import { usePolicyStore } from '@/stores/policy-store';
import { useAuthStore } from '@/stores/auth-store';
import { useCalendarStore } from '@/stores/calendar-store';
import { useCalendarNotificationStore } from '@/stores/calendar-notification-store';
import { useCalendarAlerts } from '@/hooks/use-calendar-alerts';
import { stopTitleAlert } from '@/lib/title-alert';
import type { CalendarEvent } from '@/lib/jmap/types';

const playNotificationSound = vi.hoisted(() => vi.fn());
vi.mock('@/lib/notification-sound', () => ({ playNotificationSound }));

const last = () => useToastStore.getState().toasts.at(-1)!;
const undo = { label: 'Undo', onClick: () => {} };

function restrictMin(min: number | undefined) {
  usePolicyStore.setState({
    getRestriction: (key: string) => (key === 'toastDuration' && min !== undefined ? { min } : undefined),
  } as never);
}

describe('toast durations', () => {
  const original = usePolicyStore.getState().getRestriction;
  beforeEach(() => {
    useToastStore.setState({ toasts: [] });
    useSettingsStore.setState({ toastDuration: 5 });
    restrictMin(undefined);
  });
  afterEach(() => {
    usePolicyStore.setState({ getRestriction: original } as never);
  });

  it('keeps the time a caller picked at the shortest setting', () => {
    toast.success('Email archived', { action: undo, duration: 8000 });
    expect(last().duration).toBe(8000);
    toast.success('Saved');
    expect(last().duration).toBe(5000);
  });

  it('makes toasts with an action stay as long as the setting says', () => {
    useSettingsStore.setState({ toastDuration: 20 });
    toast.success('Email archived', { action: undo, duration: 8000 });
    expect(last().duration).toBe(20000);
    // A plain notice keeps its own time.
    toast.success('Saved');
    expect(last().duration).toBe(5000);
  });

  it('keeps errors at least as long as toasts with an action', () => {
    useSettingsStore.setState({ toastDuration: 60 });
    toast.error('Failed to delete email');
    expect(last().duration).toBe(60000);
    useSettingsStore.setState({ toastDuration: 5 });
    toast.error('Failed to delete email again');
    expect(last().duration).toBe(10000);
  });

  it('keeps them until closed with "until I close them"', () => {
    useSettingsStore.setState({ toastDuration: 0 });
    toast.success('Email archived', { action: undo, duration: 8000 });
    expect(last().duration).toBe(0);
    toast.error('Failed');
    expect(last().duration).toBe(0);
  });

  it('leaves a toast whose action ends at a fixed time alone', () => {
    useSettingsStore.setState({ toastDuration: 60 });
    toast.info('Sending in 10 s', { action: undo, duration: 10000, pauseOnHover: false });
    expect(last().duration).toBe(10000);
  });

  it('raises a setting below the admin minimum to it', () => {
    restrictMin(20);
    useSettingsStore.setState({ toastDuration: 5 });
    toast.success('Email archived', { action: undo, duration: 8000 });
    expect(last().duration).toBe(20000);
  });
});

function eventDueNow(id: string): CalendarEvent {
  const start = new Date(Date.now() + 10 * 60_000);
  return {
    id,
    uid: `uid-${id}`,
    title: `Meeting ${id}`,
    start: start.toISOString().slice(0, 19),
    utcStart: start.toISOString(),
    duration: 'PT1H',
    calendarIds: { c1: true },
    useDefaultAlerts: false,
    alerts: {
      a1: { '@type': 'Alert', action: 'display', trigger: { '@type': 'AbsoluteTrigger', when: new Date(Date.now() - 1000).toISOString() } },
    },
  } as unknown as CalendarEvent;
}

describe('reminder toasts', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    playNotificationSound.mockClear();
    useToastStore.setState({ toasts: [] });
    useCalendarNotificationStore.getState().clearAll();
    useAuthStore.setState({ isAuthenticated: true, client: null });
    useSettingsStore.setState({
      calendarNotificationsEnabled: true, calendarNotificationSound: true, enableCalendarTasks: false,
      toastDuration: 5, visualAlerts: false, doNotDisturb: false,
    });
    useCalendarStore.setState({ events: [], calendars: [], supportsCalendar: true });
  });
  afterEach(() => {
    // A reminder with Visual alerts on may have started the title alert.
    stopTitleAlert();
    vi.useRealTimers();
  });

  const showReminder = (id: string) => {
    useCalendarStore.setState({ events: [eventDueNow(id)] });
    renderHook(() => useCalendarAlerts());
    act(() => { vi.advanceTimersByTime(1000); });
    return useToastStore.getState().toasts.find((t) => t.title === `Meeting ${id}`)!;
  };

  it('stays 15 seconds at the shortest setting, and longer with a longer one', () => {
    expect(showReminder('r1').duration).toBe(15000);
    useSettingsStore.setState({ toastDuration: 60 });
    expect(showReminder('r2').duration).toBe(60000);
  });

  it('stays until closed with Visual alerts on or with "until closed"', () => {
    useSettingsStore.setState({ visualAlerts: true });
    expect(showReminder('r3').duration).toBe(0);
    useSettingsStore.setState({ visualAlerts: false, toastDuration: 0 });
    expect(showReminder('r4').duration).toBe(0);
  });

  it('swaps the tab title to the reminder with Visual alerts on, in the background', () => {
    const hasFocus = vi.spyOn(document, 'hasFocus').mockReturnValue(false);
    document.title = 'Calendar';
    try {
      useSettingsStore.setState({ visualAlerts: true, doNotDisturb: true });
      const shown = showReminder('r7');
      expect(shown?.title).toBe('Meeting r7');
      expect(document.title).toBe('title_alert');
    } finally {
      stopTitleAlert();
      hasFocus.mockRestore();
    }
    expect(document.title).toBe('Calendar');
  });

  it('still shows with Do not disturb on, but without a sound', () => {
    useSettingsStore.setState({ doNotDisturb: true });
    expect(showReminder('r5')).toBeDefined();
    expect(playNotificationSound).not.toHaveBeenCalled();
    useSettingsStore.setState({ doNotDisturb: false });
    showReminder('r6');
    expect(playNotificationSound).toHaveBeenCalled();
  });
});
