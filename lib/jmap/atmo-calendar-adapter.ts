import { apiFetch } from '@/lib/browser-navigation';
import { getEffectiveTimeZone } from '@/lib/timezone';
import { generateUUID } from '@/lib/utils';
import { CALENDAR_COLORS } from '@/lib/shared-calendar-colors';
import { isAtmoSourceCatalog, type AtmoSourceCatalog } from '@/lib/atmo-calendar/source';
import type { PublicAtmoCalendarRecord } from '@/lib/atmo-calendar/record';
import { SpaceCalendarError, spaceQueryTime } from './space-calendar-adapter';

export const ATMOSPHERE_CALENDAR_COLOR = CALENDAR_COLORS[6];
import type { Calendar, CalendarEvent } from './types';

type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;

export class AtmoCalendarAdapter {
  private catalog: AtmoSourceCatalog | null = null;
  private lastRefreshComplete = true;
  private pendingActor: string | null = null;
  private localActor: string | null = null;
  private localEnabled = false;
  private sourceSlot: number | undefined;
  // Retain a failed command for an exact lost-reply retry; never reuse its ID
  // for a different input or infer acceptance from a local checkbox.
  private pendingCommand: { requestId: string; baseState: string; enabled: boolean } | null = null;

  constructor(private readonly getCookieSlot: () => number | undefined, private readonly fetcher: Fetcher = apiFetch) {}

  private async readSource(input: string): Promise<{ response: Response; body: unknown }> {
    let response: Response;
    try {
      response = await this.fetcher(input, { cache: 'no-store' });
    } catch {
      throw new SpaceCalendarError('Atmosphere calendar is unavailable', 'provider_unavailable', 502);
    }
    try {
      return { response, body: await response.json() };
    } catch {
      throw new SpaceCalendarError('Invalid Atmosphere response', 'invalid_response', 502);
    }
  }

  async getCalendars(): Promise<Calendar[]> {
    const slot = this.getCookieSlot();
    if (slot === undefined) return [];
    const { response, body } = await this.readSource(`/api/atmo-calendar?slot=${slot}&local=1`);
    if (response.status === 404) {
      this.catalog = null;
      this.pendingActor = null;
      this.pendingCommand = null;
      this.localActor = null;
      this.localEnabled = false;
      this.sourceSlot = undefined;
      return [];
    }
    if (response.status === 409) {
      const pending = body as { error?: unknown; actorDid?: unknown; authorizationProfile?: unknown };
      if (pending?.error === 'authorization_required' && typeof pending.actorDid === 'string' && /^did:(plc|web):[^\s]+$/.test(pending.actorDid)
        && (pending.authorizationProfile === 'owner-source' || pending.authorizationProfile === 'member-source')) {
        this.catalog = null;
        this.pendingActor = pending.actorDid;
        this.pendingCommand = null;
        this.localActor = null;
        this.localEnabled = false;
        this.sourceSlot = slot;
        return [this.toCalendar(pending.actorDid, false, true)];
      }
    }
    if (!response.ok) throw new SpaceCalendarError('Atmosphere calendar is unavailable', 'provider_unavailable', response.status);
    const local = body as { actorDid?: unknown; preferenceStorage?: unknown } | null;
    if (local?.preferenceStorage === 'browser' && typeof local.actorDid === 'string' && /^did:(plc|web):[^\s]+$/.test(local.actorDid)
      && Object.keys(local).every(key => ['actorDid', 'preferenceStorage'].includes(key))) {
      this.catalog = null;
      this.pendingActor = null;
      this.pendingCommand = null;
      this.localActor = local.actorDid;
      this.sourceSlot = slot;
      try { this.localEnabled = window.localStorage.getItem(this.localPreferenceKey()) === 'true'; } catch { this.localEnabled = false; }
      return [this.toCalendar(local.actorDid, this.localEnabled)];
    }
    if (!isAtmoSourceCatalog(body)) throw new SpaceCalendarError('Invalid Atmosphere source', 'invalid_response', 502);
    if (this.catalog?.actorDid !== body.actorDid) this.pendingCommand = null;
    this.catalog = body;
    this.pendingActor = null;
    this.localActor = null;
    this.localEnabled = false;
    this.sourceSlot = slot;
    return [this.toCalendar(body.actorDid, body.sources[0].enabled)];
  }

  async getEvents(after: string, before: string): Promise<CalendarEvent[]> {
    const slot = this.getCookieSlot();
    if (slot === undefined || slot !== this.sourceSlot || !(this.catalog?.sources[0].enabled ?? this.localEnabled)) {
      this.lastRefreshComplete = true;
      return [];
    }
    const actorDid = this.catalog?.actorDid ?? this.localActor;
    if (!actorDid) return [];
    const query = new URLSearchParams({ slot: String(slot), after: spaceQueryTime(after, getEffectiveTimeZone()), before: spaceQueryTime(before, getEffectiveTimeZone()) });
    if (this.localActor) { query.set('local', '1'); query.set('enabled', String(this.localEnabled)); }
    const { response, body: rawBody } = await this.readSource(`/api/atmo-calendar?${query}`);
    if (!response.ok) throw new SpaceCalendarError('Atmosphere calendar refresh failed', 'provider_unavailable', response.status);
    const body = rawBody as { actorDid?: unknown; after?: unknown; before?: unknown; complete?: unknown; events?: unknown };
    if (!body || typeof body !== 'object') throw new SpaceCalendarError('Invalid Atmosphere response', 'invalid_response', 502);
    if (body.actorDid !== actorDid || typeof body.complete !== 'boolean' || body.after !== query.get('after') || body.before !== query.get('before')
      || !Array.isArray(body.events) || body.events.length > 5000) throw new SpaceCalendarError('Incomplete Atmosphere calendar refresh', 'invalid_response', 502);
    let complete = body.complete;
    const events: CalendarEvent[] = [];
    for (const record of body.events) {
      try {
        events.push(this.toEvent(record, actorDid));
      } catch (error) {
        // The actor's own records are the trusted source of this calendar.
        // An invalid one must fail closed. A distinct actor can only add an
        // RSVP target, so one malformed third-party record is omitted.
        if (!this.isThirdPartyRecord(record, actorDid)) throw error;
        complete = false;
      }
    }
    this.lastRefreshComplete = complete;
    return events;
  }

  isLastRefreshComplete(): boolean {
    return this.lastRefreshComplete;
  }

  async startAuthorization(): Promise<string> {
    const slot = this.getCookieSlot();
    if (slot === undefined || !this.pendingActor) throw new SpaceCalendarError('Source authorization is unavailable', 'invalid_request', 400);
    const response = await this.fetcher(`/api/calendar/sources/start?slot=${slot}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ requestId: generateUUID() }) });
    const body = await response.json() as { status?: unknown; authorizationUrl?: unknown };
    if (response.status !== 202 || body.status !== 'authorization_required' || typeof body.authorizationUrl !== 'string') throw new SpaceCalendarError('Source authorization failed', 'provider_unavailable', response.status);
    let url: URL;
    try { url = new URL(body.authorizationUrl); } catch { throw new SpaceCalendarError('Invalid source authorization URL', 'invalid_response', 502); }
    if (url.protocol !== 'https:' || !/^\/oauth\/calendar\/tickets\/[A-Za-z0-9_-]{43}$/.test(url.pathname)
      || url.search || url.hash || url.username || url.password) throw new SpaceCalendarError('Invalid source authorization URL', 'invalid_response', 502);
    return body.authorizationUrl;
  }

  async setEnabled(enabled: boolean): Promise<Calendar> {
    const slot = this.getCookieSlot();
    if (slot !== this.sourceSlot) throw new SpaceCalendarError('Calendar account changed', 'invalid_request', 400);
    if (slot !== undefined && this.localActor) {
      try { window.localStorage.setItem(this.localPreferenceKey(), String(enabled)); } catch {
        throw new SpaceCalendarError('Browser calendar settings are unavailable', 'provider_unavailable', 503);
      }
      this.localEnabled = enabled;
      return this.toCalendar(this.localActor, enabled);
    }
    if (slot === undefined || !this.catalog) throw new SpaceCalendarError('Private source settings require authorization', 'authorization_required', 409);
    const actor = this.catalog.actorDid;
    const command = this.pendingCommand?.enabled === enabled ? this.pendingCommand : { requestId: generateUUID(), baseState: this.catalog.state, enabled };
    this.pendingCommand = command;
    const response = await this.fetcher(`/api/calendar/sources/atmo?slot=${slot}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(command) });
    if (response.status === 409) this.pendingCommand = null;
    if (!response.ok) throw new SpaceCalendarError('Private source setting was not accepted', response.status === 409 ? 'conflict' : 'provider_unavailable', response.status);
    const body: unknown = await response.json();
    if (!isAtmoSourceCatalog(body, actor)) throw new SpaceCalendarError('Invalid private source setting', 'invalid_response', 502);
    this.catalog = body;
    this.pendingCommand = null;
    return this.toCalendar(actor, body.sources[0].enabled);
  }

  private localPreferenceKey(): string {
    return `comail:atmo-calendar:${this.localActor}`;
  }

  private toCalendar(actorDid: string, enabled: boolean, pending = false): Calendar {
    return {
      id: `atmo:${actorDid}`, originalId: `atmo:${actorDid}`, source: 'atproto-public', name: 'Atmosphere',
      atmoActorDid: actorDid, atmoSourceState: this.catalog?.state, spaceConsentRequired: pending,
      description: this.localActor ? 'Visibility is saved only in this browser.' : null,
      color: ATMOSPHERE_CALENDAR_COLOR,
      sortOrder: 0, isSubscribed: true, isVisible: enabled,
      isDefault: false, includeInAvailability: 'none', defaultAlertsWithTime: null, defaultAlertsWithoutTime: null,
      timeZone: null, shareWith: null, isShared: false, isTasksOnly: false,
      myRights: { mayReadFreeBusy: false, mayReadItems: true, mayWriteAll: false, mayWriteOwn: false, mayUpdatePrivate: false, mayRSVP: false, mayShare: false, mayDelete: false },
    };
  }

  private isThirdPartyRecord(value: unknown, actorDid: string): boolean {
    if (!value || typeof value !== 'object' || typeof (value as { uri?: unknown }).uri !== 'string') return false;
    const match = /^at:\/\/(did:[^/]+)\//.exec((value as { uri: string }).uri);
    return match !== null && match[1] !== actorDid;
  }

  private toEvent(value: unknown, actorDid: string): CalendarEvent {
    const record = value as PublicAtmoCalendarRecord;
    const identity = typeof record?.uri === 'string' ? /^at:\/\/(did:[^/]+)\/community\.lexicon\.calendar\.event\/([234567abcdefghijklmnopqrstuvwxyz]{13})$/.exec(record.uri) : null;
    if (!identity || record.creatorDid !== identity[1] || typeof record.cid !== 'string' || !record.cid
      || record.rsvpCid !== undefined && (typeof record.rsvpCid !== 'string' || !record.rsvpCid)
      || typeof record.name !== 'string' || !record.name || typeof record.startsAt !== 'string' || !Number.isFinite(Date.parse(record.startsAt))
      || !['hosting', 'going', 'interested'].includes(record.attendance) || record.attendance === 'hosting' && record.creatorDid !== actorDid
      || !['scheduled', 'planned', 'postponed', 'rescheduled', 'cancelled'].includes(record.status)
      || record.endsAt !== undefined && (!Number.isFinite(Date.parse(record.endsAt)) || Date.parse(record.endsAt) < Date.parse(record.startsAt))) throw new SpaceCalendarError('Invalid public event', 'invalid_response', 502);
    const start = new Date(record.startsAt).toISOString();
    const end = record.endsAt ? new Date(record.endsAt).toISOString() : null;
    const atmoUrl = `https://atmo.rsvp/p/${encodeURIComponent(identity[1])}/e/${identity[2]}`;
    return {
      id: `atmo:${record.uri}`, originalId: `atmo:${record.uri}`, source: 'atproto-public', uid: record.uri,
      atprotoUri: record.uri, atprotoCid: record.cid, atprotoCreatorDid: record.creatorDid,
      atmoRsvpCid: record.rsvpCid,
      atmoAttendance: record.attendance, atmoEndUnspecified: end === null,
      calendarIds: { [`atmo:${actorDid}`]: true }, '@type': 'Event', isDraft: false, isOrigin: false,
      utcStart: start, utcEnd: end, title: record.name, description: record.description ?? '', descriptionContentType: 'text/plain',
      created: null, updated: null, sequence: 0, start: start.slice(0, -1), timeZone: 'UTC', duration: `PT${end ? (Date.parse(end) - Date.parse(start)) / 1000 : 0}S`,
      showWithoutTime: false, status: record.status === 'cancelled' ? 'cancelled' : record.status === 'planned' || record.status === 'postponed' ? 'tentative' : 'confirmed',
      freeBusyStatus: 'free', privacy: 'public', color: null, keywords: null, categories: null, locale: null, replyTo: null,
      organizerCalendarAddress: null, participants: null, mayInviteSelf: false, mayInviteOthers: false, hideAttendees: true,
      recurrenceId: null, recurrenceIdTimeZone: null, recurrenceRules: null, recurrenceOverrides: null, excludedRecurrenceRules: null,
      useDefaultAlerts: false, alerts: null, locations: record.location ? { atmo: { '@type': 'Location', name: record.location, description: null, locationTypes: null, relativeTo: null, timeZone: null, coordinates: null, links: null } } : null,
      virtualLocations: null, links: { atmo: { '@type': 'Link', href: atmoUrl, cid: null, contentType: 'text/html', size: null, rel: 'describedby', display: null, title: 'Atmo' } }, relatedTo: null,
    };
  }
}
