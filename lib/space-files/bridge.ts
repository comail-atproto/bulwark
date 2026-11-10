import { createHmac, randomBytes } from 'node:crypto';
import { inboxBridgeSecret } from '@/lib/auth/inbox-config';

export function signFileBridgeToken(mailbox: string): string | null {
  const secret = inboxBridgeSecret();
  if (!secret || !mailbox) return null;
  const now = Math.floor(Date.now() / 1000);
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const input = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({
    mailbox, iss: 'comail-bulwark', aud: 'comail-files',
    iat: now, nbf: now, exp: now + 60, jti: randomBytes(16).toString('hex'),
  })}`;
  return `${input}.${createHmac('sha256', secret).update(input).digest('base64url')}`;
}
