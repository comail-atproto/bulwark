import { useSettingsStore } from '@/stores/settings-store';

/** What a confirm dialog hook (useConfirmDialog) takes. */
export type ConfirmFn = (options: {
  title: string;
  message: string;
  confirmText?: string;
  variant?: 'default' | 'destructive';
}) => Promise<boolean>;

/** `t` of the `email_list.confirm_remove` namespace. */
export type RemovalConfirmT = (key: string, values: { count: number }) => string;

/**
 * Asks before messages are deleted or archived when the user turned on
 * "Confirm before deleting" or "Confirm before archiving" (Settings >
 * Accessibility; WCAG 3.3.4). Applies to single messages and keyboard
 * shortcuts as well as selections. Resolves true when the action may go
 * ahead: the setting is off, or the user confirmed.
 *
 * A permanent delete has its own, stronger question; ask this one only when
 * no other confirmation is shown, so nobody is asked twice.
 */
export async function confirmMailRemoval(
  kind: 'delete' | 'archive',
  count: number,
  confirm: ConfirmFn,
  t: RemovalConfirmT,
): Promise<boolean> {
  const settings = useSettingsStore.getState();
  if (!(kind === 'delete' ? settings.confirmDelete : settings.confirmArchive)) return true;
  if (count <= 0) return true;
  return confirm({
    title: t(`${kind}_title`, { count }),
    message: t(`${kind}_message`, { count }),
    confirmText: t(kind, { count }),
    variant: kind === 'delete' ? 'destructive' : 'default',
  });
}
