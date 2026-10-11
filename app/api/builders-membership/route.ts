import { createHmac } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { MAX_ACCOUNT_SLOTS } from '@/lib/account-utils';
import { decryptSession } from '@/lib/auth/crypto';
import { sessionCookieName } from '@/lib/auth/session-cookie';

export async function GET(request: NextRequest) {
  const result = (enrolled: boolean) => NextResponse.json({ enrolled }, {
    headers: { 'Cache-Control': 'private, no-store' },
  });
  const rawSlot = request.headers.get('X-JMAP-Cookie-Slot');
  if (rawSlot === null || !/^(0|[1-9]\d*)$/.test(rawSlot)) return result(false);
  const slot = Number(rawSlot);
  if (!Number.isSafeInteger(slot) || slot >= MAX_ACCOUNT_SLOTS) return result(false);

  const sessionToken = request.cookies.get(sessionCookieName(slot))?.value;
  const did = sessionToken ? decryptSession(sessionToken)?.did : undefined;
  if (!did || !/^did:(plc|web):[^\s]+$/.test(did)) return result(false);

  const secret = process.env.BULWARK_BUILDERS_MEMBERSHIP_SECRET;
  const endpoint = process.env.BUILDERS_MEMBERSHIP_URL;
  if (!secret || secret.length < 32 || !endpoint || [...endpoint].some((character) => character.charCodeAt(0) <= 32 || character.charCodeAt(0) === 127)) return result(false);

  try {
    const url = new URL(endpoint);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) return result(false);
    const now = Math.floor(Date.now() / 1000);
    // This assertion grants only a membership lookup; it cannot create a Builders session.
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({
      iss: 'comail-bulwark', aud: 'comail-builders-membership', sub: did, iat: now, exp: now + 60,
    })).toString('base64url');
    const input = `${header}.${payload}`;
    const assertion = `${input}.${createHmac('sha256', secret).update(input).digest('base64url')}`;
    const response = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${assertion}`, Accept: 'application/json' },
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(2_000),
    });
    if (!response.ok) return result(false);
    const body: unknown = await response.json();
    return result(typeof body === 'object' && body !== null &&
      'did' in body && body.did === did && 'enrolled' in body && body.enrolled === true);
  } catch {
    return result(false);
  }
}
