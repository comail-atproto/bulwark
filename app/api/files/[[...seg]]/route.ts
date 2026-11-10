import { NextRequest, NextResponse } from 'next/server';
import { isSameOriginRequest } from '@/lib/admin/session';
import { MAX_ACCOUNT_SLOTS } from '@/lib/account-utils';
import { decryptSession } from '@/lib/auth/crypto';
import { sessionCookieName } from '@/lib/auth/session-cookie';
import { inboxBridgeEndpoint, inboxBrowserOrigin } from '@/lib/auth/inbox-config';
import { readBoundedUtf8Body } from '@/lib/auth/relay-redemption';
import { groupwareMailboxAllowed } from '@/lib/groupware/access';
import { isPersonalAuthorizationUrl } from '@/lib/groupware/authorization';
import { signFileBridgeToken } from '@/lib/space-files/bridge';
import { MAX_PRIVATE_FILE_BYTES, isSpaceFile, isSpaceFileInventory, readPrivateFileBytes } from '@/lib/space-files/wire';

export const dynamic = 'force-dynamic';
type Params = { params: Promise<{ seg?: string[] }> };
const errors = new Set(['unauthorized', 'forbidden', 'not_found', 'invalid_request', 'conflict', 'files_unavailable', 'authorization_required', 'too_large']);
const json = (status: number, error: string) => NextResponse.json({ error }, { status, headers: { 'Cache-Control': 'no-store' } });
const isJson = (type: string | null) => type?.split(';', 1)[0].trim().toLowerCase() === 'application/json';

async function proxy(req: NextRequest, params: Params['params'], method: 'GET' | 'POST'): Promise<NextResponse> {
  const origin = req.headers.get('origin');
  const fetchSite = req.headers.get('sec-fetch-site');
  if (!isSameOriginRequest(req) || origin !== null && origin !== inboxBrowserOrigin(req.nextUrl.origin)
    || fetchSite !== null && fetchSite !== 'same-origin') return json(403, 'forbidden');
  const { seg } = await params;
  if (seg?.length !== 1 || !(method === 'GET' && seg[0] === 'inventory'
    || method === 'POST' && ['put', 'tombstone', 'download', 'authorization'].includes(seg[0]))) return json(400, 'invalid_request');
  if ([...req.nextUrl.searchParams.keys()].some(key => key !== 'slot')
    || req.nextUrl.searchParams.getAll('slot').length !== 1) return json(400, 'invalid_request');
  const rawSlot = req.nextUrl.searchParams.get('slot')!;
  const slot = Number(rawSlot);
  if (!/^(0|[1-9]\d*)$/.test(rawSlot) || !Number.isSafeInteger(slot) || slot >= MAX_ACCOUNT_SLOTS) return json(400, 'invalid_request');
  const configured = process.env.INBOX_FILES_BRIDGE_URL;
  if (configured === undefined || configured === '') return json(404, 'not_configured');
  const cookie = req.cookies.get(sessionCookieName(slot))?.value;
  const session = cookie ? decryptSession(cookie) : null;
  if (!session?.username || !session.did) return json(401, 'unauthorized');
  if (session.groupwareEnabled !== true || !await groupwareMailboxAllowed(session.username, 'files')) return json(403, 'forbidden');
  const base = inboxBridgeEndpoint('INBOX_FILES_BRIDGE_URL');
  if (!base || !base.endsWith('/webmail/files/api/v1')) return json(503, 'files_unavailable');
  const token = signFileBridgeToken(session.username);
  if (!token) return json(503, 'files_unavailable');
  let body: string | undefined;
  if (method === 'POST') {
    if (!isJson(req.headers.get('content-type'))) return json(415, 'invalid_request');
    const limit = seg[0] === 'put' ? Math.ceil(MAX_PRIVATE_FILE_BYTES / 3) * 4 + 1024 * 1024 : 1024 * 1024;
    try { body = await readBoundedUtf8Body(req.body, limit); } catch { return json(413, 'invalid_request'); }
    try {
      const value: unknown = JSON.parse(body);
      if (!value || typeof value !== 'object' || Array.isArray(value)) return json(400, 'invalid_request');
      if (seg[0] === 'authorization' && Object.keys(value).length !== 0) return json(400, 'invalid_request');
    } catch { return json(400, 'invalid_request'); }
  } else if (req.body) return json(400, 'invalid_request');
  try {
    const response = await fetch(`${base}/${seg[0]}`, {
      method, body, headers: { Authorization: `Bearer ${token}`, Accept: seg[0] === 'download' ? 'application/octet-stream' : 'application/json', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(30_000),
    });
    if (seg[0] === 'download' && response.ok) {
      if (response.status !== 200 || response.headers.get('content-type') !== 'application/octet-stream') return json(502, 'files_unavailable');
      const bytes = await readPrivateFileBytes(response.body);
      return new NextResponse(bytes, { headers: { 'Cache-Control': 'no-store', 'Content-Type': 'application/octet-stream', 'Content-Disposition': 'attachment; filename="download"', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; sandbox" } });
    }
    if (!isJson(response.headers.get('content-type'))) return json(502, 'files_unavailable');
    const value: unknown = JSON.parse(await readBoundedUtf8Body(response.body, 8 * 1024 * 1024));
    if (response.ok) {
      if (response.status !== 200) return json(502, 'files_unavailable');
      if (seg[0] === 'authorization') {
        const result = value as { status?: unknown; authorizationUrl?: unknown } | null;
        const expectedOrigin = process.env.INBOX_GROUPWARE_AUTHORIZATION_ORIGIN || 'https://inbox.comail.at';
        if (result?.status !== 'authorization_required' || !isPersonalAuthorizationUrl(result.authorizationUrl, 'files', expectedOrigin)) return json(502, 'files_unavailable');
        return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
      }
      const valid = seg[0] === 'inventory' ? isSpaceFileInventory(value) && value.actorDID === session.did
        : seg[0] === 'put' ? isSpaceFile(value)
          : !!value && typeof value === 'object' && 'deleted' in value && value.deleted === true;
      if (!valid) return json(502, 'files_unavailable');
      return NextResponse.json(value, { headers: { 'Cache-Control': 'no-store' } });
    }
    const code = value && typeof value === 'object' && 'error' in value ? value.error : undefined;
    if (typeof code === 'string' && errors.has(code) && [400, 401, 403, 404, 409, 413, 422, 501, 503].includes(response.status)) return json(response.status, code);
  } catch { /* Provider and credential details stay outside browser responses. */ }
  return json(502, 'files_unavailable');
}

export const GET = (req: NextRequest, { params }: Params) => proxy(req, params, 'GET');
export const POST = (req: NextRequest, { params }: Params) => proxy(req, params, 'POST');
