import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  normalizeHandle,
  looksLikeHandle,
  searchActorsTypeahead,
  resolveHandle,
  APPVIEW_BASE,
  type ActorSuggestion,
} from '../handle';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('normalizeHandle', () => {
  it('trims whitespace and strips a leading @', () => {
    expect(normalizeHandle('  @alice.bsky.social ')).toBe('alice.bsky.social');
  });

  it('lowercases the handle', () => {
    expect(normalizeHandle('Alice.BSKY.Social')).toBe('alice.bsky.social');
  });

  it('leaves a bare did untouched except for trimming', () => {
    expect(normalizeHandle('  did:plc:abc123 ')).toBe('did:plc:abc123');
  });

  it('returns empty string for empty input', () => {
    expect(normalizeHandle('   ')).toBe('');
  });
});

describe('looksLikeHandle', () => {
  it('accepts a dotted handle', () => {
    expect(looksLikeHandle('alice.bsky.social')).toBe(true);
  });

  it('accepts a raw did', () => {
    expect(looksLikeHandle('did:plc:abc123')).toBe(true);
  });

  it('rejects a value with no dot and not a did', () => {
    expect(looksLikeHandle('alice')).toBe(false);
  });

  it('rejects empty', () => {
    expect(looksLikeHandle('')).toBe(false);
  });
});

describe('searchActorsTypeahead', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it('queries canonical waow search with the Comail label and no auth', async () => {
    const actors: ActorSuggestion[] = [
      { did: 'did:plc:a', handle: 'alice.bsky.social', displayName: 'Alice' },
    ];
    fetchSpy.mockResolvedValueOnce(jsonResponse(200, { actors }));

    const result = await searchActorsTypeahead('alice');

    expect(result).toEqual(actors);
    const url = String(fetchSpy.mock.calls[0][0]);
    expect(new URL(url).origin).toBe('https://typeahead.waow.tech');
    expect(new URL(url).pathname).toBe('/xrpc/tech.waow.typeahead.searchActors');
    expect(url).toContain('q=alice');
    const init = (fetchSpy.mock.calls[0][1] ?? {}) as RequestInit;
    const headers = new Headers(init.headers);
    expect(headers.get('X-Client')).toBe('comail.at');
    expect(headers.get('Authorization')).toBeNull();
    expect(init.credentials).toBe('omit');
  });

  it('forwards the provided abort signal to fetch (composed with the timeout)', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse(200, { actors: [] }));
    const controller = new AbortController();
    await searchActorsTypeahead('bob', controller.signal);
    const init = (fetchSpy.mock.calls[0][1] ?? {}) as RequestInit;
    // The caller signal is combined with the built-in timeout, so the signal
    // passed to fetch is a composite - but caller abort must still propagate.
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(init.signal?.aborted).toBe(false);
    controller.abort();
    expect(init.signal?.aborted).toBe(true);
  });

  it('fails open to an empty list when the appview is unreachable', async () => {
    fetchSpy.mockRejectedValueOnce(new Error('network down'));
    const result = await searchActorsTypeahead('alice');
    expect(result).toEqual([]);
  });

  it('fails open to an empty list on a non-2xx response', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse(500, { error: 'boom' }));
    const result = await searchActorsTypeahead('alice');
    expect(result).toEqual([]);
  });

  it('re-throws AbortError so callers can distinguish cancellation', async () => {
    const abortErr = new DOMException('aborted', 'AbortError');
    fetchSpy.mockRejectedValueOnce(abortErr);
    await expect(searchActorsTypeahead('alice')).rejects.toThrow(/abort/i);
  });
});

describe('resolveHandle', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it('returns resolved:true with the did on success', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse(200, { did: 'did:plc:abc' }));
    const result = await resolveHandle('alice.bsky.social');
    expect(result).toEqual({ status: 'resolved', did: 'did:plc:abc' });
    const url = String(fetchSpy.mock.calls[0][0]);
    expect(url.startsWith(APPVIEW_BASE)).toBe(true);
    expect(url).toContain('com.atproto.identity.resolveHandle');
    expect(url).toContain('handle=alice.bsky.social');
  });

  it('returns invalid when the appview reports the handle is unknown (400)', async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse(400, { error: 'InvalidRequest', message: 'Unable to resolve handle' }),
    );
    const result = await resolveHandle('nope.invalid');
    expect(result.status).toBe('invalid');
  });

  it('fails open (unknown) when the appview is unreachable', async () => {
    fetchSpy.mockRejectedValueOnce(new Error('network down'));
    const result = await resolveHandle('alice.bsky.social');
    expect(result.status).toBe('unknown');
  });

  it('fails open (unknown) on a 5xx server error', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse(503, { error: 'Unavailable' }));
    const result = await resolveHandle('alice.bsky.social');
    expect(result.status).toBe('unknown');
  });

  it('short-circuits a raw did to resolved without a network call', async () => {
    const result = await resolveHandle('did:plc:abc123');
    expect(result).toEqual({ status: 'resolved', did: 'did:plc:abc123' });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('bounds the request with a timeout signal so a stalled appview cannot hang submit', async () => {
    fetchSpy.mockImplementationOnce(async () => {
      // Simulate the appview stalling past the bound timeout: fetch rejects
      // with AbortError exactly as AbortSignal.timeout would trigger.
      throw new DOMException('The operation was aborted due to timeout', 'AbortError');
    });

    const result = await resolveHandle('alice.bsky.social');
    // The bound timeout must surface as an AbortSignal on the fetch init.
    const init = (fetchSpy.mock.calls[0][1] ?? {}) as RequestInit;
    expect(init.signal).toBeInstanceOf(AbortSignal);
    // A timeout is a transient upstream fault: fail open, never re-throw.
    expect(result.status).toBe('unknown');
  });

  it('honors an explicit timeoutMs override (used by tests to keep the suite fast)', async () => {
    fetchSpy.mockImplementationOnce(async () => {
      throw new DOMException('aborted', 'AbortError');
    });

    const result = await resolveHandle('alice.bsky.social', { timeoutMs: 5 });
    const init = (fetchSpy.mock.calls[0][1] ?? {}) as RequestInit;
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(result.status).toBe('unknown');
  });

  it('still forwards a caller-supplied signal alongside the timeout', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse(200, { did: 'did:plc:abc' }));
    const caller = new AbortController();
    const result = await resolveHandle('alice.bsky.social', { signal: caller.signal });
    expect(result).toEqual({ status: 'resolved', did: 'did:plc:abc' });
    const init = (fetchSpy.mock.calls[0][1] ?? {}) as RequestInit;
    expect(init.signal).toBeInstanceOf(AbortSignal);
    // Caller cancellation must keep winning: aborting the caller signal aborts
    // the combined signal even before the timeout fires.
    expect(init.signal?.aborted).toBe(false);
    caller.abort();
    expect(init.signal?.aborted).toBe(true);
  });
});
