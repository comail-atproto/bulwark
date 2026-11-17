import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { WopiEditor } from '@/components/files/wopi-editor';

vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key, useLocale: () => 'en' }));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it('shows an error without submitting a credential form when the editor is unavailable', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: false,
    status: 503,
    json: async () => ({ error: 'Document editor is unavailable' }),
  }));
  const { container } = render(<WopiEditor target={{ kind: 'file', id: 'f1', name: 'report.docx' }} onClose={() => {}} />);
  expect(await screen.findByText('office_error')).toBeInTheDocument();
  expect(container.querySelector('form')).toBeNull();
});
