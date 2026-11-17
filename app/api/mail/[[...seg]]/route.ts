import { NextRequest, NextResponse } from 'next/server';
import { isSameOriginRequest } from '@/lib/admin/session';
import { MAX_ACCOUNT_SLOTS } from '@/lib/account-utils';
import { decryptSession } from '@/lib/auth/crypto';
import { sessionCookieName } from '@/lib/auth/session-cookie';
import { inboxBridgeEndpoint, inboxBrowserOrigin } from '@/lib/auth/inbox-config';
import { readBoundedUtf8Body } from '@/lib/auth/relay-redemption';
import { signMailBridgeToken } from '@/lib/space-mail/bridge';
import { MAIL_PROTOCOL_VERSION, MAIL_CLIENT_UPDATE_MESSAGE, MAX_MAIL_BYTES, isMailState, isSelectedMail, isMailInventory, isMailFolder, isMailBootstrap, isMailSubmission, isMailSubmissionInventory } from '@/lib/space-mail/wire';

export const dynamic = 'force-dynamic';
type Params = { params: Promise<{ seg?: string[] }> };
const ERROR_CODES = new Set(['unauthorized', 'not_found', 'invalid_request', 'conflict', 'mail_unavailable', 'client_update_required']);
const json = (status: number, error: string) => NextResponse.json(
  error === 'client_update_required' ? { error: MAIL_CLIENT_UPDATE_MESSAGE, code: error } : { error },
  { status, headers: { 'Cache-Control': 'no-store' } },
);
const isJson = (type: string | null) => type?.split(';', 1)[0].trim().toLowerCase() === 'application/json';

async function proxy(req: NextRequest, params: Params['params']): Promise<NextResponse> {
  const origin = req.headers.get('origin');
  const fetchSite = req.headers.get('sec-fetch-site');
  if (!isSameOriginRequest(req) || origin !== null && origin !== inboxBrowserOrigin(req.nextUrl.origin)
    || fetchSite !== null && fetchSite !== 'same-origin') return json(403, 'forbidden');
  const { seg } = await params;
  const operation = seg?.join('/');
  if (!operation || !['bootstrap', 'messages', 'drafts', 'messages/read', 'inventory', 'state', 'folders', 'submissions', 'submissions/status', 'submissions/cancel', 'submissions/inventory'].includes(operation)
    || seg?.some(part => part.includes('/'))) return json(400, 'invalid_request');
  if ([...req.nextUrl.searchParams.keys()].some(key => key !== 'slot')
    || req.nextUrl.searchParams.getAll('slot').length !== 1) return json(400, 'invalid_request');
  const rawSlot = req.nextUrl.searchParams.get('slot')!;
  const slot = Number(rawSlot);
  if (!/^(0|[1-9]\d*)$/.test(rawSlot) || !Number.isSafeInteger(slot) || slot >= MAX_ACCOUNT_SLOTS) return json(400, 'invalid_request');
  const configured = process.env.INBOX_MAIL_BRIDGE_URL;
  if (configured === undefined || configured === '') return json(404, 'not_configured');
  const cookie = req.cookies.get(sessionCookieName(slot))?.value;
  const session = cookie ? decryptSession(cookie) : null;
  if (!session?.username || !session.did) return json(401, 'unauthorized');
  if (req.headers.get('X-Comail-Mail-Protocol') !== MAIL_PROTOCOL_VERSION) return json(403, 'client_update_required');
  const base = inboxBridgeEndpoint('INBOX_MAIL_BRIDGE_URL');
  if (!base || !base.endsWith('/webmail/mail/api/v1')) return json(503, 'mail_unavailable');
  const token = signMailBridgeToken(session.username, session.did);
  if (!token) return json(503, 'mail_unavailable');
  if (!isJson(req.headers.get('content-type'))) return json(415, 'invalid_request');
  const limit = ['messages', 'drafts'].includes(operation) ? Math.ceil(MAX_MAIL_BYTES / 3) * 4 + 1024 * 1024 : 1024 * 1024;
  let body: string;
  try { body = await readBoundedUtf8Body(req.body, limit); } catch { return json(413, 'invalid_request'); }
  let input: Record<string, unknown>;
  try {
    const value: unknown = JSON.parse(body);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return json(400, 'invalid_request');
    input = value as Record<string, unknown>;
  } catch { return json(400, 'invalid_request'); }
  try {
    const response = await fetch(`${base}/${operation}`, {
      method: 'POST', body, headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', 'Content-Type': 'application/json', 'X-Comail-Mail-Protocol': MAIL_PROTOCOL_VERSION },
      cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(30_000),
    });
    if (!isJson(response.headers.get('content-type'))) return json(502, 'mail_unavailable');
    const value: unknown = JSON.parse(await readBoundedUtf8Body(response.body, Math.ceil(MAX_MAIL_BYTES / 3) * 4 + 1024 * 1024));
    if (response.ok) {
      if (response.status !== 200) return json(502, 'mail_unavailable');
      const mutation = input.mutation && typeof input.mutation === 'object' && !Array.isArray(input.mutation)
        ? input.mutation as Record<string, unknown> : null;
      const placement = operation === 'drafts' ? mutation : input;
      const sameStrings = (actual: string[], expected: unknown) => Array.isArray(expected)
        && actual.length === expected.length && actual.every((value, index) => value === expected[index]);
      const submissionValue = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
      const validSubmission = isMailSubmission(value) && (operation !== 'submissions'
        || value.logicalMessageId === input.logicalMessageId && value.fingerprint === input.fingerprint)
        && (operation !== 'submissions/status' || input.submissionId === undefined || value.id === input.submissionId);
      const valid = operation === 'bootstrap' ? isMailBootstrap(value, session.did, session.username)
        : operation === 'submissions' || operation === 'submissions/status' ? validSubmission
        : operation === 'submissions/inventory' ? isMailSubmissionInventory(value)
        : operation === 'submissions/cancel' ? !!submissionValue && submissionValue.cancelled === true
        : operation === 'inventory' ? isMailInventory(value, session.did)
        : operation === 'folders' ? isMailFolder(value) && (input.folderId === undefined || input.folderId === '' || value.folderId === input.folderId)
          && value.tombstone === input.tombstone && (input.tombstone === true || value.name === input.name)
        : operation === 'messages/read'
          ? isSelectedMail(value, session.did) && value.state.logicalMessageId === input.logicalMessageId && value.message.fingerprint === input.fingerprint
          : isMailState(value) && !!placement
            && (operation === 'state' ? value.tombstone === input.tombstone && value.deletePending === input.deletePending : !value.tombstone && !value.deletePending)
            && sameStrings(value.mailboxIds, placement.mailboxIds) && sameStrings(value.keywords, placement.keywords)
            && (operation === 'state' ? value.logicalMessageId === input.logicalMessageId && value.version === input.version
              : operation !== 'drafts' || value.logicalMessageId === mutation?.logicalMessageId);
      if (!valid) return json(502, 'mail_unavailable');
      return NextResponse.json(value, { headers: { 'Cache-Control': 'no-store' } });
    }
    const code = value && typeof value === 'object' && 'error' in value ? value.error : undefined;
    if (typeof code === 'string' && ERROR_CODES.has(code) && [400, 401, 403, 404, 409, 413, 422, 501, 502, 503].includes(response.status)) return json(response.status, code);
  } catch { /* Provider and credential details stay outside browser responses. */ }
  return json(502, 'mail_unavailable');
}

export const POST = (req: NextRequest, { params }: Params) => proxy(req, params);
