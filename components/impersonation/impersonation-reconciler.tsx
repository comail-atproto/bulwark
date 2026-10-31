'use client';

import { useEffect } from 'react';

import { evictAll } from '@/lib/account-state-manager';

/**
 * After a master-user impersonation handoff (`GET /api/auth/impersonate`), the
 * server swaps the slot-0 session cookie but the client's *persisted* account
 * registry still lists the PREVIOUS account — so the top-left account chip keeps
 * showing the old mailbox even though the message list is correctly the new one.
 * Only a manual sign-out (which clears `account-registry` / `auth-storage`) fixes
 * it, because that state lives in localStorage and the impersonation redirect
 * never reconciles it. (Reported downstream: jabali-panel #646.)
 *
 * The impersonate route now redirects to `/?impersonated=1`. Here we drop the
 * stale persisted account + auth state (and the server-derived caches) and
 * reload to a clean URL, so the app rehydrates empty and re-derives the single
 * account from the fresh session cookie — the same result as the manual
 * sign-out-then-reopen, done automatically. Cookies are untouched, so the
 * just-granted impersonation session survives the reload.
 */
const STALE_KEYS = [
  'account-registry',
  'auth-storage',
  'identity-storage',
  'contact-storage',
  'calendar-storage',
  'calendar-notification-storage',
];

export function ImpersonationReconciler() {
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('impersonated') !== '1') return;

    try {
      evictAll();
    } catch {
      /* in-memory snapshots are best-effort */
    }
    for (const key of STALE_KEYS) {
      try {
        window.localStorage.removeItem(key);
      } catch {
        /* ignore storage access errors */
      }
    }

    // Reload to a clean URL (drop the marker) so the now-empty persisted stores
    // rehydrate and the app reconnects + re-derives the impersonated account
    // from the session cookie. The marker is gone on the second load, so this
    // runs exactly once.
    params.delete('impersonated');
    const query = params.toString();
    window.location.replace(window.location.pathname + (query ? `?${query}` : ''));
  }, []);

  return null;
}
