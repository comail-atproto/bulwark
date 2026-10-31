import { withBasePath } from '@/lib/browser-navigation';

export type AccessApprovalNotificationRequest = {
  id: number;
  expiresAt: string;
};

const NOTIFICATION_TAG = 'comail-access-approval';

/** Remove a stale approval wake-up once Inbox observes a terminal state. */
export async function dismissAccessApprovalNotification(): Promise<void> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  try {
    const registration = await navigator.serviceWorker.ready;
    if (typeof registration.getNotifications !== 'function') return;
    const notifications = await registration.getNotifications({
      tag: NOTIFICATION_TAG,
    });
    notifications.forEach((notification) => notification.close());
  } catch {
    // Notification cleanup is best effort and must not affect approval state.
  }
}

/**
 * Surface an already-authorized browser notification for a pending login.
 *
 * This deliberately never asks for notification permission. The access-
 * approval endpoint is DID-gated by the server, and this helper is useful only
 * when that endpoint returned an authoritative request and the account owner
 * has independently granted notification permission. Request details stay in
 * Inbox; the system notification is only an opaque wake-up signal.
 */
export async function showAccessApprovalNotification(request: AccessApprovalNotificationRequest): Promise<boolean> {
  if (typeof window === 'undefined' || typeof document === 'undefined') return false;
  if (document.visibilityState !== 'hidden') return false;
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return false;
  if (!('serviceWorker' in navigator)) return false;
  if (Date.parse(request.expiresAt) <= Date.now()) return false;

  try {
    const registration = await navigator.serviceWorker.ready;
    await registration.showNotification('New Atmosphere login', {
      body: 'Open comail Inbox to review this sign-in request.',
      tag: NOTIFICATION_TAG,
      icon: withBasePath('/branding/comail/cammie-mark.png'),
      badge: withBasePath('/branding/comail/cammie-mark.png'),
      data: { kind: 'access-approval' },
    });
    return true;
  } catch {
    // A notification failure must not interfere with the in-app approval
    // dialog. The active client keeps polling and can still render the request.
    return false;
  }
}
