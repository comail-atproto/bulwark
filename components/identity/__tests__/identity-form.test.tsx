import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Identity } from '@/lib/jmap/types';

// IdentityForm reads identityManagementEnabled to decide whether the *email
// address* field may be edited (chainlink #1790). Display name + signature are
// always editable — only the From-address is constrained.
let mockIdentityManagementEnabled = true;
vi.mock('@/hooks/use-config', () => ({
  useConfig: () => ({ identityManagementEnabled: mockIdentityManagementEnabled }),
}));

vi.mock('@/lib/email-sanitization', () => ({
  sanitizeSignatureHtml: (s: string) => s,
}));

import { IdentityForm } from '../identity-form';

describe('IdentityForm address gating', () => {
  beforeEach(() => {
    mockIdentityManagementEnabled = true;
  });

  it('allows editing the email field on create when management is enabled', () => {
    mockIdentityManagementEnabled = true;
    render(<IdentityForm onSave={vi.fn(async () => {})} onCancel={vi.fn()} />);
    const email = screen.getByLabelText(/email_label/i) as HTMLInputElement;
    expect(email).not.toBeDisabled();
  });

  it('locks the email field when management is disabled (create mode)', () => {
    mockIdentityManagementEnabled = false;
    render(<IdentityForm onSave={vi.fn(async () => {})} onCancel={vi.fn()} />);
    const email = screen.getByLabelText(/email_label/i) as HTMLInputElement;
    expect(email).toBeDisabled();
  });

  it('locks the email field when management is disabled (edit mode)', () => {
    mockIdentityManagementEnabled = false;
    const identity = {
      id: 'id-1',
      name: 'Alias',
      email: 'alias@comail.at',
      mayDelete: true,
    } as Identity;
    render(<IdentityForm identity={identity} onSave={vi.fn(async () => {})} onCancel={vi.fn()} />);
    const email = screen.getByLabelText(/email_label/i) as HTMLInputElement;
    expect(email).toBeDisabled();
  });

  it('keeps display name and signatures editable when management is disabled', () => {
    mockIdentityManagementEnabled = false;
    render(<IdentityForm onSave={vi.fn(async () => {})} onCancel={vi.fn()} />);
    const name = screen.getByLabelText(/name_label/i) as HTMLInputElement;
    expect(name).not.toBeDisabled();
    const textSig = screen.getByLabelText('text_signature_label') as HTMLTextAreaElement;
    expect(textSig).not.toBeDisabled();
    const htmlSig = screen.getByLabelText('html_signature_label') as HTMLTextAreaElement;
    expect(htmlSig).not.toBeDisabled();
  });
});
