import { create } from 'zustand';
import { persist } from 'zustand/middleware';

const RETENTION_THRESHOLD_MS = 24 * 60 * 60 * 1000;

interface CalendarNotificationStore {
  acknowledgedAlerts: Record<string, number>;
  acknowledgeAlert: (key: string, fireTimeMs: number) => void;
  isAcknowledged: (key: string) => boolean;
  cleanupStaleAlerts: () => void;
  clearAll: () => void;
}

export const useCalendarNotificationStore = create<CalendarNotificationStore>()(
  persist(
    (set, get) => ({
      acknowledgedAlerts: {},

      acknowledgeAlert: (key, fireTimeMs) => {
        set((state) => ({
          acknowledgedAlerts: { ...state.acknowledgedAlerts, [key]: fireTimeMs },
        }));
      },

      isAcknowledged: (key) => {
        return key in get().acknowledgedAlerts;
      },

      cleanupStaleAlerts: () => {
        const now = Date.now();
        const cleaned = Object.fromEntries(
          Object.entries(get().acknowledgedAlerts)
            .filter(([, fireTimeMs]) => now - fireTimeMs < RETENTION_THRESHOLD_MS)
        );
        set({ acknowledgedAlerts: cleaned });
      },

      clearAll: () => {
        set({ acknowledgedAlerts: {} });
      },
    }),
    {
      name: 'calendar-notification-storage',
      partialize: (state) => ({
        acknowledgedAlerts: state.acknowledgedAlerts,
      }),
    }
  )
);
