import { setPendingDeepLink } from '@/lib/deep-link-handoff';
import {
  appPath,
  buildCalendarPath,
  buildContactsPath,
  buildFilesPath,
  buildMailPath,
} from '@/lib/deep-links';
import type { GlobalSearchHit } from '@/lib/global-search/types';
import { useAuthStore } from '@/stores/auth-store';
import { useFileStore } from '@/stores/file-store';
import { useProTabStore, type ProPaneId } from '@/stores/pro-tab-store';

export interface OpenHitOptions {
  /** True inside the Pro shell: hits open as tabs + handoff. False: router navigation. */
  proShell: boolean;
  /** Pro shell: pane the tab should land in. */
  pane?: ProPaneId;
  /** Standard layout: navigate to an app path (the palette passes `router.push`). */
  navigate?: (path: string) => void;
}

function fileLinkFor(hit: Extract<GlobalSearchHit, { kind: 'files' }>): { segments: string[]; search?: string } {
  const folderSegments = hit.folderPath.split('/').filter(Boolean);
  if (hit.isFolder) return { segments: [...folderSegments, hit.node.name] };
  return { segments: folderSegments, search: `?preview=${encodeURIComponent(hit.node.name)}` };
}

/**
 * Opens a search hit on its surface, in the right account. Every hit carries
 * login + owner + raw id (#847), so nothing here re-resolves by bare id.
 */
export async function openHit(hit: GlobalSearchHit, options: OpenHitOptions): Promise<void> {
  const { proShell, pane, navigate } = options;
  const auth = useAuthStore.getState();
  const isActiveLogin = hit.localAccountId === auth.activeAccountId;

  if (proShell) {
    const tabs = useProTabStore.getState();
    switch (hit.kind) {
      case 'mail':
        tabs.openEmailTab({
          accountId: hit.jmapAccountId,
          ...(isActiveLogin ? {} : { clientAccountId: hit.localAccountId }),
          emailId: hit.id,
          mailboxId: null,
          title: hit.title,
        }, { pane, reuseReader: true });
        return;
      case 'contacts':
        tabs.openTab('contacts');
        // Pro aggregates every login's contacts under namespaced store ids.
        setPendingDeepLink('contacts', [hit.storeId]);
        return;
      case 'calendar':
        tabs.openTab('calendar');
        setPendingDeepLink(
          'calendar',
          ['event', hit.id],
          `?account=${encodeURIComponent(hit.jmapAccountId)}${isActiveLogin ? '' : `&login=${encodeURIComponent(hit.localAccountId)}`}`,
        );
        return;
      case 'files': {
        // The Files surface browses one login at a time - switch its client
        // to the owning login before handing over the path.
        const fileStore = useFileStore.getState();
        if (fileStore.currentAccountId !== hit.localAccountId) {
          const client = auth.getClientForAccount(hit.localAccountId);
          if (client) {
            fileStore.initClient(client, hit.localAccountId);
            useFileStore.setState({ supportsFiles: null });
          }
        }
        tabs.openTab('files');
        // A node in a shared drive has no path under the login's own root -
        // land on the drive root instead of a folder that doesn't resolve.
        const link = hit.node.isShared ? { segments: [] } : fileLinkFor(hit);
        setPendingDeepLink('files', link.segments, link.search);
        return;
      }
    }
  }

  // Standard layout: switch the active login when needed, then navigate.
  if (!isActiveLogin) await auth.switchAccount(hit.localAccountId);
  switch (hit.kind) {
    case 'mail':
      navigate?.(appPath(buildMailPath({ mailboxId: null, emailId: hit.id, threadId: null })));
      return;
    case 'contacts':
      // Outside the Pro shell the store holds the active login's contacts raw.
      navigate?.(appPath(buildContactsPath({ contactId: hit.id })));
      return;
    case 'calendar':
      navigate?.(appPath(buildCalendarPath({ view: 'month', date: null, eventId: hit.id, accountId: hit.jmapAccountId })));
      return;
    case 'files': {
      const link = hit.node.isShared ? { segments: [] as string[], search: undefined } : fileLinkFor(hit);
      const path = `/${link.segments.join('/')}`;
      navigate?.(appPath(buildFilesPath(path, hit.isFolder || hit.node.isShared ? null : hit.node.name)));
      return;
    }
  }
}
