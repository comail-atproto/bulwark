import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useBuildersMembership } from '../use-builders-membership';

const state = vi.hoisted(() => ({
  auth: { isAuthenticated: true, activeAccountId: 'one', isDemoMode: false },
  accounts: { accounts: [{ id: 'one', cookieSlot: 0, lastLoginAt: 1 }, { id: 'two', cookieSlot: 1, lastLoginAt: 1 }] },
  apiFetch: vi.fn(),
}));
vi.mock('@/stores/auth-store', () => ({ useAuthStore: (select: (value: typeof state.auth) => unknown) => select(state.auth) }));
vi.mock('@/stores/account-store', () => ({ useAccountStore: (select: (value: typeof state.accounts) => unknown) => select(state.accounts) }));
vi.mock('@/lib/browser-navigation', () => ({ apiFetch: state.apiFetch }));

describe('Builders membership account switching', () => {
  beforeEach(() => {
    state.auth.activeAccountId = 'one';
    state.auth.isAuthenticated = true;
    state.apiFetch.mockReset();
  });

  it('hides while loading and queries only the active account slot', async () => {
    state.apiFetch.mockResolvedValue(Response.json({ enrolled: true }));
    const { result } = renderHook(useBuildersMembership);
    expect(result.current).toBe(false);
    await waitFor(() => expect(result.current).toBe(true));
    expect(state.apiFetch.mock.calls[0][1].headers).toEqual({ 'X-JMAP-Cookie-Slot': '0' });
  });

  it('hides on account switch and ignores an enrolled response from the previous account', async () => {
    let finishFirst!: (value: Response) => void;
    let finishSecond!: (value: Response) => void;
    state.apiFetch.mockImplementationOnce(() => new Promise((resolve) => { finishFirst = resolve; }));
    state.apiFetch.mockImplementationOnce(() => new Promise((resolve) => { finishSecond = resolve; }));
    const { result, rerender } = renderHook(useBuildersMembership);
    state.auth.activeAccountId = 'two';
    rerender();
    expect(result.current).toBe(false);
    await act(async () => { finishSecond(Response.json({ enrolled: false })); });
    await act(async () => { finishFirst(Response.json({ enrolled: true })); });
    expect(result.current).toBe(false);
    expect(state.apiFetch.mock.calls[1][1].headers).toEqual({ 'X-JMAP-Cookie-Slot': '1' });
  });

  it('clears a visible link immediately on logout', async () => {
    state.apiFetch.mockResolvedValue(Response.json({ enrolled: true }));
    const { result, rerender } = renderHook(useBuildersMembership);
    await waitFor(() => expect(result.current).toBe(true));
    state.auth.isAuthenticated = false;
    rerender();
    expect(result.current).toBe(false);
  });

  it('fails closed on network errors', async () => {
    state.apiFetch.mockRejectedValue(new Error('offline'));
    const { result } = renderHook(useBuildersMembership);
    await waitFor(() => expect(state.apiFetch).toHaveBeenCalledOnce());
    expect(result.current).toBe(false);
  });
});
