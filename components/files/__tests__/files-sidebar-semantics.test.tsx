import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { FileResource } from '@/stores/file-store';
import { FilesSidebar, type FilesSidebarProps } from '../files-sidebar';

// SR-09: the Files sidebar claimed tree roles without arrow keys. It is a
// list of buttons now, like the mail folders, with the open folder marked.

const folder = (id: string, name: string, parentId: string | null = null) =>
  ({ id, name, parentId, isDirectory: true, blobId: null }) as unknown as FileResource;

function renderSidebar(overrides: Partial<FilesSidebarProps> = {}) {
  const noop = vi.fn();
  const props = {
    currentParentId: 'docs',
    currentPath: '/Docs',
    allFolders: [folder('docs', 'Docs'), folder('old', 'Old', 'docs'), folder('pics', 'Pictures')],
    sharedRoots: [],
    favorites: [],
    recentFiles: [],
    canCreate: false,
    onNavigate: noop, onOpenRecent: noop, onUploadFiles: noop, onUploadFolder: noop, onNewFolder: noop,
    onNewTextFile: noop, onToggleFavorite: noop, onDropItems: noop, canShare: () => false, onShare: noop,
    onCreateIn: noop, onRenameFolder: noop, onDeleteFolder: noop, onRevealRecent: noop,
    onDownloadRecent: noop, onRemoveRecent: noop,
    ...overrides,
  } as FilesSidebarProps;
  return render(<FilesSidebar {...props} />);
}

describe('Files sidebar semantics', () => {
  it('has no tree roles', () => {
    renderSidebar();
    expect(screen.queryByRole('tree')).toBeNull();
    expect(screen.queryByRole('treeitem')).toBeNull();
  });

  it('marks the open folder as current, and only that one', () => {
    renderSidebar();
    const current = screen.getAllByRole('button').filter((b) => b.getAttribute('aria-current') === 'page');
    expect(current).toHaveLength(1);
    expect(current[0]).toHaveTextContent('Docs');
  });

  it('tells whether an expander is open', () => {
    renderSidebar();
    for (const toggle of screen.getAllByRole('button', { name: /expand_folder|collapse_folder/ })) {
      expect(toggle).toHaveAttribute('aria-expanded');
    }
  });
});
