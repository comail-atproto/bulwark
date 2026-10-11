import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildRelayRedemptionAuthorization,
  readRelayRedemptionConfig,
  readBoundedUtf8Body,
  redeemRelaySsoCode,
  relaySsoBootstrapHtml,
} from '@/lib/auth/relay-redemption';

const SECRET = 'r'.repeat(64);
const CODE = 'c'.repeat(64);
const REDEEM_URL = 'https://relay.internal.example/webmail/sso/redeem';

function decodeJwtPayload(token: string): Record<string, unknown> {
  const [, payload] = token.split('.');
  return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Record<string, unknown>;
}

describe('relay SSO opaque-code redemption', () => {
  const previous = {
    secret: process.env.BULWARK_RELAY_SSO_SECRET,
    url: process.env.RELAY_SSO_REDEEM_URL,
  };

  beforeEach(() => {
    process.env.BULWARK_RELAY_SSO_SECRET = SECRET;
    process.env.RELAY_SSO_REDEEM_URL = REDEEM_URL;
  });

  afterEach(() => {
    if (previous.secret === undefined) delete process.env.BULWARK_RELAY_SSO_SECRET;
    else process.env.BULWARK_RELAY_SSO_SECRET = previous.secret;
    if (previous.url === undefined) delete process.env.RELAY_SSO_REDEEM_URL;
    else process.env.RELAY_SSO_REDEEM_URL = previous.url;
  });

  it('signs a code-bound client assertion without placing the code in the JWT', () => {
    const now = 1_700_000_000;
    const token = buildRelayRedemptionAuthorization(CODE, SECRET, now);
    const payload = decodeJwtPayload(token);

    expect(token).not.toContain(CODE);
    expect(payload).not.toHaveProperty('code');
    expect(payload.code_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(payload.iss).toBe('comail-bulwark');
    expect(payload.aud).toBe('comail-relay-sso-redeem');
    expect(payload.iat).toBe(now);
    expect(payload.exp).toBe(now + 60);
  });

  it('redeems only over the configured server-to-server endpoint', async () => {
    const fetcher = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(_url).toBe(REDEEM_URL);
      expect(init?.method).toBe('POST');
      expect(init?.cache).toBe('no-store');
      expect(init?.headers).toMatchObject({
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
      });
      expect(String((init?.headers as Record<string, string>).Authorization)).toMatch(/^Bearer /);
      expect(JSON.parse(String(init?.body))).toEqual({ code: CODE });
      return new Response(JSON.stringify({
        did: 'did:plc:abcdefghijklmnopqrstuvwxyz'.slice(0, 32),
        mailbox: 'alice@example.test',
        app_password: 'durable-secret-from-backchannel',
        groupware_enabled: true,
        builders_enabled: false,
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    });

    const config = readRelayRedemptionConfig();
    expect(config).not.toBeNull();
    const result = await redeemRelaySsoCode(CODE, config!, fetcher);

    expect(result).toEqual({
      did: 'did:plc:abcdefghijklmnopqrstuvwxyz'.slice(0, 32),
      mailbox: 'alice@example.test',
      appPassword: 'durable-secret-from-backchannel',
      groupwareEnabled: true,
      buildersEnabled: false,
    });
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it('fails closed for unsafe configuration and malformed relay responses', async () => {
    process.env.RELAY_SSO_REDEEM_URL = 'http://attacker.example/redeem';
    expect(readRelayRedemptionConfig()).toBeNull();
    process.env.RELAY_SSO_REDEEM_URL = REDEEM_URL;
    process.env.BULWARK_RELAY_SSO_SECRET = 'short';
    expect(readRelayRedemptionConfig()).toBeNull();

    const config = { sharedSecret: SECRET, redeemUrl: REDEEM_URL };
    const badFetcher = vi.fn(async () => new Response(JSON.stringify({
      did: 'not-a-did',
      mailbox: 'alice:admin@example.test',
      app_password: '',
    }), { status: 200 }));
    await expect(redeemRelaySsoCode(CODE, config, badFetcher)).rejects.toThrow();
  });

  it('uses a static fragment bootstrap that never interpolates the opaque code', () => {
    const html = relaySsoBootstrapHtml('test-nonce');
    expect(html).toContain('location.hash');
    expect(html).toContain('method="post"');
    expect(html).toContain('name="code"');
    expect(html).toContain('nonce="test-nonce"');
    expect(html).not.toContain(CODE);
    expect(html).not.toContain('token=');
  });

  it('bounds server-to-server bodies by bytes before parsing', async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(4096));
        controller.enqueue(new Uint8Array([1]));
        controller.close();
      },
    });
    await expect(readBoundedUtf8Body(body, 4096)).rejects.toThrow('Body exceeds limit');
  });
});
