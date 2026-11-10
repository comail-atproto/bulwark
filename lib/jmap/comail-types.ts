import type {} from './client-interface';
import type { Calendar, CalendarEvent, CalendarRights, Principal } from './types';
import type { PublicCalendarRsvpStatus, PublicCalendarWriteResult, SpaceCalendarPersonalProperties } from './space-calendar-adapter';

// Keep this in .ts so skipLibCheck cannot hide incompatible upstream declarations.
declare module './client-interface' {
  interface IJMAPClient {
    uploadFileBlob?: IJMAPClient['uploadBlob'];
    /** Calendars/events backed by the configured canonical ATProto Space, when the adapter is available. */
    getAtprotoSpaceCalendars?(): Promise<Calendar[]>;
    getAtprotoSpaceCalendarEvents?(after: string, before: string): Promise<CalendarEvent[]>;
    getAtprotoSpacePrincipals?(): Promise<Principal[]>;
    startAtprotoSpaceCalendarConsent?(): Promise<string>;
    getAtmoPublicCalendars?(): Promise<Calendar[]>;
    getAtmoPublicCalendarEvents?(after: string, before: string): Promise<CalendarEvent[]>;
    getAtmoCalendarStale?(): boolean;
    startAtmoCalendarConsent?(): Promise<string>;
    setAtmoCalendarEnabled?(enabled: boolean): Promise<Calendar>;
    updateAtprotoSpaceCalendarEvent?(eventId: string, baseRevision: string, updates: Partial<CalendarEvent>): Promise<CalendarEvent>;
    updateAtprotoSpaceCalendarPrivateEvent?(eventId: string, basePersonalRevision: string, updates: Partial<SpaceCalendarPersonalProperties>, recurrenceId?: string, inherit?: Array<keyof SpaceCalendarPersonalProperties>): Promise<CalendarEvent>;
    rsvpAtprotoSpaceCalendarEvent?(eventId: string, baseRevision: string, status: string, recurrenceId?: string): Promise<CalendarEvent>;
    cancelAtprotoSpaceCalendarEvent?(eventId: string, baseRevision: string, calendarId: string): Promise<CalendarEvent>;
    createAtprotoSpaceCalendarEvent?(calendarId: string, event: Partial<CalendarEvent>, sendSchedulingMessages?: boolean): Promise<CalendarEvent>;
    subscribeAtprotoPublicCalendarEvent?(event: CalendarEvent): Promise<CalendarEvent>;
    rsvpAtprotoPublicCalendarEvent?(event: CalendarEvent, status: PublicCalendarRsvpStatus): Promise<PublicCalendarWriteResult>;
    publishAtprotoPublicCalendarEvent?(event: CalendarEvent): Promise<PublicCalendarWriteResult>;
    shareAtprotoSpaceCalendar?(calendarId: string, principalId: string, rights: CalendarRights | null): Promise<{ status: 'shared' | 'revoked' }>;
  }
}

declare module './types' {
  interface Calendar {
    /** Data source for adapters that expose non-JMAP calendars through the same UI. */
    source?: 'jmap' | 'atproto-space' | 'atproto-public';
    /** Latest canonical source revision returned with a Space calendar. */
    spaceRevisionId?: string | null;
    /** Current policy revision used for Space membership revocation. */
    spacePolicyId?: string | null;
    /** Fixed owner-configured role available to the invitee in the existing share control. */
    spaceOfferRole?: 'viewer' | 'editor';
    /** Whether the fixed Space already contains its initial calendar event. */
    spaceInitialized?: boolean;
    /** The configured member has a pending invitation but has not completed consent. */
    spaceConsentRequired?: boolean;
    atmoSourceState?: string;
    atmoActorDid?: string;
    /** The last public-source refresh failed; cached events may be shown. */
    atmoStale?: boolean;
    /** Authenticated Space role from the canonical current owner policy. */
    spaceRole?: 'owner' | 'editor' | 'viewer' | null;
  }
  interface CalendarEvent {
    /** Data source for adapters that expose non-JMAP events through the same UI. */
    source?: 'jmap' | 'atproto-space' | 'atproto-public';
    /** Canonical revision used as the base for a Space event command. */
    spaceRevisionId?: string;
    /** Actor-private state token, separate from the shared command base. */
    spacePersonalRevisionId?: string;
    atprotoUri?: string;
    atprotoCid?: string;
    /** Current actor RSVP revision used as the public write precondition. */
    atmoRsvpCid?: string;
    atprotoCreatorDid?: string;
    atmoAttendance?: 'hosting' | 'going' | 'interested';
    atmoEndUnspecified?: boolean;
    /** Authoritative shared overrides before any actor-private projection. */
    spaceSharedRecurrenceOverrides?: CalendarEvent['recurrenceOverrides'];
    /** Identity facts returned by the authenticated Space adapter, never JMAP data. */
    spaceActorDid?: string;
    spaceOwnerDid?: string;
  }
  interface CalendarParticipant {
    /** Optional ATProto identity supplied by the authenticated Space calendar adapter. */
    did?: string;
    /** True only when the canonical source matched this participant to its authenticated caller. */
    isCurrentUser?: boolean;
  }
  interface FileNode {
    source?: 'space';
  }
}
