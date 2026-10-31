import type { CalendarEventNotification } from "@/lib/jmap/types";
import { createPendingNotificationStore } from "@/lib/pending-notification-store";

/**
 * CalendarEventNotification (draft-ietf-jmap-calendars §7) inbox: the server
 * records every invitation, update and cancellation another participant
 * made to an event this user takes part in. Pulled on login and on every
 * `CalendarEventNotification` push; the toaster shows them and acknowledges
 * them, which destroys them server-side.
 */
export const useCalendarEventNotificationStore = createPendingNotificationStore<CalendarEventNotification>({
  name: "calendar event notifications",
  list: (client) =>
    client.supportsCalendars() && client.getCalendarEventNotifications ? client.getCalendarEventNotifications() : null,
  destroy: (client, ids) => client.destroyCalendarEventNotifications?.(ids),
});
