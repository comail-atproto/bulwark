import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionCredentials } from '@/lib/auth/crypto';
import { backfillSessionIdentity, IDENTITY_BACKFILL_TIMEOUT_MS } from '../relay-bridge';

const SECRET = 's'.repeat(32);
const BRIDGE_URL = 'https://relay.example.test';

const CREDENTIALS: SessionCredentials = {
  serverUrl: 'https://mail.example.com',
  username: 'example@example.com',
  password: 's3cret',
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('backfillSessionIdentity', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    process.env.BULWARK_RELAY_SSO_SECRET = SECRET;
    process.env.RELAY_ACCESS_APPROVAL_BRIDGE_URL = BRIDGE_URL;
    fetchSpy = vi.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    fetchSpy.mockRestore();
    delete process.env.BULWARK_RELAY_SSO_SECRET;
    delete process.env.RELAY_ACCESS_APPROVAL_BRIDGE_URL;
  });

  it('resolves a missing DID when the relay returns did:plc', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse(200, { did: 'did:plc:abc123' }));

    const result = await backfillSessionIdentity(CREDENTIALS);

    expect(result).toEqual({ ...CREDENTIALS, did: 'did:plc:abc123' });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(String(url)).toBe(`${BRIDGE_URL}/identity`);
    expect(init?.method).toBe('GET');
    const headers = init?.headers as Record<string, string>;
    expect(headers['Authorization']).toMatch(/^Bearer .+\..+\..+$/);
  });

  it('resolves a missing DID when the relay returns did:web', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse(200, { did: 'did:web:example.com' }));

    const result = await backfillSessionIdentity(CREDENTIALS);

    expect(result).toEqual({ ...CREDENTIALS, did: 'did:web:example.com' });
  });

  it('skips the relay entirely when the session already has a DID', async () => {
    const withDid: SessionCredentials = { ...CREDENTIALS, did: 'did:plc:existing' };

    const result = await backfillSessionIdentity(withDid);

    expect(result).toBe(withDid);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('returns the exact credentials object when bridge URL is not configured', async () => {
    delete process.env.RELAY_ACCESS_APPROVAL_BRIDGE_URL;

    const result = await backfillSessionIdentity(CREDENTIALS);

    expect(result).toBe(CREDENTIALS);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('returns the exact credentials object when secret is too short', async () => {
    process.env.BULWARK_RELAY_SSO_SECRET = 'short';

    const result = await backfillSessionIdentity(CREDENTIALS);

    expect(result).toBe(CREDENTIALS);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('returns the exact credentials object on a network error', async () => {
    fetchSpy.mockRejectedValueOnce(new Error('network down'));

    const result = await backfillSessionIdentity(CREDENTIALS);

    expect(result).toBe(CREDENTIALS);
  });

  it('returns the exact credentials object on a non-2xx response', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse(500, { error: 'boom' }));

    const result = await backfillSessionIdentity(CREDENTIALS);

    expect(result).toBe(CREDENTIALS);
  });

  it('returns the exact credentials object on a 403 from the relay', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse(403, { error: 'forbidden' }));

    const result = await backfillSessionIdentity(CREDENTIALS);

    expect(result).toBe(CREDENTIALS);
  });

  it('returns the exact credentials object when the response body is not valid JSON', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response('not json', { status: 200, headers: { 'Content-Type': 'text/plain' } }),
    );

    const result = await backfillSessionIdentity(CREDENTIALS);

    expect(result).toBe(CREDENTIALS);
  });

  it('returns the exact credentials object when did field is missing from the body', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse(200, { something: 'else' }));

    const result = await backfillSessionIdentity(CREDENTIALS);

    expect(result).toBe(CREDENTIALS);
  });

  it('returns the exact credentials object when the DID is not did:plc or did:web', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse(200, { did: 'did:key:abc' }));

    const result = await backfillSessionIdentity(CREDENTIALS);

    expect(result).toBe(CREDENTIALS);
  });

  it('returns the exact credentials object when the DID is not a string', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse(200, { did: 42 }));

    const result = await backfillSessionIdentity(CREDENTIALS);

    expect(result).toBe(CREDENTIALS);
  });

  it('returns the exact credentials object when DID has supported prefix but empty suffix', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse(200, { did: 'did:plc:' }));
    expect(await backfillSessionIdentity(CREDENTIALS)).toBe(CREDENTIALS);

    fetchSpy.mockResolvedValueOnce(jsonResponse(200, { did: 'did:web:' }));
    expect(await backfillSessionIdentity(CREDENTIALS)).toBe(CREDENTIALS);
  });

  it('returns the exact credentials object when DID is whitespace-bearing', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse(200, { did: '  did:plc:abc  ' }));

    const result = await backfillSessionIdentity(CREDENTIALS);

    expect(result).toBe(CREDENTIALS);
  });

  it('bounds the request with a timeout signal', async () => {
    fetchSpy.mockImplementationOnce(async () => {
      throw new DOMException('The operation was aborted due to timeout', 'AbortError');
    });

    const result = await backfillSessionIdentity(CREDENTIALS);

    const init = fetchSpy.mock.calls[0]?.[1] as RequestInit | undefined;
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(result).toBe(CREDENTIALS);
  });

  it('honors an explicit timeoutMs override (for fast tests)', async () => {
    fetchSpy.mockImplementationOnce(async () => {
      throw new DOMException('aborted', 'AbortError');
    });

    const result = await backfillSessionIdentity(CREDENTIALS, { timeoutMs: 5 });

    const init = fetchSpy.mock.calls[0]?.[1] as RequestInit | undefined;
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(result).toBe(CREDENTIALS);
  });

  it('skips the lookup when a bounded timeout signal cannot be created', async () => {
    const timeoutSpy = vi.spyOn(AbortSignal, 'timeout').mockImplementation(() => {
      throw new Error('timeout signal unavailable');
    });

    try {
      const result = await backfillSessionIdentity(CREDENTIALS);

      expect(result).toBe(CREDENTIALS);
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      timeoutSpy.mockRestore();
    }
  });

  it('forwards a caller-supplied signal alongside the timeout', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse(200, { did: 'did:plc:abc' }));

    const caller = new AbortController();
    await backfillSessionIdentity(CREDENTIALS, { signal: caller.signal });

    const init = fetchSpy.mock.calls[0]?.[1] as RequestInit | undefined;
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(init?.signal?.aborted).toBe(false);
    caller.abort();
    expect(init?.signal?.aborted).toBe(true);
  });

  it('uses no-store cache and error redirect mode', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse(200, { did: 'did:plc:abc' }));

    await backfillSessionIdentity(CREDENTIALS);

    const init = fetchSpy.mock.calls[0]?.[1] as RequestInit | undefined;
    expect(init?.cache).toBe('no-store');
    expect(init?.redirect).toBe('error');
  });

  it('exports a default timeout constant', () => {
    expect(IDENTITY_BACKFILL_TIMEOUT_MS).toBe(2_000);
  });
});
