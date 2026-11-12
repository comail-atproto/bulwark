// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildWopiActionUrl, getWopiEditorOrigins } from '@/lib/wopi/discovery';

vi.mock('@/lib/admin/config-manager', () => ({
  configManager: {
    ensureLoaded: async () => {},
    get: (key: string, fallback: unknown) => key === 'wopiClientUrl' ? 'https://office.example.invalid' : fallback,
  },
}));

afterEach(() => vi.unstubAllGlobals());

describe('WOPI editor URLs', () => {
  it.each(['https://office<x>.example/edit?', 'file:///tmp/editor', 'https://user:pass@office.example/edit'])(
    'rejects an invalid editor URL %s',
    (url) => expect(() => buildWopiActionUrl(url, 'https://mail.example/wopi')).toThrow(),
  );

  it('does not turn a malformed editor hostname into a CSP origin', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(
      '<wopi-discovery><action name="edit" ext="docx" urlsrc="https://office&lt;x&gt;.example/edit?"/></wopi-discovery>',
    )));
    expect(await getWopiEditorOrigins()).toEqual(['https://office.example.invalid']);
  });
});
