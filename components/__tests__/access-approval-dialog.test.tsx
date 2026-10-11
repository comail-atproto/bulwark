import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AccessApprovalDialog } from '../access-approval-dialog';

const fetchMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/browser-navigation', () => ({
  apiFetch: (...args: unknown[]) => fetchMock(...args),
  withBasePath: (path: string) => path,
}));
vi.mock('@/hooks/use-focus-trap', () => ({
  useFocusTrap: () => ({ current: null }),
}));

const pending = {
  accessRequests: [
    {
      id: 17,
      clientId: 'https://bsky.app',
      clientName: 'Bluesky',
      scopes: ['atproto'],
      deviceLabel: 'New iPhone',
      coarseLocation: 'Brooklyn, NY',
      numberMatch: '42',
      expiresAt: new Date(Date.now() + 90_000).toISOString(),
      status: 'pending',
      createdAt: new Date().toISOString(),
      authoritative: true,
    },
  ],
  authoritative: true,
};

function response(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

describe('AccessApprovalDialog', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    window.history.replaceState({}, '', '/');
  });

  it('shows the branded phone request and sends an approval without a DID', async () => {
    fetchMock
      .mockResolvedValueOnce(response(200, pending))
      .mockResolvedValueOnce(response(200, { status: 'approved', decisionApplied: true }))
      .mockResolvedValue(response(200, { accessRequests: [], authoritative: true }));

    render(<AccessApprovalDialog />);
    expect(await screen.findByRole('alertdialog')).toBeInTheDocument();
    expect(screen.getByText('New Atmosphere login')).toBeInTheDocument();
    expect(screen.getByText('New iPhone')).toBeInTheDocument();
    expect(screen.getByText('Brooklyn, NY')).toBeInTheDocument();
    expect(screen.getByText('42')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Allow login' }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/access-approvals/17/decision',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ decision: 'approved' }),
        }),
      ),
    );
    const decisionCall = fetchMock.mock.calls.find(([url]) => String(url).includes('/decision'));
    expect(decisionCall?.[1]?.body).not.toContain('did');
    expect(await screen.findByRole('status')).toHaveTextContent('Login allowed');
  });

  it('stays invisible for an account outside the owner gate', async () => {
    fetchMock.mockResolvedValue(response(404, { error: 'not found' }));
    render(<AccessApprovalDialog />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('converges when another device handles a request while this dialog is open', async () => {
    fetchMock
      .mockResolvedValueOnce(response(200, pending))
      .mockResolvedValue(response(200, { accessRequests: [], authoritative: true }));

    render(<AccessApprovalDialog />);
    expect(await screen.findByRole('alertdialog')).toBeInTheDocument();

    fireEvent.focus(window);

    expect(await screen.findByRole('status')).toHaveTextContent('Request handled on another device');
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows the authoritative winner instead of an error after a stale conflicting click', async () => {
    fetchMock
      .mockResolvedValueOnce(response(200, pending))
      .mockResolvedValueOnce(response(200, { status: 'denied', decisionSource: 'member_session' }))
      .mockResolvedValue(response(200, { accessRequests: [], authoritative: true }));

    render(<AccessApprovalDialog />);
    expect(await screen.findByRole('alertdialog')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Allow login' }));

    expect(await screen.findByRole('status')).toHaveTextContent('Already denied on another device');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('rechecks authoritative state before surfacing a lost decision response', async () => {
    fetchMock
      .mockResolvedValueOnce(response(200, pending))
      .mockRejectedValueOnce(new Error('response lost'))
      .mockResolvedValue(response(200, { accessRequests: [], authoritative: true }));

    render(<AccessApprovalDialog />);
    expect(await screen.findByRole('alertdialog')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Allow login' }));

    expect(await screen.findByRole('status')).toHaveTextContent('Request handled on another device');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('explains a stale notification click without carrying a request id', async () => {
    window.history.replaceState({}, '', '/?approvalWake=1');
    fetchMock.mockResolvedValue(response(200, { accessRequests: [], authoritative: true }));

    render(<AccessApprovalDialog />);

    expect(await screen.findByRole('status')).toHaveTextContent('Request handled on another device');
    expect(window.location.search).toBe('');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
