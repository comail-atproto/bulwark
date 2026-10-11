import { apiFetch } from '@/lib/browser-navigation';
import { parseISO } from 'date-fns';
import { fromWallClock, getEffectiveTimeZone } from '@/lib/timezone';
import { generateUUID } from '@/lib/utils';
import type { Calendar, CalendarEvent, CalendarParticipant, CalendarRights, Principal } from './types';

type SpaceRole = 'owner' | 'editor' | 'viewer';

export interface SpaceCalendarRecord {
  id: string;
  name: string;
  source: 'atproto-space';
  myRole: SpaceRole | null;
  initialized: boolean | null;
  pendingConsent?: true;
  revisionId?: string | null;
  policyId?: string | null;
  offerRole?: 'viewer' | 'editor';
  members?: Array<{ did: string; principalId?: string; role: SpaceRole; isCurrentUser?: boolean; status?: 'active' }>;
}

export interface SpaceShareResult {
  status: 'shared' | 'revoked';
}

export interface SpaceCalendarEventRecord {
  id: string;
  uid: string;
  calendarId: string;
  title: string;
  description: string;
  start: string;
  timeZone: string | null;
  duration: string;
  showWithoutTime: boolean;
  recurrenceRules?: CalendarEvent['recurrenceRules'];
  recurrenceOverrides?: CalendarEvent['recurrenceOverrides'];
  status: CalendarEvent['status'];
  participants?: Record<string, {
    did?: string;
    name?: string;
    participationStatus: CalendarParticipant['participationStatus'];
    isCurrentUser?: boolean;
  }>;
  actorDID?: string;
  ownerDID?: string;
  revisionId: string;
}

export class SpaceCalendarError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status?: number,
    readonly authorizationUrl?: string,
    readonly pendingCalendar?: SpaceCalendarRecord,
  ) {
    super(message);
    this.name = 'SpaceCalendarError';
  }
}

type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;

const EDITABLE_EVENT_FIELDS = new Set([
  'title', 'description', 'start', 'timeZone', 'duration', 'showWithoutTime',
  'recurrenceRules', 'recurrenceOverrides',
]);

export class SpaceCalendarAdapter {
  private readonly calendarsById = new Map<string, SpaceCalendarRecord>();

  constructor(
    private readonly getCookieSlot: () => number | undefined,
    private readonly fetcher: Fetcher = apiFetch,
  ) {}

  async getCalendars(): Promise<Calendar[]> {
    const slot = this.getCookieSlot();
    if (slot === undefined) return [];
    let body: { calendars?: SpaceCalendarRecord[] };
    try {
      body = await this.request('/calendars', slot);
    } catch (error) {
      // A missing binding means this account has no Space calendar configured.
      // Other failures remain visible so a configured canonical source cannot
      // disappear behind a successful JMAP-only result.
      if (error instanceof SpaceCalendarError && error.status === 404 && error.code === 'not_found') {
        this.calendarsById.clear();
        return [];
      }
      if (error instanceof SpaceCalendarError && error.code === 'authorization_required' && error.pendingCalendar) {
        this.calendarsById.clear();
        this.calendarsById.set(error.pendingCalendar.id, error.pendingCalendar);
        return [this.toPendingCalendar(error.pendingCalendar)];
      }
      throw error;
    }
    if (!Array.isArray(body.calendars)) throw new SpaceCalendarError('Invalid Space calendar response', 'invalid_response');
    this.calendarsById.clear();
    for (const record of body.calendars) {
      if (!record.id || !record.name || record.source !== 'atproto-space' || !isSpaceRole(record.myRole) || typeof record.initialized !== 'boolean'
        || (record.myRole === 'owner' && !isSpaceOfferRole(record.offerRole))
        || (record.myRole !== 'owner' && record.offerRole !== undefined)) {
        throw new SpaceCalendarError('Invalid Space calendar record', 'invalid_response');
      }
      this.calendarsById.set(record.id, record);
    }
    return body.calendars.map((record) => this.toCalendar(record));
  }

  async getPrincipals(): Promise<Principal[]> {
    const slot = this.getCookieSlot();
    if (slot === undefined) return [];
    const body = await this.request<{ principals?: Principal[] }>('/principals', slot);
    if (!Array.isArray(body.principals)) throw new SpaceCalendarError('Invalid Space principal response', 'invalid_response');
    return body.principals.map((principal) => {
      if (!principal.id || principal.type !== 'individual') throw new SpaceCalendarError('Invalid Space principal record', 'invalid_response');
      return { ...principal, name: principal.name || principal.email || principal.id };
    });
  }

  async startAuthorization(profile: 'owner-data' | 'owner-membership' | 'member-calendar'): Promise<string> {
    const slot = this.requireSlot();
    const path = profile === 'owner-data' ? '/owner/data/start'
      : profile === 'owner-membership' ? '/owner/membership/start' : '/member/consent/start';
    const start = await this.request<{ status?: unknown; authorizationUrl?: unknown }>(path, slot, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requestId: generateUUID() }),
    }, true, false);
    if (start.status !== 'authorization_required' || typeof start.authorizationUrl !== 'string' || !isTicketAuthorizationUrl(start.authorizationUrl)) {
      throw new SpaceCalendarError('Calendar authorization could not be started', 'invalid_response', 502);
    }
    return start.authorizationUrl;
  }

  async getEvents(after: string, before: string): Promise<CalendarEvent[]> {
    const slot = this.getCookieSlot();
    if (slot === undefined) return [];
    if ([...this.calendarsById.values()].some((calendar) => calendar.myRole === null)) return [];
    const timeZone = getEffectiveTimeZone();
    const query = new URLSearchParams({
      after: spaceQueryTime(after, timeZone),
      before: spaceQueryTime(before, timeZone),
      slot: String(slot),
    });
    const body = await this.request(`/events?${query.toString()}`, slot, undefined, false);
    if (!Array.isArray(body.events)) throw new SpaceCalendarError('Invalid Space event response', 'invalid_response');
    return body.events.map((record: SpaceCalendarEventRecord) => this.toEvent(record));
  }

  async updateEvent(
    eventId: string,
    baseRevision: string,
    updates: Partial<CalendarEvent>,
  ): Promise<CalendarEvent> {
    const event: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(updates)) {
      if (value === undefined) continue;
      if (!EDITABLE_EVENT_FIELDS.has(key)) {
        throw new SpaceCalendarError(`Space calendar does not support changing ${key}`, 'unsupported_operation', 501);
      }
      event[key] = value;
    }
    if (Object.keys(event).length === 0) throw new SpaceCalendarError('Space calendar update has no supported changes', 'invalid_request', 400);
    const slot = this.requireSlot();
    const record = await this.request<SpaceCalendarEventRecord>(`/events/${encodeURIComponent(eventId)}`, slot, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requestId: generateUUID(), baseRevision, patch: event }),
    });
    return this.toEvent(record);
  }

  async rsvpEvent(eventId: string, baseRevision: string, status: string): Promise<CalendarEvent> {
    if (!['accepted', 'declined', 'tentative'].includes(status)) {
      throw new SpaceCalendarError('Space calendar does not support this RSVP status', 'unsupported_operation', 501);
    }
    const slot = this.requireSlot();
    const record = await this.request<SpaceCalendarEventRecord>(`/events/${encodeURIComponent(eventId)}/rsvp`, slot, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requestId: generateUUID(), baseRevision, status }),
    });
    return this.toEvent(record);
  }

  async cancelEvent(eventId: string, baseRevision: string, role: SpaceRole): Promise<CalendarEvent> {
    if (role !== 'owner') {
      throw new SpaceCalendarError('Only the Space owner can cancel this event', 'unsupported_operation', 501);
    }
    const slot = this.requireSlot();
    const record = await this.request<SpaceCalendarEventRecord>(`/events/${encodeURIComponent(eventId)}`, slot, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requestId: generateUUID(), baseRevision }),
    });
    return this.toEvent(record);
  }

  async createEvent(calendarId: string, input: Partial<CalendarEvent>, sendSchedulingMessages = false): Promise<CalendarEvent> {
    const calendar = this.calendarsById.get(calendarId);
    if (!calendar || calendar.initialized) {
      throw new SpaceCalendarError('The configured Space already has an event or its state is unavailable', 'conflict', 409);
    }
    if (sendSchedulingMessages) throw new SpaceCalendarError('Space calendar invitations are not supported', 'unsupported_operation', 501);
    if (input.showWithoutTime || input.timeZone === null) {
      throw new SpaceCalendarError('All-day and floating Space calendar events are not supported', 'unsupported_operation', 501);
    }
    if (input.calendarIds) {
      const selected = Object.entries(input.calendarIds).filter(([, included]) => included).map(([id]) => id);
      if (selected.length !== 1 || ![calendarId, `space:${calendarId}`].includes(selected[0])) {
        throw new SpaceCalendarError('The event must remain in its selected Space calendar', 'unsupported_operation', 501);
      }
    }
    const event: Record<string, unknown> = {};
    for (const field of ['title', 'description', 'start', 'timeZone', 'duration', 'showWithoutTime', 'recurrenceRules', 'recurrenceOverrides'] as const) {
      const value = input[field];
      if (value !== undefined) event[field] = value;
    }
    for (const [field, value] of Object.entries(input)) {
      if (['title', 'description', 'start', 'timeZone', 'duration', 'showWithoutTime', 'recurrenceRules', 'recurrenceOverrides', 'calendarIds'].includes(field)) continue;
      if (field === 'uid' || field === 'status' && value === 'confirmed' || field === 'freeBusyStatus' && value === 'busy' || field === 'privacy' && value === 'public') continue;
      if (field === 'locations' || field === 'virtualLocations' || field === 'alerts' || field === 'participants') {
        if (value === null || typeof value === 'object' && Object.keys(value as object).length === 0) continue;
      }
      if (value !== undefined) throw new SpaceCalendarError(`Space calendar does not support setting ${field} on creation`, 'unsupported_operation', 501);
    }
    const slot = this.requireSlot();
    const record = await this.request<SpaceCalendarEventRecord>('/events', slot, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requestId: generateUUID(), calendarId, event }),
    });
    return this.toEvent(record);
  }

  async shareCalendar(calendarId: string, principalId: string, rights: CalendarRights | null): Promise<SpaceShareResult> {
    const calendar = this.calendarsById.get(calendarId);
    if (!calendar || calendar.myRole !== 'owner') throw new SpaceCalendarError('Only the Space owner can manage membership', 'forbidden', 403);
    const slot = this.requireSlot();
    if (rights === null) {
      if (!calendar.policyId) throw new SpaceCalendarError('Space policy revision is unavailable', 'invalid_response');
      const result = await this.request<{ status?: string }>('/share', slot, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId: generateUUID(), principalId, baseRevision: calendar.policyId }),
      });
      if (result.status !== 'revoked') throw new SpaceCalendarError('Space member removal was not confirmed', 'invalid_response');
      return { status: 'revoked' };
    }
    const role = roleForRights(rights);
    if (role !== calendar.offerRole) {
      throw new SpaceCalendarError('The requested role differs from the configured calendar offer', 'unsupported_operation', 501);
    }
    const result = await this.request<{ status?: string }>('/share', slot, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requestId: generateUUID(), principalId, role }),
    });
    if (result.status === 'consent_required') {
      throw new SpaceCalendarError('Calendar access is waiting for member consent; access is not active yet.', 'consent_required', 202);
    }
    if (result.status !== 'shared') throw new SpaceCalendarError('Space membership was not confirmed', 'invalid_response');
    return { status: 'shared' };
  }

  private requireSlot(): number {
    const slot = this.getCookieSlot();
    if (slot === undefined) throw new SpaceCalendarError('No authenticated account slot for Space calendar', 'unauthorized', 401);
    return slot;
  }

  private async request<T = Record<string, unknown>>(
    path: string,
    slot: number,
    init?: RequestInit,
    appendSlot = true,
    allowAuthorizationStart = true,
  ): Promise<T> {
    const url = new URL(path, 'http://bulwark.local');
    if (appendSlot) url.searchParams.set('slot', String(slot));
    const route = `/api/calendar${url.pathname.replace('/api/calendar', '')}${url.search}`;
    const options: RequestInit = { ...init, credentials: 'same-origin', cache: 'no-store' };
    const retryableCommand = Boolean(init?.method && init.method !== 'GET');
    let response: Response | undefined;
    for (let attempt = 0; attempt < (retryableCommand ? 2 : 1); attempt += 1) {
      try {
        response = await this.fetcher(route, options);
      } catch {
        if (retryableCommand && attempt === 0) continue;
        throw new SpaceCalendarError('Space calendar command result is unavailable', 'provider_unavailable', 502);
      }
      if (retryableCommand && attempt === 0 && (response.status === 502 || response.status === 503)) {
        await response.body?.cancel().catch(() => undefined);
        response = undefined;
        continue;
      }
      break;
    }
    if (!response) throw new SpaceCalendarError('Space calendar command result is unavailable', 'provider_unavailable', 502);
    let body: Record<string, unknown> = {};
    try {
      const value: unknown = await response.json();
      if (typeof value === 'object' && value !== null) body = value as Record<string, unknown>;
    } catch {
      if (response.ok) throw new SpaceCalendarError('Invalid Space calendar response', 'invalid_response', response.status);
    }
    if (!response.ok) {
      const code = typeof body.error === 'string' ? body.error : 'provider_error';
      if (allowAuthorizationStart && response.status === 409 && code === 'authorization_required') {
        const profile = body.authorizationProfile;
        if (profile === 'member-calendar' && isPendingCalendarRecord(body.calendar)) {
          throw new SpaceCalendarError('Calendar consent is required for this account', code, response.status, undefined, body.calendar);
        }
        const startPath = profile === 'owner-data' ? '/owner/data/start'
          : profile === 'owner-membership' ? '/owner/membership/start'
            : profile === 'member-calendar' ? '/member/consent/start' : null;
        if (!startPath) throw new SpaceCalendarError('Calendar authorization profile is invalid', 'invalid_response', 502);
        const authorizationUrl = await this.startAuthorization(profile as 'owner-data' | 'owner-membership' | 'member-calendar');
        throw new SpaceCalendarError(
          'No calendar changes were saved. Authorize access, return to this page, and retry.',
          'authorization_required',
          409,
          authorizationUrl,
        );
      }
      throw new SpaceCalendarError(`Space calendar request failed (${code})`, code, response.status);
    }
    return body as T;
  }

  private toCalendar(record: SpaceCalendarRecord): Calendar {
    if (record.source !== 'atproto-space' || !record.id || !record.name || !isSpaceRole(record.myRole) || typeof record.initialized !== 'boolean') {
      throw new SpaceCalendarError('Invalid Space calendar record', 'invalid_response');
    }
    return {
      id: `space:${record.id}`,
      originalId: record.id,
      source: 'atproto-space',
      spaceRevisionId: record.revisionId,
      spacePolicyId: record.policyId,
      spaceOfferRole: record.offerRole,
      spaceInitialized: record.initialized,
      spaceRole: record.myRole,
      name: record.name,
      description: null,
      color: null,
      sortOrder: 0,
      isSubscribed: false,
      isVisible: true,
      isDefault: false,
      includeInAvailability: 'none',
      defaultAlertsWithTime: null,
      defaultAlertsWithoutTime: null,
      timeZone: null,
      shareWith: shareWithForMembers(record.members),
      myRights: rightsForRole(record.myRole, record.initialized),
      isShared: false,
      isTasksOnly: false,
    };
  }

  private toPendingCalendar(record: SpaceCalendarRecord): Calendar {
    return {
      id: `space:${record.id}`,
      originalId: record.id,
      source: 'atproto-space',
      spaceInitialized: undefined,
      spaceConsentRequired: true,
      spaceRole: null,
      name: record.name,
      description: null,
      color: null,
      sortOrder: 0,
      isSubscribed: false,
      isVisible: true,
      isDefault: false,
      includeInAvailability: 'none',
      defaultAlertsWithTime: null,
      defaultAlertsWithoutTime: null,
      timeZone: null,
      shareWith: null,
      myRights: {
        mayReadFreeBusy: false, mayReadItems: false, mayWriteAll: false, mayWriteOwn: false,
        mayUpdatePrivate: false, mayRSVP: false, mayShare: false, mayDelete: false,
      },
      isShared: false,
      isTasksOnly: false,
    };
  }

  private toEvent(record: SpaceCalendarEventRecord): CalendarEvent {
    if (!record.id || !record.uid || !record.calendarId || !record.revisionId || !record.start || !record.duration) {
      throw new SpaceCalendarError('Invalid Space event record', 'invalid_response');
    }
    const participants: Record<string, CalendarParticipant> | null = record.participants
      ? Object.fromEntries(Object.entries(record.participants).map(([id, participant]) => [id, {
          '@type': 'Participant',
          name: participant.name ?? participant.did ?? '',
          email: '',
          calendarAddress: null,
          description: null,
          sendTo: null,
          kind: 'individual',
          roles: {},
          participationStatus: participant.participationStatus,
          participationComment: null,
          expectReply: false,
          scheduleAgent: 'none',
          scheduleForceSend: false,
          scheduleId: null,
          scheduleSequence: 0,
          scheduleStatus: null,
          scheduleUpdated: null,
          invitedBy: null,
          delegatedTo: null,
          delegatedFrom: null,
          memberOf: null,
          locationId: null,
          language: null,
          links: null,
          did: participant.did,
          isCurrentUser: participant.isCurrentUser === true,
        }]))
      : null;
    const event: CalendarEvent = {
      id: `space-event:${record.id}`,
      originalId: record.id,
      source: 'atproto-space',
      spaceRevisionId: record.revisionId,
      spaceActorDid: record.actorDID,
      spaceOwnerDid: record.ownerDID,
      calendarIds: { [`space:${record.calendarId}`]: true },
      originalCalendarIds: { [record.calendarId]: true },
      isDraft: false,
      isOrigin: false,
      utcStart: !record.showWithoutTime && record.timeZone ? spaceQueryTime(record.start, record.timeZone) : null,
      utcEnd: null,
      '@type': 'Event',
      uid: record.uid,
      title: record.title,
      description: record.description,
      descriptionContentType: 'text/plain',
      created: null,
      updated: null,
      sequence: 0,
      start: record.start,
      duration: record.duration,
      timeZone: record.timeZone,
      showWithoutTime: record.showWithoutTime,
      status: record.status,
      freeBusyStatus: 'busy',
      privacy: 'private',
      color: null,
      keywords: null,
      categories: null,
      locale: null,
      replyTo: null,
      organizerCalendarAddress: null,
      participants,
      mayInviteSelf: false,
      mayInviteOthers: false,
      hideAttendees: false,
      recurrenceId: null,
      recurrenceIdTimeZone: null,
      recurrenceRules: record.recurrenceRules ?? null,
      recurrenceOverrides: record.recurrenceOverrides ?? null,
      excludedRecurrenceRules: null,
      useDefaultAlerts: false,
      alerts: null,
      locations: null,
      virtualLocations: null,
      links: null,
      relatedTo: null,
    };
    return event;
  }
}

function isTicketAuthorizationUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash
      && /^\/oauth\/calendar\/tickets\/[A-Za-z0-9_-]{43}$/.test(url.pathname);
  } catch {
    return false;
  }
}

function spaceQueryTime(value: string, timeZone: string): string {
  // The grid supplies display-zone wall clocks; the canonical API needs instants.
  const wall = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})$/.exec(value);
  if (!wall) return value;
  if (!Number.isFinite(parseISO(value).getTime())) {
    throw new SpaceCalendarError('Invalid calendar date range', 'invalid_request', 400);
  }
  const [year, month, day, hour, minute, second] = wall.slice(1).map(Number);
  return fromWallClock({ year, month, day, hour, minute, second }, timeZone).toISOString();
}

function isSpaceOfferRole(value: unknown): value is 'viewer' | 'editor' {
  return value === 'viewer' || value === 'editor';
}

function isSpaceRole(value: unknown): value is SpaceRole {
  return value === 'owner' || value === 'editor' || value === 'viewer';
}

function isPendingCalendarRecord(value: unknown): value is SpaceCalendarRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return typeof record.id === 'string' && record.id.length > 0
    && typeof record.name === 'string' && record.name.length > 0
    && record.source === 'atproto-space' && record.myRole === null
    && record.initialized === null && record.pendingConsent === true
    && record.revisionId === null && record.policyId === null
    && !('members' in record);
}

function rightsForRole(role: SpaceRole, initialized: boolean): CalendarRights {
  const canEdit = role === 'owner' || role === 'editor';
  return {
    mayReadFreeBusy: false,
    mayReadItems: true,
    mayWriteAll: canEdit && initialized,
    mayWriteOwn: role === 'owner' && !initialized,
    mayUpdatePrivate: false,
    mayRSVP: role !== 'viewer' && initialized,
    mayShare: role === 'owner' && initialized,
    mayDelete: role === 'owner' && initialized,
  };
}

function shareWithForMembers(members: SpaceCalendarRecord['members']): Record<string, CalendarRights> | null {
  const shareWith = Object.fromEntries((members ?? [])
    .filter((member) => member.status === 'active' && !member.isCurrentUser && member.role !== 'owner')
    .map((member) => [member.principalId || member.did, rightsForRole(member.role, true)]));
  return Object.keys(shareWith).length > 0 ? shareWith : null;
}

function roleForRights(rights: CalendarRights): 'viewer' | 'editor' {
  if (rights.mayReadFreeBusy || rights.mayWriteOwn || rights.mayUpdatePrivate || rights.mayShare || rights.mayDelete) {
    throw new SpaceCalendarError('This Space role grants unsupported calendar permissions', 'unsupported_operation', 501);
  }
  if (rights.mayReadItems && !rights.mayWriteAll && !rights.mayRSVP) return 'viewer';
  if (rights.mayReadItems && rights.mayWriteAll && rights.mayRSVP) return 'editor';
  throw new SpaceCalendarError('This Space role is unsupported', 'unsupported_operation', 501);
}
