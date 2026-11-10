import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FilePreviewModal } from '../file-preview-modal';
import { WopiEditor } from '../wopi-editor';
import { MailboxShareDialog } from '@/components/layout/mailbox-share-dialog';
import type { IJMAPClient } from '@/lib/jmap/client-interface';
import type { Mailbox } from '@/lib/jmap/types';

// The full-screen file preview, the document editor and the share dialog's
// loading step are modals for the keyboard: the focus moves in, and comes
// back to what opened them when they close.

vi.mock('@/lib/standalone-display', () => ({ canOpenUrlInNewWindow: () => false }));

let opener: HTMLButtonElement;
beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn().mockReturnValue(new Promise(() => {})));
  opener = document.createElement('button');
  document.body.appendChild(opener);
  opener.focus();
});
afterEach(() => {
  cleanup();
  opener.remove();
  vi.unstubAllGlobals();
});

describe('file overlays hold and return the focus', () => {
  it('file preview', () => {
    const { unmount } = render(
      <FilePreviewModal name="b.txt" onClose={vi.fn()} onDownload={vi.fn()} getFileContent={() => new Promise(() => {})} />,
    );
    expect(screen.getByRole('dialog', { name: 'b.txt' })).toContainElement(document.activeElement as HTMLElement);
    unmount();
    expect(opener).toHaveFocus();
  });

  it('document editor', () => {
    const { unmount } = render(<WopiEditor target={{ kind: 'file', id: 'f1', name: 'report.docx' }} onClose={() => {}} />);
    const dialog = screen.getByRole('dialog', { name: 'report.docx' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
    unmount();
    expect(opener).toHaveFocus();
  });

  it('share dialog while it loads', () => {
    const client = { getMailboxShareWith: () => new Promise(() => {}), getAccountId: () => 'a' } as unknown as IJMAPClient;
    const onClose = vi.fn();
    render(<MailboxShareDialog client={client} mailbox={{ id: 'm', name: 'Team' } as Mailbox} onClose={onClose} />);
    const dialog = screen.getByRole('dialog', { name: 'loading_principals' });
    expect(dialog).toHaveAttribute('aria-busy', 'true');
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
  });
});
