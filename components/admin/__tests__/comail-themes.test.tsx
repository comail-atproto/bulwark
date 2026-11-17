import { act, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { BUILTIN_THEMES } from '@/lib/builtin-themes';
import { DEFAULT_POLICY } from '@/lib/admin/types';
import { ThemesPage } from '@/app/(main)/admin/_pages/themes';

vi.mock('@/lib/browser-navigation', async original => ({
  ...await original<typeof import('@/lib/browser-navigation')>(),
  apiFetch: vi.fn(async (url: string) => Response.json(url.endsWith('/policy') ? DEFAULT_POLICY : [])),
}));
vi.mock('@/components/admin/feedback', () => ({ useAdminFeedback: () => vi.fn() }));

afterEach(() => vi.restoreAllMocks());

it('offers every native built-in theme as an administrator default', async () => {
  await act(async () => { render(<ThemesPage />); });
  const options = within(screen.getByRole('combobox', { name: 'Default theme' }));
  for (const theme of BUILTIN_THEMES) {
    expect(options.getByRole('option', { name: theme.name })).toHaveValue(theme.id);
  }
});
