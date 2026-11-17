export const ATMO_EVENT_COLLECTION = 'community.lexicon.calendar.event';
export const ATMO_RSVP_COLLECTION = 'community.lexicon.calendar.rsvp';

export type AtmoAttendance = 'hosting' | 'going' | 'interested';
export type AtmoEventStatus = 'scheduled' | 'planned' | 'postponed' | 'rescheduled' | 'cancelled';
export type AtmoEventMode = 'inperson' | 'virtual' | 'hybrid';

export interface AtprotoRepoRecord {
  uri: string;
  cid: string;
  value: unknown;
}

export interface PublicAtmoCalendarRecord {
  uri: string;
  cid: string;
  rsvpCid?: string;
  creatorDid: string;
  name: string;
  startsAt: string;
  endsAt?: string;
  description?: string;
  location?: string;
  status: AtmoEventStatus;
  mode?: AtmoEventMode;
  attendance: AtmoAttendance;
  atmoUrl: string;
}

export interface PublicAtmoRsvpRecord {
  uri: string;
  cid: string;
  creatorDid: string;
  rkey: string;
  eventUri: string;
  subjectCid: string;
  status: 'going' | 'interested' | 'notgoing';
}

export class AtmoCalendarRecordError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AtmoCalendarRecordError';
  }
}

const DID_PATTERN = /^did:[a-z0-9]+:[A-Za-z0-9._:%-]{1,256}$/;
const TID_PATTERN = /^[234567abcdefghijklmnopqrstuvwxyz]{13}$/;
const CID_PATTERN = /^[A-Za-z0-9._~:-]{1,256}$/;
const DATE_TIME_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|([+-])(\d{2}):(\d{2}))$/;
const EVENT_STATUSES = new Set<AtmoEventStatus>(['scheduled', 'planned', 'postponed', 'rescheduled', 'cancelled']);
const EVENT_MODES = new Set<AtmoEventMode>(['inperson', 'virtual', 'hybrid']);

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isValidDid(value: unknown): value is string {
  return typeof value === 'string' && DID_PATTERN.test(value);
}

function requireCid(value: unknown): string {
  if (typeof value !== 'string' || !CID_PATTERN.test(value)) {
    throw new AtmoCalendarRecordError('Record CID is malformed');
  }
  return value;
}

function parseAtUri(uri: string, expectedCollection: string): { did: string; rkey: string } {
  const match = /^at:\/\/(did:[^/]+)\/([^/]+)\/([^/?#]+)$/.exec(uri);
  if (!match || !isValidDid(match[1]) || match[2] !== expectedCollection || !TID_PATTERN.test(match[3])) {
    throw new AtmoCalendarRecordError('Record URI identity is malformed');
  }
  return { did: match[1], rkey: match[3] };
}

function parseDateTime(value: unknown, field: string): { value: string; epoch: number } {
  if (typeof value !== 'string') throw new AtmoCalendarRecordError(`${field} timestamp is malformed`);
  const match = DATE_TIME_PATTERN.exec(value);
  if (!match) throw new AtmoCalendarRecordError(`${field} timestamp must include a timezone offset`);
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, zone, , offsetHourText, offsetMinuteText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const offsetHour = offsetHourText ? Number(offsetHourText) : 0;
  const offsetMinute = offsetMinuteText ? Number(offsetMinuteText) : 0;
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth[month - 1]
    || Number(hourText) > 23 || Number(minuteText) > 59 || Number(secondText) > 59
    || offsetHour > 23 || offsetMinute > 59 || !Number.isFinite(Date.parse(value))) {
    throw new AtmoCalendarRecordError(`${field} timestamp is malformed`);
  }
  if (zone !== 'Z' && zone[0] !== '+' && zone[0] !== '-') {
    throw new AtmoCalendarRecordError(`${field} timestamp must include a timezone offset`);
  }
  return { value, epoch: Date.parse(value) };
}

function optionalString(record: Record<string, unknown>, key: string, maxLength: number): string | undefined {
  const value = record[key];
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value.length > maxLength) {
    throw new AtmoCalendarRecordError(`Event ${key} is malformed`);
  }
  return value || undefined;
}

function locationText(value: unknown): string | undefined {
  if (!isObject(value)) return undefined;
  const parts: string[] = [];
  for (const key of ['name', 'streetAddress', 'locality', 'region', 'country', 'uri']) {
    const part = value[key];
    if (typeof part === 'string' && part.trim() && !parts.includes(part.trim())) parts.push(part.trim());
  }
  return parts.length ? parts.join(', ').slice(0, 1000) : undefined;
}

function normalizeStatus(value: unknown): AtmoEventStatus {
  if (value === undefined) return 'scheduled';
  const prefix = `${ATMO_EVENT_COLLECTION}#`;
  if (typeof value !== 'string' || !value.startsWith(prefix)) {
    throw new AtmoCalendarRecordError('Event status is malformed');
  }
  const status = value.slice(prefix.length);
  if (!EVENT_STATUSES.has(status as AtmoEventStatus)) throw new AtmoCalendarRecordError('Event status is unsupported');
  return status as AtmoEventStatus;
}

function normalizeMode(value: unknown): AtmoEventMode | undefined {
  if (value === undefined) return undefined;
  const prefix = `${ATMO_EVENT_COLLECTION}#`;
  if (typeof value !== 'string' || !value.startsWith(prefix)) {
    throw new AtmoCalendarRecordError('Event mode is malformed');
  }
  const mode = value.slice(prefix.length);
  if (!EVENT_MODES.has(mode as AtmoEventMode)) throw new AtmoCalendarRecordError('Event mode is unsupported');
  return mode as AtmoEventMode;
}

export function normalizeAtmoEventRecord(
  envelope: AtprotoRepoRecord,
  attendance: AtmoAttendance,
  expectedUri?: string,
): PublicAtmoCalendarRecord | null {
  if (!isObject(envelope) || typeof envelope.uri !== 'string') {
    throw new AtmoCalendarRecordError('Event record envelope is malformed');
  }
  const identity = parseAtUri(envelope.uri, ATMO_EVENT_COLLECTION);
  if (expectedUri !== undefined && envelope.uri !== expectedUri) {
    throw new AtmoCalendarRecordError('Event record does not match its requested identity');
  }
  const cid = requireCid(envelope.cid);
  if (!isObject(envelope.value) || envelope.value.$type !== ATMO_EVENT_COLLECTION) {
    throw new AtmoCalendarRecordError('Event record type is malformed');
  }
  const record = envelope.value;
  if (typeof record.name !== 'string' || !record.name.trim() || record.name.length > 500) {
    throw new AtmoCalendarRecordError('Event name is malformed');
  }
  parseDateTime(record.createdAt, 'Event createdAt');
  const rawStart = record.startsAt;
  if (rawStart === undefined) return null;
  const start = parseDateTime(rawStart, 'Event startsAt');
  let end: { value: string; epoch: number } | undefined;
  if (record.endsAt !== undefined) {
    end = parseDateTime(record.endsAt, 'Event endsAt');
    if (end.epoch < start.epoch) throw new AtmoCalendarRecordError('Event end cannot precede its start');
  }
  const description = optionalString(record, 'description', 20_000);
  const locations = record.locations;
  if (locations !== undefined && !Array.isArray(locations)) throw new AtmoCalendarRecordError('Event locations are malformed');
  const location = Array.isArray(locations)
    ? locations.map(locationText).filter((part): part is string => !!part).join('; ').slice(0, 1000) || undefined
    : undefined;
  const status = normalizeStatus(record.status);
  const mode = normalizeMode(record.mode);
  const atmoUrl = new URL(`/p/${encodeURIComponent(identity.did)}/e/${encodeURIComponent(identity.rkey)}`, 'https://atmo.rsvp').toString();

  return {
    uri: envelope.uri,
    cid,
    creatorDid: identity.did,
    name: record.name.trim(),
    startsAt: start.value,
    ...(end ? { endsAt: end.value } : {}),
    ...(description ? { description } : {}),
    ...(location ? { location } : {}),
    status,
    ...(mode ? { mode } : {}),
    attendance,
    atmoUrl,
  };
}

export function normalizeAtmoRsvpRecord(envelope: AtprotoRepoRecord): PublicAtmoRsvpRecord {
  if (!isObject(envelope) || typeof envelope.uri !== 'string') {
    throw new AtmoCalendarRecordError('RSVP record envelope is malformed');
  }
  const identity = parseAtUri(envelope.uri, ATMO_RSVP_COLLECTION);
  const cid = requireCid(envelope.cid);
  if (!isObject(envelope.value) || envelope.value.$type !== ATMO_RSVP_COLLECTION) {
    throw new AtmoCalendarRecordError('RSVP record type is malformed');
  }
  const subject = envelope.value.subject;
  if (!isObject(subject) || typeof subject.uri !== 'string') {
    throw new AtmoCalendarRecordError('RSVP subject is malformed');
  }
  parseAtUri(subject.uri, ATMO_EVENT_COLLECTION);
  const subjectCid = requireCid(subject.cid);
  const rawStatus = envelope.value.status;
  if (typeof rawStatus !== 'string' || !rawStatus.startsWith(`${ATMO_RSVP_COLLECTION}#`)) {
    throw new AtmoCalendarRecordError('RSVP status is malformed');
  }
  const status = rawStatus.slice(rawStatus.lastIndexOf('#') + 1);
  if (!['going', 'interested', 'notgoing'].includes(status)) {
    throw new AtmoCalendarRecordError('RSVP status is unsupported');
  }
  return {
    uri: envelope.uri,
    cid,
    creatorDid: identity.did,
    rkey: identity.rkey,
    eventUri: subject.uri,
    subjectCid,
    status: status as PublicAtmoRsvpRecord['status'],
  };
}

export function atmoEventOverlapsWindow(
  event: Pick<PublicAtmoCalendarRecord, 'startsAt' | 'endsAt'>,
  after: string,
  before: string,
): boolean {
  const start = Date.parse(event.startsAt);
  const afterTime = Date.parse(after);
  const beforeTime = Date.parse(before);
  if (event.endsAt === undefined) return start >= afterTime && start < beforeTime;
  const end = Date.parse(event.endsAt);
  if (end === start) return start >= afterTime && start < beforeTime;
  return start < beforeTime && end > afterTime;
}
