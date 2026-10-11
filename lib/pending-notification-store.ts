import { create, type StoreApi, type UseBoundStore } from "zustand";
import type { IJMAPClient } from "@/lib/jmap/client-interface";

/**
 * A server-side notification inbox (RFC 9670 ShareNotification,
 * draft-ietf-jmap-calendars CalendarEventNotification): the server records
 * an object per event, the client fetches them on login and on push, shows
 * them, and destroys them once shown. This factory holds the shared
 * fetch / acknowledge bookkeeping; the toaster components do the showing.
 */
export interface PendingNotificationStore<T extends { id: string }> {
  /** Notifications fetched but not yet shown / acknowledged. */
  pending: T[];
  fetch: (client: IJMAPClient) => Promise<void>;
  /** Acknowledge shown notifications: drop them locally and destroy them on the server. */
  acknowledge: (client: IJMAPClient, ids: string[]) => Promise<void>;
  reset: () => void;
}

interface PendingNotificationSource<T> {
  /** Log label. */
  name: string;
  /** Lists the notifications, or null when the client cannot (demo, capability missing). */
  list: (client: IJMAPClient) => Promise<T[]> | null;
  destroy: (client: IJMAPClient, ids: string[]) => Promise<void> | undefined;
}

export function createPendingNotificationStore<T extends { id: string }>(
  source: PendingNotificationSource<T>,
): UseBoundStore<StoreApi<PendingNotificationStore<T>>> {
  // Ids already handed to the toaster; a fetch racing an acknowledge must not
  // re-queue them.
  const seen = new Set<string>();
  let inFlight: Promise<void> | null = null;

  return create<PendingNotificationStore<T>>((set, get) => ({
    pending: [],

    fetch: (client) => {
      // Coalesce: a push arriving while the previous fetch runs joins it.
      if (inFlight) return inFlight;
      const listing = source.list(client);
      if (!listing) return Promise.resolve();
      inFlight = (async () => {
        try {
          const list = await listing;
          const fresh = list.filter((n) => !seen.has(n.id));
          if (fresh.length === 0) return;
          for (const n of fresh) seen.add(n.id);
          set((state) => ({ pending: [...state.pending, ...fresh] }));
        } catch (error) {
          console.error(`Failed to fetch ${source.name}:`, error);
        } finally {
          inFlight = null;
        }
      })();
      return inFlight;
    },

    acknowledge: async (client, ids) => {
      if (ids.length === 0) return;
      const idSet = new Set(ids);
      set({ pending: get().pending.filter((n) => !idSet.has(n.id)) });
      try {
        await source.destroy(client, ids);
      } catch (error) {
        // Worst case the notification is shown again after a reload.
        console.error(`Failed to acknowledge ${source.name}:`, error);
      }
    },

    reset: () => {
      seen.clear();
      set({ pending: [] });
    },
  }));
}
