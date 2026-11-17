import { useSettingsStore } from '@/stores/settings-store';
import { usePolicyStore } from '@/stores/policy-store';
import { toastDurationAtLeast } from '@/lib/accessibility-settings';
import type { Toast } from '@/components/ui/toast';

/** How long a toast stays when nothing else says so. */
export const DEFAULT_TOAST_MS = 5000;
/** Errors stay longer than other toasts. */
export const DEFAULT_ERROR_TOAST_MS = 10000;

/**
 * The "Notification duration" setting in seconds, raised to the admin's
 * minimum when it is below it. 0 keeps toasts until they are closed.
 */
export function userToastSeconds(): number {
  let value = 5;
  let min: number | undefined;
  try {
    const stored = useSettingsStore.getState().toastDuration;
    if (typeof stored === 'number' && stored >= 0) value = stored;
    const restriction = usePolicyStore.getState().getRestriction?.('toastDuration');
    if (typeof restriction?.min === 'number') min = restriction.min;
  } catch {
    // A store that isn't there yet (tests, the plugin sandbox): the default.
  }
  if (min !== undefined && !toastDurationAtLeast(value, min)) return min;
  return value;
}

/**
 * How long a toast that must not be missed stays: one with an action (Undo),
 * an error, a reminder. The setting makes it stay longer, never shorter than
 * `baseMs`, the time the caller picked; with "until closed" it stays until
 * it is closed.
 */
export function lastingToastDuration(baseMs: number): number {
  const seconds = userToastSeconds();
  if (seconds === 0 || baseMs <= 0) return 0;
  return Math.max(baseMs, seconds * 1000);
}

/**
 * The duration a new toast gets (WCAG 2.2.1). A toast with an action or an
 * error follows the setting (lastingToastDuration); a plain notice keeps
 * its own time. Progress toasts stay until they are updated, and a toast
 * whose action ends at a fixed time (Undo send, pauseOnHover: false) keeps
 * that time, since its countdown has to match it.
 */
export function effectiveToastDuration(
  toast: Pick<Toast, 'type' | 'duration' | 'action' | 'secondaryAction' | 'tertiaryAction' | 'pauseOnHover' | 'progress'>,
): number {
  const base = toast.duration ?? (toast.type === 'error' ? DEFAULT_ERROR_TOAST_MS : DEFAULT_TOAST_MS);
  if (base <= 0 || toast.progress !== undefined || toast.pauseOnHover === false) return base;
  const lasting = toast.type === 'error' || !!(toast.action || toast.secondaryAction || toast.tertiaryAction);
  return lasting ? lastingToastDuration(base) : base;
}
