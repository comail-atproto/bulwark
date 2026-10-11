'use client';

import { useEffect } from 'react';
import { useAuthStore } from '@/stores/auth-store';

// Re-sync identities every 30 minutes while the app is open
const SYNC_INTERVAL_MS = 30 * 60 * 1000;

export function useIdentitySync() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const refreshIdentities = useAuthStore((s) => s.refreshIdentities);

  useEffect(() => {
    if (!isAuthenticated) return;

    // Sync when the user returns to the tab (e.g. after adding an alias in Stalwart)
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        refreshIdentities();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    const interval = setInterval(refreshIdentities, SYNC_INTERVAL_MS);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      clearInterval(interval);
    };
  }, [isAuthenticated, refreshIdentities]);
}
