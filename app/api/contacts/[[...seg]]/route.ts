import { NextRequest, NextResponse } from 'next/server';
import { isSameOriginRequest } from '@/lib/admin/session';
import { MAX_ACCOUNT_SLOTS } from '@/lib/account-utils';
import { decryptSession } from '@/lib/auth/crypto';
import { sessionCookieName } from '@/lib/auth/session-cookie';
import { inboxBridgeEndpoint, inboxBrowserOrigin } from '@/lib/auth/inbox-config';
import { readBoundedUtf8Body } from '@/lib/auth/relay-redemption';
import { groupwareMailboxAllowed } from '@/lib/groupware/access';
import { isPersonalAuthorizationUrl } from '@/lib/groupware/authorization';
import { signContactBridgeToken } from '@/lib/space-contacts/bridge';
import { isSpaceContactBook } from '@/lib/space-contacts/book';

export const dynamic = 'force-dynamic';
type Params = { params: Promise<{ seg?: string[] }> };
const errors = new Set(['unauthorized', 'forbidden', 'not_found', 'invalid_request', 'conflict', 'unsupported_operation', 'contacts_unavailable', 'authorization_required']);
const json = (status: number, error: string) => NextResponse.json({ error }, { status, headers: { 'Cache-Control': 'no-store' } });
const isJson = (type: string | null) => type?.split(';', 1)[0].trim().toLowerCase() === 'application/json';

async function proxy(req: NextRequest, params: Params['params'], method: 'GET' | 'POST'): Promise<NextResponse> {
  const origin = req.headers.get('origin');
  const fetchSite = req.headers.get('sec-fetch-site');
  if (!isSameOriginRequest(req) || origin !== null && origin !== inboxBrowserOrigin(req.nextUrl.origin)
    || fetchSite !== null && fetchSite !== 'same-origin') return json(403, 'forbidden');
  const { seg } = await params;
  if (seg?.length !== 1 || !(method === 'GET' && seg[0] === 'book'
    || method === 'POST' && ['apply', 'rebuild', 'authorization'].includes(seg[0]))) return json(400, 'invalid_request');
  if ([...req.nextUrl.searchParams.keys()].some(key => key !== 'slot')
    || req.nextUrl.searchParams.getAll('slot').length !== 1) return json(400, 'invalid_request');
  const rawSlot = req.nextUrl.searchParams.get('slot')!;
  const slot = Number(rawSlot);
  if (!/^(0|[1-9]\d*)$/.test(rawSlot) || !Number.isSafeInteger(slot) || slot >= MAX_ACCOUNT_SLOTS) return json(400, 'invalid_request');
  const configured = process.env.INBOX_CONTACTS_BRIDGE_URL;
  if (configured === undefined || configured === '') return json(404, 'not_configured');
  const cookie = req.cookies.get(sessionCookieName(slot))?.value;
  const session = cookie ? decryptSession(cookie) : null;
  if (!session?.username || !session.did) return json(401, 'unauthorized');
  if (session.groupwareEnabled !== true || !await groupwareMailboxAllowed(session.username, 'contacts')) return json(403, 'forbidden');
  const base = inboxBridgeEndpoint('INBOX_CONTACTS_BRIDGE_URL');
  if (!base || !base.endsWith('/webmail/contacts/api/v1')) return json(503, 'bridge_unavailable');
  const token = signContactBridgeToken(session.username);
  if (!token) return json(503, 'bridge_unavailable');
  let body: string | undefined;
  if (method === 'POST') {
    if (!isJson(req.headers.get('content-type'))) return json(415, 'invalid_request');
    try {
      body = await readBoundedUtf8Body(req.body, 128 * 1024);
    } catch {
      return json(413, 'invalid_request');
    }
    try {
      const value: unknown = JSON.parse(body);
      if (!value || typeof value !== 'object' || Array.isArray(value)) return json(400, 'invalid_request');
      if (['rebuild', 'authorization'].includes(seg[0]) && Object.keys(value).length !== 0) return json(400, 'invalid_request');
    } catch { return json(400, 'invalid_request'); }
  } else if (req.body) return json(400, 'invalid_request');
  try {
    const response = await fetch(`${base}/${seg[0]}`, {
      method, body, headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(30_000),
    });
    if (!isJson(response.headers.get('content-type'))) return json(502, 'provider_unavailable');
    const value: unknown = JSON.parse(await readBoundedUtf8Body(response.body, 8 * 1024 * 1024));
    if (response.ok) {
      if (seg[0] === 'authorization') {
        const result = value as { status?: unknown; authorizationUrl?: unknown } | null;
        const expectedOrigin = process.env.INBOX_GROUPWARE_AUTHORIZATION_ORIGIN || 'https://inbox.comail.at';
        if (response.status !== 200 || result?.status !== 'authorization_required'
          || !isPersonalAuthorizationUrl(result.authorizationUrl, 'contacts', expectedOrigin)) return json(502, 'provider_unavailable');
        return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
      }

      if (response.status !== 200 || !isSpaceContactBook(value) || value.actorDID !== session.did) return json(502, 'provider_unavailable');
      return NextResponse.json(value, { headers: { 'Cache-Control': 'no-store' } });
    }
    const code = value && typeof value === 'object' && 'error' in value ? value.error : undefined;
    if (typeof code === 'string' && errors.has(code) && [400, 401, 403, 404, 409, 413, 422, 501, 503].includes(response.status)) return json(response.status, code);
  } catch { /* Provider and credential details stay outside browser responses. */ }
  return json(502, 'provider_unavailable');
}

export const GET = (req: NextRequest, { params }: Params) => proxy(req, params, 'GET');
export const POST = (req: NextRequest, { params }: Params) => proxy(req, params, 'POST');
