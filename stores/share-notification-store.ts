import type { ShareNotification } from "@/lib/jmap/types";
import { createPendingNotificationStore } from "@/lib/pending-notification-store";

/**
 * ShareNotification (RFC 9670 §3) inbox: the server records every change to
 * this user's rights on someone else's collection. Pulled on login and on
 * every `ShareNotification` push; the toaster component shows them
 * (translated) and acknowledges them, which destroys them server-side.
 */
export const useShareNotificationStore = createPendingNotificationStore<ShareNotification>({
  name: "share notifications",
  list: (client) =>
    client.supportsShareNotifications?.() && client.getShareNotifications ? client.getShareNotifications() : null,
  destroy: (client, ids) => client.destroyShareNotifications?.(ids),
});
