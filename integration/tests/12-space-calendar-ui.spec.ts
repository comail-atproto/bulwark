import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { ACCOUNTS } from './helpers/config';
import { addAccount, enableProInterface, login, openCalendar } from './helpers/app';

const SPACE_CALENDAR_ID = 'cal_fixed-calendar';
const INVITEE_DID = 'did:plc:fixed-invitee';
const TICKET_URL = 'https://space-host.test/oauth/calendar/tickets/abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG';

async function enableCalendarFeature(page: import('@playwright/test').Page): Promise<void> {
  await page.route('**/api/config', async (route) => {
    const response = await route.fetch();
    const config = await response.json() as Record<string, unknown>;
    await route.fulfill({ response, body: JSON.stringify({ ...config, calendarEnabled: true }) });
  });
  await page.route('**/api/admin/policy', async (route) => {
    const response = await route.fetch();
    const policy = await response.json() as { features?: Record<string, unknown> };
    await route.fulfill({ response, body: JSON.stringify({ ...policy, features: { ...policy.features, calendarEnabled: true } }) });
  });
}

function captureReviewEvidence(name: string) {
  return async (page: import('@playwright/test').Page) => {
    if (process.env.COMAIL_CAPTURE_REVIEW_EVIDENCE !== '1') return;
    const directory = path.resolve('review-evidence');
    await mkdir(directory, { recursive: true });
    await page.screenshot({ path: path.join(directory, name), fullPage: false });
  };
}

test.describe('Space calendar existing controls', () => {
  test('selecting a pending calendar starts consent and its toast opens a fixed ticket in a new tab', async ({ page }) => {
    const starts: string[] = [];
    await page.route('**/api/calendar/calendars?*', (route) => route.fulfill({
      status: 409,
      contentType: 'application/json',
      body: JSON.stringify({
        error: 'authorization_required', authorizationProfile: 'member-calendar',
        calendar: {
          id: SPACE_CALENDAR_ID, name: 'Project calendar', source: 'atproto-space', initialized: null,
          pendingConsent: true, revisionId: null, policyId: null, myRole: null,
        },
      }),
    }));
    await page.route('**/api/calendar/member/consent/start?*', async (route) => {
      starts.push(route.request().url());
      await route.fulfill({ status: 202, contentType: 'application/json', body: JSON.stringify({ status: 'authorization_required', authorizationUrl: TICKET_URL }) });
    });
    await page.context().route('https://space-host.test/oauth/calendar/tickets/**', (route) => route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><title>Calendar authorization ticket</title><main>Calendar authorization ticket</main>',
    }));

    await enableCalendarFeature(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await login(page, ACCOUNTS.alice);
    await openCalendar(page);
    const row = page.locator(`[data-testid="calendar-item"][data-calendar-name="Project calendar"]`).first();
    await expect(row).toHaveAttribute('data-visible', 'false');
    await captureReviewEvidence('space-calendar-pending-row.png')(page);

    await row.click();
    await expect.poll(() => starts.length).toBe(1);
    await expect(page.getByRole('button', { name: 'Authorize', exact: true })).toBeVisible();
    if (process.env.COMAIL_CAPTURE_REVIEW_EVIDENCE === '1') {
      await page.waitForTimeout(400);
      await page.locator('.toast-item').last().screenshot({ path: path.resolve('review-evidence/space-calendar-consent-toast.png'), animations: 'disabled' });
    }

    const popup = page.waitForEvent('popup');
    await page.getByRole('button', { name: 'Authorize', exact: true }).click();
    const ticket = await popup;
    await expect(ticket).toHaveURL(TICKET_URL);
    await expect(ticket.getByText('Calendar authorization ticket')).toBeVisible();
    await expect(page).toHaveURL(/calendar/);
    await expect(row).toBeVisible();
  });

  test('the existing share dialog uses the owning account and fixed offer role', async ({ page }) => {
    const principalSlots: string[] = [];
    let activeShare = false;
    await page.route('**/api/calendar/calendars?*', async (route) => {
      const slot = new URL(route.request().url()).searchParams.get('slot');
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ calendars: slot === '1' ? [{
          id: SPACE_CALENDAR_ID, name: 'Project calendar', source: 'atproto-space', myRole: 'owner',
          initialized: true, revisionId: 'space-rev-1', policyId: 'policy-1', offerRole: 'editor',
          members: activeShare ? [{ did: INVITEE_DID, principalId: INVITEE_DID, role: 'editor', status: 'active' }] : [],
        }] : [] }),
      });
    });
    await page.route('**/api/calendar/events?*', (route) => route.fulfill({
      contentType: 'application/json', body: JSON.stringify({ events: [], revisionId: 'space-rev-1' }),
    }));
    await page.route('**/api/calendar/principals?*', async (route) => {
      principalSlots.push(new URL(route.request().url()).searchParams.get('slot') ?? '');
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ principals: [{
        id: INVITEE_DID, type: 'individual', name: 'Project invitee', email: 'invitee@example.test',
      }] }) });
    });
    await page.route('**/api/calendar/share?*', async (route) => {
      const payload = route.request().postDataJSON() as { principalId?: string; role?: string };
      expect(payload).toMatchObject({ principalId: INVITEE_DID, role: 'editor' });
      expect(new URL(route.request().url()).searchParams.get('slot')).toBe('1');
      activeShare = true;
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ status: 'shared', member: { did: INVITEE_DID, role: 'editor' } }) });
    });

    await enableCalendarFeature(page);
    await login(page, ACCOUNTS.alice);
    await addAccount(page, ACCOUNTS.bob);
    await enableProInterface(page);
    await openCalendar(page);

    const row = page.locator(`[data-testid="calendar-item"][data-calendar-name="Project calendar"]`).first();
    await expect(row).toBeVisible();
    await row.click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Share calendar', exact: true }).click({ force: true });
    const dialog = page.getByRole('dialog', { name: /Project calendar/ });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('The invited member must authorize access before calendar sharing becomes active.');
    await expect.poll(() => principalSlots).toContain('1');
    await captureReviewEvidence('space-calendar-share-dialog.png')(page);

    await dialog.getByRole('button', { name: 'Add person or group', exact: true }).click();
    await dialog.getByRole('button', { name: /Project invitee/ }).click();
    await expect.poll(() => activeShare).toBe(true);
    await expect(dialog.locator('select option')).toHaveCount(1);
    await expect(dialog.locator('select option').first()).toHaveAttribute('value', 'readWrite');
    await captureReviewEvidence('space-calendar-share-role.png')(page);
  });
});
