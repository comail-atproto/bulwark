import { describe, it, expect } from 'vitest';
import { emailDisplayDate, MAX_FUTURE_SENT_AT_MS } from '@/lib/email-date';

// #891: migrated/restored mail gets receivedAt = import time; the Date header
// (sentAt) is the message's real date and must win for display.
describe('emailDisplayDate', () => {
  const receivedAt = '2026-08-20T12:00:00Z';

  it('prefers the Date header over the server receive time', () => {
    expect(emailDisplayDate({ sentAt: '2019-03-04T05:06:07Z', receivedAt })).toBe('2019-03-04T05:06:07Z');
  });

  it('falls back to receivedAt when there is no Date header', () => {
    expect(emailDisplayDate({ receivedAt })).toBe(receivedAt);
    expect(emailDisplayDate({ sentAt: undefined, receivedAt })).toBe(receivedAt);
    expect(emailDisplayDate({ sentAt: null, receivedAt })).toBe(receivedAt);
    expect(emailDisplayDate({ sentAt: '', receivedAt })).toBe(receivedAt);
  });

  it('falls back to receivedAt when the Date header is unparsable', () => {
    expect(emailDisplayDate({ sentAt: 'not-a-date', receivedAt })).toBe(receivedAt);
  });

  it('tolerates ordinary clock skew (Date slightly after receipt)', () => {
    const skewed = new Date(Date.parse(receivedAt) + 5 * 60 * 1000).toISOString();
    expect(emailDisplayDate({ sentAt: skewed, receivedAt })).toBe(skewed);
  });

  it('ignores a Date header implausibly far in the future (forged spam dates)', () => {
    const forged = new Date(Date.parse(receivedAt) + MAX_FUTURE_SENT_AT_MS + 1000).toISOString();
    expect(emailDisplayDate({ sentAt: forged, receivedAt })).toBe(receivedAt);
  });

  it('uses sentAt when receivedAt is missing or unparsable', () => {
    expect(emailDisplayDate({ sentAt: '2019-03-04T05:06:07Z' })).toBe('2019-03-04T05:06:07Z');
    expect(emailDisplayDate({ sentAt: '2019-03-04T05:06:07Z', receivedAt: 'garbage' })).toBe('2019-03-04T05:06:07Z');
  });

  it('returns undefined when neither is present', () => {
    expect(emailDisplayDate({})).toBeUndefined();
  });
});
