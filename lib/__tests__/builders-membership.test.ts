import { createHmac } from 'node:crypto';
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { encryptSession } from '@/lib/auth/crypto';
import { sessionCookieName } from '@/lib/auth/session-cookie';
import { GET } from '@/app/api/builders-membership/route';

const did = 'did:plc:enrolled';
const secret = 'builders-only-secret-with-32-characters';
const fetchMock = vi.fn();

function request(slot = '0', identity: string | undefined = did) {
  const token = encryptSession('https://mail.example/jmap', 'mail@example.com', 'private-password', { did: identity });
  return new NextRequest('https://inbox.example/api/builders-membership?did=did:plc:attacker', {
    headers: { 'X-JMAP-Cookie-Slot': slot, cookie: `${sessionCookieName(0)}=${token}` },
  });
}

describe('Builders membership for the active authenticated account', () => {
  beforeEach(() => {
    vi.stubEnv('SESSION_SECRET', 'session-secret-at-least-32-characters');
    vi.stubEnv('BUILDERS_MEMBERSHIP_URL', 'https://build.example/api/v1/inbox/builders-membership');
    vi.stubEnv('BULWARK_BUILDERS_MEMBERSHIP_SECRET', secret);
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(Response.json({ did, enrolled: true }));
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

  it('uses the encrypted session DID, signs a short-lived assertion, and sends no mail credentials', async () => {
    const response = await GET(request());
    expect(await response.json()).toEqual({ enrolled: true });
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe('https://build.example/api/v1/inbox/builders-membership');
    expect(options.cache).toBe('no-store');
    expect(options.redirect).toBe('error');
    const token = options.headers.Authorization.replace('Bearer ', '');
    const [header, payload, signature] = token.split('.');
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString());
    expect(claims.sub).toBe(did);
    expect(claims.iss).toBe('comail-bulwark');
    expect(claims.aud).toBe('comail-builders-membership');
    expect(claims.exp - claims.iat).toBe(60);
    expect(signature).toBe(createHmac('sha256', secret).update(`${header}.${payload}`).digest('base64url'));
    expect(JSON.stringify(options)).not.toContain('private-password');
    expect(JSON.stringify(options)).not.toContain('mail@example.com');
  });

  it('hides on a missing or tampered session cookie', async () => {
    for (const cookie of ['', 'jmap_session=tampered']) {
      const anonymous = new NextRequest('https://inbox.example/api/builders-membership', {
        headers: { 'X-JMAP-Cookie-Slot': '0', cookie },
      });
      expect(await (await GET(anonymous)).json()).toEqual({ enrolled: false });
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(['', '1', '-1', '0junk', '100'])('does not fall back to another account for slot %s', async (slot) => {
    expect(await (await GET(request(slot))).json()).toEqual({ enrolled: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('hides the link when there is no authenticated DID', async () => {
    expect(await (await GET(request('0', ''))).json()).toEqual({ enrolled: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    { did, enrolled: false }, { did, enrolled: 'true' }, { did: 'did:plc:other', enrolled: true }, {}, null,
  ])('hides on unenrolled, malformed, or different-account responses: %j', async (body) => {
    fetchMock.mockResolvedValue(Response.json(body));
    expect(await (await GET(request())).json()).toEqual({ enrolled: false });
  });

  it.each(['http://build.example/path', 'https://user:password@build.example/path', 'https://build.example/path?did=x', 'https://build.example/path#x', ''])('rejects unsafe or missing endpoint %s', async (url) => {
    vi.stubEnv('BUILDERS_MEMBERSHIP_URL', url);
    expect(await (await GET(request())).json()).toEqual({ enrolled: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('requires a dedicated secret', async () => {
    vi.stubEnv('BULWARK_BUILDERS_MEMBERSHIP_SECRET', '');
    expect(await (await GET(request())).json()).toEqual({ enrolled: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([401, 404, 500])('hides on upstream HTTP %s', async (status) => {
    fetchMock.mockResolvedValue(new Response('', { status }));
    expect(await (await GET(request())).json()).toEqual({ enrolled: false });
  });

  it('hides on timeout or transport failure', async () => {
    fetchMock.mockRejectedValue(new DOMException('timed out', 'TimeoutError'));
    expect(await (await GET(request())).json()).toEqual({ enrolled: false });
  });
});
