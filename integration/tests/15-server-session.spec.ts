import { test, expect } from '@playwright/test';
import { ACCOUNTS } from './helpers/config';
import { accountSwitcher } from './helpers/app';

test('browser login creates a usable server-side session @smoke', async ({ page }) => {
  const groupwareRequests: string[] = [];
  const consoleErrors: string[] = [];
  page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  page.on('pageerror', (error) => consoleErrors.push(error.message));
  page.on('request', (request) => {
    const path = new URL(request.url()).pathname;
    if (path.startsWith('/api/calendar/') || path.startsWith('/api/contacts/')) groupwareRequests.push(path);
    if (path === '/api/account/stalwart/jmap' && request.method() === 'POST') {
      const body = request.postDataJSON() as { methodCalls?: [string, unknown, string][] };
      if (body.methodCalls?.some(([name]) => /^(Calendar|AddressBook|Contact)/.test(name))) groupwareRequests.push(path);
    }
  });
  const contextResponse = page.waitForResponse((response) =>
    new URL(response.url()).pathname === '/api/auth/stalwart-context'
      && response.request().method() === 'POST',
  );

  await page.goto('/en/login');
  await page.fill('#username', ACCOUNTS.alice.email);
  await page.fill('#password', ACCOUNTS.alice.password);
  await page.click('button[type="submit"]');
  await expect(accountSwitcher(page)).toBeVisible();
  const response = await contextResponse;
  expect(response.status(), await response.text()).toBe(200);

  const passthrough = await page.evaluate(async () => {
    const response = await fetch('/api/account/stalwart/jmap', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        using: ['urn:ietf:params:jmap:core'],
        methodCalls: [['Core/echo', { startup: 'ok' }, 'startup']],
      }),
    });
    return { status: response.status, body: await response.json() };
  });

  expect(groupwareRequests).toEqual([]);
  expect(consoleErrors).toEqual([]);
  expect(passthrough.status).toBe(200);
  expect(passthrough.body.methodResponses).toContainEqual([
    'Core/echo', { startup: 'ok' }, 'startup',
  ]);
});
