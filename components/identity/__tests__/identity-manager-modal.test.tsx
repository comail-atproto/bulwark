import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Identity } from '@/lib/jmap/types';

// The modal reads identityManagementEnabled from useConfig to decide whether
// members may mint arbitrary From-identities (chainlink #1790). We drive the
// flag per-test through this mock.
let mockIdentityManagementEnabled = true;
vi.mock('@/hooks/use-config', () => ({
  useConfig: () => ({ identityManagementEnabled: mockIdentityManagementEnabled }),
}));

// Focus trap returns a ref; a plain ref object is enough for render.
vi.mock('@/hooks/use-focus-trap', () => ({
  useFocusTrap: () => ({ current: null }),
}));

vi.mock('@/hooks/use-confirm-dialog', () => ({
  useConfirmDialog: () => ({
    dialogProps: { isOpen: false },
    confirm: vi.fn(async () => true),
  }),
}));

vi.mock('@/stores/toast-store', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

// The identity list the modal renders. Two identities: the primary (mayDelete
// false, i.e. the relay-provisioned address) and an attested alias.
// vi.hoisted: the vi.mock factories below are hoisted above this file's
// statements, so a plain top-level const would be TDZ-dead when they run
// ("Cannot access 'IDENTITIES' before initialization").
const IDENTITIES: Identity[] = vi.hoisted(() => [
  { id: 'id-primary', name: 'Primary', email: 'member@comail.at', mayDelete: false } as Identity,
  { id: 'id-alias', name: 'Alias', email: 'alias@comail.at', mayDelete: true } as Identity,
]);

vi.mock('@/stores/identity-store', () => {
  const state = {
    identities: IDENTITIES,
    preferredPrimaryId: null,
    setPreferredPrimary: vi.fn(),
    setIdentities: vi.fn(),
  };
  const hook = (sel?: (s: typeof state) => unknown) =>
    typeof sel === 'function' ? sel(state) : state;
  hook.getState = () => state;
  return { useIdentityStore: hook };
});

vi.mock('@/stores/auth-store', () => {
  const state = {
    client: {
      getIdentities: vi.fn(async () => IDENTITIES),
      createIdentity: vi.fn(async () => {}),
      updateIdentity: vi.fn(async () => {}),
      deleteIdentity: vi.fn(async () => {}),
    },
    username: 'member@comail.at',
    syncIdentities: vi.fn(),
    refreshIdentities: vi.fn(),
  };
  const hook = (sel?: (s: typeof state) => unknown) =>
    typeof sel === 'function' ? sel(state) : state;
  hook.getState = () => state;
  return { useAuthStore: hook };
});

import { IdentityManagerModal } from '../identity-manager-modal';

describe('IdentityManagerModal identity-management gating', () => {
  beforeEach(() => {
    mockIdentityManagementEnabled = true;
  });

  it('shows the create-new control when identity management is enabled', () => {
    mockIdentityManagementEnabled = true;
    render(<IdentityManagerModal isOpen onClose={vi.fn()} />);
    // create_new label appears on the "add identity" button.
    expect(screen.getByText('create_new')).toBeInTheDocument();
  });

  it('hides the create-new control when identity management is disabled', () => {
    mockIdentityManagementEnabled = false;
    render(<IdentityManagerModal isOpen onClose={vi.fn()} />);
    expect(screen.queryByText('create_new')).not.toBeInTheDocument();
  });

  it('still lists the provisioned identities when management is disabled', () => {
    mockIdentityManagementEnabled = false;
    render(<IdentityManagerModal isOpen onClose={vi.fn()} />);
    // Read-only listing: the member sees their identities but cannot mint new
    // ones. Display names + addresses are still visible.
    expect(screen.getByText('Primary')).toBeInTheDocument();
    expect(screen.getByText('Alias')).toBeInTheDocument();
    expect(screen.getByText('alias@comail.at')).toBeInTheDocument();
  });

  it('renders no delete controls when management is disabled', () => {
    mockIdentityManagementEnabled = false;
    const { container } = render(<IdentityManagerModal isOpen onClose={vi.fn()} />);
    // The delete button carries the destructive trash affordance; when
    // management is off, deletion of identities must not be offered.
    expect(container.querySelector('[data-testid="identity-delete"]')).toBeNull();
  });

  it('keeps the edit control (display-name/signature editing is safe)', () => {
    mockIdentityManagementEnabled = false;
    const { container } = render(<IdentityManagerModal isOpen onClose={vi.fn()} />);
    // Edit stays available so members can adjust display name + signature.
    expect(container.querySelector('[data-testid="identity-edit"]')).not.toBeNull();
  });
});
