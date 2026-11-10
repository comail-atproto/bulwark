import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NextConfig } from 'next';

async function loadConfig(basePath?: string): Promise<NextConfig> {
  vi.resetModules();
  vi.stubEnv('NEXT_PUBLIC_BASE_PATH', basePath);

  const { default: config } = await import('../../next.config');
  return config;
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('Next static asset CORS', () => {
  it.each([undefined, '/webmail'])('allows opaque plugin sandboxes with basePath %s', async (basePath) => {
    const config = await loadConfig(basePath);
    const rules = await config.headers?.();

    expect(config.basePath).toBe(basePath);
    expect(rules?.filter((rule) => rule.source.includes('_next/static'))).toEqual([
      {
        source: '/_next/static/:path*',
        headers: [{ key: 'Access-Control-Allow-Origin', value: '*' }],
      },
    ]);
  });

  it('does not add CORS headers to application or API routes', async () => {
    const config = await loadConfig('/webmail');
    const rules = await config.headers?.();
    const corsRules = rules?.filter((rule) =>
      rule.headers.some((header) => header.key.toLowerCase() === 'access-control-allow-origin')
    );

    // The plugin sandbox's prebuilt, content-hashed script and stylesheet
    // (scripts/build-plugin-sandbox.mjs) are public static files too.
    expect(corsRules?.map((rule) => rule.source)).toEqual(['/_next/static/:path*', '/plugin-sandbox-assets/:path*']);
  });
});

describe('Comail source and development defaults', () => {
  it.each([undefined, '', '   '])('offers Tangled source with no configured URL (%s)', async (sourceUrl) => {
    vi.stubEnv('NEXT_PUBLIC_CORRESPONDING_SOURCE_URL', sourceUrl);
    const config = await loadConfig();
    expect(config.env?.NEXT_PUBLIC_CORRESPONDING_SOURCE_URL).toBe('https://tangled.org/comail.at/bulwark');
  });

  it('preserves an operator source URL override', async () => {
    vi.stubEnv('NEXT_PUBLIC_CORRESPONDING_SOURCE_URL', ' https://source.example.com/release.tar.gz ');
    const config = await loadConfig();
    expect(config.env?.NEXT_PUBLIC_CORRESPONDING_SOURCE_URL).toBe('https://source.example.com/release.tar.gz');
  });

  it('does not authorize the upstream development origin by default', async () => {
    const config = await loadConfig();
    expect(config.allowedDevOrigins ?? []).toEqual([]);
  });
});
