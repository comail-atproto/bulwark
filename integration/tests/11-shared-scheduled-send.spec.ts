import { test, expect } from '@playwright/test';
import { ACCOUNTS, GROUP } from './helpers/config';
import { JmapClient } from './helpers/jmap';
import { login, forceSync, folderRow, expandSharedFolders } from './helpers/app';

/**
 * PR #874 — a delayed ("scheduled") send composed from a shared/group
 * identity is created in the *shared* JMAP account, because sendEmail routes
 * the EmailSubmission to the identity's account. Every read/write on the
 * scheduled surface, however, asked the *primary* submission account only:
 *
 *   getScheduledEmails / cancelEmailSubmission / rescheduleEmailSubmission
 *       -> getSubmissionAccountId()   // no argument = primary account
 *
 * The message is therefore accepted and stays pending on the server — it *will*
 * be delivered at sendAt — while the UI cannot list it, cancel it, or
 * reschedule it. Silent unrecallable mail, which is worse than a failed send.
 *
 * Stalwart advertises `urn:ietf:params:jmap:submission` (with FUTURERELEASE) on
 * group accounts as well as personal ones, so scheduling from a shared address
 * is legitimate and expected to work.
 */
const member = ACCOUNTS[GROUP.team.memberOf];
const { team } = GROUP;

/** Six hours out: comfortably inside Stalwart's maxDelayedSend (30 days). */
function sendAtSoon(): { iso: string; holdFor: number } {
  const holdFor = 6 * 60 * 60;
  return { iso: new Date(Date.now() + holdFor * 1000).toISOString(), holdFor };
}

async function scheduleFromShared(client: JmapClient, subject: string) {
  const sharedAccountId = client.accountIdByName(team.email);

  const identityRes = await client.request([
    ['Identity/get', { accountId: sharedAccountId }, '0'],
  ]);
  const identityId = (identityRes.methodResponses[0][1].list as Array<{ id: string; email: string }>)
    .find((i) => i.email === team.email)!.id;

  const mailboxRes = await client.request([['Mailbox/get', { accountId: sharedAccountId }, '0']]);
  const draftsId = (mailboxRes.methodResponses[0][1].list as Array<{ id: string; role: string | null }>)
    .find((m) => m.role === 'drafts')!.id;

  const { holdFor } = sendAtSoon();
  const res = await client.request([
    ['Email/set', {
      accountId: sharedAccountId,
      create: {
        e1: {
          mailboxIds: { [draftsId]: true },
          keywords: { $draft: true },
          from: [{ email: team.email }],
          to: [{ email: ACCOUNTS.bob.email }],
          subject,
          bodyValues: { '1': { value: 'scheduled from a shared identity' } },
          textBody: [{ partId: '1', type: 'text/plain' }],
        },
      },
    }, '0'],
    ['EmailSubmission/set', {
      accountId: sharedAccountId,
      create: {
        s1: {
          emailId: '#e1',
          identityId,
          envelope: {
            mailFrom: { email: team.email, parameters: { HOLDFOR: String(holdFor) } },
            rcptTo: [{ email: ACCOUNTS.bob.email }],
          },
        },
      },
    }, '1'],
  ]);

  const created = res.methodResponses[1][1].created?.s1;
  expect(res.methodResponses[1][1].notCreated ?? null).toBeNull();
  expect(created?.id).toBeTruthy();
  return { sharedAccountId, submissionId: created.id as string };
}

test.describe('Scheduled send from a shared account (PR #874)', () => {
  test('the shared account advertises delayed send in its own right', async () => {
    // Guard for everything below: if Stalwart stopped exposing submission on
    // group accounts, the bug and the fix are both moot.
    const client = await JmapClient.connect(member.email, member.password);
    const sharedAccountId = client.accountIdByName(team.email);
    const session = await client.sessionAccountCapabilities(sharedAccountId);
    const submission = session['urn:ietf:params:jmap:submission'] as
      | { maxDelayedSend?: number; submissionExtensions?: Record<string, unknown> }
      | undefined;

    expect(submission, 'shared account exposes submission').toBeTruthy();
    expect(submission!.maxDelayedSend ?? 0).toBeGreaterThan(0);
    expect(Object.keys(submission!.submissionExtensions ?? {})).toContain('FUTURERELEASE');
  });

  test('a shared-account submission is invisible to the primary account', async () => {
    // Server-truth control: this is the whole mechanism of the bug, independent
    // of the app. The submission exists — but not where the app used to look.
    const client = await JmapClient.connect(member.email, member.password);
    const { sharedAccountId, submissionId } = await scheduleFromShared(client, `it-801-server-${Date.now()}`);

    const inShared = await client.request([
      ['EmailSubmission/get', { accountId: sharedAccountId, ids: [submissionId], properties: ['id', 'undoStatus'] }, '0'],
    ]);
    expect(inShared.methodResponses[0][1].list).toHaveLength(1);
    expect(inShared.methodResponses[0][1].list[0].undoStatus).toBe('pending');

    const inPrimary = await client.request([
      ['EmailSubmission/get', { accountId: client.accountId, ids: [submissionId], properties: ['id'] }, '0'],
    ]);
    expect(inPrimary.methodResponses[0][1].list).toHaveLength(0);
    expect(inPrimary.methodResponses[0][1].notFound).toContain(submissionId);

    // ...and cancelling it through the primary account is a no-op that reports
    // no error to the user, which is why the mail used to go out anyway.
    const badCancel = await client.request([
      ['EmailSubmission/set', { accountId: client.accountId, update: { [submissionId]: { undoStatus: 'canceled' } } }, '0'],
    ]);
    expect(badCancel.methodResponses[0][1].updated ?? null).toBeNull();
    expect(badCancel.methodResponses[0][1].notUpdated?.[submissionId]?.type).toBe('notFound');

    // Clean up through the owning account so the mail never leaves.
    await client.request([
      ['EmailSubmission/set', { accountId: sharedAccountId, update: { [submissionId]: { undoStatus: 'canceled' } } }, '0'],
    ]);
  });

  test('the Scheduled view lists mail scheduled from the shared account', async ({ page }) => {
    const client = await JmapClient.connect(member.email, member.password);
    const subject = `it-801-ui-${Date.now()}`;
    const { sharedAccountId, submissionId } = await scheduleFromShared(client, subject);

    try {
      await login(page, member);
      await forceSync(page);

      // The user's own Scheduled folder aggregates every submission account she
      // can reach, so the shared message shows up there. Before the fix this
      // list only ever queried her primary account and stayed empty.
      await folderRow(page, { role: 'scheduled' }).click();
      await expect(page.getByText(subject)).toBeVisible({ timeout: 30000 });
    } finally {
      await client.request([
        ['EmailSubmission/set', { accountId: sharedAccountId, update: { [submissionId]: { undoStatus: 'canceled' } } }, '0'],
      ]);
    }
  });

  test('the shared account gets its own Scheduled row, scoped to its mail', async ({ page }) => {
    const client = await JmapClient.connect(member.email, member.password);
    const subject = `it-801-scope-${Date.now()}`;
    const { sharedAccountId, submissionId } = await scheduleFromShared(client, subject);

    try {
      await login(page, member);
      await forceSync(page);
      await expandSharedFolders(page, team.email);

      const sharedScheduled = page.locator(`[data-mailbox-id="__scheduled__:${sharedAccountId}"]`);
      await expect(sharedScheduled).toBeVisible({ timeout: 30000 });

      await sharedScheduled.click();
      await expect(page.getByText(subject)).toBeVisible({ timeout: 30000 });

      // The clicked row must be the highlighted one. The store keeps a single
      // virtual "__scheduled__" mailbox id for both rows, so selection is
      // driven by the account scope — get that wrong and the user's own
      // Scheduled row lights up while the shared one's list is shown.
      await expect(sharedScheduled).toHaveAttribute('data-selected', 'true');
      await expect(
        page.locator('[data-mailbox-id="__scheduled__"]'),
      ).not.toHaveAttribute('data-selected', 'true');
    } finally {
      await client.request([
        ['EmailSubmission/set', { accountId: sharedAccountId, update: { [submissionId]: { undoStatus: 'canceled' } } }, '0'],
      ]);
    }
  });
});
