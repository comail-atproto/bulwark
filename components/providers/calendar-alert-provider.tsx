"use client";

import { useCalendarAlerts } from '@/hooks/use-calendar-alerts';
import { ToastContainer } from '@/components/ui/toast';
import { useToastStore } from '@/stores/toast-store';

export function CalendarAlertProvider({ children }: { children: React.ReactNode }) {
  useCalendarAlerts();

  const toasts = useToastStore((s) => s.toasts);
  const removeToast = useToastStore((s) => s.removeToast);

  return (
    <>
      {children}
      <ToastContainer toasts={toasts} onClose={removeToast} />
    </>
  );
}
