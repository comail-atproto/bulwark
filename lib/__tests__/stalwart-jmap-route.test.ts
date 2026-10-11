import { describe, it, expect, vi, beforeEach } from 'vitest';

// #904: the Stalwart JMAP passthrough is registered unconditionally by Next,
// so the server-side switch has to answer 404 inside the handler - before any
// credential lookup or upstream request.

vi.mock('next/server', () => {
  class NextResponse {
    status: number;
    private body: string;
    constructor(body: string, init?: { status?: number }) {
      this.body = body;
      this.status = init?.status ?? 200;
    }
    async json() {
      return JSON.parse(this.body);
    }
    static json(data: unknown, init?: { status?: number }) {
      return new NextResponse(JSON.stringify(data), init);
    }
  }
  return { NextResponse };
});

const groupwareAllowed = vi.fn().mockResolvedValue(false);
vi.mock('@/lib/groupware/access', () => ({ groupwareAllowed: (...args: unknown[]) => groupwareAllowed(...args) }));
vi.mock('@/lib/logger', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), debug: vi.fn(), info: vi.fn() },
}));

const configValues: Record<string, unknown> = {};
vi.mock('@/lib/admin/config-manager', () => ({
  configManager: {
    ensureLoaded: vi.fn().mockResolvedValue(undefined),
    get: (key: string, def: unknown) => (key in configValues ? configValues[key] : def),
  },
}));

const getStalwartCredentials = vi.fn();
vi.mock('@/lib/stalwart/credentials', () => ({
  getStalwartCredentials: (...args: unknown[]) => getStalwartCredentials(...args),
}));

const postJmap = vi.fn();
vi.mock('@/lib/stalwart/jmap-api', () => ({
  JmapRedirectError: class JmapRedirectError extends Error {},
  fetchJmapSession: vi.fn(),
  postJmap: (...args: unknown[]) => postJmap(...args),
  rebaseApiUrl: vi.fn(),
}));

vi.mock('@/lib/security/url-guard', () => ({
  DisallowedUrlError: class DisallowedUrlError extends Error {},
}));

async function callRoute(methodCalls: unknown[] = [], using: string[] = []) {
  const { POST } = await import('@/app/api/account/stalwart/jmap/route');
  const request = {
    text: async () => JSON.stringify({ using, methodCalls }),
    headers: { get: () => null },
    nextUrl: { searchParams: { get: () => null } },
  };
  const res = (await POST(request as unknown as Parameters<typeof POST>[0])) as unknown as {
    status: number;
    json: () => Promise<Record<string, unknown>>;
  };
  return { status: res.status, body: await res.json() };
}

describe('Stalwart JMAP passthrough switch (#904)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const key of Object.keys(configValues)) delete configValues[key];
    getStalwartCredentials.mockResolvedValue({
      serverUrl: 'https://mail.example.com',
      authHeader: 'Basic abc',
      trusted: true,
    });
    postJmap.mockResolvedValue(
      new Response(JSON.stringify({ methodResponses: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
  });

  it('returns 404 and never reads credentials or calls upstream when disabled', async () => {
    configValues.stalwartJmapPassthroughEnabled = false;

    const { status } = await callRoute();

    expect(status).toBe(404);
    expect(getStalwartCredentials).not.toHaveBeenCalled();
    expect(postJmap).not.toHaveBeenCalled();
  });

  it('treats disabled Stalwart features as disabling the passthrough too', async () => {
    configValues.stalwartFeaturesEnabled = false;

    const { status } = await callRoute();

    expect(status).toBe(404);
    expect(postJmap).not.toHaveBeenCalled();
  });

  it('proxies to the server by default', async () => {
    const { status } = await callRoute();

    expect(status).toBe(200);
    expect(postJmap).toHaveBeenCalledTimes(1);
    expect(postJmap.mock.calls[0][0]).toBe('https://mail.example.com/jmap/');
  });
});


describe('Stalwart JMAP Groupware gate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const key of Object.keys(configValues)) delete configValues[key];
    getStalwartCredentials.mockResolvedValue({ serverUrl: 'https://mail.example.com', authHeader: 'Basic abc', slot: 0 });
    postJmap.mockResolvedValue(new Response(JSON.stringify({ methodResponses: [] })));
    groupwareAllowed.mockResolvedValue(false);
  });

  it.each(['Calendar/get', 'CalendarEvent/set', 'AddressBook/get', 'ContactCard/set', 'FileNode/get'])('blocks %s without touching upstream', async (method) => {
    expect((await callRoute([[method, { accountId: 'a' }, '1']])).status).toBe(404);
    expect(postJmap).not.toHaveBeenCalled();
  });

  it('rejects the whole mixed mail/calendar batch before any mutation', async () => {
    expect((await callRoute([['EmailSubmission/set', {}, 'mail'], ['CalendarEvent/set', {}, 'event']])).status).toBe(404);
    expect(postJmap).not.toHaveBeenCalled();
  });

  it('leaves mail available when Groupware is disabled', async () => {
    expect((await callRoute([['Email/get', { accountId: 'a' }, '1']])).status).toBe(200);
    expect(postJmap).toHaveBeenCalledTimes(1);
    expect(groupwareAllowed).not.toHaveBeenCalled();
  });

  it('allows groupware only after its gate succeeds', async () => {
    groupwareAllowed.mockResolvedValue(true);
    expect((await callRoute([['Calendar/get', { accountId: 'a' }, '1']])).status).toBe(200);
    expect(postJmap).toHaveBeenCalledTimes(1);
  });

  it('also gates the declared groupware capability', async () => {
    expect((await callRoute([], ['urn:ietf:params:jmap:contacts'])).status).toBe(404);
    expect(postJmap).not.toHaveBeenCalled();
  });
});
