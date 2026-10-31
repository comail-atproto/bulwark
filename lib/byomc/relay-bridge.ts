import { inboxBridgeEndpoint, inboxBridgeSecret } from '@/lib/auth/inbox-config';
// Inbox scopes mailbox assertions to the encrypted Bulwark session. Browser
// input cannot choose the mailbox or reuse the SSO/approval JWT audience.

import { createHmac, randomBytes } from 'node:crypto';
import { cookies } from 'next/headers';
import { decryptSession } from '@/lib/auth/crypto';
import { sessionCookieName } from '@/lib/auth/session-cookie';
import { MAX_ACCOUNT_SLOTS } from '@/lib/account-utils';

// Wire audience retained for existing Inbox verifier compatibility.
const BRIDGE_AUDIENCE = 'comail-byomc-app-passwords';
const BRIDGE_ISSUER = 'comail-bulwark';
const BRIDGE_TTL_SECONDS = 120;

function b64url(input: string): string {
  return Buffer.from(input, 'utf8').toString('base64url');
}

/**
 * Sign a short-lived HS256 JWT asserting `mailbox`, using the Inbox↔Bulwark
 * shared secret. Returns null if the secret is unset/too short (bridge disabled)
 * or the mailbox is empty. The token carries a distinct audience + issuer from
 * the SSO handoff token so the two can never be cross-used.
 */
export function signBridgeToken(mailbox: string): string | null {
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
  const sig = createHmac('sha256', secret).update(signingInput).digest('base64url');
  return `${signingInput}.${sig}`;
}

/**
 * Resolve the caller's mailbox from their server-side session cookie. Reads the
 * first valid account slot (slot 0 = the primary/legacy account). Returns null
 * when unauthenticated. NOTE: targets the primary account; multi-account
 * active-slot selection is a follow-up.
 */
export async function sessionMailbox(): Promise<string | null> {
  const store = await cookies();
  for (let slot = 0; slot < MAX_ACCOUNT_SLOTS; slot++) {
    const token = store.get(sessionCookieName(slot))?.value;
    if (!token) continue;
    const sess = decryptSession(token);
    if (sess?.username) return sess.username;
  }
  return null;
}

/** The owned private bridge base URL, trailing slash trimmed. Empty = unset. */
export function relayBridgeUrl(): string {
  return inboxBridgeEndpoint('INBOX_APP_PASSWORD_BRIDGE_URL', 'RELAY_APP_PASSWORD_BRIDGE_URL');
}
