import { isNoThirdPartyTrafficOn } from '@/lib/admin/third-party-mode';
import { fetchPublicUrl, type PublicFetchResponse } from '@/lib/security/url-guard';
import {
  ATMO_EVENT_COLLECTION,
  ATMO_RSVP_COLLECTION,
  atmoEventOverlapsWindow,
  normalizeAtmoEventRecord,
  normalizeAtmoRsvpRecord,
  type AtprotoRepoRecord,
  type PublicAtmoCalendarRecord,
} from './record';

const MAX_WINDOW_MS = 366 * 24 * 60 * 60 * 1000;
const MAX_PAGES_PER_COLLECTION = 8;
const PAGE_SIZE = 100;
const MAX_RECORDS_PER_COLLECTION = 400;
const MAX_EVENT_LOOKUPS = 25;
const MAX_CONCURRENT_EVENT_LOOKUPS = 5;
const MAX_DID_LOOKUPS = 16;
const MAX_RESPONSE_BYTES = 1024 * 1024;
const MAX_TOTAL_BYTES = 4 * 1024 * 1024;
const TOTAL_DEADLINE_MS = 8_000;
const DID_PLC_PATTERN = /^did:plc:[a-z2-7]{24}$/;
const DID_WEB_PATTERN = /^did:web:([A-Za-z0-9.-]+)$/;
const RFC3339_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

export type PublicAtmoCalendarReadErrorCode =
  | 'invalid_actor'
  | 'invalid_window'
  | 'invalid_pds'
  | 'missing_pds'
  | 'redirect_rejected'
  | 'invalid_response'
  | 'response_too_large'
  | 'pagination_cycle'
  | 'page_limit'
  | 'record_limit'
  | 'lookup_limit'
  | 'deadline_exceeded'
  | 'upstream_error';

export class PublicAtmoCalendarReadError extends Error {
  constructor(readonly code: PublicAtmoCalendarReadErrorCode, message: string) {
    super(message);
    this.name = 'PublicAtmoCalendarReadError';
  }
}

export interface PublicAtmoCalendarReadInput {
  actorDid: string;
  after: string;
  before: string;
}

export interface PublicAtmoCalendarReadResult {
  actorDid: string;
  after: string;
  before: string;
  events: PublicAtmoCalendarRecord[];
  /** False means one or more third-party RSVP targets could not be read. */
  complete: boolean;
}

interface Deadline {
  signal: AbortSignal;
  race<T>(promise: Promise<T>): Promise<T>;
  consume(bytes: number): void;
}

function fail(code: PublicAtmoCalendarReadErrorCode, message: string): never {
  throw new PublicAtmoCalendarReadError(code, message);
}

function normalizeEventRecord(
  record: AtprotoRepoRecord,
  attendance: 'hosting' | 'going' | 'interested',
  expectedUri?: string,
): PublicAtmoCalendarRecord | null {
  try {
    return normalizeAtmoEventRecord(record, attendance, expectedUri);
  } catch {
    fail('invalid_response', 'PDS returned an invalid public event record');
  }
}

function normalizeRsvpRecord(record: AtprotoRepoRecord): ReturnType<typeof normalizeAtmoRsvpRecord> {
  try {
    return normalizeAtmoRsvpRecord(record);
  } catch {
    fail('invalid_response', 'PDS returned an invalid public RSVP record');
  }
}

function deadline(): { state: Deadline; close: () => void } {
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout>;
  const expired = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      controller.abort();
      reject(new PublicAtmoCalendarReadError('deadline_exceeded', 'Public calendar read exceeded its time budget'));
    }, TOTAL_DEADLINE_MS);
  });
  let totalBytes = 0;
  return {
    state: {
      signal: controller.signal,
      race: (promise) => Promise.race([promise, expired]),
      consume: (bytes) => {
        totalBytes += bytes;
        if (totalBytes > MAX_TOTAL_BYTES) fail('response_too_large', 'Public calendar read exceeded its byte budget');
      },
    },
    close: () => {
      clearTimeout(timeout!);
      controller.abort();
    },
  };
}

export function validatePublicAtmoCalendarWindow(after: string, before: string): void {
  if (!RFC3339_PATTERN.test(after) || !RFC3339_PATTERN.test(before)) {
    fail('invalid_window', 'Date bounds must be RFC3339 timestamps with timezone offsets');
  }
  const validTimestamp = (value: string): boolean => {
    const parts = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|([+-])(\d{2}):(\d{2}))$/.exec(value);
    if (!parts) return false;
    const [, y, m, d, h, min, sec, zone, , offsetH, offsetM] = parts;
    const year = Number(y);
    const month = Number(m);
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    const monthDays = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    return month >= 1 && month <= 12 && Number(d) >= 1 && Number(d) <= monthDays[month - 1]
      && Number(h) <= 23 && Number(min) <= 59 && Number(sec) <= 59
      && (zone === 'Z' || (Number(offsetH) <= 23 && Number(offsetM) <= 59));
  };
  if (!validTimestamp(after) || !validTimestamp(before)) fail('invalid_window', 'Date bounds are not valid calendar timestamps');
  const afterMs = Date.parse(after);
  const beforeMs = Date.parse(before);
  if (!Number.isFinite(afterMs) || !Number.isFinite(beforeMs) || beforeMs <= afterMs || beforeMs - afterMs > MAX_WINDOW_MS) {
    fail('invalid_window', 'Date bounds must describe a positive window no longer than 366 days');
  }
}

function isSupportedAtprotoDid(did: string): boolean {
  if (DID_PLC_PATTERN.test(did)) return true;
  const match = DID_WEB_PATTERN.exec(did);
  if (!match) return false;
  const hostname = match[1];
  if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local') || hostname.endsWith('.arpa')) return false;
  try {
    const parsed = new URL(`https://${hostname}`);
    return parsed.hostname === hostname.toLowerCase() && parsed.hostname !== 'localhost' && !parsed.hostname.endsWith('.arpa');
  } catch {
    return false;
  }
}

function hasControlCharacters(value: string): boolean {
  return [...value].some((character) => {
    const code = character.charCodeAt(0);
    return code < 32 || code === 127;
  });
}

function didDocumentUrl(did: string): string {
  if (did.startsWith('did:plc:')) return `https://plc.directory/${did}`;
  const match = DID_WEB_PATTERN.exec(did);
  if (!match || !isSupportedAtprotoDid(did)) fail('invalid_actor', 'DID web identifier is unsupported');
  const host = match[1];
  let url: URL;
  try {
    url = new URL(`https://${host}/.well-known/did.json`);
  } catch {
    fail('invalid_actor', 'DID web identifier is malformed');
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    fail('invalid_actor', 'DID web document URL is malformed');
  }
  return url.toString();
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function pdsEndpoint(document: unknown, did: string): string {
  if (!isObject(document) || document.id !== did || !Array.isArray(document.service)) {
    fail('invalid_response', 'DID document identity or services are malformed');
  }
  const service = document.service.find((entry) => isObject(entry)
    && (entry.id === '#atproto_pds' || entry.id === `${did}#atproto_pds`)
    && (entry.type === 'AtprotoPersonalDataServer'
      || (Array.isArray(entry.type) && entry.type.includes('AtprotoPersonalDataServer'))));
  if (!service) fail('missing_pds', 'DID document must identify an AT Protocol PDS');
  const rawEndpoint = service.serviceEndpoint;
  if (typeof rawEndpoint !== 'string') fail('invalid_pds', 'PDS endpoint is malformed');
  let endpoint: URL;
  try {
    endpoint = new URL(rawEndpoint);
  } catch {
    fail('invalid_pds', 'PDS endpoint is malformed');
  }
  if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || endpoint.search || endpoint.hash
    || endpoint.pathname !== '/' || !endpoint.hostname) {
    fail('invalid_pds', 'PDS endpoint must be a public HTTPS origin');
  }
  return endpoint.origin;
}

async function readBody(response: PublicFetchResponse, maxBytes: number, budget: Deadline): Promise<string> {
  const contentType = response.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase();
  if (contentType !== 'application/json' && !contentType?.endsWith('+json')) {
    fail('invalid_response', 'Public endpoint did not return JSON');
  }
  const declared = response.headers.get('content-length');
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > maxBytes)) {
    fail('response_too_large', 'Public endpoint response exceeded its byte limit');
  }
  if (!response.body) fail('invalid_response', 'Public endpoint returned an empty body');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  let complete = false;
  try {
    while (true) {
      const { done, value } = await budget.race(reader.read());
      if (done) {
        complete = true;
        break;
      }
      size += value.byteLength;
      if (size > maxBytes) fail('response_too_large', 'Public endpoint response exceeded its byte limit');
      chunks.push(value);
    }
    budget.consume(size);
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } finally {
    if (!complete) {
      try { await reader.cancel(); } catch { /* the stream may already be aborted */ }
    }
  }
}

async function cancelResponseBody(response: PublicFetchResponse): Promise<void> {
  try { await response.body?.cancel(); } catch { /* the stream may already be consumed or aborted */ }
}

async function parseResponseJson(response: PublicFetchResponse, budget: Deadline): Promise<unknown> {
  try {
    return JSON.parse(await readBody(response, MAX_RESPONSE_BYTES, budget));
  } catch (error) {
    await cancelResponseBody(response);
    if (error instanceof PublicAtmoCalendarReadError) throw error;
    fail('invalid_response', 'Public AT Protocol endpoint returned malformed JSON');
  }
}

async function requestJson(url: URL, budget: Deadline, allowNotFound = false): Promise<unknown | null> {
  if (await isNoThirdPartyTrafficOn()) fail('upstream_error', 'Public calendars are off (NO_THIRD_PARTY_TRAFFIC).');
  if (url.protocol !== 'https:' || url.username || url.password || url.hash) fail('invalid_pds', 'Public fetch URL must use HTTPS');
  let response: PublicFetchResponse;
  try {
    response = await budget.race(fetchPublicUrl(url.toString(), {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: budget.signal,
    }));
  } catch (error) {
    if (error instanceof PublicAtmoCalendarReadError) throw error;
    fail('upstream_error', 'Public AT Protocol endpoint could not be reached');
  }
  if (response.status >= 300 && response.status < 400) {
    await cancelResponseBody(response);
    fail('redirect_rejected', 'Public AT Protocol endpoint redirected');
  }
  if (allowNotFound && (response.status === 400 || response.status === 404)) {
    const body = await parseResponseJson(response, budget);
    if (response.status === 400 && isObject(body) && body.error === 'RecordNotFound') return null;
    fail('upstream_error', `Public AT Protocol endpoint returned ${response.status}`);
  }
  if (!response.ok) {
    await cancelResponseBody(response);
    fail('upstream_error', `Public AT Protocol endpoint returned ${response.status}`);
  }
  return parseResponseJson(response, budget);
}

function listUrl(pds: string, repo: string, collection: string, cursor?: string): URL {
  const url = new URL('/xrpc/com.atproto.repo.listRecords', pds);
  url.searchParams.set('repo', repo);
  url.searchParams.set('collection', collection);
  url.searchParams.set('limit', String(PAGE_SIZE));
  if (cursor !== undefined) url.searchParams.set('cursor', cursor);
  return url;
}

function getRecordUrl(pds: string, did: string, rkey: string): URL {
  const url = new URL('/xrpc/com.atproto.repo.getRecord', pds);
  url.searchParams.set('repo', did);
  url.searchParams.set('collection', ATMO_EVENT_COLLECTION);
  url.searchParams.set('rkey', rkey);
  return url;
}

async function listRecords(
  pds: string,
  did: string,
  collection: string,
  budget: Deadline,
): Promise<AtprotoRepoRecord[]> {
  const records: AtprotoRepoRecord[] = [];
  const recordUris = new Set<string>();
  const cursors = new Set<string>();
  let cursor: string | undefined;
  for (let page = 0; page < MAX_PAGES_PER_COLLECTION; page += 1) {
    const result = await requestJson(listUrl(pds, did, collection, cursor), budget);
    if (!isObject(result) || !Array.isArray(result.records) || result.records.length > PAGE_SIZE) {
      fail('invalid_response', 'PDS record page is malformed');
    }
    for (const raw of result.records) {
      if (!isObject(raw) || typeof raw.uri !== 'string' || typeof raw.cid !== 'string' || !('value' in raw)) {
        fail('invalid_response', 'PDS record envelope is malformed');
      }
      if (recordUris.has(raw.uri)) fail('invalid_response', 'PDS repeated a record identity across pages');
      recordUris.add(raw.uri);
      records.push(raw as unknown as AtprotoRepoRecord);
      if (records.length > MAX_RECORDS_PER_COLLECTION) fail('record_limit', 'PDS record count exceeded its limit');
    }
    if (result.cursor === undefined) return records;
    if (typeof result.cursor !== 'string' || !result.cursor || result.cursor.length > 512 || hasControlCharacters(result.cursor)) {
      fail('invalid_response', 'PDS pagination cursor is malformed');
    }
    if (cursors.has(result.cursor)) fail('pagination_cycle', 'PDS pagination cursor repeated');
    cursors.add(result.cursor);
    cursor = result.cursor;
  }
  fail('page_limit', 'PDS pagination exceeded its page limit');
}

export async function readPublicAtmoCalendar(input: PublicAtmoCalendarReadInput): Promise<PublicAtmoCalendarReadResult> {
  if (!input || typeof input.actorDid !== 'string' || !isSupportedAtprotoDid(input.actorDid)) {
    fail('invalid_actor', 'A verified AT Protocol DID is required');
  }
  validatePublicAtmoCalendarWindow(input.after, input.before);
  const { state: budget, close } = deadline();
  try {
    const pdsCache = new Map<string, Promise<string>>();
    const resolvePds = async (did: string): Promise<string> => {
      if (!isSupportedAtprotoDid(did)) fail('invalid_response', 'Record references an unsupported DID method');
      const cached = pdsCache.get(did);
      if (cached) return cached;
      if (pdsCache.size >= MAX_DID_LOOKUPS) fail('lookup_limit', 'DID lookup count exceeded its limit');
      const endpoint = requestJson(new URL(didDocumentUrl(did)), budget).then((doc) => pdsEndpoint(doc, did));
      pdsCache.set(did, endpoint);
      return endpoint;
    };

    const actorPds = await resolvePds(input.actorDid);
    const [hostedEnvelopes, rsvpEnvelopes] = await Promise.all([
      listRecords(actorPds, input.actorDid, ATMO_EVENT_COLLECTION, budget),
      listRecords(actorPds, input.actorDid, ATMO_RSVP_COLLECTION, budget),
    ]);
    const hosted = new Map<string, PublicAtmoCalendarRecord>();
    for (const envelope of hostedEnvelopes) {
      const event = normalizeEventRecord(envelope, 'hosting');
      if (!event) continue;
      if (event.creatorDid !== input.actorDid) fail('invalid_response', 'Hosted event record belongs to another DID');
      if (atmoEventOverlapsWindow(event, input.after, input.before)) hosted.set(event.uri, event);
    }

    const latestRsvp = new Map<string, ReturnType<typeof normalizeAtmoRsvpRecord>>();
    for (const envelope of rsvpEnvelopes) {
      const rsvp = normalizeRsvpRecord(envelope);
      if (rsvp.creatorDid !== input.actorDid) fail('invalid_response', 'RSVP record belongs to another DID');
      const previous = latestRsvp.get(rsvp.eventUri);
      if (!previous || rsvp.rkey > previous.rkey) latestRsvp.set(rsvp.eventUri, rsvp);
    }

    const resultEvents = new Map(hosted);
    const lookupTargets = [...latestRsvp.values()]
      .filter((rsvp) => rsvp.status !== 'notgoing' && !hosted.has(rsvp.eventUri))
      .sort((a, b) => a.eventUri.localeCompare(b.eventUri));
    let complete = true;
    const selectedTargets: typeof lookupTargets = [];
    const selectedDids = new Set<string>();
    for (const rsvp of lookupTargets) {
      const [, , creatorDid, collection, rkey] = rsvp.eventUri.split('/');
      if (rsvp.eventUri.slice(0, 5) !== 'at://' || !creatorDid || collection !== ATMO_EVENT_COLLECTION || !rkey) {
        fail('invalid_response', 'RSVP event reference is malformed');
      }
      if (selectedTargets.length >= MAX_EVENT_LOOKUPS
        || !pdsCache.has(creatorDid) && !selectedDids.has(creatorDid) && pdsCache.size + selectedDids.size >= MAX_DID_LOOKUPS) {
        complete = false;
        continue;
      }
      selectedTargets.push(rsvp);
      selectedDids.add(creatorDid);
    }
    const loadTarget = async (rsvp: (typeof selectedTargets)[number]) => {
      const [, , creatorDid, , rkey] = rsvp.eventUri.split('/');
      try {
        const eventPds = await resolvePds(creatorDid);
        const raw = await requestJson(getRecordUrl(eventPds, creatorDid, rkey), budget, true);
        if (raw === null) return;
        if (!isObject(raw) || typeof raw.uri !== 'string' || typeof raw.cid !== 'string' || !('value' in raw)) {
          fail('invalid_response', 'PDS event lookup is malformed');
        }
        const attendance = rsvp.status === 'going' ? 'going' : 'interested';
        const event = normalizeEventRecord(raw as unknown as AtprotoRepoRecord, attendance, rsvp.eventUri);
        if (event && atmoEventOverlapsWindow(event, input.after, input.before)) {
          resultEvents.set(event.uri, { ...event, rsvpCid: rsvp.cid });
        }
      } catch (error) {
        if (creatorDid === input.actorDid) throw error;
        complete = false;
      }
    };
    for (let i = 0; i < selectedTargets.length; i += MAX_CONCURRENT_EVENT_LOOKUPS) {
      await Promise.all(selectedTargets.slice(i, i + MAX_CONCURRENT_EVENT_LOOKUPS).map(loadTarget));
    }

    return {
      actorDid: input.actorDid,
      after: input.after,
      before: input.before,
      events: [...resultEvents.values()].sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt) || a.uri.localeCompare(b.uri)),
      complete,
    };
  } finally {
    close();
  }
}
