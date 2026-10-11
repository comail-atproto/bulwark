import type { ContactCard, CalendarEvent, Calendar, PartialDate, Timestamp } from '@/lib/jmap/types';
import { getContactDisplayName } from '@/stores/contact-store';
import { eachYearOfInterval, parseISO } from 'date-fns';

export const BIRTHDAY_CALENDAR_ID = '__birthday-calendar__';
export const BIRTHDAY_CALENDAR_COLOR = '#eab308'; // Yellow

/**
 * Virtual calendar object for the contact birthday calendar.
 */
export function createBirthdayCalendar(name?: string, color?: string): Calendar {
  return {
    id: BIRTHDAY_CALENDAR_ID,
    name: name || 'Birthdays',
    description: null,
    color: color || BIRTHDAY_CALENDAR_COLOR,
    sortOrder: 999,
    isSubscribed: true,
    isVisible: true,
    isDefault: false,
    includeInAvailability: 'none',
    defaultAlertsWithTime: null,
    defaultAlertsWithoutTime: null,
    timeZone: null,
    shareWith: null,
    myRights: {
      mayReadFreeBusy: true,
      mayReadItems: true,
      mayWriteAll: false,
      mayWriteOwn: false,
      mayUpdatePrivate: false,
      mayRSVP: false,
      mayShare: false,
      mayDelete: false,
    },
  };
}

/**
 * Extract month and day from an AnniversaryDate.
 * Returns null if the date cannot be parsed into month/day.
 */
function parseBirthdayDate(date: string | PartialDate | Timestamp): { month: number; day: number; year?: number } | null {
  // A birthday is a calendar date, not an instant. Parsing it through a local
  // Date and reading getMonth/getDate/getFullYear would shift the day whenever
  // the timestamp's UTC instant lands on a different calendar day in the
  // host's local timezone (e.g. a UTC-midnight Timestamp parsed in a negative
  // offset like America/New_York rolls back to the prior day). Parse the
  // date-only components directly, and read UTC components for instant-typed
  // Timestamps so the result is identical in every timezone.
  if (typeof date === 'string') {
    // Could be ISO date string like "1990-05-15" or partial "--05-15"
    if (date.startsWith('--')) {
      // Partial date: --MM-DD
      const match = date.match(/^--(\d{2})-(\d{2})$/);
      if (match) {
        return { month: parseInt(match[1], 10), day: parseInt(match[2], 10) };
      }
      return null;
    }
    // Plain calendar date "YYYY-MM-DD" — read the components verbatim so the
    // day does not drift with the host timezone.
    const dateOnly = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (dateOnly) {
      return {
        year: parseInt(dateOnly[1], 10),
        month: parseInt(dateOnly[2], 10),
        day: parseInt(dateOnly[3], 10),
      };
    }
    try {
      const parsed = parseISO(date);
      if (!isNaN(parsed.getTime())) {
        return {
          month: parsed.getUTCMonth() + 1,
          day: parsed.getUTCDate(),
          year: parsed.getUTCFullYear(),
        };
      }
    } catch {
      return null;
    }
    return null;
  }

  if ('utc' in date && date['@type'] === 'Timestamp') {
    // Timestamp type — an instant, not a calendar date. Read UTC components so
    // the anniversary day is stable regardless of host timezone.
    try {
      const parsed = parseISO(date.utc);
      if (!isNaN(parsed.getTime())) {
        return {
          month: parsed.getUTCMonth() + 1,
          day: parsed.getUTCDate(),
          year: parsed.getUTCFullYear(),
        };
      }
    } catch {
      return null;
    }
    return null;
  }

  // PartialDate type
  const partial = date as PartialDate;
  if (partial.month && partial.day) {
    return {
      month: partial.month,
      day: partial.day,
      year: partial.year || undefined,
    };
  }

  return null;
}

/**
 * Generate virtual CalendarEvent objects from contacts that have birthday anniversaries.
 * Events are generated for each year in the given date range.
 */
export function generateBirthdayEvents(
  contacts: ContactCard[],
  rangeStart: string,
  rangeEnd: string,
): CalendarEvent[] {
  const events: CalendarEvent[] = [];
  const start = parseISO(rangeStart);
  const end = parseISO(rangeEnd);

  if (isNaN(start.getTime()) || isNaN(end.getTime())) {
    return events;
  }

  const years = eachYearOfInterval({ start, end });
  // Also include the end date's year if not already covered
  const endYear = end.getFullYear();
  if (!years.some(y => y.getFullYear() === endYear)) {
    years.push(new Date(endYear, 0, 1));
  }

  for (const contact of contacts) {
    if (!contact.anniversaries) continue;

    for (const [key, anniversary] of Object.entries(contact.anniversaries)) {
      if (anniversary.kind !== 'birth') continue;

      const parsed = parseBirthdayDate(anniversary.date);
      if (!parsed) continue;

      const displayName = getContactDisplayName(contact);
      if (!displayName) continue;

      for (const yearDate of years) {
        const year = yearDate.getFullYear();
        // Handle Feb 29 in non-leap years: JS silently rolls over to Mar 1,
        // but the ISO eventStart string would be invalid. Clamp to Feb 28.
        let occMonth = parsed.month;
        let occDay = parsed.day;
        const occurrenceDate = new Date(year, occMonth - 1, occDay);
        if (occurrenceDate.getMonth() !== occMonth - 1) {
          occurrenceDate.setDate(0); // last day of previous month
          occMonth = occurrenceDate.getMonth() + 1;
          occDay = occurrenceDate.getDate();
        }
        if (occurrenceDate < start || occurrenceDate > end) continue;

        const monthStr = String(occMonth).padStart(2, '0');
        const dayStr = String(occDay).padStart(2, '0');
        const eventStart = `${year}-${monthStr}-${dayStr}T00:00:00`;

        const age = parsed.year ? year - parsed.year : undefined;
        const ageText = age && age > 0 ? ` (${age})` : '';

        const event: CalendarEvent = {
          id: `birthday-${contact.id}-${key}-${year}`,
          calendarIds: { [BIRTHDAY_CALENDAR_ID]: true },
          isDraft: false,
          isOrigin: false,
          utcStart: null,
          utcEnd: null,
          '@type': 'Event',
          uid: `birthday-${contact.id}-${key}`,
          title: `🎂 ${displayName}${ageText}`,
          description: '',
          descriptionContentType: 'text/plain',
          created: null,
          updated: '',
          sequence: 0,
          start: eventStart,
          duration: 'P1D',
          timeZone: null,
          showWithoutTime: true,
          status: 'confirmed',
          freeBusyStatus: 'free',
          privacy: 'public',
          color: null,
          keywords: null,
          categories: null,
          locale: null,
          replyTo: null,
          organizerCalendarAddress: null,
          participants: null,
          mayInviteSelf: false,
          mayInviteOthers: false,
          hideAttendees: false,
          recurrenceId: null,
          recurrenceIdTimeZone: null,
          recurrenceRules: null,
          recurrenceOverrides: null,
          excludedRecurrenceRules: null,
          useDefaultAlerts: false,
          alerts: null,
          locations: null,
          virtualLocations: null,
          links: null,
          relatedTo: null,
        };

        events.push(event);
      }
    }
  }

  return events;
}
