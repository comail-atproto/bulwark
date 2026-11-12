// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from '@/app/api/atmo-calendar/route';
const mocks = vi.hoisted(() => ({ credentials: vi.fn(), actor: vi.fn(), source: vi.fn(), read: vi.fn() }));
vi.mock('@/lib/stalwart/credentials', () => ({ getStalwartCredentials: mocks.credentials }));
vi.mock('@/lib/groupware/access', () => ({ groupwareActor: mocks.actor }));
vi.mock('@/lib/atmo-calendar/source-preferences', () => ({ readAtmoSourcePreferences: mocks.source }));
vi.mock('@/lib/atmo-calendar/public-reader', async (original) => ({ ...await original<typeof import('@/lib/atmo-calendar/public-reader')>(), readPublicAtmoCalendar: mocks.read }));
const alice = 'did:plc:alice';
const catalog = (actorDid = alice, enabled = true) => ({ actorDid, state: `source-state-${'a'.repeat(64)}`, sources: [{ id: 'atmo', type: 'atproto-community-calendar', actorDid, includeHosted: true, statuses: ['going', 'interested'], enabled }] });
const req = (query: string) => new NextRequest(`https://bulwark.test/api/atmo-calendar?${query}`, { headers: { 'sec-fetch-site': 'same-origin' } });
const range = 'after=2026-10-01T00:00:00Z&before=2026-11-01T00:00:00Z';
beforeEach(() => {
  vi.clearAllMocks();
  mocks.credentials.mockResolvedValue({ username: 'alice@example.test', slot: 0 });
  mocks.actor.mockResolvedValue(alice);
  mocks.source.mockResolvedValue(catalog());
  mocks.read.mockImplementation(async (input) => ({ ...input, events: [], complete: true }));
});
describe('Atmo calendar request authority', () => {
  it.each([
    { code: 'not_found', status: 404 },
    { code: 'authorization_required', status: 409, authorizationProfile: 'member-source' },
  ])('offers a disabled browser overlay when private preferences are unavailable: $code', async (failure) => {
    mocks.source.mockRejectedValue(failure);
    const response = await GET(req('slot=0&local=1'));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ actorDid: alice, preferenceStorage: 'browser' });
    expect(mocks.read).not.toHaveBeenCalled();
    expect((await GET(req(`local=1&${range}`))).status).toBe(200);
    expect(mocks.read).not.toHaveBeenCalled();
    expect((await GET(req(`local=1&enabled=true&${range}`))).status).toBe(200);
    expect(mocks.read).toHaveBeenCalledExactlyOnceWith({ actorDid: alice, after: '2026-10-01T00:00:00Z', before: '2026-11-01T00:00:00Z' });
    expect((await GET(req('slot=0'))).status).toBe(failure.status);
  });
  it('keeps private preferences authoritative over a browser opt-in', async () => {
    mocks.source.mockResolvedValue(catalog(alice, false));
    expect((await GET(req(`local=1&enabled=true&${range}`))).status).toBe(200);
    expect(mocks.read).not.toHaveBeenCalled();
  });
  it('does not switch to browser preferences on a provider failure', async () => {
    mocks.source.mockRejectedValue({ code: 'provider_unavailable', status: 502 });
    expect((await GET(req(`local=1&enabled=true&${range}`))).status).toBe(502);
    expect(mocks.read).not.toHaveBeenCalled();
  });
  it('rechecks the selected account and live access before a local public read', async () => {
    expect((await GET(req(`slot=1&local=1&enabled=true&${range}`))).status).toBe(401);
    mocks.actor.mockResolvedValue(null);
    expect((await GET(req(`slot=0&local=1&enabled=true&${range}`))).status).toBe(404);
    expect(mocks.source).not.toHaveBeenCalled();
    expect(mocks.read).not.toHaveBeenCalled();
  });
  it.each(['local=0', 'local=true', 'enabled=true', 'local=1&enabled=yes', 'local=1&local=1'])('rejects ambiguous local preference input: %s', async (query) => {
    expect((await GET(req(query))).status).toBe(400);
    expect(mocks.source).not.toHaveBeenCalled();
  });
  it('binds the source and public reader to the selected live actor', async () => {
    mocks.credentials.mockResolvedValue({ username: 'bob@example.test', slot: 1 });
    mocks.actor.mockResolvedValue('did:plc:bob');
    mocks.source.mockResolvedValue(catalog('did:plc:bob'));
    const response = await GET(req(`slot=1&${range}`));
    expect(response.status).toBe(200);
    expect(mocks.source).toHaveBeenCalledWith('bob@example.test', 'did:plc:bob');
    expect(mocks.read).toHaveBeenCalledWith({ actorDid: 'did:plc:bob', after: '2026-10-01T00:00:00Z', before: '2026-11-01T00:00:00Z' });
  });
  it.each(['after=2026-02-30T00:00:00Z&before=2026-03-02T00:00:00Z', 'actorDid=did:plc:other', 'slot=1&slot=0', 'slot=1x', 'before=2026-11-01T00:00:00Z', `${range}&after=2026-10-01T00:00:00Z`])('rejects forged or ambiguous parameters %s', async (query) => {
    expect((await GET(req(query))).status).toBe(400);
    expect(mocks.source).not.toHaveBeenCalled();
    expect(mocks.read).not.toHaveBeenCalled();
  });
  it('denies the live flag or identity mismatch before fetching any records/preferences', async () => {
    mocks.actor.mockResolvedValue(null);
    expect((await GET(req(range))).status).toBe(404);
    expect(mocks.source).not.toHaveBeenCalled();
    expect(mocks.read).not.toHaveBeenCalled();
  });
  it('does not read public records for a disabled private source', async () => {
    mocks.source.mockResolvedValue(catalog(alice, false));
    expect((await GET(req(range))).status).toBe(200);
    expect(mocks.read).not.toHaveBeenCalled();
  });
  it('rejects another actor returned by source recovery', async () => {
    mocks.source.mockResolvedValue(catalog('did:plc:other'));
    expect((await GET(req(range))).status).toBe(502);
    expect(mocks.read).not.toHaveBeenCalled();
  });
  it('does not turn interrupted public reads into a successful empty refresh', async () => {
    mocks.read.mockRejectedValue(new Error('private diagnostic'));
    const response = await GET(req(range));
    expect(response.status).toBe(502);
    expect(await response.text()).not.toContain('private diagnostic');
    expect(response.headers.get('cache-control')).toBe('no-store');
  });
});
