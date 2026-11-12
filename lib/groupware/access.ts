import type { NextRequest } from 'next/server';
import { configManager } from '@/lib/admin/config-manager';
import { decryptSession, sessionAuthHeader } from '@/lib/auth/crypto';
import { sessionCookieName } from '@/lib/auth/session-cookie';
import { readBoundedUtf8Body } from '@/lib/auth/relay-redemption';
import { mailboxSessionURL, signMailboxSessionToken } from '@/lib/auth/mailbox-session';
import type { StalwartCredentials } from '@/lib/stalwart/credentials';
import type { GroupwareFeature } from '@/lib/groupware/jmap';

// Recheck Inbox's live groupware access; a login-time entitlement cannot keep
// a disabled feature accessible through an old session or document token.
export async function groupwareMailboxAllowed(mailbox: string, feature: GroupwareFeature): Promise<boolean> {
  await configManager.ensureLoaded();
  if (configManager.get<boolean>(`${feature}Enabled`, false) !== true) return false;
  return currentGroupwareEnabled(mailbox);
}

async function currentGroupwareActor(mailbox: string): Promise<string | null> {
  const url = mailboxSessionURL();
  const token = signMailboxSessionToken(mailbox);
  if (!url || !token) return null;
  try {
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(2000),
    });
    if (!response.ok) return null;
    const body: unknown = JSON.parse(await readBoundedUtf8Body(response.body, 4096));
    if (!body || typeof body !== 'object') return null;
    const identity = body as Record<string, unknown>;
    return typeof identity.did === 'string' && /^did:(plc|web):[^\s]+$/.test(identity.did)
      && identity.groupware_enabled === true ? identity.did : null;
  } catch {
    return null;
  }
}

export async function groupwareAllowed(request: NextRequest, creds: StalwartCredentials, feature: GroupwareFeature): Promise<boolean> {
  const token = request.cookies?.get(sessionCookieName(creds.slot))?.value;
  const session = token ? decryptSession(token) : null;
  if (session?.groupwareEnabled !== true || session.username !== creds.username
    || session.serverUrl.replace(/\/+$/, '') !== creds.serverUrl
    || sessionAuthHeader(session) !== creds.authHeader) return false;
  return groupwareMailboxAllowed(session.username, feature);
}

export async function currentGroupwareEnabled(mailbox: string): Promise<boolean> {
  return (await currentGroupwareActor(mailbox)) !== null;
}

/** Bind public AT records to the selected account's current mailbox identity. */
export async function groupwareActor(request: NextRequest, creds: StalwartCredentials, feature: GroupwareFeature): Promise<string | null> {
  const token = request.cookies?.get(sessionCookieName(creds.slot))?.value;
  const session = token ? decryptSession(token) : null;
  if (session?.groupwareEnabled !== true || !session.did || session.username !== creds.username
    || session.serverUrl.replace(/\/+$/, '') !== creds.serverUrl
    || sessionAuthHeader(session) !== creds.authHeader) return null;
  await configManager.ensureLoaded();
  if (configManager.get<boolean>(`${feature}Enabled`, false) !== true) return null;
  const actor = await currentGroupwareActor(session.username);
  return actor === session.did ? actor : null;
}
