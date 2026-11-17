import { isSingleCharacterKey } from "@/lib/keyboard";
import { useSettingsStore } from "@/stores/settings-store";

/**
 * True when the user turned single-key shortcuts off (Settings >
 * Accessibility) and this key press is one: a printable character without
 * Ctrl, Alt or ⌘. Read at the time of the key press, so a window listener
 * needs no re-subscribe when the setting changes.
 */
export function isSingleKeyShortcutOff(event: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey">): boolean {
  return isSingleCharacterKey(event) && useSettingsStore.getState().singleKeyShortcuts === false;
}
