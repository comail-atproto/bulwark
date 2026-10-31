import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const configState = { demoMode: false };
vi.mock('@/hooks/use-config', () => ({
  useConfig: () => ({ ...configState }),
}));

const resolveAtprotoProfile = vi.fn();
vi.mock('@/lib/atproto-avatar', () => ({
  resolveAtprotoProfile: (did: string) => resolveAtprotoProfile(did),
}));

import { AtprotoHandle } from '../atproto-handle';

const DID = 'did:plc:abc123';

describe('AtprotoHandle', () => {
  beforeEach(() => {
    configState.demoMode = false;
    resolveAtprotoProfile.mockReset();
  });

  it('renders the current Bluesky handle for a verified DID', async () => {
    resolveAtprotoProfile.mockResolvedValue({
      did: DID,
      handle: 'alice.example.com',
      avatar: null,
    });

    render(<AtprotoHandle did={DID} />);

    expect(await screen.findByText('@alice.example.com')).toBeInTheDocument();
    expect(resolveAtprotoProfile).toHaveBeenCalledWith(DID);
  });

  it('fails open when the public profile cannot be resolved', async () => {
    resolveAtprotoProfile.mockResolvedValue(null);

    const { container } = render(<AtprotoHandle did={DID} />);

    await waitFor(() => expect(resolveAtprotoProfile).toHaveBeenCalledWith(DID));
    expect(container).toBeEmptyDOMElement();
  });

  it('does not query the appview in demo mode', async () => {
    configState.demoMode = true;

    const { container } = render(<AtprotoHandle did={DID} />);

    await Promise.resolve();
    expect(resolveAtprotoProfile).not.toHaveBeenCalled();
    expect(container).toBeEmptyDOMElement();
  });
});
