import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

const root = process.cwd();

describe('retired cross-device approval', () => {
  it.each(['available', 'offline'] as const)('ignores queued approval wakeups when mail previews are %s', async (previewState) => {
    const source = await readFile(path.join(root, 'public/sw.js'), 'utf8');
    const listeners = new Map<string, (event: unknown) => void>();
    const showNotification = vi.fn(async () => {});
    const fetchPreview = vi.fn(async () => {
      if (previewState === 'offline') throw new Error('offline');
      return {
        ok: true,
        json: async () => ({ unreadTotal: 1, email: { id: 'm', subject: 'Mail', from: [{ name: 'Sender' }] } }),
      };
    });
    const self = {
      location: { href: 'https://mail.example.test/sw.js', origin: 'https://mail.example.test' },
      addEventListener: (type: string, listener: (event: unknown) => void) => listeners.set(type, listener),
      registration: { showNotification, getNotifications: async () => [] },
    };
    const caches = { open: async () => ({ match: async () => undefined, put: async () => {} }) };
    vm.runInNewContext(source, { self, caches, fetch: fetchPreview, URL, URLSearchParams, Response, Date, console });
    async function push(payload: unknown) {
      const pending: Promise<unknown>[] = [];
      listeners.get('push')?.({ data: { json: () => payload }, waitUntil: (p: Promise<unknown>) => pending.push(p) });
      await Promise.all(pending);
    }

    await push({ kind: 'access-approval' });
    expect(fetchPreview).not.toHaveBeenCalled();
    expect(showNotification).not.toHaveBeenCalled();

    await push({ kind: 'jmap-email-push', accountId: 'a', emailIds: ['m'] });
    expect(fetchPreview).toHaveBeenCalledOnce();
    expect(showNotification).toHaveBeenCalledOnce();
  });

  it('does not ship an approval API route or client dialog', async () => {
    await expect(access(path.join(root, 'app/api/access-approvals/[[...seg]]/route.ts'))).rejects.toThrow();
    await expect(access(path.join(root, 'components/access-approval-dialog.tsx'))).rejects.toThrow();
  });

  it('keeps ordinary Web Push registration but removes approval wakeups', async () => {
    const [settings, serviceWorker] = await Promise.all([
      readFile(path.join(root, 'components/settings/notification-settings.tsx'), 'utf8'),
      readFile(path.join(root, 'public/sw.js'), 'utf8'),
    ]);

    expect(settings).toContain('enableWebPush');
    expect(settings).toContain('disableWebPush');
    expect(settings).not.toContain('/api/access-approvals');
    expect(serviceWorker).not.toContain('approvalWake');
  });
});
