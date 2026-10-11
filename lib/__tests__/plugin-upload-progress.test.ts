import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import type { InstalledPlugin } from '../plugin-types';
import { useAuthStore } from '@/stores/auth-store';
import { onUploadProgress } from '../upload-progress';

vi.mock('@/stores/toast-store', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

import { dispatchApiCall } from '../plugin-sandbox/host-api';

function plugin(overrides: Partial<InstalledPlugin> = {}): InstalledPlugin {
  return {
    id: 'p1',
    name: 'Test plugin',
    version: '1.0.0',
    author: 'test',
    description: '',
    type: 'hook',
    permissions: ['http:post'],
    grantedPermissions: ['http:post'],
    entrypoint: 'index.js',
    enabled: true,
    status: 'running',
    settings: {},
    apiPostPaths: ['/api/upload'],
    ...overrides,
  };
}

/**
 * Stand-in for XMLHttpRequest that records the request and lets the test
 * drive upload progress and completion by hand.
 */
class FakeXHR {
  static instances: FakeXHR[] = [];
  method = '';
  url = '';
  headers: Record<string, string> = {};
  sentBody: unknown = null;
  status = 200;
  responseText = '{"url":"https://example.test/d/1"}';
  upload: { onprogress: ((e: { lengthComputable: boolean; loaded: number; total: number }) => void) | null } = { onprogress: null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  ontimeout: (() => void) | null = null;
  open(method: string, url: string) { this.method = method; this.url = url; }
  setRequestHeader(name: string, value: string) { this.headers[name] = value; }
  send(body: unknown) { this.sentBody = body; FakeXHR.instances.push(this); }
}

describe('plugin binary upload progress', () => {
  beforeEach(() => {
    FakeXHR.instances = [];
    vi.stubGlobal('XMLHttpRequest', FakeXHR);
    useAuthStore.setState({
      client: {
        getAuthHeader: () => 'Basic dGVzdA==',
        getUsername: () => 'tester',
      } as never,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    useAuthStore.setState({ client: null });
  });

  it('reports byte progress into the registry keyed by progressFileId', async () => {
    const seen: Array<[number, number]> = [];
    const off = onUploadProgress('staged-1', (loaded, total) => seen.push([loaded, total]));

    const call = dispatchApiCall(plugin(), 'http.post', [
      '/api/upload',
      new Blob(['0123456789']),
      { progressFileId: 'staged-1' },
    ]);

    // send() is synchronous inside the promise executor, so the request is
    // already captured even though the call promise is still pending.
    expect(FakeXHR.instances).toHaveLength(1);
    const xhr = FakeXHR.instances[0];
    xhr.upload.onprogress?.({ lengthComputable: true, loaded: 4, total: 10 });
    xhr.upload.onprogress?.({ lengthComputable: true, loaded: 10, total: 10 });
    xhr.onload?.();

    const result = await call as { ok: boolean; status: number; data: unknown };
    expect(seen).toEqual([[4, 10], [10, 10]]);
    expect(result.ok).toBe(true);
    expect(result.data).toEqual({ url: 'https://example.test/d/1' });
    off();
  });

  it('still applies credential headers after plugin headers on the XHR path', async () => {
    const call = dispatchApiCall(plugin(), 'http.post', [
      '/api/upload',
      new Blob(['x'], { type: 'application/octet-stream' }),
      { headers: { 'X-Plugin-Name': 'a.bin' }, progressFileId: 'staged-2' },
    ]);
    const xhr = FakeXHR.instances[0];
    expect(xhr.headers['Authorization']).toBe('Basic dGVzdA==');
    expect(xhr.headers['X-JMAP-Username']).toBe('tester');
    expect(xhr.headers['X-Plugin-Name']).toBe('a.bin');
    xhr.onload?.();
    await call;
  });

  it('skips progress events whose length is not computable', async () => {
    const listener = vi.fn();
    const off = onUploadProgress('staged-3', listener);
    const call = dispatchApiCall(plugin(), 'http.post', [
      '/api/upload',
      new Blob(['x']),
      { progressFileId: 'staged-3' },
    ]);
    const xhr = FakeXHR.instances[0];
    xhr.upload.onprogress?.({ lengthComputable: false, loaded: 0, total: 0 });
    xhr.onload?.();
    await call;
    expect(listener).not.toHaveBeenCalled();
    off();
  });

  it('rejects a malformed progressFileId', async () => {
    await expect(
      dispatchApiCall(plugin(), 'http.post', [
        '/api/upload',
        new Blob(['x']),
        { progressFileId: 'x'.repeat(129) },
      ]),
    ).rejects.toThrow(/progressFileId/);
    expect(FakeXHR.instances).toHaveLength(0);
  });

  it('keeps the fetch path when no progressFileId is given', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: 1 }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchSpy);
    await dispatchApiCall(plugin(), 'http.post', ['/api/upload', new Blob(['x']), {}]);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(FakeXHR.instances).toHaveLength(0);
  });

  it('surfaces a network error as a rejection', async () => {
    const call = dispatchApiCall(plugin(), 'http.post', [
      '/api/upload',
      new Blob(['x']),
      { progressFileId: 'staged-4' },
    ]);
    FakeXHR.instances[0].onerror?.();
    await expect(call).rejects.toThrow(/Network error/);
  });
});
