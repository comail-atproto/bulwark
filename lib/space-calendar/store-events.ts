import type { Calendar, CalendarEvent } from '@/lib/jmap/types';
import type { IJMAPClient } from '@/lib/jmap/client-interface';
import { isPublicAtprotoCalendar, isPublicAtprotoEvent } from '@/lib/calendar-editability';
import { SpaceCalendarError, SPACE_PERSONAL_EVENT_FIELDS } from '@/lib/jmap/space-calendar-adapter';
import { buildOccurrencePatch, resolveOverrideKey } from '@/lib/recurrence-instances';

export function requireWritableCalendar(id: string, calendars: Calendar[]): void {
  const calendar = calendars.find(c => c.id === id);
  if (isPublicAtprotoCalendar(calendar ?? { id })) throwPublicSourceReadOnly();
}

export function throwPublicSourceReadOnly(): never {
  throw new SpaceCalendarError('Public Atmosphere calendars are read-only', 'unsupported_operation', 403);
}

export function requireWritableEvent(event: Partial<CalendarEvent>, calendars: Calendar[]): void {
  if (isPublicAtprotoEvent(event)) throwPublicSourceReadOnly();
  for (const [id, included] of Object.entries(event.calendarIds ?? {})) {
    if (included) requireWritableCalendar(id, calendars);
  }
}

export function mergeSpaceEventResponse(existing: CalendarEvent, canonical: CalendarEvent): CalendarEvent {
  return {
    ...existing,
    ...canonical,
    id: existing.id,
    originalId: existing.originalId,
    calendarIds: existing.calendarIds,
    originalCalendarIds: existing.originalCalendarIds,
    accountId: existing.accountId,
    accountName: existing.accountName,
    localAccountId: existing.localAccountId,
    isShared: existing.isShared,
  };
}

const SPACE_EDITABLE_EVENT_FIELDS = new Set([
  'title', 'description', 'start', 'timeZone', 'duration', 'showWithoutTime',
  'recurrenceRules', 'recurrenceOverrides',
]);

function sharedSpaceOverrides(overrides: CalendarEvent['recurrenceOverrides'], shared?: CalendarEvent['recurrenceOverrides']): CalendarEvent['recurrenceOverrides'] {
  if (!overrides) return overrides;
  return Object.fromEntries(Object.entries(overrides).flatMap(([stamp, patch]) => {
    const entries = Object.entries(patch);
    const sharedEntries = entries.filter(([field]) => !SPACE_PERSONAL_EVENT_FIELDS.has(field.split('/')[0]));
    if (shared !== undefined && entries.length > 0 && sharedEntries.length === 0
      && !Object.prototype.hasOwnProperty.call(shared ?? {}, stamp)) return [];
    return [[stamp, Object.fromEntries(sharedEntries)]];
  }));
}

function sharedSpaceEventOverrides(event: CalendarEvent): CalendarEvent['recurrenceOverrides'] {
  if (event.spaceSharedRecurrenceOverrides !== undefined) return event.spaceSharedRecurrenceOverrides;
  if (event.spacePersonalRevisionId) throw new SpaceCalendarError('Authoritative shared occurrence history is unavailable', 'invalid_response');
  return sharedSpaceOverrides(event.recurrenceOverrides);
}

export function applySpacePersonalResponse(existing: CalendarEvent, canonical: CalendarEvent): CalendarEvent {
  const privateValues = Object.fromEntries([...SPACE_PERSONAL_EVENT_FIELDS].map(field => [field,
    (canonical as unknown as Record<string, unknown>)[field],
  ]));
  if (existing.recurrenceId) {
    const override = canonical.recurrenceOverrides?.[existing.recurrenceId];
    for (const field of SPACE_PERSONAL_EVENT_FIELDS) {
      if (override && field in override) privateValues[field] = (override as Record<string, unknown>)[field];
    }
  }
  return { ...existing, ...privateValues, recurrenceOverrides: canonical.recurrenceOverrides,
    spacePersonalRevisionId: canonical.spacePersonalRevisionId };
}

function stableValue(value: unknown): string | undefined {
  if (Array.isArray(value)) return `[${value.map(stableValue).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${stableValue(record[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function prepareSpaceEventUpdate(event: CalendarEvent, updates: Partial<CalendarEvent>, calendars: Calendar[]): void {
  if (event?.source === 'atproto-space') {
    for (const [key, value] of Object.entries(updates)) {
      if (key === 'calendarIds') continue;
      if (stableValue(value) === stableValue((event as unknown as Record<string, unknown>)[key])) {
        delete (updates as Record<string, unknown>)[key];
      } else if (!SPACE_EDITABLE_EVENT_FIELDS.has(key) && !SPACE_PERSONAL_EVENT_FIELDS.has(key)) {
        throw new SpaceCalendarError(`Space calendar does not support changing ${key}`, 'unsupported_operation', 501);
      }
    }
  }
  if (event?.source === 'atproto-space' && updates.calendarIds) {
    const currentCalendarIds = Object.entries(event.calendarIds ?? {})
      .filter(([, included]) => included)
      .map(([calendarId]) => {
        const calendar = calendars.find(c => c.id === calendarId);
        return calendar?.originalId || calendarId;
      })
      .sort();
    const requestedCalendarIds = Object.entries(updates.calendarIds)
      .filter(([, included]) => included)
      .map(([calendarId]) => {
        const calendar = calendars.find(c => c.id === calendarId);
        return calendar?.originalId || calendarId;
      })
      .sort();
    if (currentCalendarIds.length !== 1 || requestedCalendarIds.length !== 1 || requestedCalendarIds[0] !== currentCalendarIds[0]) {
      throw new SpaceCalendarError('Moving an event between calendars is not supported for Space calendars', 'unsupported_operation', 501);
    }
    delete updates.calendarIds;
  }
}

export function prepareSpaceSharedOverrides(event: CalendarEvent, updates: Partial<CalendarEvent>): void {
  if (updates.recurrenceOverrides) {
    for (const [stamp, override] of Object.entries(updates.recurrenceOverrides)) {
      for (const [field, value] of Object.entries(override)) {
        if (SPACE_PERSONAL_EVENT_FIELDS.has(field.split('/')[0])
          && stableValue(value) !== stableValue((event.recurrenceOverrides?.[stamp] as Record<string, unknown> | undefined)?.[field])) {
          throw new SpaceCalendarError('Save shared event changes and private settings separately', 'mixed_audiences', 400);
        }
      }
    }
    const shared = event.spacePersonalRevisionId ? sharedSpaceEventOverrides(event) : undefined;
    updates.recurrenceOverrides = sharedSpaceOverrides(updates.recurrenceOverrides, shared);
  }
}

export async function updateSpaceOccurrence(client: IJMAPClient, event: CalendarEvent, realId: string, updates: Partial<CalendarEvent>): Promise<CalendarEvent> {
  if (!event.spaceRevisionId || !client.updateAtprotoSpaceCalendarEvent || !event.recurrenceId || event.recurrenceOverrides === undefined) {
    throw new SpaceCalendarError('Space occurrence revision or override history is unavailable', 'invalid_response');
  }
  for (const field of ['recurrenceRules', 'recurrenceOverrides'] as const) {
    if (updates[field] !== undefined && stableValue(updates[field]) !== stableValue(event[field])) {
      throw new SpaceCalendarError(`A single occurrence cannot change ${field}`, 'unsupported_operation', 501);
    }
  }
  const key = resolveOverrideKey(event, event.recurrenceOverrides);
  if (!key) throw new SpaceCalendarError('Space occurrence identity is unavailable', 'invalid_response');
  const sharedOverrides = sharedSpaceEventOverrides(event);
  const overrides = { ...sharedOverrides, [key]: {
    ...sharedOverrides?.[key], start: event.start, duration: event.duration,
    ...buildOccurrencePatch(updates),
  } };
  const base = await client.updateAtprotoSpaceCalendarEvent(event.baseEventId || realId, event.spaceRevisionId, { recurrenceOverrides: overrides });
  return { ...event, ...updates, recurrenceOverrides: base.recurrenceOverrides, spaceRevisionId: base.spaceRevisionId, spaceSharedRecurrenceOverrides: base.spaceSharedRecurrenceOverrides };
}

export async function rsvpSpaceOccurrence(client: IJMAPClient, event: CalendarEvent, realId: string, participantId: string, status: string): Promise<{ base: CalendarEvent; event: CalendarEvent }> {
  if (!event.spaceRevisionId || !client.rsvpAtprotoSpaceCalendarEvent || !event.recurrenceId || event.recurrenceOverrides === undefined) {
    throw new SpaceCalendarError('Space occurrence adapter, revision or history is unavailable', 'invalid_response');
  }
  if (!event.participants?.[participantId]?.isCurrentUser) {
    throw new SpaceCalendarError('RSVP participant does not match the authenticated Space member', 'unauthorized', 403);
  }
  const key = resolveOverrideKey(event, event.recurrenceOverrides);
  if (!key) {
    throw new SpaceCalendarError('Space occurrence identity is unavailable', 'invalid_response');
  }
  const base = await client.rsvpAtprotoSpaceCalendarEvent(event.baseEventId || realId, event.spaceRevisionId, status, key);
  const reply = base.recurrenceOverrides?.[key]?.participants?.[participantId];
  if (!reply?.isCurrentUser || reply.participationStatus !== status) {
    throw new SpaceCalendarError('Space occurrence response was not confirmed', 'invalid_response');
  }
  const answered = { ...event, recurrenceOverrides: base.recurrenceOverrides, spaceRevisionId: base.spaceRevisionId, spaceSharedRecurrenceOverrides: base.spaceSharedRecurrenceOverrides,
    participants: { ...event.participants, [participantId]: { ...event.participants[participantId], ...reply } } };
  return { base, event: answered };
}

export async function cancelSpaceOccurrence(client: IJMAPClient, event: CalendarEvent, realId: string, calendars: Calendar[]): Promise<CalendarEvent> {
  const spaceCalendar = Object.keys(event.calendarIds ?? {})
    .map(calendarId => calendars.find(c => c.id === calendarId))
    .find(c => c?.source === 'atproto-space');
  if (spaceCalendar?.spaceRole !== 'owner') {
    throw new SpaceCalendarError('Only the Space owner can cancel this occurrence', 'unsupported_operation', 501);
  }
  if (!event.spaceRevisionId || !client.updateAtprotoSpaceCalendarEvent || !event.recurrenceId || event.recurrenceOverrides === undefined) {
    throw new SpaceCalendarError('Space occurrence revision or override history is unavailable', 'invalid_response');
  }
  const key = resolveOverrideKey(event, event.recurrenceOverrides);
  if (!key) throw new SpaceCalendarError('Space occurrence identity is unavailable', 'invalid_response');
  const sharedOverrides = sharedSpaceEventOverrides(event);
  return await client.updateAtprotoSpaceCalendarEvent(event.baseEventId || realId, event.spaceRevisionId, {
    recurrenceOverrides: { ...sharedOverrides, [key]: { ...sharedOverrides?.[key], excluded: true } },
  });
}

export async function updateSpacePrivateEvent(client: IJMAPClient, event: CalendarEvent, realId: string, updates: Partial<CalendarEvent>, calendars: Calendar[], isOccurrence: boolean): Promise<CalendarEvent> {
  if (Object.keys(updates).some(key => !SPACE_PERSONAL_EVENT_FIELDS.has(key))) {
    throw new SpaceCalendarError('Save shared event changes and private settings separately', 'mixed_audiences', 400);
  }
  const calendarIds = Object.entries(event.calendarIds ?? {}).filter(([, included]) => included).map(([id]) => id);
  if (calendarIds.length === 0 || !calendarIds.every(id => {
    const calendar = calendars.find(c => c.id === id);
    return calendar?.source === 'atproto-space' && calendar.myRights?.mayUpdatePrivate === true;
  })) {
    throw new SpaceCalendarError('Private calendar settings are not authorized', 'unauthorized', 403);
  }
  if (!event.spacePersonalRevisionId || !client.updateAtprotoSpaceCalendarPrivateEvent) {
    throw new SpaceCalendarError('Private calendar adapter or revision is unavailable', 'invalid_response');
  }
  const stamp = isOccurrence ? event.recurrenceId : undefined;
  if (isOccurrence && !stamp) throw new SpaceCalendarError('Space occurrence identity is unavailable', 'invalid_response');
  const canonical = await client.updateAtprotoSpaceCalendarPrivateEvent(
    isOccurrence ? event.baseEventId || realId : realId,
    event.spacePersonalRevisionId, updates, stamp || undefined,
  );
  if (!canonical.spacePersonalRevisionId) throw new SpaceCalendarError('Private calendar response is incomplete', 'invalid_response');
  return canonical;
}
