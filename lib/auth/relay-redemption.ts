import { inboxBridgeEndpoint, inboxBridgeSecret } from '@/lib/auth/inbox-config';
import { createHash, createHmac, randomBytes } from 'node:crypto';

const REDEMPTION_AUDIENCE = 'comail-relay-sso-redeem';
const REDEMPTION_ISSUER = 'comail-bulwark';
const REDEMPTION_TTL_SECONDS = 60;
const MIN_SECRET_LENGTH = 32;
const MAX_RESPONSE_BYTES = 4096;

export interface RelayRedemptionConfig {
  sharedSecret: string;
  redeemUrl: string;
}

export interface RelaySsoCredential {
  did: string;
  mailbox: string;
  appPassword: string;
  groupwareEnabled: boolean;
  buildersEnabled: boolean;
}

function b64url(input: string): string {
  return Buffer.from(input, 'utf8').toString('base64url');
}

function validOpaqueCode(code: string): boolean {
  return /^[a-f0-9]{64}$/.test(code);
}

function hasAsciiControl(value: string): boolean {
  for (const char of value) {
    const code = char.charCodeAt(0);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

export async function readBoundedUtf8Body(
  body: ReadableStream<Uint8Array> | null,
  maxBytes: number,
): Promise<string> {
  if (!body || !Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    throw new Error('Invalid bounded body');
  }
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) throw new Error('Body exceeds limit');
      chunks.push(value);
    }
  } catch (err) {
    await reader.cancel().catch(() => undefined);
    throw err;
  }
  return Buffer.concat(chunks, total).toString('utf8');
}

export function readRelayRedemptionConfig(): RelayRedemptionConfig | null {
  const sharedSecret = inboxBridgeSecret();
  const redeemUrl = inboxBridgeEndpoint('INBOX_SSO_REDEEM_URL', 'RELAY_SSO_REDEEM_URL');
  if (!sharedSecret || !redeemUrl) return null;
  return { sharedSecret, redeemUrl };
}

export function buildRelayRedemptionAuthorization(
  code: string,
  secret: string,
  now: number = Math.floor(Date.now() / 1000),
): string {
  if (!validOpaqueCode(code)) throw new Error('Invalid relay SSO code');
  if (secret.length < MIN_SECRET_LENGTH) throw new Error('Relay SSO secret is too short');
  const header = { alg: 'HS256', typ: 'JWT' };
  const payload = {
    iss: REDEMPTION_ISSUER,
    aud: REDEMPTION_AUDIENCE,
    iat: now,
    nbf: now,
    exp: now + REDEMPTION_TTL_SECONDS,
    jti: randomBytes(16).toString('hex'),
    code_hash: createHash('sha256').update(code).digest('hex'),
  };
  const input = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  const signature = createHmac('sha256', secret).update(input).digest('base64url');
  return `${input}.${signature}`;
}

function parseCredential(value: unknown): RelaySsoCredential {
  if (!value || typeof value !== 'object') throw new Error('Invalid relay redemption response');
  const raw = value as Record<string, unknown>;
  const did = raw.did;
  const mailbox = raw.mailbox;
  const appPassword = raw.app_password;
  if (
    typeof did !== 'string' ||
    did.length > 2048 ||
    (!/^did:plc:[a-z2-7]{24}$/.test(did) && !/^did:web:[A-Za-z0-9._:%-]+$/.test(did)) ||
    typeof mailbox !== 'string' ||
    mailbox.length === 0 ||
    mailbox.length > 254 ||
    !/^[^\s:@%]+@[^\s:@%]+$/.test(mailbox) ||
    hasAsciiControl(mailbox) ||
    typeof appPassword !== 'string' ||
    appPassword.length === 0 ||
    appPassword.length > 1024 ||
    hasAsciiControl(appPassword) ||
    typeof raw.groupware_enabled !== 'boolean' ||
    typeof raw.builders_enabled !== 'boolean'
  ) {
    throw new Error('Invalid relay redemption response');
  }
  return {
    did,
    mailbox,
    appPassword,
    groupwareEnabled: raw.groupware_enabled,
    buildersEnabled: raw.builders_enabled,
  };
}

export async function redeemRelaySsoCode(
  code: string,
  config: RelayRedemptionConfig,
  fetcher: typeof fetch = fetch,
): Promise<RelaySsoCredential> {
  const authorization = buildRelayRedemptionAuthorization(code, config.sharedSecret);
  const response = await fetcher(config.redeemUrl, {
    method: 'POST',
    cache: 'no-store',
    redirect: 'error',
    headers: {
      Authorization: `Bearer ${authorization}`,
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
    body: JSON.stringify({ code }),
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error('Relay SSO code redemption failed');
  const contentType = response.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase();
  const declaredLength = Number(response.headers.get('content-length'));
  if (contentType !== 'application/json' || (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES)) {
    throw new Error('Invalid relay redemption response');
  }
  const text = await readBoundedUtf8Body(response.body, MAX_RESPONSE_BYTES);
  if (text.length === 0) {
    throw new Error('Invalid relay redemption response');
  }
  try {
    return parseCredential(JSON.parse(text));
  } catch {
    throw new Error('Invalid relay redemption response');
  }
}

export function relaySsoBootstrapHtml(nonce: string): string {
  if (!/^[A-Za-z0-9+/=_-]+$/.test(nonce)) throw new Error('Invalid CSP nonce');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="referrer" content="same-origin"><title>Signing in…</title></head>
<body><form id="relay-sso" method="post" action="/api/auth/relay"><input id="relay-code" type="hidden" name="code"></form>
<script nonce="${nonce}">(()=>{const c=new URLSearchParams(location.hash.slice(1)).get('code')||'';history.replaceState(null,'',location.pathname);if(!/^[a-f0-9]{64}$/.test(c)){location.replace('/?error=sso');return}document.getElementById('relay-code').value=c;document.getElementById('relay-sso').submit()})()</script></body></html>`;
}
