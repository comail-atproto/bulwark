import { act, fireEvent, render, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { noThirdPartyTraffic, setNoThirdPartyTraffic } from '@/lib/third-party-mode';

// Controllable config: tests set demoMode / devMode per case.
const configState = { devMode: false, demoMode: false };
vi.mock('@/hooks/use-config', () => ({
  useConfig: () => ({ ...configState }),
}));

// The atproto resolver is exercised directly in atproto-avatar.test.ts; here we
// mock it to drive the Avatar's resolution chain deterministically and to assert
// that demo mode never calls it.
const resolveAtprotoAvatar = vi.fn<(did: string) => Promise<string | null>>();
vi.mock('@/lib/atproto-avatar', () => ({
  resolveAtprotoAvatar: (did: string) => resolveAtprotoAvatar(did),
}));

import { AtprotoAvatar as Avatar } from '../atproto-avatar';

const DID = 'did:plc:abc123';
const ATPROTO_AVATAR = 'https://cdn.bsky.app/img/avatar/plain/abc/avatar.jpg';

describe('Avatar atproto profile photo', () => {
  beforeEach(() => {
    configState.devMode = false;
    configState.demoMode = false;
    resolveAtprotoAvatar.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('renders the atproto avatar as the default account avatar when a DID resolves', async () => {
    resolveAtprotoAvatar.mockResolvedValue(ATPROTO_AVATAR);

    const { container } = render(<Avatar name="Demo User" did={DID} disableFavicon />);

    const img = await waitFor(() => {
      const el = container.querySelector('img');
      if (!el) throw new Error('no img yet');
      return el as HTMLImageElement;
    });
    expect(img.getAttribute('src')).toBe(ATPROTO_AVATAR);
    expect(resolveAtprotoAvatar).toHaveBeenCalledWith(DID);
  });

  it('falls back to initials when getProfile resolves no avatar', async () => {
    resolveAtprotoAvatar.mockResolvedValue(null);

    const { container } = render(<Avatar name="Demo User" did={DID} disableFavicon />);

    await waitFor(() => {
      expect(resolveAtprotoAvatar).toHaveBeenCalledWith(DID);
    });
    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent).toBe('DU');
  });

  it('waits for privacy settings and updates when public lookups are allowed', async () => {
    setNoThirdPartyTraffic('unknown');
    resolveAtprotoAvatar.mockImplementation(async () => noThirdPartyTraffic() ? null : ATPROTO_AVATAR);
    const { container } = render(<Avatar name="Demo User" did={DID} disableFavicon />);

    expect(container.querySelector('img')).toBeNull();

    act(() => setNoThirdPartyTraffic(false));
    await waitFor(() => expect(container.querySelector('img')).toHaveAttribute('src', ATPROTO_AVATAR));

    act(() => setNoThirdPartyTraffic(true));
    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent).toBe('DU');
  });

  it('falls back to initials when the resolver rejects (fail-open)', async () => {
    resolveAtprotoAvatar.mockRejectedValue(new Error('boom'));

    const { container } = render(<Avatar name="Demo User" did={DID} disableFavicon />);

    await waitFor(() => {
      expect(resolveAtprotoAvatar).toHaveBeenCalledWith(DID);
    });
    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent).toBe('DU');
  });

  it('does not call the appview and renders initials in demo mode', async () => {
    configState.demoMode = true;
    resolveAtprotoAvatar.mockResolvedValue(ATPROTO_AVATAR);

    const { container } = render(<Avatar name="Demo User" did={DID} disableFavicon />);

    // Give any (incorrectly scheduled) async resolution a chance to run.
    await Promise.resolve();
    expect(resolveAtprotoAvatar).not.toHaveBeenCalled();
    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent).toBe('DU');
  });

  it('does not attempt atproto resolution when no DID is provided', async () => {
    const { container } = render(<Avatar name="Demo User" disableFavicon />);

    await Promise.resolve();
    expect(resolveAtprotoAvatar).not.toHaveBeenCalled();
    expect(container.textContent).toBe('DU');
  });

  it('renders initials immediately without blocking on the pending fetch', () => {
    // Never-resolving promise: the avatar must still render (initials) synchronously.
    resolveAtprotoAvatar.mockReturnValue(new Promise<string | null>(() => {}));

    const { container } = render(<Avatar name="Demo User" did={DID} disableFavicon />);

    expect(container.textContent).toBe('DU');
    expect(container.querySelector('img')).toBeNull();
  });

  it('falls back to the original contact photo when the DID image fails', async () => {
    resolveAtprotoAvatar.mockResolvedValue(ATPROTO_AVATAR);
    const photo = 'data:image/png;base64,c3ludGhldGlj';
    const { container } = render(<Avatar name="Demo User" did={DID} contactPhoto={{ uri: photo }} disableFavicon />);
    await waitFor(() => expect(container.querySelector('img')).toHaveAttribute('src', ATPROTO_AVATAR));
    fireEvent.error(container.querySelector('img')!);
    await waitFor(() => expect(container.querySelector('img')).toHaveAttribute('src', photo));
  });

  it('preserves native image restrictions and sizing while a DID resolves', async () => {
    resolveAtprotoAvatar.mockResolvedValue(ATPROTO_AVATAR);
    const { container } = render(<Avatar name="Demo User" did={DID} disableImages size="lg" className="account-avatar" />);
    await waitFor(() => expect(resolveAtprotoAvatar).toHaveBeenCalled());
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('[title="Demo User"]')).toHaveClass('account-avatar');
  });
});
