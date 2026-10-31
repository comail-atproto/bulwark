import { randomBytes, createHash } from 'node:crypto';

function base64urlEncode(buffer: Buffer): string {
  return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function generateCodeVerifierServer(): string {
  return base64urlEncode(randomBytes(32));
}

export function generateCodeChallengeServer(verifier: string): string {
  const hash = createHash('sha256').update(verifier).digest();
  return base64urlEncode(hash);
}

export function generateStateServer(): string {
  return base64urlEncode(randomBytes(32));
}
