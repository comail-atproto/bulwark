import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { unnamedFields } from '@/lib/__tests__/helpers/form-labels';

// The setup wizard's fields are named by their labels (see form-labels.test.tsx).

const status = vi.hoisted(() => ({ authenticated: false, partialConfig: null as Record<string, unknown> | null }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));
vi.mock('@/lib/browser-navigation', () => ({
  apiFetch: vi.fn(async () => new Response(JSON.stringify({ state: 'bootstrap', authenticated: status.authenticated, readOnly: false, partialConfig: status.partialConfig }), {
    status: 200, headers: { 'content-type': 'application/json' },
  })),
  getPathPrefix: () => '',
  withBasePath: (p: string) => p,
}));
vi.mock('@/lib/setup/url-token', () => ({ takeSetupTokenFromUrl: () => '' }));

const { default: SetupWizardPage } = await import('@/app/(main)/setup/page');

describe('setup wizard fields have labels', () => {
  it('welcome step', async () => {
    render(<SetupWizardPage />);
    expect(await screen.findByRole('textbox', { name: 'welcome.token_label' })).toBeInTheDocument();
    expect(unnamedFields()).toEqual([]);
  });

  it('server step, hint read with the field', async () => {
    status.authenticated = true;
    status.partialConfig = {};
    render(<SetupWizardPage />);
    const url = await screen.findByRole('textbox', { name: 'server.url_label' });
    expect(url).toHaveAccessibleDescription('server.url_hint');
    expect(unnamedFields()).toEqual([]);
  });
});
