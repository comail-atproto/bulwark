import { test, expect, type Page } from '@playwright/test';
import type { Server } from 'node:http';
import { ACCOUNTS } from './helpers/config';
import { accountSwitcher, enableProInterface, openCalendar, openContacts, openFiles, switchAccount } from './helpers/app';
import { calls, grantCalendarConsent, resetFixture, startFixture, withdrawAccess } from '../fixtures/comail-browser/backend';

// The browser and all /api/* handlers are real. The loopback provider uses
// synthetic data, so these tests do not establish PDS or Space storage behavior.
let fixture: Server;
test.use({ timezoneId: 'UTC' });
test.beforeAll(async () => { fixture = await startFixture(); });
test.afterAll(async () => { await new Promise<void>((resolve, reject) => fixture.close(error => error ? reject(error) : resolve())); });
test.beforeEach(async ({ page }) => {
  resetFixture();
  await page.addLocatorHandler(page.getByRole('button', { name: 'Not now', exact: true }), async button => { await button.evaluate(element => (element as HTMLButtonElement).click()); });
  // Do not contact public identity services from this isolated test. This does
  // not intercept the application's sign-in, session, or authorization routes.
  await page.route('https://public.api.bsky.app/**', route => route.abort());
  await page.route('https://typeahead.waow.tech/**', route => route.abort());
});

async function signIn(page: Page, handle: string): Promise<void> {
  await page.goto('/en/login');
  await page.locator('#atproto-handle').fill(handle);
  await page.locator('form[aria-label]').filter({ has: page.locator('#atproto-handle') }).locator('button[type="submit"]').click();
  await expect(accountSwitcher(page)).toBeVisible({ timeout: 30_000 });
}

async function openMailView(page: Page): Promise<void> {
  await page.locator('a[href="/"]').first().click();
  await expect(accountSwitcher(page)).toBeVisible();
}

async function addRelayAccount(page: Page, handle: string): Promise<void> {
  await accountSwitcher(page).click();
  await page.getByTestId('add-account').first().click();
  await page.locator('#atproto-handle').fill(handle);
  await page.locator('form[aria-label]').filter({ has: page.locator('#atproto-handle') }).locator('button[type="submit"]').click();
  await expect.poll(() => calls.filter(call => call.path === '/redeem').length).toBe(2);
  await expect(accountSwitcher(page)).toBeVisible();
}

test('relay handoff binds two overlapping private datasets to their accounts and removes one', async ({ page }) => {
  await signIn(page, 'alice.example.test');
  await addRelayAccount(page, 'bob.example.test');
  await expect.poll(() => calls.filter(call => call.path === '/redeem').map(call => call.mailbox)).toEqual([ACCOUNTS.alice.email, ACCOUNTS.bob.email]);
  const mailStatus = await page.evaluate(async () => (await fetch('/api/mail/messages/read?slot=1', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ logicalMessageId: 'synthetic', fingerprint: 'synthetic' }),
  })).status);
  expect(mailStatus).toBe(404);
  expect(calls.find(call => call.path.endsWith('/mail/api/v1/messages/read'))?.mailbox).toBe(ACCOUNTS.bob.email);
  await enableProInterface(page);
  await openContacts(page);
  await expect(page.getByText('alice contact', { exact: true })).toBeVisible();
  await expect(page.getByText('bob contact', { exact: true })).toBeVisible();
  await openFiles(page);
  await page.locator(`button[title="${ACCOUNTS.bob.email}"]`).click();
  await expect(page.getByText('bob.txt', { exact: true })).toBeVisible();
  await expect(page.getByText('alice.txt', { exact: true })).toHaveCount(0);
  await switchAccount(page, ACCOUNTS.alice.email);
  await page.locator(`button[title="${ACCOUNTS.alice.email}"]`).click();
  await expect(page.getByText('alice.txt', { exact: true })).toBeVisible();
  await expect(page.getByText('bob.txt', { exact: true })).toHaveCount(0);
  await switchAccount(page, ACCOUNTS.bob.email);
  await page.locator(`button[title="${ACCOUNTS.bob.email}"]`).click();
  await expect(page.getByText('bob.txt', { exact: true })).toBeVisible();
  await expect(page.getByText('alice.txt', { exact: true })).toHaveCount(0);
  await switchAccount(page, ACCOUNTS.alice.email);
  await page.locator(`button[title="${ACCOUNTS.alice.email}"]`).click();
  await expect(page.getByText('alice.txt', { exact: true })).toBeVisible();
  await expect(page.getByText('bob.txt', { exact: true })).toHaveCount(0);
  await openMailView(page);
  await accountSwitcher(page).click();
  const bob = page.locator(`[data-testid="account-option"][data-account-email="${ACCOUNTS.bob.email}"]`).first();
  await bob.hover();
  await bob.locator('..').getByRole('menuitem', { name: 'Remove account' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Remove account' }).click();
  await accountSwitcher(page).click();
  await expect(page.locator(`[data-testid="account-option"][data-account-email="${ACCOUNTS.bob.email}"]`)).toHaveCount(0);
  const removed = await page.evaluate(async () => (await fetch('/api/contacts/book?slot=1')).status);
  expect(removed).toBe(401);
});

test('calendar consent starts only on user action and live access is checked again', async ({ page }) => {
  await signIn(page, 'alice.example.test');
  await openCalendar(page);
  const pending = page.locator('[data-testid="calendar-item"][data-calendar-name="alice private calendar"]').first();
  await expect(pending).toHaveAttribute('data-visible', 'false');
  expect(calls.filter(call => call.path.endsWith('/member/consent/start'))).toHaveLength(0);
  await pending.click();
  await expect.poll(() => calls.filter(call => call.path.endsWith('/member/consent/start')).length).toBe(1);
  await expect(page.getByRole('button', { name: 'Authorize', exact: true })).toBeVisible();
  // The synthetic provider simulates consent completion; no PDS grant is made.
  grantCalendarConsent(ACCOUNTS.alice.email);
  await openMailView(page);
  await openCalendar(page);
  await expect(page.locator('[data-testid="calendar-item"][data-calendar-name="alice private calendar"]').first()).toBeVisible();
  await openContacts(page);
  await expect(page.getByText('alice contact', { exact: true })).toBeVisible();
  withdrawAccess(ACCOUNTS.alice.email);
  const statuses = await page.evaluate(async () => Promise.all([
    fetch('/api/contacts/book?slot=0').then(r => r.status),
    fetch('/api/files/inventory?slot=0').then(r => r.status),
    fetch('/api/calendar/calendars?slot=0').then(r => r.status),
  ]));
  expect(statuses.every(status => status === 403 || status === 404)).toBe(true);
  await openMailView(page);
  await page.locator('a[href$="/contacts"]').first().click();
  const denied = page.waitForResponse(response => response.url().includes('/api/contacts/book?slot=0') && response.status() === 403, { timeout: 10000 });
  await page.keyboard.press('F5');
  await denied;
  await expect(page.getByText('alice contact', { exact: true })).toHaveCount(0);
});

test.describe('Comail sign-in branding', () => {
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    test(`fits ${viewport.width}px viewport`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await page.goto('/en/login');
      await expect(page.locator('#atproto-handle')).toBeVisible();
      await expect(page.getByRole('form', { name: /sign in/i })).toBeVisible();
      await expect(page.locator('img[src*="comail"]').first()).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
    });
  }
});


test('calendar sharing keeps the fixed role and a recurring event private until publication', async ({ page }) => {
  grantCalendarConsent(ACCOUNTS.alice.email);
  await signIn(page, 'alice.example.test');
  await openCalendar(page);
  const row = page.locator('[data-testid="calendar-item"][data-calendar-name="alice private calendar"]').first();
  await row.click({ button: 'right' });
  await page.getByRole('menuitem', { name: /^Share calendar/ }).click();
  const dialog = page.getByRole('dialog', { name: /alice private calendar/ });
  await dialog.getByRole('button', { name: 'Add person or group', exact: true }).click();
  await dialog.getByRole('button', { name: /Fixture invitee/ }).click();
  await expect.poll(() => calls.filter(call => call.path.endsWith('/calendar/api/v1/share')).length).toBe(1);
  const share = calls.find(call => call.path.endsWith('/calendar/api/v1/share'))!;
  expect(share.mailbox).toBe(ACCOUNTS.alice.email);
  expect(share.body).toMatchObject({ principalId: 'did:plc:bcdefghijklmnopqrstuvwxy', role: 'editor' });
  await expect(dialog.locator('select option')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await page.getByText('alice private event', { exact: true }).first().click();
  await expect(page.getByRole('button', { name: 'Publish to Atmosphere' })).toBeVisible();
  expect(calls.some(call => call.path.endsWith('/public/events'))).toBe(false);
});


test('a linked public event keeps shared fields read-only and sends a private reminder to its owner', async ({ page }) => {
  grantCalendarConsent(ACCOUNTS.alice.email);
  await signIn(page, 'alice.example.test');
  await openCalendar(page);
  await page.getByText('alice linked public event', { exact: true }).first().click();
  await page.getByRole('button', { name: 'Edit event', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'Edit event' });
  await expect(editor.getByLabel('Title', { exact: true })).toBeDisabled();
  await expect(editor.getByLabel('Recurrence', { exact: true })).toBeDisabled();
  await editor.getByRole('button', { name: 'Add reminder' }).click();
  await editor.getByRole('button', { name: 'Save', exact: true }).click();
  await expect.poll(() => calls.filter(call => call.path.endsWith('/event_public/personal')).length).toBe(1);
  const update = calls.find(call => call.path.endsWith('/event_public/personal'))!;
  expect(update.mailbox).toBe(ACCOUNTS.alice.email);
  expect(update.body).toMatchObject({ basePersonalRevision: `personal-state-${'a'.repeat(64)}`, patch: { alerts: expect.anything() } });
  expect(calls.some(call => call.method === 'PUT' && call.path.endsWith('/events/event_public'))).toBe(false);
});

test('a private recurring event saves a reminder for one occurrence', async ({ page }) => {
  grantCalendarConsent(ACCOUNTS.alice.email);
  await signIn(page, 'alice.example.test');
  await openCalendar(page);
  await page.getByText('alice private event', { exact: true }).first().click();
  await page.getByRole('button', { name: 'Edit event', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'Edit event' });
  await editor.getByRole('button', { name: 'Add reminder' }).click();
  await editor.getByRole('button', { name: 'Save', exact: true }).click();
  const scope = page.getByRole('dialog', { name: 'Edit recurring event' });
  await scope.getByText('This event only').click();
  await scope.getByRole('button', { name: 'Save', exact: true }).click();
  await expect.poll(() => calls.filter(call => call.path.endsWith('/event_overlap/personal')).length).toBe(1);
  const update = calls.find(call => call.path.endsWith('/event_overlap/personal'))!;
  expect(update.mailbox).toBe(ACCOUNTS.alice.email);
  expect(update.body).toMatchObject({ basePersonalRevision: `personal-state-${'a'.repeat(64)}`, patch: { alerts: expect.anything() }, recurrenceId: expect.any(String) });
});

test('disabled identity management still allows signature editing without changing the email address', async ({ page }) => {
  await signIn(page, 'alice.example.test');
  await page.locator('a[href$="/settings"]').first().click();
  await page.getByTestId('settings-tab-account').first().click();
  await page.getByRole('button', { name: 'Manage identities' }).click();
  const dialog = page.getByRole('dialog', { name: 'Manage sending identities' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'New identity' })).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Edit identity' }).first().click();
  await expect(dialog.locator('#identity-email')).toBeDisabled();
  await expect(dialog.locator('#identity-email')).toHaveValue(ACCOUNTS.alice.email);
  await expect(dialog.getByRole('button', { name: 'Save' })).toBeVisible();
});


test('a calendar viewer cannot share or edit another actor’s event body', async ({ page }) => {
  grantCalendarConsent(ACCOUNTS.bob.email);
  await signIn(page, 'bob.example.test');
  await openCalendar(page);
  const row = page.locator('[data-testid="calendar-item"][data-calendar-name="bob private calendar"]').first();
  await row.click({ button: 'right' });
  await expect(page.getByRole('menuitem', { name: /^Share calendar/ })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await page.getByText('bob private event', { exact: true }).first().click();
  await page.getByRole('button', { name: 'Edit event', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'Edit event' });
  await expect(editor.getByLabel('Title', { exact: true })).toBeDisabled();
  await expect(editor.getByRole('button', { name: 'Add reminder' })).toBeEnabled();
  expect(calls.some(call => call.method === 'PUT' && call.path.endsWith('/events/event_overlap'))).toBe(false);
});

test('the signed-in Comail mobile masthead and controls fit on screen', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page, 'alice.example.test');
  const header = page.locator('header:has(img[alt="comail"])').first();
  await expect(header).toBeVisible();
  for (const control of [header, header.getByRole('button', { name: 'Toggle menu' }), header.getByRole('button', { name: 'Compose' })]) {
    const box = await control.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(390.5);
  }
  await header.getByRole('button', { name: 'Toggle menu' }).click();
  await expect(accountSwitcher(page)).toBeVisible();
});
