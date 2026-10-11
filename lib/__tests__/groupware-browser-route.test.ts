// @vitest-environment node
import { createServer } from 'node:http';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { NextRequest } from 'next/server';
import { describe, expect, it, vi } from 'vitest';
import { encryptSession } from '@/lib/auth/crypto';
import { POST } from '@/app/api/account/stalwart/jmap/route';

vi.mock('@/lib/auth/session-secret', () => ({ getSessionSecret: () => 'x'.repeat(32) }));
vi.mock('@/lib/admin/config-manager', () => ({ configManager: { ensureLoaded: async () => {}, get: () => true } }));
vi.mock('@/lib/access-approval/relay-bridge', () => ({
  accessApprovalRelayBridgeUrl: () => `${origin}/bridge`, signAccessApprovalBridgeToken: () => 'synthetic-proof',
}));
vi.mock('@/lib/stalwart/credentials', () => ({ getStalwartCredentials: async () => ({
  serverUrl: origin, username: 'owner@example.test', authHeader: `Basic ${Buffer.from('owner@example.test:synthetic').toString('base64')}`, slot: 2, trusted: true,
}) }));
vi.mock('@/lib/stalwart/jmap-api', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/stalwart/jmap-api')>(),
  postJmap: (url: string, auth: string, body: string) => fetch(url, { method: 'POST', headers: { Authorization: auth, 'Content-Type': 'application/json' }, body }),
}));

let origin = '';

describe('Groupware browser gate', () => {
  it.runIf(process.env.COMAIL_BROWSER_TESTS === '1')('denies stale-session groupware after the live flag changes and keeps mail available', async () => {
    let enabled = true;
    let groupwareCalls = 0;
    let mailCalls = 0;
    const slots: Array<string | null> = [];
    const bundle = await build({
      stdin: {
        resolveDir: process.cwd(), loader: 'ts', contents: `
          import { JMAPClient } from './lib/jmap/client';
          import { useAccountStore } from './stores/account-store';
          window.proof = async () => {
            const origin = location.origin;
            const id = useAccountStore.getState().addAccount({ username: 'owner@example.test', serverUrl: origin, label: 'Owner', authMode: 'basic', rememberMe: true, displayName: 'Owner', email: 'owner@example.test', lastLoginAt: 0, isConnected: true, hasError: false, isDefault: true });
            useAccountStore.getState().updateAccount(id, { cookieSlot: 2 });
            const client = new JMAPClient(origin, 'owner@example.test', 'synthetic');
            try {
              await client.connect();
              const allowed = await client.getAddressBooks({ throwOnError: true });
              await fetch('/disable', { method: 'POST' });
              let denied = false;
              try { await client.getAddressBooks({ throwOnError: true }); } catch { denied = true; }
              const mail = await client.getMailboxes();
              return { allowed: allowed.length, denied, mail: mail.length };
            } finally { client.disconnect(); }
          };
        `,
      },
      bundle: true, platform: 'browser', write: false, minify: true, external: ['crypto'],
      define: { 'process.env': '{}', 'process.env.NODE_ENV': '"production"', 'process.env.NEXT_PUBLIC_BASE_PATH': '""', 'process.env.NEXT_PUBLIC_BULWARK_LITE': '"false"' },
    });
    const server = createServer(async (incoming, outgoing) => {
      try {
        const url = new URL(incoming.url ?? '/', origin);
        const chunks: Buffer[] = [];
        for await (const chunk of incoming) chunks.push(Buffer.from(chunk));
        const body = Buffer.concat(chunks).toString('utf8');
        if (url.pathname === '/') {
          outgoing.setHeader('Content-Type', 'text/html');
          outgoing.end('<!doctype html><script src="/client.js"></script>');
        } else if (url.pathname === '/client.js') {
          outgoing.setHeader('Content-Type', 'application/javascript');
          outgoing.end(bundle.outputFiles[0].text);
        } else if (url.pathname === '/.well-known/jmap') {
          outgoing.setHeader('Content-Type', 'application/json');
          outgoing.end(JSON.stringify({ capabilities: {}, accounts: { a: { name: 'Owner', isPersonal: true, accountCapabilities: {} } }, primaryAccounts: { 'urn:ietf:params:jmap:mail': 'a', 'urn:ietf:params:jmap:contacts': 'a' }, apiUrl: `${origin}/jmap/`, downloadUrl: '', uploadUrl: '', eventSourceUrl: '' }));
        } else if (url.pathname === '/bridge/identity') {
          outgoing.setHeader('Content-Type', 'application/json');
          outgoing.end(JSON.stringify({ did: 'did:plc:synthetic', groupware_enabled: enabled }));
        } else if (url.pathname === '/disable') {
          enabled = false;
          outgoing.end();
        } else if (url.pathname === '/jmap/') {
          const payload = JSON.parse(body);
          const method = payload.methodCalls[0][0];
          if (method === 'AddressBook/get') groupwareCalls++;
          if (method === 'Mailbox/get') mailCalls++;
          outgoing.setHeader('Content-Type', 'application/json');
          outgoing.end(JSON.stringify({ methodResponses: [[method, { list: [{ id: 'synthetic' }] }, '0']] }));
        } else if (url.pathname === '/api/account/stalwart/jmap') {
          const headers = new Headers();
          for (const [name, value] of Object.entries(incoming.headers)) if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(', ') : value);
          slots.push(headers.get('X-JMAP-Cookie-Slot'));
          const response = await POST(new NextRequest(url, { method: 'POST', headers, body }));
          outgoing.writeHead(response.status, Object.fromEntries(response.headers));
          outgoing.end(await response.text());
        } else {
          outgoing.writeHead(404);
          outgoing.end();
        }
      } catch {
        outgoing.writeHead(500);
        outgoing.end('Fixture failure');
      }
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing fixture address');
    origin = `http://127.0.0.1:${address.port}`;
    let browser;
    try {
      browser = await chromium.launch({ headless: true, executablePath: process.env.COMAIL_CHROMIUM_PATH || undefined });
      const context = await browser.newContext();
      await context.addCookies([{ name: 'jmap_session_2', value: encryptSession(origin, 'owner@example.test', 'synthetic', { groupwareEnabled: true }), url: origin, httpOnly: true, sameSite: 'Lax' }]);
      const page = await context.newPage();
      await page.goto(origin);
      const result = await page.evaluate(async () => (window as unknown as { proof: () => Promise<unknown> }).proof());
      expect(result).toEqual({ allowed: 1, denied: true, mail: 1 });
      expect(slots).toEqual(['2', '2']);
      expect(groupwareCalls).toBe(1);
      expect(mailCalls).toBe(1);
    } finally {
      await browser?.close();
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
  }, 30_000);
});
