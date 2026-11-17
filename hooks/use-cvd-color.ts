import { useCallback } from "react";
import { useSettingsStore } from "@/stores/settings-store";
import { cvdColor } from "@/lib/cvd-palette";

/**
 * Maps a stored colour (calendar, event) to the colour it is drawn in: the
 * colour-blind-safe one when that setting is on, else itself. The stored
 * colour never changes.
 */
export function useCvdColor(): (color: string) => string {
  const enabled = useSettingsStore((s) => s.colorBlindPalette);
  return useCallback((color: string) => cvdColor(color, enabled), [enabled]);
}
