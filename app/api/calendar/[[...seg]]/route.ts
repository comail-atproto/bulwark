import { NextRequest, NextResponse } from 'next/server';
import { isSameOriginRequest } from '@/lib/admin/session';
import { MAX_ACCOUNT_SLOTS } from '@/lib/account-utils';
import { decryptSession } from '@/lib/auth/crypto';
import { sessionCookieName } from '@/lib/auth/session-cookie';
import { bridgeFailureClass, calendarBridgeEndpoint, inboxSetting } from '@/lib/auth/inbox-config';
import { signCalendarBridgeToken } from '@/lib/space-calendar/bridge';
import { configManager } from '@/lib/admin/config-manager';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

type SegParams = { params: Promise<{ seg?: string[] }> };

function json(status: number, error: string, detail?: Record<string, unknown>): NextResponse {
  return NextResponse.json({ error, ...detail }, { status, headers: { 'Cache-Control': 'no-store' } });
}

async function readLimitedBody(request: Request, maxBytes: number): Promise<string | null> {
  const declared = request.headers.get('content-length');
  if (declared && Number(declared) > maxBytes) return null;
  if (!request.body) return '';
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

async function readLimitedResponse(response: Response, maxBytes: number): Promise<string | null> {
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

function isJsonContentType(value: string | null): boolean {
  const mime = value?.split(';', 1)[0]?.trim().toLowerCase();
  return mime === 'application/json' || !!mime?.startsWith('application/') && mime.endsWith('+json');
}

const KNOWN_BRIDGE_ERRORS = new Set([
  'unauthorized', 'forbidden', 'not_found', 'invalid_request', 'unsupported_operation',
  'conflict', 'stale_revision', 'no_membership', 'lease_expired', 'invalid_event',
  'calendar_unavailable', 'provider_unavailable', 'provider_error', 'unsupported', 'expired', 'unavailable',
  'authorization_required', 'consent_required',
]);

function hasOnlyUniqueQueryParams(req: NextRequest, allowed: string[]): boolean {
  const seen = new Set<string>();
  for (const [key] of req.nextUrl.searchParams) {
    if (!allowed.includes(key) || seen.has(key)) return false;
    seen.add(key);
  }
  return true;
}

function isRfc3339(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|[+-](\d{2}):(\d{2}))$/.exec(value);
  if (!match || !Number.isFinite(Date.parse(value))) return false;
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, , , offsetHourText, offsetMinuteText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const offsetHour = offsetHourText ? Number(offsetHourText) : 0;
  const offsetMinute = offsetMinuteText ? Number(offsetMinuteText) : 0;
  return month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth[month - 1]
    && Number(hourText) <= 23 && Number(minuteText) <= 59 && Number(secondText) <= 59
    && offsetHour <= 23 && offsetMinute <= 59;
}

function parseSlot(raw: string | null): number | null {
  if (raw === null || !/^(0|[1-9]\d*)$/.test(raw)) return null;
  const slot = Number(raw);
  return Number.isSafeInteger(slot) && slot < MAX_ACCOUNT_SLOTS ? slot : null;
}

function validEventId(id: string): boolean {
  return /^[A-Za-z0-9_-]{1,128}$/.test(id);
}

function validAuthorizationUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash
      && /^\/oauth\/calendar\/tickets\/[A-Za-z0-9_-]{43}$/.test(url.pathname);
  } catch {
    return false;
  }
}

function validPendingCalendar(value: unknown): value is {
  id: string; name: string; source: 'atproto-space'; initialized: null;
  pendingConsent: true; revisionId: null; policyId: null; myRole: null;
} {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const calendar = value as Record<string, unknown>;
  return typeof calendar.id === 'string' && calendar.id.length > 0 && calendar.id.length <= 128
    && typeof calendar.name === 'string' && calendar.name.length > 0 && calendar.name.length <= 256
    && calendar.source === 'atproto-space' && calendar.initialized === null
    && calendar.pendingConsent === true && calendar.revisionId === null
    && calendar.policyId === null && calendar.myRole === null
    && Object.keys(calendar).every((key) => ['id', 'name', 'source', 'initialized', 'pendingConsent', 'revisionId', 'policyId', 'myRole'].includes(key));
}

function routeSuffix(req: NextRequest, seg: string[] | undefined, method: string): string | null {
  if (!seg?.length) return null;
  if (seg.length === 1 && seg[0] === 'calendars' && method === 'GET' && hasOnlyUniqueQueryParams(req, ['slot'])) return '/calendars';
  if (seg.length === 1 && seg[0] === 'principals' && method === 'GET' && hasOnlyUniqueQueryParams(req, ['slot'])) return '/principals';
  if (seg.length === 3 && seg[0] === 'owner' && (seg[1] === 'data' || seg[1] === 'membership') && seg[2] === 'start'
    && method === 'POST' && hasOnlyUniqueQueryParams(req, ['slot'])) return `/owner/${seg[1]}/start`;
  if (seg.length === 3 && seg[0] === 'member' && seg[1] === 'consent' && seg[2] === 'start'
    && method === 'POST' && hasOnlyUniqueQueryParams(req, ['slot'])) return '/member/consent/start';
  if (seg.length === 1 && seg[0] === 'events' && method === 'GET') {
    if (!hasOnlyUniqueQueryParams(req, ['slot', 'after', 'before'])) return null;
    const after = req.nextUrl.searchParams.get('after');
    const before = req.nextUrl.searchParams.get('before');
    if (!after || !before || !isRfc3339(after) || !isRfc3339(before)) return null;
    const range = Date.parse(before) - Date.parse(after);
    if (range <= 0 || range > 366 * 24 * 60 * 60 * 1000) return null;
    return `/events?${new URLSearchParams({ after, before }).toString()}`;
  }
  if (seg.length === 1 && seg[0] === 'events' && method === 'POST' && hasOnlyUniqueQueryParams(req, ['slot'])) return '/events';
  if (seg.length === 1 && seg[0] === 'share' && (method === 'POST' || method === 'DELETE') && hasOnlyUniqueQueryParams(req, ['slot'])) return '/share';
  if (seg.length === 1 && seg[0] === 'rebuild' && method === 'POST' && hasOnlyUniqueQueryParams(req, ['slot'])) return '/rebuild';
  if (seg[0] === 'events' && seg.length === 2 && validEventId(seg[1]) && (method === 'PUT' || method === 'DELETE')) {
    if (!hasOnlyUniqueQueryParams(req, ['slot'])) return null;
    return `/events/${encodeURIComponent(seg[1])}`;
  }
  if (seg[0] === 'events' && seg.length === 3 && validEventId(seg[1]) && seg[2] === 'rsvp' && method === 'POST') {
    if (!hasOnlyUniqueQueryParams(req, ['slot'])) return null;
    return `/events/${encodeURIComponent(seg[1])}/rsvp`;
  }
  return null;
}

async function proxyCalendarRequest(
  req: NextRequest,
  params: SegParams['params'],
  method: 'GET' | 'PUT' | 'POST' | 'DELETE',
): Promise<NextResponse> {
  if (!isSameOriginRequest(req)) return json(403, 'forbidden');
  const { seg } = await params;
  const suffix = routeSuffix(req, seg, method);
  if (suffix === null) return json(400, 'invalid_request');
  const slot = parseSlot(req.nextUrl.searchParams.get('slot'));
  if (slot === null) return json(400, 'invalid_request');
  const sessionToken = req.cookies.get(sessionCookieName(slot))?.value;
  const session = sessionToken ? decryptSession(sessionToken) : null;
  if (!session?.username) return json(401, 'unauthorized');
  await configManager.ensureLoaded();
  if (session.groupwareEnabled !== true || configManager.get<boolean>('calendarEnabled', false) !== true) {
    return json(404, 'not_found');
  }

  const rawBase = inboxSetting('INBOX_CALENDAR_BRIDGE_URL', 'RELAY_CALENDAR_BRIDGE_URL');
  if (rawBase === undefined || rawBase === '') return json(404, 'not_found');
  const base = calendarBridgeEndpoint();
  if (!base) return json(503, 'bridge_unavailable');
  const token = signCalendarBridgeToken(session.username);
  if (!token) return json(503, 'bridge_unavailable');
  let body: string | undefined;
  if (method !== 'GET') {
    if (!isJsonContentType(req.headers.get('content-type'))) return json(415, 'invalid_request');
    try {
      body = await readLimitedBody(req, 64 * 1024) ?? undefined;
    } catch {
      return json(400, 'invalid_request');
    }
    if (body === undefined) return json(413, 'invalid_request');
    try {
      const parsed: unknown = JSON.parse(body);
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return json(400, 'invalid_request');
    } catch {
      return json(400, 'invalid_request');
    }
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/json',
  };
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  let response: Response;
  let responseText: string | null;
  try {
    response = await fetch(`${base}${suffix}`, {
      method,
      headers,
      body,
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(30_000),
    });
    responseText = await readLimitedResponse(response, 2 * 1024 * 1024);
  } catch (error) {
    logger.error('Space calendar bridge request failed', { outcome: bridgeFailureClass(error) });
    return json(502, 'provider_unavailable');
  }
  if (responseText === null || !isJsonContentType(response.headers.get('content-type'))) return json(502, 'provider_unavailable');
  let responseBody: unknown;
  try {
    responseBody = JSON.parse(responseText);
  } catch {
    return json(502, 'provider_unavailable');
  }
  if (response.ok) {
    if (typeof responseBody !== 'object' || responseBody === null || Array.isArray(responseBody)) return json(502, 'provider_unavailable');
    if (suffix.endsWith('/start')) {
      const start = responseBody as { status?: unknown; authorizationUrl?: unknown };
      if (response.status !== 202 || start.status !== 'authorization_required' || !validAuthorizationUrl(start.authorizationUrl)) {
        return json(502, 'provider_unavailable');
      }
      return NextResponse.json({ status: 'authorization_required', authorizationUrl: start.authorizationUrl }, {
        status: 202,
        headers: { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' },
      });
    }
    return NextResponse.json(responseBody, { status: response.status, headers: { 'Cache-Control': 'no-store' } });
  }
  const upstreamError = typeof responseBody === 'object' && responseBody !== null && 'error' in responseBody
    ? (responseBody as { error?: unknown }).error
    : undefined;
  const code = typeof upstreamError === 'string' && KNOWN_BRIDGE_ERRORS.has(upstreamError) ? upstreamError : null;
  if (code === 'authorization_required' && response.status === 409 && typeof responseBody === 'object' && responseBody !== null) {
    const profile = (responseBody as { authorizationProfile?: unknown }).authorizationProfile;
    if (profile === 'owner-data' || profile === 'owner-membership' || profile === 'member-calendar') {
      const detail: Record<string, unknown> = { authorizationProfile: profile };
      if (profile === 'member-calendar' && validPendingCalendar((responseBody as { calendar?: unknown }).calendar)) {
        detail.calendar = (responseBody as { calendar: unknown }).calendar;
      }
      return json(409, code, detail);
    }
  }
  if (code && [400, 401, 403, 404, 409, 410, 422, 501, 503].includes(response.status)) return json(response.status, code);
  return json(502, code ?? 'provider_unavailable');
}

export async function GET(req: NextRequest, { params }: SegParams): Promise<NextResponse> {
  return proxyCalendarRequest(req, params, 'GET');
}

export async function PUT(req: NextRequest, { params }: SegParams): Promise<NextResponse> {
  return proxyCalendarRequest(req, params, 'PUT');
}

export async function POST(req: NextRequest, { params }: SegParams): Promise<NextResponse> {
  return proxyCalendarRequest(req, params, 'POST');
}

export async function DELETE(req: NextRequest, { params }: SegParams): Promise<NextResponse> {
  return proxyCalendarRequest(req, params, 'DELETE');
}
