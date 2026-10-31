import { inboxSetting } from '@/lib/auth/inbox-config';
import { randomBytes } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { logger } from '@/lib/logger';
import { encryptSession, decryptSession } from '@/lib/auth/crypto';
import { SESSION_COOKIE_MAX_AGE, sessionCookieName } from '@/lib/auth/session-cookie';
import { getCookieOptions } from '@/lib/oauth/cookie-config';
import { normalizeJmapServerUrl, validateProxyAuthHeader } from '@/lib/auth/verify-jmap-auth';
import { setStalwartAuthContextInStore, stalwartAuthContextCookieName } from '@/lib/stalwart/auth-context';
import { configManager } from '@/lib/admin/config-manager';
import { recordLogin } from '@/lib/telemetry/login-tracker';
import {
  readRelayRedemptionConfig,
  readBoundedUtf8Body,
  redeemRelaySsoCode,
  relaySsoBootstrapHtml,
  type RelaySsoCredential,
} from '@/lib/auth/relay-redemption';

import { MAX_ACCOUNT_SLOTS } from '@/lib/account-utils';
import { refreshTokenCookieName, accessTokenCookieName } from '@/lib/oauth/tokens';
export const runtime = 'nodejs';

const MAX_FORM_BYTES = 256;

const NO_STORE_HEADERS = {
  'Cache-Control': 'no-store',
  Pragma: 'no-cache',
  'Referrer-Policy': 'no-referrer',
};

function unavailable() {
  return new NextResponse('Not found', { status: 404, headers: NO_STORE_HEADERS });
}

function errorResponse(message: string, status: number) {
  return NextResponse.json({ error: message }, { status, headers: NO_STORE_HEADERS });
}

function sameOriginPost(request: NextRequest): boolean {
  const origin = request.headers.get('origin');
  if (!origin) return false;
  try {
    // Standalone Next.js constructs nextUrl from its loopback bind address.
    // A reverse-proxied deployment pins the browser origin in configuration;
    // request-supplied Host/Forwarded headers cannot expand that allowlist.
    const configured = inboxSetting('INBOX_SSO_PUBLIC_ORIGIN', 'RELAY_SSO_PUBLIC_ORIGIN');
    if (configured === null) return false;
    const expected = new URL(configured ?? request.nextUrl.origin);
    const loopbackHttp = expected.protocol === 'http:' &&
      ['127.0.0.1', '[::1]', 'localhost'].includes(expected.hostname);
    if ((expected.protocol !== 'https:' && !loopbackHttp) ||
      expected.username || expected.password || expected.pathname !== '/' ||
      expected.search || expected.hash) return false;
    return origin === expected.origin;
  } catch {
    return false;
  }
}

// GET receives no credential and no query parameter. Inbox places a
// random one-use code in the URL fragment, which HTTP never transmits. This
// static, nonce-bound bootstrap moves the fragment into a same-origin POST and
// immediately erases it from browser history.
export async function GET() {
  if (!readRelayRedemptionConfig()) return unavailable();
  const nonce = randomBytes(18).toString('base64');
  return new NextResponse(relaySsoBootstrapHtml(nonce), {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      Pragma: 'no-cache',
      // Navigational form POSTs use Origin: null under no-referrer. Keep
      // the real same-origin Origin so the POST guard can authenticate it;
      // the bootstrap erases the fragment before submitting the form.
      'Referrer-Policy': 'same-origin',
      'X-Content-Type-Options': 'nosniff',
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Resource-Policy': 'same-origin',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
      'Content-Security-Policy': `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'none'; img-src 'none'; connect-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'`,
    },
  });
}

async function grantSession(credential: RelaySsoCredential): Promise<NextResponse> {
  await configManager.ensureLoaded();
  const serverUrl =
    configManager.get<string>('jmapServerUrl', '') ||
    process.env.JMAP_SERVER_URL ||
    process.env.NEXT_PUBLIC_JMAP_SERVER_URL ||
    '';
  if (!serverUrl) throw new Error('JMAP server not configured');
  const normalizedServerUrl = normalizeJmapServerUrl(serverUrl);
  const { did, mailbox, appPassword } = credential;
  const authHeader = `Basic ${Buffer.from(`${mailbox}:${appPassword}`).toString('base64')}`;
  validateProxyAuthHeader(authHeader);

  const cookieStore = await cookies();
  let freeSlot: number | undefined;
  let matchingSlot: number | undefined;
  for (let index = 0; index < MAX_ACCOUNT_SLOTS; index++) {
    const token = cookieStore.get(sessionCookieName(index))?.value;
    const existing = token ? decryptSession(token) : null;
    if (existing?.serverUrl === normalizedServerUrl && existing.username === mailbox) {
      matchingSlot = index;
      break;
    }
    const occupied = token || cookieStore.get(refreshTokenCookieName(index))?.value ||
      cookieStore.get(accessTokenCookieName(index))?.value || cookieStore.get(stalwartAuthContextCookieName(index))?.value;
    if (!occupied && freeSlot === undefined) {
      freeSlot = index;
    }
  }
  const slot = matchingSlot ?? freeSlot;
  if (slot === undefined) return errorResponse('Maximum number of signed-in accounts reached', 409);
  const options = { ...getCookieOptions(), maxAge: SESSION_COOKIE_MAX_AGE };
  cookieStore.set(
    sessionCookieName(slot),
    encryptSession(normalizedServerUrl, mailbox, appPassword, {
      did, groupwareEnabled: credential.groupwareEnabled, buildersEnabled: credential.buildersEnabled,
    }),
    options,
  );
  setStalwartAuthContextInStore(cookieStore, slot, {
    serverUrl: normalizedServerUrl,
    username: mailbox,
    authHeader,
  });

  logger.info('Inbox SSO session granted', {
    event: 'relay_sso_granted',
    protocol: 'opaque_code_backchannel',
  });
  void recordLogin(mailbox, normalizedServerUrl);
  return new NextResponse(null, { status: 303, headers: { ...NO_STORE_HEADERS, Location: `/?sso_slot=${slot}` } });
}

// POST accepts the fragment-derived opaque code only from the same origin.
// Bulwark then authenticates to Inbox over its configured server-to-server
// URL. The mailbox credential exists only in that no-store response and the
// encrypted session cookies created here; it never enters a browser URL.
export async function POST(request: NextRequest) {
  const config = readRelayRedemptionConfig();
  if (!config) return unavailable();
  if (!sameOriginPost(request)) {
    return errorResponse('Forbidden', 403);
  }

  let code: string;
  try {
    const contentType = request.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase();
    const declaredLength = Number(request.headers.get('content-length'));
    if (
      contentType !== 'application/x-www-form-urlencoded' ||
      (Number.isFinite(declaredLength) && declaredLength > MAX_FORM_BYTES)
    ) {
      return errorResponse('Invalid request', 400);
    }
    const rawBody = await readBoundedUtf8Body(request.body, MAX_FORM_BYTES);
    const form = new URLSearchParams(rawBody);
    const values = form.getAll('code');
    if (values.length !== 1 || [...form.keys()].some((key) => key !== 'code') || !/^[a-f0-9]{64}$/.test(values[0])) {
      return errorResponse('Invalid sign-in code', 400);
    }
    code = values[0];
  } catch {
    return errorResponse('Invalid request', 400);
  }

  try {
    const credential = await redeemRelaySsoCode(code, config);
    return await grantSession(credential);
  } catch (err) {
    logger.warn('Relay SSO opaque-code redemption rejected', {
      event: 'relay_sso_redeem_failed',
      error_type: err instanceof Error ? err.name : 'unknown',
    });
    return errorResponse('Sign-in code unavailable', 401);
  }
}
