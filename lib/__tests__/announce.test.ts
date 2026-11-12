import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { announce, cancelAnnouncement, ensureLiveRegions, LIVE_REGION_IDS, resetAnnouncerForTests } from '../announce';

const polite = () => document.getElementById(LIVE_REGION_IDS.polite);
const assertive = () => document.getElementById(LIVE_REGION_IDS.assertive);

describe('announce', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetAnnouncerForTests();
    document.body.innerHTML = '';
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('creates one polite and one assertive region, once', () => {
    ensureLiveRegions();
    ensureLiveRegions();
    expect(document.querySelectorAll(`#${LIVE_REGION_IDS.polite}`)).toHaveLength(1);
    expect(polite()).toHaveAttribute('aria-live', 'polite');
    expect(polite()).toHaveAttribute('role', 'status');
    expect(assertive()).toHaveAttribute('aria-live', 'assertive');
    expect(assertive()).toHaveAttribute('role', 'alert');
  });

  it('writes a message to the polite region after clearing it', () => {
    announce('Moved to Archive');
    expect(polite()?.textContent).toBe('');
    vi.advanceTimersByTime(100);
    expect(polite()?.textContent).toBe('Moved to Archive');
    expect(assertive()?.textContent).toBe('');
  });

  it('sends errors to the assertive region', () => {
    announce('Could not delete', { assertive: true });
    vi.advanceTimersByTime(100);
    expect(assertive()?.textContent).toBe('Could not delete');
    expect(polite()?.textContent).toBe('');
  });

  it('does not repeat the same message within a short time, but does later', () => {
    announce('Draft saved');
    vi.advanceTimersByTime(100);
    polite()!.textContent = '';
    announce('Draft saved');
    vi.advanceTimersByTime(100);
    expect(polite()?.textContent).toBe('');
    vi.advanceTimersByTime(3000);
    announce('Draft saved');
    vi.advanceTimersByTime(100);
    expect(polite()?.textContent).toBe('Draft saved');
  });

  it('reads messages that arrive together as one', () => {
    announce('Email archived');
    announce('3 new messages');
    vi.advanceTimersByTime(100);
    expect(polite()?.textContent).toBe('Email archived 3 new messages');
  });

  it('reads only the last debounced message of a burst', () => {
    announce('Inbox, 10 messages', { key: 'list', debounceMs: 500 });
    vi.advanceTimersByTime(200);
    announce('Inbox, 12 messages', { key: 'list', debounceMs: 500 });
    vi.advanceTimersByTime(700);
    expect(polite()?.textContent).toBe('Inbox, 12 messages');
  });

  it('drops a cancelled debounced message', () => {
    announce('12 results', { key: 'search', debounceMs: 500 });
    cancelAnnouncement('search');
    vi.advanceTimersByTime(1000);
    expect(polite()?.textContent ?? '').toBe('');
  });

  it('clears old text after a while', () => {
    announce('Email deleted');
    vi.advanceTimersByTime(100);
    expect(polite()?.textContent).toBe('Email deleted');
    vi.advanceTimersByTime(8000);
    expect(polite()?.textContent).toBe('');
  });
});

describe('announce without a page', () => {
  it('does nothing when a pending write runs after the document is gone', () => {
    vi.useFakeTimers();
    resetAnnouncerForTests();
    announce('Moved to Archive');
    const realDocument = globalThis.document;
    // As when a test file's DOM is torn down before the timer fires.
    Object.defineProperty(globalThis, 'document', { value: undefined, configurable: true });
    try {
      expect(() => vi.advanceTimersByTime(1000)).not.toThrow();
    } finally {
      Object.defineProperty(globalThis, 'document', { value: realDocument, configurable: true });
      vi.useRealTimers();
    }
  });
});
