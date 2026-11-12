import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  isTitleAlertActive, startTitleAlert, stopTitleAlert, TITLE_ALERT_INTERVAL_MS, TITLE_ALERT_MAX_SWAPS,
} from '../title-alert';

describe('title alert', () => {
  let focused = false;
  beforeEach(() => {
    vi.useFakeTimers();
    focused = false;
    vi.spyOn(document, 'hasFocus').mockImplementation(() => focused);
    document.title = 'Inbox';
  });
  afterEach(() => {
    stopTitleAlert();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('never swaps faster than once a second', () => {
    expect(TITLE_ALERT_INTERVAL_MS).toBeGreaterThanOrEqual(1000);
    startTitleAlert('1 new message');
    expect(document.title).toBe('1 new message');
    vi.advanceTimersByTime(999);
    expect(document.title).toBe('1 new message');
    vi.advanceTimersByTime(TITLE_ALERT_INTERVAL_MS - 999);
    expect(document.title).toBe('Inbox');
  });

  it('stops by itself after a few rounds and puts the title back', () => {
    startTitleAlert('1 new message');
    vi.advanceTimersByTime(TITLE_ALERT_INTERVAL_MS * TITLE_ALERT_MAX_SWAPS);
    expect(isTitleAlertActive()).toBe(false);
    expect(document.title).toBe('Inbox');
    vi.advanceTimersByTime(TITLE_ALERT_INTERVAL_MS * 4);
    expect(document.title).toBe('Inbox');
  });

  it('stops when the tab gets the focus', () => {
    startTitleAlert('1 new message');
    focused = true;
    window.dispatchEvent(new Event('focus'));
    expect(isTitleAlertActive()).toBe(false);
    expect(document.title).toBe('Inbox');
  });

  it('does nothing while the tab is in front', () => {
    focused = true;
    startTitleAlert('1 new message');
    expect(isTitleAlertActive()).toBe(false);
    expect(document.title).toBe('Inbox');
  });
});
