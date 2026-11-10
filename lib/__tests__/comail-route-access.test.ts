// @vitest-environment node
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST as discover } from '@/app/api/caldav/discover/route';
import { POST as agenda } from '@/app/api/calendar-agenda/route';
import { POST as fetchIcal } from '@/app/api/fetch-ical/route';
import { POST as webdav } from '@/app/api/webdav/route';
import { POST as launch } from '@/app/api/wopi/launch/route';
import { GET as checkFileInfo } from '@/app/api/wopi/files/[fileId]/route';
import { groupwareAllowed, groupwareMailboxAllowed } from '@/lib/groupware/access';
import { fetchJmapSession, postJmap } from '@/lib/stalwart/jmap-api';
import { getWopiFileNode } from '@/lib/wopi/files';
import { mintWopiToken, wopiDocumentId } from '@/lib/wopi/token';

vi.mock('@/lib/groupware/access', () => ({
  groupwareAllowed: vi.fn().mockResolvedValue(false),
  groupwareMailboxAllowed: vi.fn().mockResolvedValue(false),
}));
vi.mock('@/lib/stalwart/credentials', () => ({ getStalwartCredentials: async () => ({
  serverUrl: 'https://mail.example.test', username: 'owner@example.test',
  authHeader: 'Basic synthetic', slot: 0, trusted: true,
}) }));
vi.mock('@/lib/stalwart/jmap-api', () => ({ fetchJmapSession: vi.fn(), postJmap: vi.fn(), rebaseApiUrl: vi.fn() }));
vi.mock('@/lib/wopi/files', () => ({ getWopiFileNode: vi.fn() }));
vi.mock('@/lib/wopi/revocation', () => ({ isWopiTokenRevoked: async () => false }));
vi.mock('@/lib/stalwart/server-fetch', () => ({ isTrustedJmapServerUrl: async () => true }));
vi.mock('@/lib/auth/session-secret', () => ({ getSessionSecret: () => 'x'.repeat(32) }));

const origin = 'https://webmail.example.test';
const request = (path: string, body: unknown, headers: Record<string, string> = {}) => new NextRequest(`${origin}${path}`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body),
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(groupwareAllowed).mockResolvedValue(false);
  vi.mocked(groupwareMailboxAllowed).mockResolvedValue(false);
  vi.stubGlobal('fetch', vi.fn());
  vi.stubEnv('INBOX_FILES_BRIDGE_URL', '');
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('Comail access before native route work', () => {
  it.each([
    ['discovery', discover, '/api/caldav/discover', { accounts: [{ key: 'A', candidates: ['c1'] }] }],
    ['agenda', agenda, '/api/calendar-agenda', {}],
    ['subscriptions', fetchIcal, '/api/fetch-ical', { url: 'https://calendar.example.test/calendar.ics' }],
    ['file launch', launch, '/api/wopi/launch', { fileId: 'b', accountId: 'owner' }],
  ] as const)('denies %s before fetching upstream when Groupware is off', async (_name, handler, path, body) => {
    const response = await handler(request(path, body));
    expect(response.status).toBe(404);
    expect(groupwareAllowed).toHaveBeenCalledOnce();
    expect(fetch).not.toHaveBeenCalled();
    expect(fetchJmapSession).not.toHaveBeenCalled();
    expect(postJmap).not.toHaveBeenCalled();
  });

  it.each(['file', 'cal'])('denies the %s DAV root before fetching upstream', async collection => {
    const response = await webdav(request('/api/webdav', null, { 'X-WebDAV-Method': 'GET', 'X-WebDAV-Collection': collection }));
    expect(response.status).toBe(404);
    expect(groupwareAllowed).toHaveBeenCalledWith(expect.anything(), expect.anything(), collection === 'cal' ? 'calendar' : 'files');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('denies an already-open file editor after the live flag is switched off', async () => {
    const payload = {
      serverUrl: 'https://mail.example.test', authHeader: 'Basic synthetic', username: 'owner@example.test',
      accountId: 'owner', fileId: 'b', kind: 'file' as const, canWrite: true, origin,
    };
    const documentId = wopiDocumentId(payload);
    const { token } = mintWopiToken(payload);
    const call = () => checkFileInfo(new NextRequest(`${origin}/api/wopi/files/${documentId}?access_token=${encodeURIComponent(token)}`), {
      params: Promise.resolve({ fileId: documentId }),
    });
    vi.mocked(getWopiFileNode).mockResolvedValue({ id: 'b', parentId: null, name: 'report.docx', type: 'application/octet-stream', blobId: 'blob', size: 10, created: '2026-01-01T00:00:00Z', modified: '2026-01-01T00:00:00Z' });
    vi.mocked(groupwareMailboxAllowed).mockResolvedValueOnce(true);
    expect((await call()).status).toBe(200);
    vi.mocked(getWopiFileNode).mockClear();

    expect((await call()).status).toBe(401);
    expect(getWopiFileNode).not.toHaveBeenCalled();
    expect(postJmap).not.toHaveBeenCalled();
  });
});
