import { createHmac, randomBytes } from 'node:crypto';
import { inboxBridgeSecret } from '@/lib/auth/inbox-config';

const ISSUER = 'comail-bulwark';
const AUDIENCE = 'comail-calendar';
const TOKEN_TTL_SECONDS = 60;

function b64url(input: string): string {
  return Buffer.from(input, 'utf8').toString('base64url');
}

/** Sign a short-lived assertion for a mailbox read from one encrypted session slot. */
export function signCalendarBridgeToken(mailbox: string): string | null {
  const secret = inboxBridgeSecret();
  if (!secret || !mailbox) return null;
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'HS256', typ: 'JWT' };
  const payload = {
    mailbox,
    iss: ISSUER,
    aud: AUDIENCE,
    iat: now,
    nbf: now,
    exp: now + TOKEN_TTL_SECONDS,
    jti: randomBytes(16).toString('hex'),
  };
  const input = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  const signature = createHmac('sha256', secret).update(input).digest('base64url');
  return `${input}.${signature}`;
}
