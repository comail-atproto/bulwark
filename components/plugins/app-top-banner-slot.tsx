'use client';

import { PluginSlot } from '@/components/plugins/plugin-slot';
import { useAuthStore } from '@/stores/auth-store';

/**
 * Mounts the `app-top-banner` plugin slot with the current session
 * username + serverUrl as extraProps. Drop this at the top of every
 * authenticated page so plugins like impersonation-notice render
 * everywhere, not just on the mail page.
 */
export function AppTopBannerSlot() {
  const username = useAuthStore((s) => s.username);
  const serverUrl = useAuthStore((s) => s.serverUrl);
  return <PluginSlot name="app-top-banner" extraProps={{ username, serverUrl }} />;
}
