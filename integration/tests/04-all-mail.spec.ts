import { test, expect } from '@playwright/test';
import { ACCOUNTS } from './helpers/config';
import { sendMail } from './helpers/smtp';
import { JmapClient } from './helpers/jmap';
import {
  login,
  addAccount,
  seedAllMailSettings,
  folderRow,
  openFolder,
  expectFolderCountsSynced,
  expectEmailVisible,
  emailItem,
  forceSync,
} from './helpers/app';

/**
 * The "All Mail" view — a virtual folder that merges messages across an
 * account's folders (Inbox + custom, excluding junk/sent/trash/drafts/archive),
 * and across every logged-in account when the cross-account sub-option is on.
 */
const { alice, bob } = ACCOUNTS;
const ALL_MAIL = '__cross_all__';

let seq = 0;
const subj = (l: string) => `IT ${l} ${Date.now()}-${seq++}`;
const send = (to: typeof alice, subject: string) =>
  sendMail({ from: to.email, authPass: to.password, to: to.email, subject, body: 'x' });

test.describe('All Mail — single account', () => {
  let jmap: JmapClient;

  test.beforeEach(async () => {
    jmap = await JmapClient.connect(alice.email, alice.password);
    await jmap.reset();
  });

  test('merges Inbox + custom folders and excludes Junk', async ({ page }) => {
    const inboxSubj = subj('am-inbox');
    const folderSubj = subj('am-folder');
    const junkSubj = subj('am-junk');
    await send(alice, inboxSubj);
    await send(alice, folderSubj);
    await send(alice, junkSubj);

    // File one into a custom folder and one into Junk (excluded from All Mail).
    const folderMail = await jmap.waitForEmail(folderSubj);
    await jmap.moveEmailToFolder(folderMail.id, 'Projects');
    const junkMail = await jmap.waitForEmail(junkSubj);
    const junk = await jmap.mailboxByRole('junk');
    await jmap.moveEmail(junkMail.id, junk!.id);

    await seedAllMailSettings(page, { crossAccount: false });
    await login(page, alice);

    // The All Mail entry is present and shows the two included-folder unreads.
    await expect(folderRow(page, { name: ALL_MAIL }).first()).toBeVisible();
    await expectFolderCountsSynced(page, { name: ALL_MAIL }, { unread: 2 });

    // Its list merges the Inbox and custom-folder messages, but not Junk.
    await openFolder(page, { name: ALL_MAIL });
    await forceSync(page);
    await expectEmailVisible(page, inboxSubj);
    await expectEmailVisible(page, folderSubj);
    await expect(emailItem(page, junkSubj)).toHaveCount(0);
  });
});

test.describe('All Mail — cross account', () => {
  test.beforeEach(async () => {
    for (const a of [alice, bob]) {
      const j = await JmapClient.connect(a.email, a.password);
      await j.reset();
    }
  });

  test('merges mail from every logged-in account', async ({ page }) => {
    const aSubj = subj('am-a');
    const bSubj = subj('am-b');
    await send(alice, aSubj);
    await send(bob, bSubj);

    await seedAllMailSettings(page, { crossAccount: true });
    await login(page, alice);
    await addAccount(page, bob);

    // All Mail aggregates unread across both accounts (alice 1 + bob 1).
    await expect(folderRow(page, { name: ALL_MAIL }).first()).toBeVisible();
    await expectFolderCountsSynced(page, { name: ALL_MAIL }, { unread: 2 });

    await openFolder(page, { name: ALL_MAIL });
    await forceSync(page);
    await expectEmailVisible(page, aSubj);
    await expectEmailVisible(page, bSubj);
  });
});
