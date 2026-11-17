import { render } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Email } from '@/lib/jmap/types';
import type { IJMAPClient } from '@/lib/jmap/client-interface';

// The reader's attachment chips colour their icon by file type, the same way
// the list row's chips do, instead of drawing every type in grey.

vi.mock('@/hooks/use-media-query', () => ({
  useDeviceDetection: () => ({ isMobile: false, isTablet: false, isDesktop: true }),
  useMediaQuery: () => false,
}));
vi.mock('@/components/tour/tour-provider', () => ({
  useTour: () => ({ activeTour: null, startTour: vi.fn(), endTour: vi.fn(), registerStep: vi.fn() }),
}));
vi.mock('@/components/plugins/plugin-slot', () => ({ PluginSlot: () => null }));
vi.mock('@/hooks/use-plugin-slot-offers', () => ({ usePluginSlotOffers: () => [] }));

class NoopResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal('ResizeObserver', NoopResizeObserver);

const { EmailViewer } = await import('../email-viewer');
const { useAuthStore } = await import('@/stores/auth-store');

const name = 'google.com!example.org!1761609600!1761695999!001.json.gz';
const email = {
  id: 'e1',
  blobId: 'b1',
  threadId: 't1',
  mailboxIds: { inbox: true },
  keywords: { $seen: true },
  from: [{ name: 'Google', email: 'noreply-smtp-tls-reporting@google.com' }],
  to: [{ email: 'postmaster@example.org' }],
  subject: 'Report Domain: example.org',
  receivedAt: '2026-01-01T00:00:00Z',
  preview: 'This is an aggregate TLS report',
  hasAttachment: true,
  size: 100,
  textBody: [],
  htmlBody: [],
  attachments: [{ partId: '2', blobId: 'blob-gz', name, type: 'application/tlsrpt+gzip', size: 249, disposition: 'attachment' }],
  bodyValues: {},
} as unknown as Email;

const client = new Proxy({ getAccountId: () => 'me' } as Record<string, unknown>, {
  get: (target, prop) => (prop in target ? target[prop as string] : prop === 'then' ? undefined : vi.fn().mockResolvedValue(null)),
}) as unknown as IJMAPClient;

describe('attachment icons in the reader', () => {
  beforeEach(() => {
    useAuthStore.setState({ client } as never);
  });

  it('colours the icon by file type', () => {
    const { container } = render(<EmailViewer email={email} mailboxes={[]} selectedMailbox="inbox" />);
    const chips = container.querySelectorAll(`[data-testid="attachment"][data-attachment-name="${name}"]`);
    expect(chips.length).toBeGreaterThan(0);
    for (const chip of chips) {
      const icon = chip.querySelector('svg')!;
      expect(icon.getAttribute('class')).toContain('text-amber-600');
      expect(icon.getAttribute('class')).not.toContain('text-muted-foreground');
    }
  });
});
