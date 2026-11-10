"use client";

import { useEffect } from "react";
import { ensureLiveRegions } from "@/lib/announce";

/**
 * Puts the app-wide screen reader regions (lib/announce) into the page as
 * soon as an app starts, so they are there before the first announcement.
 * Renders nothing itself: the regions live at the end of <body>.
 */
export function LiveRegions() {
  useEffect(() => {
    ensureLiveRegions();
  }, []);
  return null;
}
