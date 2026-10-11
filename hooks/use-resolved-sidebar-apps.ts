'use client';

import { useMemo } from 'react';
import { useSettingsStore } from '@/stores/settings-store';
import { usePolicyStore } from '@/stores/policy-store';
import { mergeSidebarApps, sanitizeDefaultSidebarApps, type ResolvedSidebarApp } from '@/lib/sidebar-apps';
import type { AdminSidebarApp } from '@/lib/admin/types';

/** The apps the operator pins for every user (#931), validated. */
export function useManagedSidebarApps(): AdminSidebarApp[] {
  const defaults = usePolicyStore((s) => s.policy.defaultSidebarApps);
  return useMemo(() => sanitizeDefaultSidebarApps(defaults), [defaults]);
}

/**
 * The full sidebar app list: operator-provided apps first, then the user's own.
 *
 * `sidebarAppsEnabled` gates only the user's custom apps, so turning it off
 * still leaves the operator's set in place.
 */
export function useResolvedSidebarApps(): ResolvedSidebarApp[] {
  const userApps = useSettingsStore((s) => s.sidebarApps);
  const defaults = usePolicyStore((s) => s.policy.defaultSidebarApps);
  const userAppsEnabled = usePolicyStore((s) => s.isFeatureEnabled('sidebarAppsEnabled'));
  return useMemo(
    () => mergeSidebarApps(defaults, userAppsEnabled ? userApps : []),
    [defaults, userApps, userAppsEnabled]
  );
}
