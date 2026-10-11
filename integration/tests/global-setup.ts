/**
 * Brings the integration stack up before the suite runs:
 *   1. fetch the arch-specific stalwart-cli (offline-friendly build input),
 *   2. ensure integration/.env exists (compose credentials),
 *   3. docker compose up -d --build --wait (Stalwart + webmail),
 *   4. wait for the JMAP and HTTP health endpoints,
 *   5. wait for a disposable browser to reach the login form.
 *
 * Set IT_NO_DOCKER=1 to skip container management entirely (useful when the
 * stack is already running, e.g. during test authoring against `npm run dev`).
 */
import { execFileSync } from 'node:child_process';
import { existsSync, copyFileSync, mkdirSync } from 'node:fs';
import { chromium } from '@playwright/test';
import path from 'node:path';
import { JMAP_URL, WEBMAIL_URL, ACCOUNTS, ACCOUNT_PASSWORD } from './helpers/config';

const INTEGRATION_DIR = path.resolve(__dirname, '..');
const COMPOSE_FILE = path.join(INTEGRATION_DIR, 'docker-compose.yml');
const ENV_FILE = path.join(INTEGRATION_DIR, '.env');

function run(cmd: string, args: string[], cwd = INTEGRATION_DIR): void {
  execFileSync(cmd, args, { cwd, stdio: 'inherit' });
}

// Node fetch keeps the actionable socket or DNS failure in its cause chain.
function describeFetchError(error: unknown): string {
  const parts: string[] = [];
  for (let current: unknown = error, depth = 0; current instanceof Error && depth < 5; depth += 1) {
    const code = (current as NodeJS.ErrnoException).code;
    if (code && !parts.includes(code)) parts.push(code);
    if (!parts.includes(current.message)) parts.push(current.message);
    current = (current as { cause?: unknown }).cause;
  }
  return parts.length ? parts.join(' <- ') : String(error);
}

async function waitFor(label: string, url: string, check: (r: Response) => boolean, timeoutMs = 240000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let last = 'no attempt completed yet';
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(Math.max(1, Math.min(15000, deadline - Date.now()))), headers: { Authorization: 'Basic ' + Buffer.from(`${ACCOUNTS.alice.email}:${ACCOUNT_PASSWORD}`).toString('base64') } });
      const ready = check(res);
      await res.body?.cancel();
      if (ready) return;
      last = `HTTP ${res.status} ${res.statusText}`.trim();
    } catch (error) {
      last = describeFetchError(error);
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error(`Timed out waiting for ${label} at ${url} (last attempt: ${last})`);
}

// The health endpoint can be ready while next dev still compiles the client.
// A disposable browser must reach the login form before test contexts start.
async function waitForLoginForm(): Promise<void> {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    try {
      await page.goto(WEBMAIL_URL, { timeout: 180000 });
      await page.locator('#username').waitFor({ state: 'visible', timeout: 180000 });
    } catch (error) {
      mkdirSync(path.join(INTEGRATION_DIR, 'test-results'), { recursive: true });
      await page.screenshot({ path: path.join(INTEGRATION_DIR, 'test-results/startup.png') }).catch(() => {});
      throw error;
    }
  } finally {
    await browser.close();
  }
}

export default async function globalSetup(): Promise<void> {
  if (process.env.IT_NO_DOCKER === '1') {
    console.log('[global-setup] IT_NO_DOCKER=1 — skipping docker compose management');
  } else {
    console.log('[global-setup] fetching stalwart-cli');
    run('bash', [path.join(INTEGRATION_DIR, 'stalwart', 'prepare-stalwart-cli.sh')]);

    if (!existsSync(ENV_FILE)) {
      console.log('[global-setup] creating integration/.env from .env.example');
      copyFileSync(path.join(INTEGRATION_DIR, '.env.example'), ENV_FILE);
    }

    console.log('[global-setup] docker compose up -d --build --wait');
    run('docker', [
      'compose', '-f', COMPOSE_FILE, '--env-file', ENV_FILE,
      'up', '-d', '--build', '--wait', '--wait-timeout', '300',
    ]);
  }

  console.log('[global-setup] waiting for Stalwart JMAP');
  await waitFor('Stalwart JMAP', `${JMAP_URL}/jmap/session`, (r) => r.ok);

  console.log('[global-setup] waiting for webmail');
  await waitFor('webmail', `${WEBMAIL_URL}/api/health`, (r) => r.ok, 240000);

  console.log('[global-setup] waiting for the browser login form');
  await waitForLoginForm();

  console.log('[global-setup] stack ready');
}
