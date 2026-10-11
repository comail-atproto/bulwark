import type { NextRequest } from 'next/server';
import { configManager } from '@/lib/admin/config-manager';
import { decryptSession, sessionAuthHeader } from '@/lib/auth/crypto';
import { sessionCookieName } from '@/lib/auth/session-cookie';
import { readBoundedUtf8Body } from '@/lib/auth/relay-redemption';
import { accessApprovalRelayBridgeUrl, signAccessApprovalBridgeToken } from '@/lib/access-approval/relay-bridge';
import type { StalwartCredentials } from '@/lib/stalwart/credentials';
import type { GroupwareFeature } from '@/lib/groupware/jmap';

// Recheck Inbox's live per-DID flag; a login-time entitlement cannot keep a
// disabled feature accessible through an old session or document token.
export async function groupwareMailboxAllowed(mailbox: string, feature: GroupwareFeature): Promise<boolean> {
  await configManager.ensureLoaded();
  if (configManager.get<boolean>(`${feature}Enabled`, false) !== true) return false;
  return currentGroupwareEnabled(mailbox);
}

export async function currentGroupwareEnabled(mailbox: string): Promise<boolean> {
  const base = accessApprovalRelayBridgeUrl();
  const token = signAccessApprovalBridgeToken(mailbox);
  if (!base || !token) return false;
  try {
    const response = await fetch(`${base}/identity`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(2000),
    });
    if (!response.ok) return false;
    const body: unknown = JSON.parse(await readBoundedUtf8Body(response.body, 4096));
    if (!body || typeof body !== 'object') return false;
    const identity = body as Record<string, unknown>;
    return typeof identity.did === 'string' && /^did:(plc|web):[^\s]+$/.test(identity.did)
      && identity.groupware_enabled === true;
  } catch {
    return false;
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

