import { beforeEach, describe, expect, it } from 'vitest';
import { createOAuthState, takeOAuthStateOwner } from '../plugin-oauth';

describe('plugin OAuth state', () => {
  beforeEach(() => localStorage.clear());

  it('rejects stored states without a valid creation time', () => {
    localStorage.setItem('plugin-oauth-states', JSON.stringify({ state: { pluginId: 'plugin' } }));
    expect(takeOAuthStateOwner('state')).toBeNull();
  });

  it('still delivers a fresh state once', () => {
    const state = createOAuthState('plugin');
    expect(takeOAuthStateOwner(state)).toBe('plugin');
    expect(takeOAuthStateOwner(state)).toBeNull();
  });
});
