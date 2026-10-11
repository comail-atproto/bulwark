import { inboxBridgeEndpoint, inboxBridgeSecret } from '@/lib/auth/inbox-config';
// Active-laptop access approval bridge. The mailbox assertion is derived only
// from Bulwark's encrypted server-side session; the browser never supplies a
// mailbox or DID. The distinct audience prevents cross-use with SSO or BYOMC.

import { createHmac, randomBytes } from 'node:crypto';
import { cookies } from 'next/headers';
import { MAX_ACCOUNT_SLOTS } from '@/lib/account-utils';
import { decryptSession, type SessionCredentials } from '@/lib/auth/crypto';
import { sessionCookieName } from '@/lib/auth/session-cookie';
import { logger } from '@/lib/logger';

const BRIDGE_AUDIENCE = 'comail-access-approvals';
const BRIDGE_ISSUER = 'comail-bulwark';
const BRIDGE_TTL_SECONDS = 120;

function b64url(input: string): string {
  return Buffer.from(input, 'utf8').toString('base64url');
}

export function signAccessApprovalBridgeToken(mailbox: string): string | null {
  const secret = inboxBridgeSecret();
  if (!secret || !mailbox) return null;
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'HS256', typ: 'JWT' };
  const payload = {
    mailbox,
    iss: BRIDGE_ISSUER,
    aud: BRIDGE_AUDIENCE,
    iat: now,
    nbf: now,
    exp: now + BRIDGE_TTL_SECONDS,
    jti: randomBytes(16).toString('hex'),
  };
  const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  const signature = createHmac('sha256', secret).update(signingInput).digest('base64url');
  return `${signingInput}.${signature}`;
}

export async function accessApprovalSessionMailbox(): Promise<string | null> {
  const store = await cookies();
  for (let slot = 0; slot < MAX_ACCOUNT_SLOTS; slot++) {
    const token = store.get(sessionCookieName(slot))?.value;
    if (!token) continue;
    const session = decryptSession(token);
    if (session?.username) return session.username;
  }
  return null;
}

export function accessApprovalRelayBridgeUrl(): string {
  return inboxBridgeEndpoint('INBOX_ACCESS_APPROVAL_BRIDGE_URL', 'RELAY_ACCESS_APPROVAL_BRIDGE_URL');
}

export const IDENTITY_BACKFILL_TIMEOUT_MS = 2_000;

export interface BackfillOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
}

const DID_RE = /^did:(?:plc|web):[^\s]+$/;

function isValidDid(did: string): boolean {
  return DID_RE.test(did);
}

function withBackfillTimeout(options?: BackfillOptions): AbortSignal | null {
  try {
    const timeoutMs = options?.timeoutMs ?? IDENTITY_BACKFILL_TIMEOUT_MS;
    const timeoutSignal = AbortSignal.timeout(timeoutMs);
    const callerSignal = options?.signal;
    if (!callerSignal) return timeoutSignal;
    return AbortSignal.any([callerSignal, timeoutSignal]);
  } catch {
    return null;
  }
}

export async function backfillSessionIdentity(
  credentials: SessionCredentials,
  options?: BackfillOptions,
): Promise<SessionCredentials> {
  if (credentials.did) return credentials;

  const base = accessApprovalRelayBridgeUrl();
  if (!base) return credentials;

  const token = signAccessApprovalBridgeToken(credentials.username);
  if (!token) return credentials;

  const signal = withBackfillTimeout(options);
  if (!signal) return credentials;

  let response: Response;
  try {
    response = await fetch(`${base}/identity`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      },
      cache: 'no-store',
      redirect: 'error',
      signal,
    });
  } catch {
    logger.debug('Identity backfill fetch failed');
    return credentials;
  }

  if (!response.ok) return credentials;

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return credentials;
  }

  if (typeof body !== 'object' || body === null) return credentials;
  const did = (body as Record<string, unknown>).did;
  if (typeof did !== 'string' || !isValidDid(did)) return credentials;

  return { ...credentials, did };
}
