import { useSettingsStore } from "@/stores/settings-store";

/**
 * Whether hovering may open things: hover previews, submenus, the Mountain
 * View rail peek. Settings > Accessibility can turn it off, so that only a
 * click, a tap or Enter opens them (a shaking hand or a screen magnifier
 * otherwise opens and closes them by accident). Read when the pointer
 * arrives, so a listener needs no re-render when the setting changes.
 */
export function hoverOpens(): boolean {
  return useSettingsStore.getState().openOnHover !== false;
}
