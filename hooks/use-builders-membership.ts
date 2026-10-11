"use client";

import { useEffect, useState } from 'react';
import { useAuthStore } from '@/stores/auth-store';
import { useAccountStore } from '@/stores/account-store';
import { apiFetch } from '@/lib/browser-navigation';

export function useBuildersMembership(): boolean {
  const authenticated = useAuthStore((state) => state.isAuthenticated);
  const activeAccountId = useAuthStore((state) => state.activeAccountId);
  const account = useAccountStore((state) => state.accounts.find((entry) => entry.id === activeAccountId));
  const slot = account?.cookieSlot;
  const login = account?.lastLoginAt;
  const key = authenticated && activeAccountId && slot !== undefined ? `${activeAccountId}:${slot}:${login}` : null;
  const [membership, setMembership] = useState<{ key: string; enrolled: boolean } | null>(null);

  useEffect(() => {
    if (!key || slot === undefined) return;
    const controller = new AbortController();
    void apiFetch('/api/builders-membership', {
      headers: { 'X-JMAP-Cookie-Slot': String(slot) },
      cache: 'no-store',
      signal: controller.signal,
    }).then(async (response) => {
      if (!response.ok) return;
      const body = await response.json();
      if (!controller.signal.aborted) setMembership({ key, enrolled: body?.enrolled === true });
    }).catch(() => {
      if (!controller.signal.aborted) setMembership({ key, enrolled: false });
    });
    return () => controller.abort();
  }, [key, slot]);

  return key !== null && membership?.key === key && membership.enrolled;
}
