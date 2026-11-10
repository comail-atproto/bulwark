import { createHmac, randomBytes } from 'node:crypto';
import type { SessionCredentials } from '@/lib/auth/crypto';
import { inboxBridgeEndpoint, inboxBridgeSecret, inboxSetting } from '@/lib/auth/inbox-config';
import { readBoundedUtf8Body } from '@/lib/auth/relay-redemption';
import { logger } from '@/lib/logger';

// Inbox builds released before the mailbox-session endpoint verify this audience.
// Keep it until those builds are no longer supported; the assertion remains scoped
// to the mailbox and is not usable for SSO or BYOMC routes.
const MAILBOX_SESSION_AUDIENCE = 'comail-access-approvals';
const MAILBOX_SESSION_ISSUER = 'comail-bulwark';
const MAILBOX_SESSION_TTL_SECONDS = 120;
const MAILBOX_SESSION_BODY_LIMIT = 4096;
export const IDENTITY_BACKFILL_TIMEOUT_MS = 2_000;

function b64url(input: string): string {
  return Buffer.from(input, 'utf8').toString('base64url');
}

/** Sign a server-derived mailbox assertion for Inbox mailbox metadata only. */
export function signMailboxSessionToken(mailbox: string): string | null {
  const secret = inboxBridgeSecret();
  if (!secret || !mailbox) return null;
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'HS256', typ: 'JWT' };
  const payload = {
    mailbox,
    iss: MAILBOX_SESSION_ISSUER,
    aud: MAILBOX_SESSION_AUDIENCE,
    iat: now,
    nbf: now,
    exp: now + MAILBOX_SESSION_TTL_SECONDS,
    jti: randomBytes(16).toString('hex'),
  };
  const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  const signature = createHmac('sha256', secret).update(signingInput).digest('base64url');
  return `${signingInput}.${signature}`;
}

/**
 * The new setting is an exact endpoint. Released settings named the retired
 * access-approval bridge base, whose metadata endpoint remains `/identity`.
 */
export function mailboxSessionURL(): string {
  const configured = inboxSetting('INBOX_MAILBOX_SESSION_URL', 'INBOX_MAILBOX_SESSION_URL');
  if (configured !== undefined) {
    if (typeof configured !== 'string') return '';
    const endpoint = inboxBridgeEndpoint('INBOX_MAILBOX_SESSION_URL');
    if (!endpoint) return '';
    try {
      return new URL(configured).pathname === '/webmail/session' ? endpoint : '';
    } catch {
      return '';
    }
  }

  const legacyBase = inboxBridgeEndpoint(
    'INBOX_ACCESS_APPROVAL_BRIDGE_URL',
    'RELAY_ACCESS_APPROVAL_BRIDGE_URL',
  );
  return legacyBase ? `${legacyBase}/identity` : '';
}

export interface BackfillOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
}

const DID_RE = /^did:(?:plc|web):[^\s]+$/;

function withBackfillTimeout(options?: BackfillOptions): AbortSignal | null {
  try {
    const timeoutSignal = AbortSignal.timeout(options?.timeoutMs ?? IDENTITY_BACKFILL_TIMEOUT_MS);
    return options?.signal ? AbortSignal.any([options.signal, timeoutSignal]) : timeoutSignal;
  } catch {
    return null;
  }
}

/** Add a verified Inbox DID to older encrypted sessions without trusting the browser. */
export async function backfillSessionIdentity(
  credentials: SessionCredentials,
  options?: BackfillOptions,
): Promise<SessionCredentials> {
  if (credentials.did) return credentials;

  const url = mailboxSessionURL();
  const token = signMailboxSessionToken(credentials.username);
  const signal = withBackfillTimeout(options);
  if (!url || !token || !signal) return credentials;

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      cache: 'no-store',
      redirect: 'error',
      signal,
    });
  } catch {
    logger.debug('Mailbox session lookup failed');
    return credentials;
  }

  if (!response.ok) return credentials;

  let body: unknown;
  try {
    body = JSON.parse(await readBoundedUtf8Body(response.body, MAILBOX_SESSION_BODY_LIMIT));
  } catch {
    return credentials;
  }

  if (!body || typeof body !== 'object') return credentials;
  const did = (body as Record<string, unknown>).did;
  return typeof did === 'string' && DID_RE.test(did) ? { ...credentials, did } : credentials;
}
