import { describe, it, expect } from 'vitest';
import type { CalendarEvent, CalendarParticipant, CalendarRights } from '@/lib/jmap/types';
import {
  getEventEditability,
  canUserRsvp,
  canUserEditPrivate,
  canCreateEventsIn,
  eventHasNoOwner,
  publicAtprotoOriginalLink,
  type EventEditability,
  type EditabilityContext,
} from '@/lib/calendar-editability';

function makeEvent(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    '@type': 'Event',
    id: 'ev1',
    uid: 'uid-ev1',
    calendarIds: { cal1: true },
    title: 'Test Event',
    description: '',
    descriptionContentType: 'text/plain',
    start: '2026-03-01T10:00:00',
    duration: 'PT1H',
    timeZone: 'UTC',
    showWithoutTime: false,
    status: 'confirmed',
    freeBusyStatus: 'busy',
    privacy: 'public',
    keywords: null,
    categories: null,
    color: null,
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
    utcStart: null,
    utcEnd: null,
    isDraft: false,
    isOrigin: true,
    sequence: 0,
    created: '2026-03-01T09:00:00Z',
    updated: '2026-03-01T09:00:00Z',
    locale: null,
    replyTo: null,
    organizerCalendarAddress: null,
    participants: null,
    mayInviteSelf: false,
    mayInviteOthers: false,
    hideAttendees: false,
    ...overrides,
  };
}

function makeRights(overrides: Partial<CalendarRights> = {}): CalendarRights {
  return {
    mayReadFreeBusy: false,
    mayReadItems: false,
    mayWriteAll: false,
    mayWriteOwn: false,
    mayUpdatePrivate: false,
    mayRSVP: false,
    mayShare: false,
    mayDelete: false,
    ...overrides,
  };
}

const ALL_RIGHTS = makeRights({
  mayReadFreeBusy: true, mayReadItems: true, mayWriteAll: true, mayWriteOwn: true,
  mayUpdatePrivate: true, mayRSVP: true, mayShare: true, mayDelete: true,
});
const READ_ONLY = makeRights({ mayReadFreeBusy: true, mayReadItems: true });
const WRITE_OWN = makeRights({
  mayReadFreeBusy: true, mayReadItems: true, mayWriteOwn: true, mayUpdatePrivate: true, mayRSVP: true,
});
const RSVP_ONLY = makeRights({
  mayReadFreeBusy: true, mayReadItems: true, mayUpdatePrivate: true, mayRSVP: true,
});

const SELF = 'alice@example.com';
const ALIAS = 'info@example.com';
const OTHER = 'carol@example.com';

const owner = (email: string): Partial<CalendarParticipant> => ({
  '@type': 'Participant', name: email, email, roles: { owner: true, attendee: true },
  sendTo: { imip: `mailto:${email}` }, participationStatus: 'accepted', kind: 'individual',
});
const attendee = (email: string): Partial<CalendarParticipant> => ({
  '@type': 'Participant', name: email, email, roles: { attendee: true },
  sendTo: { imip: `mailto:${email}` }, participationStatus: 'needs-action', kind: 'individual',
});

/** Build a context whose single calendar `cal1` carries the given rights. */
function ctx(
  rights: CalendarRights | null,
  addresses: string[] = [SELF],
  subscriptions: string[] = [],
): EditabilityContext {
  const calendarsById = new Map(rights ? [['cal1', { myRights: rights }]] : []);
  return {
    calendarsById,
    userCalendarAddresses: addresses,
    isSubscriptionCalendar: (id) => subscriptions.includes(id),
  };
}

describe('canCreateEventsIn (issue #762)', () => {
  const sub = (id: string) => id === 'sub';
  it('allows a writable, non-subscription calendar', () => {
    expect(canCreateEventsIn({ id: 'c', myRights: ALL_RIGHTS }, sub)).toBe(true);
    expect(canCreateEventsIn({ id: 'c', myRights: WRITE_OWN }, sub)).toBe(true);
  });
  it('rejects a read-only calendar', () => {
    expect(canCreateEventsIn({ id: 'c', myRights: READ_ONLY }, sub)).toBe(false);
    expect(canCreateEventsIn({ id: 'c', myRights: RSVP_ONLY }, sub)).toBe(false);
  });
  it('rejects an iCal subscription even when its Stalwart rights are writable', () => {
    expect(canCreateEventsIn({ id: 'sub', myRights: ALL_RIGHTS }, sub)).toBe(false);
  });
  it('is permissive when myRights is absent (local/birthday calendars)', () => {
    expect(canCreateEventsIn({ id: 'c', myRights: undefined as never }, sub)).toBe(true);
  });
});

describe('eventHasNoOwner', () => {
  it('is true for a plain event with no participants/organizer', () => {
    expect(eventHasNoOwner(makeEvent())).toBe(true);
  });
  it('is false when an owner-role participant exists', () => {
    expect(eventHasNoOwner(makeEvent({ participants: { a: owner(SELF) } as never }))).toBe(false);
  });
  it('is false when an event-level organizer address exists', () => {
    expect(eventHasNoOwner(makeEvent({ organizerCalendarAddress: `mailto:${OTHER}` }))).toBe(false);
  });
  it('is false when a reply destination exists', () => {
    expect(eventHasNoOwner(makeEvent({ replyTo: { imip: `mailto:${OTHER}` } }))).toBe(false);
  });
  it('is true when only non-owner participants exist', () => {
    expect(eventHasNoOwner(makeEvent({ participants: { b: attendee(OTHER) } as never }))).toBe(true);
  });
});

describe('getEventEditability - calendar rights gate', () => {
  it('mayWriteAll -> editable even when the user is not the organizer', () => {
    const ev = makeEvent({ isOrigin: false, organizerCalendarAddress: `mailto:${OTHER}`,
      participants: { a: owner(OTHER), b: attendee(SELF) } as never });
    expect(getEventEditability(ev, ctx(ALL_RIGHTS))).toBe('editable');
  });

  it('read-only calendar -> read-only even for an event the user organizes', () => {
    const ev = makeEvent({ organizerCalendarAddress: `mailto:${SELF}`,
      participants: { a: owner(SELF) } as never });
    expect(getEventEditability(ev, ctx(READ_ONLY))).toBe('read-only');
  });

  it('mayWriteOwn + user is organizer -> editable', () => {
    const ev = makeEvent({ participants: { a: owner(SELF), b: attendee(OTHER) } as never });
    expect(getEventEditability(ev, ctx(WRITE_OWN))).toBe('editable');
  });

  it('mayWriteOwn + user is a mere attendee -> rsvp-only (cannot edit body)', () => {
    const ev = makeEvent({ isOrigin: false, organizerCalendarAddress: `mailto:${OTHER}`,
      participants: { a: owner(OTHER), b: attendee(SELF) } as never });
    expect(getEventEditability(ev, ctx(WRITE_OWN))).toBe('rsvp-only');
  });

  it('mayWriteOwn + ownerless event -> editable', () => {
    const ev = makeEvent({ participants: { b: attendee(SELF) } as never });
    expect(getEventEditability(ev, ctx(WRITE_OWN))).toBe('editable');
  });

  it('RSVP-only rights + participant -> rsvp-only', () => {
    const ev = makeEvent({ isOrigin: false, organizerCalendarAddress: `mailto:${OTHER}`,
      participants: { a: owner(OTHER), b: attendee(SELF) } as never });
    expect(getEventEditability(ev, ctx(RSVP_ONLY))).toBe('rsvp-only');
  });

  it('RSVP-only rights + user is NOT a participant -> read-only', () => {
    const ev = makeEvent({ isOrigin: false, organizerCalendarAddress: `mailto:${OTHER}`,
      participants: { a: owner(OTHER), b: attendee('dave@example.com') } as never });
    expect(getEventEditability(ev, ctx(RSVP_ONLY))).toBe('read-only');
  });

  it('no write / no rsvp rights -> read-only', () => {
    const ev = makeEvent({ participants: { a: owner(SELF) } as never });
    expect(getEventEditability(ev, ctx(READ_ONLY))).toBe('read-only');
  });
});

describe('getEventEditability - subscription calendars', () => {
  it('an event in a client-side iCal subscription is read-only regardless of rights/organizer', () => {
    const ev = makeEvent({ organizerCalendarAddress: `mailto:${SELF}`,
      participants: { a: owner(SELF) } as never });
    // Even if the (irrelevant) rights map says all-writable, the subscription wins.
    expect(getEventEditability(ev, ctx(ALL_RIGHTS, [SELF], ['cal1']))).toBe('read-only');
  });
});

describe('getEventEditability - unknown calendar rights', () => {
  it('own origin copy is editable when rights are not yet loaded', () => {
    expect(getEventEditability(makeEvent({ isOrigin: true }), ctx(null))).toBe('editable');
  });
  it('a delivered (non-origin) copy stays read-only until rights load', () => {
    expect(getEventEditability(makeEvent({ isOrigin: false }), ctx(null))).toBe('read-only');
  });
});

describe('getEventEditability - alias over-permissiveness regression', () => {
  it('organizer == account alias in a READ-ONLY shared calendar -> read-only (not editable)', () => {
    // The alias branch would have matched isOrganizer and opened the editor; the
    // rights gate must keep it read-only.
    const ev = makeEvent({ isOrigin: false, organizerCalendarAddress: `mailto:${ALIAS}`,
      participants: { a: owner(ALIAS) } as never });
    expect(getEventEditability(ev, ctx(READ_ONLY, [SELF, ALIAS]))).toBe('read-only');
  });

  it('organizer == account alias in a WRITE-OWN calendar -> editable (legitimate alias edit)', () => {
    const ev = makeEvent({ organizerCalendarAddress: `mailto:${ALIAS}`,
      participants: { a: owner(ALIAS) } as never });
    expect(getEventEditability(ev, ctx(WRITE_OWN, [SELF, ALIAS]))).toBe('editable');
  });
});

describe('getEventEditability - multi-calendar membership', () => {
  it('requires the right on EVERY calendar (a read-only member blocks edit)', () => {
    const ev = makeEvent({ calendarIds: { cal1: true, cal2: true },
      participants: { a: owner(SELF) } as never });
    const context: EditabilityContext = {
      calendarsById: new Map([
        ['cal1', { myRights: ALL_RIGHTS }],
        ['cal2', { myRights: READ_ONLY }],
      ]),
      userCalendarAddresses: [SELF],
      isSubscriptionCalendar: () => false,
    };
    expect(getEventEditability(ev, context)).toBe('read-only');
  });
});

describe('getEventEditability - matrix sanity', () => {
  const cases: Array<[string, CalendarRights, boolean, EventEditability]> = [
    ['writeAll/organizer', ALL_RIGHTS, true, 'editable'],
    ['writeAll/attendee', ALL_RIGHTS, false, 'editable'],
    ['writeOwn/organizer', WRITE_OWN, true, 'editable'],
    ['writeOwn/attendee', WRITE_OWN, false, 'rsvp-only'],
    ['rsvpOnly/attendee', RSVP_ONLY, false, 'rsvp-only'],
    ['readOnly/organizer', READ_ONLY, true, 'read-only'],
    ['readOnly/attendee', READ_ONLY, false, 'read-only'],
  ];
  it.each(cases)('%s -> %s', (_label, rights, userIsOrganizer, expected) => {
    const ev = userIsOrganizer
      ? makeEvent({ participants: { a: owner(SELF), b: attendee(OTHER) } as never })
      : makeEvent({ isOrigin: false, organizerCalendarAddress: `mailto:${OTHER}`,
          participants: { a: owner(OTHER), b: attendee(SELF) } as never });
    expect(getEventEditability(ev, ctx(rights))).toBe(expected);
  });
});

/**
 * Stalwart shape: participants carry only `calendarAddress` (no email/sendTo)
 * and the organizer is additionally named by `organizerCalendarAddress`.
 */
function receivedInvite(attendeeAddress = SELF): CalendarEvent {
  return makeEvent({
    isOrigin: false,
    organizerCalendarAddress: `mailto:${OTHER}`,
    participants: {
      att: {
        '@type': 'Participant', calendarAddress: `mailto:${attendeeAddress}`,
        participationStatus: 'needs-action', expectReply: true,
        roles: { attendee: true, required: true },
      },
      org: {
        '@type': 'Participant', calendarAddress: `mailto:${OTHER}`,
        participationStatus: 'accepted',
        roles: { owner: true, required: true },
      },
    } as never,
  });
}

describe('canUserRsvp (issue #937)', () => {
  it('is true for an externally organized invite in the user\'s own calendar', () => {
    expect(canUserRsvp(receivedInvite(), ctx(ALL_RIGHTS))).toBe(true);
  });

  it('leaves the 1.9 rights-first editability of that invite untouched', () => {
    // Must not regress 1.9 functionality
    expect(getEventEditability(receivedInvite(), ctx(ALL_RIGHTS))).toBe('editable');
  });

  it('is true when the invited address is an account alias', () => {
    expect(canUserRsvp(receivedInvite(ALIAS), ctx(ALL_RIGHTS, [SELF, ALIAS]))).toBe(true);
  });

  it('agrees with the rsvp-only editability state', () => {
    const ev = receivedInvite();
    expect(getEventEditability(ev, ctx(RSVP_ONLY))).toBe('rsvp-only');
    expect(canUserRsvp(ev, ctx(RSVP_ONLY))).toBe(true);
  });

  it('is false for the organizer of their own event', () => {
    const ev = makeEvent({ organizerCalendarAddress: `mailto:${SELF}`,
      participants: { a: owner(SELF), b: attendee(OTHER) } as never });
    expect(canUserRsvp(ev, ctx(ALL_RIGHTS))).toBe(false);
  });

  it('is false when the user is not a participant at all', () => {
    expect(canUserRsvp(receivedInvite(OTHER), ctx(ALL_RIGHTS, ['dave@example.com']))).toBe(false);
  });

  it('is false for a plain event with no organizer or participants', () => {
    expect(canUserRsvp(makeEvent(), ctx(ALL_RIGHTS))).toBe(false);
  });

  it('is false without mayRSVP on the calendar', () => {
    expect(canUserRsvp(receivedInvite(), ctx(READ_ONLY))).toBe(false);
  });

  it('is false in an iCal subscription', () => {
    expect(canUserRsvp(receivedInvite(), ctx(ALL_RIGHTS, [SELF], ['cal1']))).toBe(false);
  });

  it('is false while the calendar rights are still unloaded', () => {
    expect(canUserRsvp(receivedInvite(), ctx(null))).toBe(false);
  });

  it('requires mayRSVP on every calendar the event belongs to', () => {
    const ev = receivedInvite();
    ev.calendarIds = { cal1: true, cal2: true };
    const context: EditabilityContext = {
      calendarsById: new Map([
        ['cal1', { myRights: ALL_RIGHTS }],
        ['cal2', { myRights: READ_ONLY }],
      ]),
      userCalendarAddresses: [SELF],
      isSubscriptionCalendar: () => false,
    };
    expect(canUserRsvp(ev, context)).toBe(false);
  });
});


describe('private event settings rights', () => {
  it('keeps private reminders available on a linked public copy', () => {
    const event = makeEvent({ source: 'atproto-space', atprotoUri: 'at://did:plc:organizer/community.lexicon.calendar.event/3m3z2a2b3c4d5' });
    const context = ctx(makeRights({ mayReadItems: true, mayUpdatePrivate: true }));
    expect(canUserEditPrivate(event, context)).toBe(true);
    expect(getEventEditability(event, context)).toBe('read-only');
  });

  it('allows a viewer’s own private settings without granting shared editing or RSVP', () => {
    const event = makeEvent({ isOrigin: false });
    const context = ctx(makeRights({ mayReadItems: true, mayUpdatePrivate: true }));
    expect(canUserEditPrivate(event, context)).toBe(true);
    expect(getEventEditability(event, context)).toBe('read-only');
    expect(canUserRsvp(event, context)).toBe(false);
  });

  it('requires loaded private rights on every included calendar and denies subscriptions', () => {
    expect(canUserEditPrivate(makeEvent(), ctx(null))).toBe(false);
    expect(canUserEditPrivate(makeEvent(), ctx(READ_ONLY))).toBe(false);
    expect(canUserEditPrivate(makeEvent(), ctx(ALL_RIGHTS, [SELF], ['cal1']))).toBe(false);
    expect(canUserEditPrivate(makeEvent({ calendarIds: {} }), ctx(ALL_RIGHTS))).toBe(false);
    expect(canUserEditPrivate(makeEvent({ calendarIds: { cal1: true, missing: true } }), ctx(ALL_RIGHTS))).toBe(false);
    expect(canUserEditPrivate(makeEvent({ calendarIds: { cal1: true, unused: false } }), ctx(ALL_RIGHTS))).toBe(true);
  });
});


describe('Atmosphere public source guards', () => {
  it.each([
    { source: 'atproto-public' },
    { id: 'atmo:event' },
    { id: 'account::atmo:event' },
    { calendarIds: { 'atmo:calendar': true } },
    { originalId: 'atmo:event' },
  ])('keeps %j read-only despite writable rights or missing calendar metadata', identity => {
    const event = makeEvent(identity as Partial<CalendarEvent>);
    for (const calendarsById of [new Map(), new Map([['cal1', { myRights: ALL_RIGHTS }]])]) {
      const ctx = { calendarsById, userCalendarAddresses: ['me@example.com'], isSubscriptionCalendar: () => false };
      expect(getEventEditability(event, ctx)).toBe('read-only');
      expect(canUserRsvp(event, ctx)).toBe(false);
      expect(canUserEditPrivate(event, ctx)).toBe(false);
    }
  });

  it('does not offer a reserved public calendar as an event destination', () => {
    expect(canCreateEventsIn({ id: 'atmo:calendar', myRights: ALL_RIGHTS })).toBe(false);
  });
});


describe('original public Atmo event link', () => {
  const uri = 'at://did:plc:synthetic/community.lexicon.calendar.event/3l3d3d3d3d3d3';
  const href = 'https://atmo.rsvp/p/did%3Aplc%3Asynthetic/e/3l3d3d3d3d3d3';
  const event = makeEvent({ id: 'atmo:event', source: 'atproto-public', atprotoUri: uri,
    links: { atmo: { '@type': 'Link', href, cid: null, contentType: 'text/html', size: null, rel: 'describedby', display: null, title: 'Atmo' } } } as Partial<CalendarEvent>);

  it('uses the stored link only when it matches the exact public record', () => {
    expect(publicAtprotoOriginalLink(event)).toBe(href);
  });

  it.each(['javascript:alert(1)', 'https://atmo.rsvp.evil.test/p/did%3Aplc%3Asynthetic/e/3l3d3d3d3d3d3',
    href + '?redirect=https://evil.test', href + '#fragment', href.replace('https:', 'http:'), href.replace('3l3d3d3d3d3d3', '3l3e3e3e3e3e3')])('rejects a changed link %s', changed => {
    expect(publicAtprotoOriginalLink({ ...event, links: { atmo: { ...event.links!.atmo, href: changed } } })).toBeNull();
  });

  it('requires the public source and a valid community event identity', () => {
    expect(publicAtprotoOriginalLink({ ...event, id: 'jmap', source: 'jmap' })).toBeNull();
    expect(publicAtprotoOriginalLink({ ...event, atprotoUri: uri.replace('calendar.event', 'calendar.rsvp') })).toBeNull();
  });
});
