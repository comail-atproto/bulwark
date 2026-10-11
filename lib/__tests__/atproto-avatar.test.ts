import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  resolveAtprotoAvatar,
  resolveAtprotoProfile,
  __resetAtprotoAvatarCacheForTests,
} from '../atproto-avatar';

const DID = 'did:plc:abc123';
const AVATAR_URL = 'https://cdn.bsky.app/img/avatar/plain/abc/avatar.jpg';
const HANDLE = 'alice.example.com';

function okResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => body,
  } as unknown as Response;
}

describe('resolveAtprotoAvatar', () => {
  beforeEach(() => {
    __resetAtprotoAvatarCacheForTests();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns the avatar URL from getProfile against the public appview', async () => {
    const fetchMock = vi
      .spyOn(global, 'fetch')
      .mockResolvedValue(okResponse({ did: DID, avatar: AVATAR_URL }));

    const url = await resolveAtprotoAvatar(DID);

    expect(url).toBe(AVATAR_URL);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const calledWith = String(fetchMock.mock.calls[0][0]);
    expect(calledWith).toContain('https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile');
    expect(calledWith).toContain(`actor=${encodeURIComponent(DID)}`);
  });

  it('returns the current Bluesky handle and avatar from the shared profile request', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(
      okResponse({ did: DID, handle: HANDLE, avatar: AVATAR_URL }),
    );

    await expect(resolveAtprotoProfile(DID)).resolves.toEqual({
      did: DID,
      handle: HANDLE,
      avatar: AVATAR_URL,
    });
  });

  it('shares one cached profile request between the handle and avatar consumers', async () => {
    const fetchMock = vi.spyOn(global, 'fetch').mockResolvedValue(
      okResponse({ did: DID, handle: HANDLE, avatar: AVATAR_URL }),
    );

    const profile = await resolveAtprotoProfile(DID);
    const avatar = await resolveAtprotoAvatar(DID);

    expect(profile?.handle).toBe(HANDLE);
    expect(avatar).toBe(AVATAR_URL);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('never sends an Authorization header (public appview needs no auth)', async () => {
    const fetchMock = vi
      .spyOn(global, 'fetch')
      .mockResolvedValue(okResponse({ avatar: AVATAR_URL }));

    await resolveAtprotoAvatar(DID);

    const init = fetchMock.mock.calls[0][1] as RequestInit | undefined;
    const headers = (init?.headers ?? {}) as Record<string, string>;
    const headerKeys = Object.keys(headers).map((k) => k.toLowerCase());
    expect(headerKeys).not.toContain('authorization');
  });

  it('returns null when the profile has no avatar', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(okResponse({ did: DID }));
    expect(await resolveAtprotoAvatar(DID)).toBeNull();
  });

  it('fails open to null on a non-ok HTTP response', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({}),
    } as unknown as Response);
    expect(await resolveAtprotoAvatar(DID)).toBeNull();
  });

  it('fails open to null on a network error', async () => {
    vi.spyOn(global, 'fetch').mockRejectedValue(new Error('network down'));
    expect(await resolveAtprotoAvatar(DID)).toBeNull();
  });

  it('caches the result so it does not refetch for the same DID', async () => {
    const fetchMock = vi
      .spyOn(global, 'fetch')
      .mockResolvedValue(okResponse({ avatar: AVATAR_URL }));

    const first = await resolveAtprotoAvatar(DID);
    const second = await resolveAtprotoAvatar(DID);

    expect(first).toBe(AVATAR_URL);
    expect(second).toBe(AVATAR_URL);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('caches negative results too (no avatar) without refetching', async () => {
    const fetchMock = vi
      .spyOn(global, 'fetch')
      .mockResolvedValue(okResponse({ did: DID }));

    expect(await resolveAtprotoAvatar(DID)).toBeNull();
    expect(await resolveAtprotoAvatar(DID)).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('dedupes concurrent requests for the same DID onto one fetch', async () => {
    let resolveFetch!: (r: Response) => void;
    const fetchMock = vi.spyOn(global, 'fetch').mockReturnValue(
      new Promise<Response>((resolve) => {
        resolveFetch = resolve;
      }),
    );

    const p1 = resolveAtprotoAvatar(DID);
    const p2 = resolveAtprotoAvatar(DID);
    resolveFetch(okResponse({ avatar: AVATAR_URL }));

    expect(await p1).toBe(AVATAR_URL);
    expect(await p2).toBe(AVATAR_URL);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('returns null without fetching for an unsupported / empty DID', async () => {
    const fetchMock = vi.spyOn(global, 'fetch');
    expect(await resolveAtprotoAvatar('')).toBeNull();
    expect(await resolveAtprotoAvatar('not-a-did')).toBeNull();
    expect(await resolveAtprotoAvatar('did:key:zabc')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
