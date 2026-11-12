import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { EmailAddressesSection } from '../identity-settings';

// SET-19: "Learn more" next to Sub-Addressing opened the identity manager,
// which says nothing about sub-addressing. The row keeps its description;
// only "Manage" opens the identity manager.

vi.mock('@/components/identity/identity-manager-modal', () => ({
  IdentityManagerModal: ({ isOpen }: { isOpen: boolean }) => (isOpen ? <div role="dialog">identities</div> : null),
}));

describe('Email addresses section', () => {
  it('explains sub-addressing without a button that opens the identity manager', () => {
    render(<EmailAddressesSection />);
    const row = screen.getByText('sub_addressing.label').closest('[data-search-label]') as HTMLElement;
    expect(within(row).getByText('sub_addressing.description')).toBeTruthy();
    // Only the glossary info button that explains the term.
    expect(within(row).queryAllByRole('button').map((b) => b.getAttribute('data-glossary-term'))).toEqual(['sub_addressing']);

    fireEvent.click(screen.getByRole('button', { name: 'manage' }));
    expect(screen.getByRole('dialog')).toBeTruthy();
  });
});
