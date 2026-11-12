import { useEffect, useRef } from 'react';

export function useCalendarAutoRefresh(enabled: boolean, refresh: () => Promise<void>): void {
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  const inFlight = useRef(false);

  useEffect(() => {
    if (!enabled) return;
    const run = () => {
      if (document.visibilityState !== 'visible' || inFlight.current) return;
      inFlight.current = true;
      void refreshRef.current().catch(() => {}).finally(() => { inFlight.current = false; });
    };
    const interval = window.setInterval(run, 60_000);
    document.addEventListener('visibilitychange', run);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', run);
    };
  }, [enabled]);
}
