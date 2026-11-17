import { createHmac, randomBytes } from 'node:crypto';
import { inboxBridgeSecret } from '@/lib/auth/inbox-config';

export function signMailBridgeToken(mailbox: string, did: string): string | null {
  const secret = inboxBridgeSecret();
  if (!secret || !mailbox || !did) return null;
  const now = Math.floor(Date.now() / 1000);
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const input = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({
    mailbox, sub: did, iss: 'comail-bulwark', aud: 'comail-mail',
    iat: now, nbf: now, exp: now + 60, jti: randomBytes(16).toString('hex'),
  })}`;
  return `${input}.${createHmac('sha256', secret).update(input).digest('base64url')}`;
}
