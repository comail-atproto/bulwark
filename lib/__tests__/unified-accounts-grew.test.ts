import { describe, expect, it } from 'vitest';
import { connectedAccountsGrew } from '../unified-mailbox';

/**
 * Guards the trigger for the unified list refetch (#950). The unified view can
 * be fetched while background accounts are still connecting; when one lands we
 * refetch, but only on growth - a shrink is already driven by the flow that
 * caused it, and mount must not count or the initial fetch is duplicated.
 */
describe('connectedAccountsGrew (#950)', () => {
  it('detects an account joining the set', () => {
    expect(connectedAccountsGrew('alice', 'alice,bob')).toBe(true);
  });

  it('detects growth when several accounts land at once', () => {
    expect(connectedAccountsGrew('alice', 'alice,bob,carol')).toBe(true);
  });

  it('treats the first render as no growth, so the initial fetch is not duplicated', () => {
    expect(connectedAccountsGrew(null, 'alice,bob')).toBe(false);
  });

  it('ignores an unchanged set', () => {
    expect(connectedAccountsGrew('alice,bob', 'alice,bob')).toBe(false);
  });

  it('ignores a shrink (sign-out / disconnect owns that flow)', () => {
    expect(connectedAccountsGrew('alice,bob', 'alice')).toBe(false);
  });

  it('ignores everything disconnecting', () => {
    expect(connectedAccountsGrew('alice,bob', '')).toBe(false);
  });

  // The realistic #950 sequence: reload starts with nothing connected (the
  // rehydrate reset), the active account lands, then the background ones.
  it('fires for the first account after an empty start', () => {
    expect(connectedAccountsGrew('', 'alice')).toBe(true);
  });

  it('fires again as each background account lands', () => {
    expect(connectedAccountsGrew('alice', 'alice,bob')).toBe(true);
    expect(connectedAccountsGrew('alice,bob', 'alice,bob,carol')).toBe(true);
  });

  // A swap keeps the count identical, so a length comparison would miss it -
  // the check must be membership-based.
  it('detects a replacement even though the size is unchanged', () => {
    expect(connectedAccountsGrew('alice,bob', 'alice,carol')).toBe(true);
  });

  it('does not treat the empty-string baseline as a member', () => {
    // ''.split(',') === [''] - a naive Set would contain '' and mis-compare.
    expect(connectedAccountsGrew('', '')).toBe(false);
  });
});
