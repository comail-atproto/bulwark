// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createServer, request, type Server } from 'node:http';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import type { AddressInfo } from 'node:net';

const configuredRequests: string[] = [];
const otherRequests: string[] = [];
let configured: Server;
let other: Server;
let preview: ChildProcess;
let fixture: string;
let port: number;
let otherPort: number;

async function listen(server: Server): Promise<number> {
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  return (server.address() as AddressInfo).port;
}
const close = (server: Server) => new Promise<void>(done => server.close(() => done()));

beforeAll(async () => {
  fixture = await mkdtemp(join(tmpdir(), 'comail-lite-origin-'));
  await writeFile(join(fixture, 'index.html'), '<!doctype html><title>Synthetic Lite export</title>');
  configured = createServer((req, res) => { configuredRequests.push(req.url ?? ''); res.end('configured'); });
  other = createServer((req, res) => { otherRequests.push(req.url ?? ''); res.end('other'); });
  const upstreamPort = await listen(configured);
  otherPort = await listen(other);
  const reservation = createServer();
  port = await listen(reservation);
  await close(reservation);
  preview = spawn(process.execPath, [resolve('scripts/lite/serve.mjs'), fixture, String(port),
    '--stalwart=/webmail', `--upstream=http://127.0.0.1:${upstreamPort}`], { stdio: ['ignore', 'pipe', 'pipe'] });
  await Promise.race([
    once(preview.stdout!, 'data', { signal: AbortSignal.timeout(10_000) }),
    once(preview, 'exit').then(([code]) => { throw new Error(`Lite preview exited before listening: ${code}`); }),
  ]);
});

beforeEach(() => { configuredRequests.length = 0; otherRequests.length = 0; });
afterAll(async () => {
  if (preview && preview.exitCode === null) { const exited = once(preview, 'exit'); preview.kill(); await exited; }
  await Promise.all([configured, other].filter(Boolean).map(close));
  if (fixture) await rm(fixture, { recursive: true, force: true });
});

describe('Lite preview upstream origin', () => {
  it.each(['relative', 'absolute', 'scheme-relative', 'userinfo'] as const)(
    'keeps a %s request on the configured origin', async kind => {
      const path = kind === 'relative' ? '/api/probe?q=1'
        : kind === 'absolute' ? `http://127.0.0.1:${otherPort}/api/probe?q=1`
        : kind === 'scheme-relative' ? `//127.0.0.1:${otherPort}/api/probe?q=1`
        : `http://synthetic:password@127.0.0.1:${otherPort}/api/probe?q=1`;
      const body = await new Promise<string>((done, reject) => {
        const incoming = request({ hostname: '127.0.0.1', port, path,
          headers: { cookie: 'session=synthetic' } }, response => {
          let data = ''; response.setEncoding('utf8');
          response.on('data', chunk => { data += chunk; });
          response.on('end', () => done(data));
          response.on('error', reject);
        });
        incoming.on('error', reject); incoming.end();
      });
      expect(body).toBe('configured');
      expect(configuredRequests).toEqual(['/api/probe?q=1']);
      expect(otherRequests).toEqual([]);
    },
  );
});
