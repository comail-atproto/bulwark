// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { encryptSession } from '@/lib/auth/crypto';
import { GET, POST, PUT } from '@/app/api/calendar/[[...seg]]/route';
vi.mock('@/lib/admin/config-manager', () => ({ configManager: { ensureLoaded: async () => {}, get: () => true } }));
const actorDid = 'did:plc:alice';
const source = { actorDid, state: `source-state-${'b'.repeat(64)}`, sources: [{ id: 'atmo', type: 'atproto-community-calendar', actorDid, includeHosted: true, statuses: ['going', 'interested'], enabled: false }] };
function request(method: string, path: string, body?: unknown) {
  return new NextRequest(`https://bulwark.test/api/calendar/${path}?slot=1`, { method, headers: { 'sec-fetch-site': 'same-origin', cookie: `jmap_session_1=${encryptSession('https://mail.test', 'alice@example.test', 'synthetic', { did: actorDid, groupwareEnabled: true })}`, ...(body ? { 'content-type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
}
beforeEach(() => { vi.stubEnv('SESSION_SECRET', 'x'.repeat(32)); vi.stubEnv('BULWARK_INBOX_SSO_SECRET', 'y'.repeat(64)); vi.stubEnv('INBOX_CALENDAR_BRIDGE_URL', 'https://inbox.test/webmail/calendar/api/v1'); });
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
describe('private Atmo source calendar proxy', () => {
  it('reads and updates only the fixed source endpoint', async () => {
    const fetcher = vi.fn().mockImplementation(async () => Response.json(source)); vi.stubGlobal('fetch', fetcher);
    expect((await GET(request('GET', 'sources'), { params: Promise.resolve({ seg: ['sources'] }) })).status).toBe(200);
    expect((await PUT(request('PUT', 'sources/atmo', { requestId: 'source-1', baseState: source.state, enabled: false }), { params: Promise.resolve({ seg: ['sources', 'atmo'] }) })).status).toBe(200);
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual(['https://inbox.test/webmail/calendar/api/v1/sources', 'https://inbox.test/webmail/calendar/api/v1/sources/atmo']);
  });
  it('keeps missing source consent explicit and starts only on an intentional POST', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ error: 'authorization_required', authorizationProfile: 'member-source' }, { status: 409 })).mockResolvedValueOnce(Response.json({ status: 'authorization_required', authorizationUrl: `https://host.test/oauth/calendar/tickets/${'a'.repeat(43)}` }, { status: 202 })); vi.stubGlobal('fetch', fetcher);
    expect((await GET(request('GET', 'sources'), { params: Promise.resolve({ seg: ['sources'] }) })).status).toBe(409);
    expect((await POST(request('POST', 'sources/start', { requestId: 'source-start' }), { params: Promise.resolve({ seg: ['sources', 'start'] }) })).status).toBe(202);
  });
  it('rejects unknown sources and caller-selected actor data before upstream requests', async () => {
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    expect((await PUT(request('PUT', 'sources/other', {}), { params: Promise.resolve({ seg: ['sources', 'other'] }) })).status).toBe(400);
    expect((await PUT(request('PUT', 'sources/atmo', { requestId: 'source-1', baseState: source.state, enabled: false, actorDid: 'did:plc:other' }), { params: Promise.resolve({ seg: ['sources', 'atmo'] }) })).status).toBe(400);
    expect(fetcher).not.toHaveBeenCalled();
  });
});
