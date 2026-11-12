import type { CalendarEvent, Calendar, CalendarRights } from '@/lib/jmap/types';
import { isOrganizer, getUserParticipantId } from '@/lib/calendar-participants';

export type EventEditability = 'editable' | 'rsvp-only' | 'read-only';

export function isPublicAtprotoCalendar(calendar: { id?: string; originalId?: string; source?: string }): boolean {
  return calendar.source === 'atproto-public' || [calendar.id, calendar.originalId].some(id => {
    if (!id) return false;
    const raw = id.includes('::') ? id.slice(id.lastIndexOf('::') + 2) : id;
    return raw.startsWith('atmo:');
  });
}

export function isPublicAtprotoEvent(event: {
  id?: string; originalId?: string; baseEventId?: string | null; source?: string;
  atprotoUri?: string;
  calendarIds?: Record<string, boolean>; originalCalendarIds?: Record<string, boolean>;
}): boolean {
  return event.source === 'atproto-space' && event.atprotoUri !== undefined
    || Object.keys(event).some(key => key.startsWith('calendarIds/') && isPublicAtprotoCalendar({ id: key.slice('calendarIds/'.length) }))
    || isPublicAtprotoCalendar(event) || isPublicAtprotoCalendar({ id: event.baseEventId ?? undefined })
    || [event.calendarIds, event.originalCalendarIds].some(ids => Object.entries(ids ?? {})
      .some(([id, included]) => included && isPublicAtprotoCalendar({ id })));
}

export function publicAtprotoOriginalLink(event: CalendarEvent): string | null {
  if (!isPublicAtprotoEvent(event) || !event.atprotoUri) return null;
  const identity = /^at:\/\/(did:(?:plc|web):[^/\s]+)\/community\.lexicon\.calendar\.event\/([234567abcdefghijklmnopqrstuvwxyz]{13})$/.exec(event.atprotoUri);
  if (!identity) return null;
  const expected = `https://atmo.rsvp/p/${encodeURIComponent(identity[1])}/e/${identity[2]}`;
  return event.source === 'atproto-space' || event.links?.atmo?.href === expected ? expected : null;
}

export interface EditabilityContext {
  /** Viewer's calendars by id; only their `myRights` is read. */
  calendarsById: ReadonlyMap<string, Pick<Calendar, 'myRights'>>;
  /** Identities + aliases; only refines owner/participant detection, never the gate. */
  userCalendarAddresses: string[];
  /** Client-side external iCal (webcal/ICS) subscriptions - always read-only. */
  isSubscriptionCalendar: (calendarId: string) => boolean;
}

/**
 * Whether new events may be created in / moved into this calendar: writable and
 * not a (read-only) iCal subscription. Bulwark subscriptions are real Stalwart
 * calendars with writable myRights, so the flag must be checked too (issue #762).
 */
export function canCreateEventsIn(
  calendar: Pick<Calendar, 'id' | 'myRights'> & Partial<Pick<Calendar, 'source' | 'originalId'>>,
  isSubscriptionCalendar?: (calendarId: string) => boolean,
): boolean {
  if (isPublicAtprotoCalendar(calendar) || isSubscriptionCalendar?.(calendar.id)) return false;
  const r = calendar.myRights;
  return !r || r.mayWriteAll || r.mayWriteOwn;
}

/** Ownerless (plain, non-scheduled) events are editable under `mayWriteOwn`. */
export function eventHasNoOwner(event: CalendarEvent): boolean {
  if (event.source === 'atproto-space' && event.spaceOwnerDid) return false;
  if (event.organizerCalendarAddress) return false;
  if (event.replyTo && Object.keys(event.replyTo).length > 0) return false;
  if (event.participants) {
    for (const p of Object.values(event.participants)) {
      if (p.roles?.owner) return false;
    }
  }
  return true;
}

/**
 * Editability gated on the calendar's `myRights` FIRST, then identity - so
 * read-only/subscription calendars stay read-only and an alias organizer can't
 * over-open events the user can't write. (Stalwart: organizer identity does not
 * confer calendar write; the ACL does.)
 */
export function getEventEditability(
  event: CalendarEvent,
  ctx: EditabilityContext,
): EventEditability {
  if (isPublicAtprotoEvent(event)) return 'read-only';
  const calIds = Object.keys(event.calendarIds ?? {});

  // Subscriptions have no write path and myRights can't describe them.
  if (calIds.some((id) => ctx.isSubscriptionCalendar(id))) return 'read-only';

  const rights = calIds
    .map((id) => ctx.calendarsById.get(id)?.myRights)
    .filter((r): r is CalendarRights => Boolean(r));

  // Rights not loaded: allow only the user's own origin copy for now.
  if (rights.length === 0) return event.isOrigin ? 'editable' : 'read-only';

  // Every calendar must grant the right (a read-only member blocks edit).
  const may = (k: keyof CalendarRights) => rights.every((r) => r[k]);
  const isOwner =
    isOrganizer(event, ctx.userCalendarAddresses) || eventHasNoOwner(event);

  if (may('mayWriteAll')) return 'editable';
  if (may('mayWriteOwn') && isOwner) return 'editable';

  const isParticipant =
    getUserParticipantId(event, ctx.userCalendarAddresses) != null;
  if (may('mayRSVP') && isParticipant) return 'rsvp-only';

  return 'read-only';
}

/** Private rights apply to this viewer’s settings without granting event-body edits. */
export function canUserEditPrivate(event: CalendarEvent, ctx: EditabilityContext): boolean {
  // A public overlay has no private state. A verified linked Space copy does:
  // reminders and other actor-private settings remain separate from its
  // organizer-owned public fields.
  if (isPublicAtprotoEvent(event) && event.source !== 'atproto-space') return false;
  const ids = Object.entries(event.calendarIds ?? {}).filter(([, included]) => included).map(([id]) => id);
  return ids.length > 0 && ids.every(id => !ctx.isSubscriptionCalendar(id)
    && ctx.calendarsById.get(id)?.myRights?.mayUpdatePrivate === true);
}

/**
 * Whether the viewer may RSVP to an event.
 *
 * Required because a received invite is delivered into the user's own calendar,
 * which generally has mayWriteAll as `true` ([#937]).
 */
export function canUserRsvp(
  event: CalendarEvent,
  ctx: EditabilityContext,
): boolean {
  if (isPublicAtprotoEvent(event)) return false;
  const calIds = Object.keys(event.calendarIds ?? {});

  // Subscriptions are a one-way copy; there is no scheduling path to reply on.
  if (calIds.some((id) => ctx.isSubscriptionCalendar(id))) return false;

  const rights = calIds
    .map((id) => ctx.calendarsById.get(id)?.myRights)
    .filter((r): r is CalendarRights => Boolean(r));

  // Rights not loaded: stay quiet rather than offer a reply that may be refused.
  if (rights.length === 0) return false;
  if (!rights.every((r) => r.mayRSVP)) return false;

  // The organizer does not reply to their own invite, and an ownerless event carries no scheduling request at all.
  if (isOrganizer(event, ctx.userCalendarAddresses)) return false;
  if (eventHasNoOwner(event)) return false;

  return getUserParticipantId(event, ctx.userCalendarAddresses) != null;
}
