"use client";

import { useMemo } from "react";
import { useFormatter, type DateTimeFormatOptions } from "next-intl";
import { getBrowserTimeZone } from "@/lib/timezone";

/**
 * next-intl formatter for *display dates* - calendar grid days and the
 * results of getEventStartDate() / getEventEndDate(), whose local fields
 * already read as the wall-clock in the user's effective time zone.
 *
 * The app-wide formatter renders every date in the user's time zone override
 * (#755), which would shift a display date a second time and mislabel day
 * headers and hour gutters. Pinning the runtime's own zone makes Intl render
 * the Date's local fields unchanged - exactly what a display date encodes.
 */
export function useDisplayDateFormatter() {
  const format = useFormatter();
  return useMemo(() => {
    const timeZone = getBrowserTimeZone();
    return {
      dateTime: (date: Date | number, options?: DateTimeFormatOptions) =>
        format.dateTime(date, { ...options, timeZone }),
    };
  }, [format]);
}
