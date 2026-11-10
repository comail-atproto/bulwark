import type {} from './comail-types';
import { apiFetch } from '@/lib/browser-navigation';
import { parseISO } from 'date-fns';
import { fromWallClock, getEffectiveTimeZone } from '@/lib/timezone';
import { generateUUID } from '@/lib/utils';
import type { Calendar, CalendarEvent, CalendarParticipant, CalendarRights, Principal } from './types';

type SpaceRole = 'owner' | 'editor' | 'viewer';
type SpaceAuthorizationProfile = 'owner-data' | 'owner-membership' | 'owner-public' | 'member-calendar' | 'owner-personal' | 'member-personal';
export type SpaceCalendarPersonalProperties = Pick<CalendarEvent, 'keywords' | 'color' | 'freeBusyStatus' | 'useDefaultAlerts' | 'alerts'>;
export const SPACE_PERSONAL_EVENT_FIELDS: ReadonlySet<string> = new Set(['keywords', 'color', 'freeBusyStatus', 'useDefaultAlerts', 'alerts']);

export interface SpaceCalendarRecord {
  id: string;
  name: string;
  source: 'atproto-space';
  myRole: SpaceRole | null;
  initialized: boolean | null;
  mayUpdatePrivate?: boolean;
  mayShare?: boolean;
  pendingConsent?: true;
  revisionId?: string | null;
  policyId?: string | null;
  offerRole?: 'viewer' | 'editor';
  members?: Array<{ did: string; principalId?: string; role: SpaceRole; isCurrentUser?: boolean; status?: 'active' }>;
}

export interface SpaceShareResult {
  status: 'shared' | 'revoked';
}

export interface PublicCalendarWriteResult {
  uri: string;
  cid: string;
}

export type PublicCalendarRsvpStatus = 'going' | 'interested' | 'notgoing';

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
  recurrenceOverrides?: Record<string, Omit<Partial<CalendarEvent>, 'participants' | 'freeBusyStatus' | 'useDefaultAlerts'> & {
    freeBusyStatus?: CalendarEvent['freeBusyStatus'] | null;
    useDefaultAlerts?: boolean | null;
    excluded?: boolean;
    participants?: SpaceCalendarEventRecord['participants'];
  }> | null;
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
  sharedRecurrenceOverrides?: SpaceCalendarEventRecord['recurrenceOverrides'];
  personalRevisionId?: string;
  personalProperties?: SpaceCalendarPersonalProperties;
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
        || (record.myRole === 'owner' && !isSpaceOfferRole(record.offerRole) && record.mayShare !== false)
        || (record.mayShare !== undefined && record.mayShare !== false)
        || (record.mayShare === false && (record.myRole !== 'owner' || record.offerRole !== undefined || !Array.isArray(record.members) || record.members.length !== 0))
        || (record.myRole !== 'owner' && record.offerRole !== undefined)
        || (record.mayUpdatePrivate !== undefined && typeof record.mayUpdatePrivate !== 'boolean')
        || (record.mayUpdatePrivate === true && !record.initialized)) {
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

  async startAuthorization(profile: SpaceAuthorizationProfile): Promise<string> {
    const slot = this.requireSlot();
    const path = authorizationStartPath(profile);
    if (!path) throw new SpaceCalendarError('Calendar authorization profile is invalid', 'invalid_request', 400);
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
      includeMetadata: 'true',
    });
    const body = await this.request(`/events?${query.toString()}`, slot, undefined, false);
    if (!Array.isArray(body.events)) throw new SpaceCalendarError('Invalid Space event response', 'invalid_response');
    if (body.metadata !== undefined && (typeof body.metadata !== 'object' || body.metadata === null || Array.isArray(body.metadata))) {
      throw new SpaceCalendarError('Invalid Space event metadata', 'invalid_response');
    }
    const metadata = body.metadata as Record<string, unknown> | undefined;
    return body.events.map((record: SpaceCalendarEventRecord) => this.toEvent(record, metadata?.[record.id]));
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
      if (key === 'recurrenceOverrides' && value) {
        if (Object.values(value).some((override) => Object.keys(override).some((field) => SPACE_PERSONAL_EVENT_FIELDS.has(field.split('/')[0])))) {
          throw new SpaceCalendarError('Shared calendar updates cannot include private occurrence settings', 'unsupported_operation', 501);
        }
        event[key] = Object.fromEntries(Object.entries(value as NonNullable<CalendarEvent['recurrenceOverrides']>).map(([stamp, override]) => {
          if (!override.participants) return [stamp, override];
          const participants = Object.fromEntries(Object.entries(override.participants).map(([id, participant]) => {
            if (participant.did !== id) throw new SpaceCalendarError('Space occurrence participant identity is invalid', 'invalid_request', 400);
            return [id, { did: participant.did, participationStatus: participant.participationStatus, isCurrentUser: participant.isCurrentUser === true }];
          }));
          return [stamp, { ...override, participants }];
        }));
      } else {
        event[key] = value;
      }
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

  async updatePrivateEvent(
    eventId: string,
    basePersonalRevision: string,
    updates: Partial<SpaceCalendarPersonalProperties>,
    recurrenceId?: string,
    inherit: Array<keyof SpaceCalendarPersonalProperties> = [],
  ): Promise<CalendarEvent> {
    const patch: Record<string, unknown> = Object.fromEntries(Object.entries(updates).filter(([, value]) => value !== undefined));
    if (updates.alerts) {
      patch.alerts = Object.fromEntries(Object.entries(updates.alerts).map(([id, alert]) => [id,
        Object.fromEntries(Object.entries(alert).filter(([field, value]) =>
          value !== null || !['acknowledged', 'relatedTo'].includes(field))),
      ]));
    }
    if (Object.keys(patch).some((field) => !SPACE_PERSONAL_EVENT_FIELDS.has(field))) {
      throw new SpaceCalendarError('Private calendar updates cannot change shared event fields', 'unsupported_operation', 501);
    }
    if (!/^personal-state-[a-f0-9]{64}$/.test(basePersonalRevision) || Object.keys(patch).length + inherit.length === 0
      || inherit.some((field) => !SPACE_PERSONAL_EVENT_FIELDS.has(field) || field in patch)
      || new Set(inherit).size !== inherit.length || (inherit.length > 0 && !recurrenceId)
      || (recurrenceId !== undefined && (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(recurrenceId)
        || Number(recurrenceId.slice(0, 4)) < 1 || Number.isNaN(parseISO(recurrenceId).getTime())))) {
      throw new SpaceCalendarError('Private calendar update is invalid', 'invalid_request', 400);
    }
    const record = await this.request<SpaceCalendarEventRecord>(`/events/${encodeURIComponent(eventId)}/personal`, this.requireSlot(), {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requestId: generateUUID(), basePersonalRevision, patch, recurrenceId, ...(inherit.length ? { inherit } : {}) }),
    });
    if (!record.personalRevisionId || !record.personalProperties) throw new SpaceCalendarError('Private calendar response is incomplete', 'invalid_response', 502);
    return this.toEvent(record);
  }

  async rsvpEvent(eventId: string, baseRevision: string, status: string, recurrenceId?: string): Promise<CalendarEvent> {
    if (!['accepted', 'declined', 'tentative'].includes(status)) {
      throw new SpaceCalendarError('Space calendar does not support this RSVP status', 'unsupported_operation', 501);
    }
    if (recurrenceId !== undefined && (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(recurrenceId) || Number.isNaN(parseISO(recurrenceId).getTime()))) {
      throw new SpaceCalendarError('Space occurrence identity is invalid', 'invalid_request', 400);
    }
    const slot = this.requireSlot();
    const record = await this.request<SpaceCalendarEventRecord>(`/events/${encodeURIComponent(eventId)}/rsvp`, slot, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requestId: generateUUID(), baseRevision, status, recurrenceId }),
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
    if (!calendar || (calendar.initialized && calendar.mayShare !== false)) {
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
    // The canonical PDS schema requires description even when the editor leaves
    // it blank. The regular event form intentionally omits empty descriptions.
    const event: Record<string, unknown> = { description: '' };
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

  async subscribePublicEvent(event: CalendarEvent): Promise<CalendarEvent> {
    const source = requirePublicSource(event);
    const record = await this.request<SpaceCalendarEventRecord>('/subscriptions', this.requireSlot(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requestId: generateUUID(), source }),
    });
    return this.toEvent(record, { sequence: 0, publicSource: source });
  }

  async rsvpPublicEvent(event: CalendarEvent, status: PublicCalendarRsvpStatus): Promise<PublicCalendarWriteResult> {
    if (!['going', 'interested', 'notgoing'].includes(status)) {
      throw new SpaceCalendarError('Unsupported public RSVP status', 'unsupported_operation', 501);
    }
    const source = requirePublicSource(event);
    const result = await this.request<PublicCalendarWriteResult>('/public/rsvps', this.requireSlot(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requestId: generateUUID(), eventUri: source.uri, eventCid: source.cid,
        expectedRsvpCid: event.atmoRsvpCid ?? null, status,
      }),
    });
    return requirePublicWriteResult(result, 'community.lexicon.calendar.rsvp');
  }

  async publishPublicEvent(event: CalendarEvent): Promise<PublicCalendarWriteResult> {
    if (event.source !== 'atproto-space' || event.atprotoUri || event.atprotoCid || !event.title?.trim()) {
      throw new SpaceCalendarError('Only an unpublished My Calendar event can be made public', 'unsupported_operation', 501);
    }
    const startsAt = publicEventInstant(event.utcStart, event.start, event.timeZone);
    const endsAt = event.utcEnd ?? endFromDuration(startsAt, event.duration);
    const result = await this.request<PublicCalendarWriteResult>('/public/events', this.requireSlot(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requestId: generateUUID(),
        name: event.title.trim(),
        ...(event.description ? { description: event.description } : {}),
        startsAt,
        ...(endsAt ? { endsAt } : {}),
      }),
    });
    return requirePublicWriteResult(result, 'community.lexicon.calendar.event');
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
        if (!authorizationStartPath(profile)) throw new SpaceCalendarError('Calendar authorization profile is invalid', 'invalid_response', 502);
        const authorizationUrl = await this.startAuthorization(profile as SpaceAuthorizationProfile);
        throw new SpaceCalendarError(
          'Calendar access needs authorization. Authorize access, return to this page, and retry.',
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
      myRights: {
        ...rightsForRole(record.myRole, record.initialized),
        mayWriteOwn: record.myRole === 'owner' && (!record.initialized || record.mayShare === false),
        mayShare: record.mayShare !== false && record.myRole === 'owner' && record.initialized,
        mayUpdatePrivate: record.initialized && record.mayUpdatePrivate === true,
      },
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

  private toParticipants(source: SpaceCalendarEventRecord['participants']): Record<string, CalendarParticipant> | null {
    return source
      ? Object.fromEntries(Object.entries(source).map(([id, participant]) => [id, {
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
  }

  private toOverrides(overrides: SpaceCalendarEventRecord['recurrenceOverrides']): CalendarEvent['recurrenceOverrides'] {
    return overrides ? Object.fromEntries(Object.entries(overrides).map(([stamp, override]) => {
      const { participants: replies, freeBusyStatus, useDefaultAlerts, ...fields } = override;
      return [stamp, { ...fields,
        ...('freeBusyStatus' in override ? { freeBusyStatus: freeBusyStatus ?? 'busy' as const } : {}),
        ...('useDefaultAlerts' in override ? { useDefaultAlerts: useDefaultAlerts ?? false } : {}),
        ...(replies !== undefined ? { participants: this.toParticipants(replies) } : {}) }];
    })) : null;
  }

  private toEvent(record: SpaceCalendarEventRecord, metadata?: unknown): CalendarEvent {
    if (!record.id || !record.uid || !record.calendarId || !record.revisionId || !record.start || !record.duration) {
      throw new SpaceCalendarError('Invalid Space event record', 'invalid_response');
    }
    if ((record.personalRevisionId !== undefined || record.personalProperties !== undefined)
      && (!/^personal-state-[a-f0-9]{64}$/.test(record.personalRevisionId ?? '') || !isPersonalProperties(record.personalProperties))) {
      throw new SpaceCalendarError('Invalid actor-private calendar projection', 'invalid_response', 502);
    }
    const eventMetadata = isEventMetadata(metadata) ? metadata : undefined;
    if (metadata !== undefined && !eventMetadata) throw new SpaceCalendarError('Invalid Space event metadata', 'invalid_response');
    const publicSource = eventMetadata?.publicSource;
    if (publicSource && publicSource.uri !== record.uid) throw new SpaceCalendarError('Public source does not match Space event', 'invalid_response');
    if (record.sharedRecurrenceOverrides !== undefined && record.sharedRecurrenceOverrides !== null
      && (typeof record.sharedRecurrenceOverrides !== 'object' || Array.isArray(record.sharedRecurrenceOverrides)
        || Object.values(record.sharedRecurrenceOverrides).some(override => !override || typeof override !== 'object' || Array.isArray(override)
          || Object.keys(override).some(field => SPACE_PERSONAL_EVENT_FIELDS.has(field.split('/')[0]))))) {
      throw new SpaceCalendarError('Invalid shared occurrence snapshot', 'invalid_response');
    }
    const participants = this.toParticipants(record.participants);
    const event: CalendarEvent = {
      id: `space-event:${record.id}`,
      originalId: record.id,
      source: 'atproto-space',
      atprotoUri: publicSource?.uri,
      atprotoCid: publicSource?.cid,
      atprotoCreatorDid: publicSource?.uri.split('/')[2],
      spaceRevisionId: record.revisionId,
      spacePersonalRevisionId: record.personalRevisionId,
      spaceSharedRecurrenceOverrides: record.sharedRecurrenceOverrides !== undefined ? this.toOverrides(record.sharedRecurrenceOverrides) : undefined,
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
      created: eventMetadata?.created || null,
      updated: eventMetadata?.updated || null,
      sequence: eventMetadata?.sequence ?? 0,
      start: record.start,
      duration: record.duration,
      timeZone: record.timeZone,
      showWithoutTime: record.showWithoutTime,
      status: record.status,
      freeBusyStatus: record.personalProperties?.freeBusyStatus ?? 'busy',
      privacy: 'private',
      color: record.personalProperties?.color ?? null,
      keywords: record.personalProperties?.keywords ?? null,
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
      recurrenceOverrides: this.toOverrides(record.recurrenceOverrides),
      excludedRecurrenceRules: null,
      useDefaultAlerts: record.personalProperties?.useDefaultAlerts ?? false,
      alerts: record.personalProperties?.alerts ?? null,
      locations: null,
      virtualLocations: null,
      links: null,
      relatedTo: null,
    };
    return event;
  }
}

function requirePublicSource(event: CalendarEvent): { uri: string; cid: string } {
  if (!event.atprotoUri || !/^at:\/\/did:(?:plc|web):[A-Za-z0-9.:%_-]+\/community\.lexicon\.calendar\.event\/[234567abcdefghijklmnopqrstuvwxyz]{13}$/.test(event.atprotoUri)
    || !event.atprotoCid || !/^bafyrei[a-h][a-z2-7]{50}[aeimquy4]$/.test(event.atprotoCid)) {
    throw new SpaceCalendarError('Public event identity is unavailable', 'invalid_request', 400);
  }
  return { uri: event.atprotoUri, cid: event.atprotoCid };
}

function requirePublicWriteResult(result: PublicCalendarWriteResult, collection: string): PublicCalendarWriteResult {
  if (!result || typeof result !== 'object'
    || typeof result.uri !== 'string' || !new RegExp(`^at://did:(?:plc|web):[A-Za-z0-9.:%_-]+/${collection.replaceAll('.', '\\.')}/[234567abcdefghijklmnopqrstuvwxyz]{13}$`).test(result.uri)
    || typeof result.cid !== 'string' || !/^bafyrei[a-h][a-z2-7]{50}[aeimquy4]$/.test(result.cid)
    || Object.keys(result).some((key) => !['uri', 'cid'].includes(key))) {
    throw new SpaceCalendarError('Invalid public calendar write response', 'invalid_response', 502);
  }
  return result;
}

function publicEventInstant(utc: string | null | undefined, start: string, timeZone: string | null): string {
  const value = utc ?? (timeZone ? spaceQueryTime(start, timeZone) : start);
  const parsed = new Date(value);
  if (!value || !Number.isFinite(parsed.getTime()) || !/(?:Z|[+-]\d{2}:\d{2})$/.test(value)) {
    throw new SpaceCalendarError('Public event requires a timed start', 'invalid_request', 400);
  }
  return parsed.toISOString();
}

function endFromDuration(startsAt: string, duration: string): string | undefined {
  const match = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/.exec(duration);
  if (!match) return undefined;
  const milliseconds = Number(match[1] ?? 0) * 86_400_000 + Number(match[2] ?? 0) * 3_600_000
    + Number(match[3] ?? 0) * 60_000 + Number(match[4] ?? 0) * 1000;
  return milliseconds > 0 ? new Date(Date.parse(startsAt) + milliseconds).toISOString() : undefined;
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

export function spaceQueryTime(value: string, timeZone: string): string {
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

function authorizationStartPath(profile: unknown): string | null {
  switch (profile) {
    case 'owner-data': return '/owner/data/start';
    case 'owner-membership': return '/owner/membership/start';
    case 'owner-public': return '/public/start';
    case 'member-calendar': return '/member/consent/start';
    case 'owner-personal':
    case 'member-personal': return '/personal/start';
    default: return null;
  }
}

function isPersonalProperties(value: unknown): value is SpaceCalendarPersonalProperties {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const fields = value as Record<string, unknown>;
  return Object.keys(fields).length === 5 && Object.keys(fields).every((field) => SPACE_PERSONAL_EVENT_FIELDS.has(field))
    && (fields.color === null || typeof fields.color === 'string')
    && (fields.freeBusyStatus === 'busy' || fields.freeBusyStatus === 'free') && typeof fields.useDefaultAlerts === 'boolean'
    && (fields.keywords === null || typeof fields.keywords === 'object' && !Array.isArray(fields.keywords)
      && Object.values(fields.keywords).every((enabled) => enabled === true))
    && (fields.alerts === null || typeof fields.alerts === 'object' && !Array.isArray(fields.alerts));
}

function isEventMetadata(value: unknown): value is { created?: string; updated?: string; sequence: number; publicSource?: { uri: string; cid: string } } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const metadata = value as Record<string, unknown>;
  if (Object.hasOwn(metadata, 'publicSource')) {
    const source = metadata.publicSource;
    if (!source || typeof source !== 'object' || Array.isArray(source)) return false;
    const reference = source as Record<string, unknown>;
    if (Object.keys(reference).length !== 2 || typeof reference.uri !== 'string'
      || !/^at:\/\/did:(?:plc|web):[A-Za-z0-9.:%_-]+\/community\.lexicon\.calendar\.event\/[A-Za-z0-9._~:-]+$/.test(reference.uri)
      || typeof reference.cid !== 'string' || !/^bafyrei[a-h][a-z2-7]{50}[aeimquy4]$/.test(reference.cid)) return false;
  }
  return Number.isSafeInteger(metadata.sequence) && (metadata.sequence as number) >= 0
    && ['created', 'updated'].every(field => metadata[field] === undefined || metadata[field] === ''
      || typeof metadata[field] === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/.test(metadata[field] as string)
        && !Number.isNaN(Date.parse(metadata[field] as string)));
}
