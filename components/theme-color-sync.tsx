"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { enableThemeColorSync, syncThemeColorMeta } from "@/lib/theme-color-meta";

/**
 * Keeps the PWA title bar colour matched to the active theme (#671).
 *
 * Mounted by the root layout only when no explicit `pwaThemeColor` branding is
 * configured - an admin-set colour is an intentional override and must not be
 * second-guessed by the client. See lib/theme-color-meta.ts for the mechanism.
 */
export function ThemeColorSync() {
  useEffect(() => {
    enableThemeColorSync();
  }, []);

  // Client-side navigation re-applies the route's server-rendered metadata,
  // which resets the meta tag to the static viewport value - re-sync after it.
  const pathname = usePathname();
  useEffect(() => {
    syncThemeColorMeta();
  }, [pathname]);

  return null;
}
