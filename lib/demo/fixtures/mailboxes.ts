import type { Mailbox } from '@/lib/jmap/types';

const RIGHTS_SYSTEM = { mayReadItems: true, mayAddItems: true, mayRemoveItems: true, maySetSeen: true, maySetKeywords: true, mayCreateChild: true, mayRename: false, mayDelete: false, maySubmit: true };
const RIGHTS_CUSTOM = { ...RIGHTS_SYSTEM, mayRename: true, mayDelete: true };

// Counts must stay in sync with createDemoEmails() in fixtures/emails.ts.
export function createDemoMailboxes(): Mailbox[] {
  return [
    { id: 'demo-mailbox-inbox', name: 'Inbox', role: 'inbox', sortOrder: 1, totalEmails: 22, unreadEmails: 13, totalThreads: 20, unreadThreads: 12, myRights: RIGHTS_SYSTEM, isSubscribed: true },
    { id: 'demo-mailbox-sent', name: 'Sent', role: 'sent', sortOrder: 2, totalEmails: 3, unreadEmails: 0, totalThreads: 3, unreadThreads: 0, myRights: RIGHTS_SYSTEM, isSubscribed: true },
    { id: 'demo-mailbox-drafts', name: 'Drafts', role: 'drafts', sortOrder: 3, totalEmails: 2, unreadEmails: 0, totalThreads: 2, unreadThreads: 0, myRights: RIGHTS_SYSTEM, isSubscribed: true },
    { id: 'demo-mailbox-trash', name: 'Trash', role: 'trash', sortOrder: 5, totalEmails: 2, unreadEmails: 0, totalThreads: 2, unreadThreads: 0, myRights: RIGHTS_SYSTEM, isSubscribed: true },
    { id: 'demo-mailbox-archive', name: 'Archive', role: 'archive', sortOrder: 4, totalEmails: 2, unreadEmails: 0, totalThreads: 2, unreadThreads: 0, myRights: RIGHTS_SYSTEM, isSubscribed: true },
    { id: 'demo-mailbox-junk', name: 'Spam', role: 'junk', sortOrder: 6, totalEmails: 3, unreadEmails: 3, totalThreads: 3, unreadThreads: 3, myRights: RIGHTS_SYSTEM, isSubscribed: true },
    { id: 'demo-mailbox-projects', name: 'Projects', sortOrder: 10, totalEmails: 3, unreadEmails: 2, totalThreads: 3, unreadThreads: 2, myRights: RIGHTS_CUSTOM, isSubscribed: true },
    { id: 'demo-mailbox-receipts', name: 'Receipts', sortOrder: 11, totalEmails: 2, unreadEmails: 0, totalThreads: 2, unreadThreads: 0, myRights: RIGHTS_CUSTOM, isSubscribed: true },
  ];
}
