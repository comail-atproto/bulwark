import { describe, it, expect, beforeEach } from 'vitest';
import { useEmailStore } from '../email-store';

function makeEmail(id: string, threadId = `thread-${id}`) {
  return {
    id,
    threadId,
    mailboxIds: { inbox: true },
    keywords: {},
    size: 100,
    receivedAt: new Date().toISOString(),
    from: [{ name: 'Test', email: 'test@example.com' }],
    to: [{ name: 'User', email: 'user@example.com' }],
    subject: `Email ${id}`,
    preview: 'preview',
    hasAttachment: false,
    textBody: [],
    htmlBody: [],
    bodyValues: {},
  };
}

describe('email-store selection', () => {
  beforeEach(() => {
    useEmailStore.setState({
      emails: [makeEmail('a'), makeEmail('b'), makeEmail('c'), makeEmail('d'), makeEmail('e')],
      selectedEmailIds: new Set(),
      lastSelectedEmailId: null,
      selectedEmail: null,
    });
  });

  describe('toggleEmailSelection', () => {
    it('should add email to selection', () => {
      useEmailStore.getState().toggleEmailSelection('b');
      expect(useEmailStore.getState().selectedEmailIds.has('b')).toBe(true);
      expect(useEmailStore.getState().lastSelectedEmailId).toBe('b');
    });

    it('should remove email from selection when toggled again', () => {
      useEmailStore.getState().toggleEmailSelection('b');
      useEmailStore.getState().toggleEmailSelection('b');
      expect(useEmailStore.getState().selectedEmailIds.has('b')).toBe(false);
    });

    it('should support selecting multiple emails', () => {
      useEmailStore.getState().toggleEmailSelection('a');
      useEmailStore.getState().toggleEmailSelection('c');
      const ids = useEmailStore.getState().selectedEmailIds;
      expect(ids.has('a')).toBe(true);
      expect(ids.has('c')).toBe(true);
      expect(ids.size).toBe(2);
    });
  });

  describe('selectRangeEmails', () => {
    it('should select range from last selected to target (forward)', () => {
      useEmailStore.getState().toggleEmailSelection('b'); // anchor at index 1
      useEmailStore.getState().selectRangeEmails('d'); // target at index 3
      const ids = useEmailStore.getState().selectedEmailIds;
      expect(ids.has('b')).toBe(true);
      expect(ids.has('c')).toBe(true);
      expect(ids.has('d')).toBe(true);
      expect(ids.size).toBe(3);
    });

    it('should select range backward', () => {
      useEmailStore.getState().toggleEmailSelection('d'); // anchor at index 3
      useEmailStore.getState().selectRangeEmails('b'); // target at index 1
      const ids = useEmailStore.getState().selectedEmailIds;
      expect(ids.has('b')).toBe(true);
      expect(ids.has('c')).toBe(true);
      expect(ids.has('d')).toBe(true);
      expect(ids.size).toBe(3);
    });

    it('should use first email as anchor when no previous selection', () => {
      useEmailStore.getState().selectRangeEmails('c'); // no anchor → uses first email 'a'
      const ids = useEmailStore.getState().selectedEmailIds;
      expect(ids.has('a')).toBe(true);
      expect(ids.has('b')).toBe(true);
      expect(ids.has('c')).toBe(true);
      expect(ids.size).toBe(3);
    });

    it('should add to existing selection', () => {
      useEmailStore.getState().toggleEmailSelection('a');
      useEmailStore.getState().toggleEmailSelection('b'); // anchor now at 'b'
      useEmailStore.getState().selectRangeEmails('d');
      const ids = useEmailStore.getState().selectedEmailIds;
      // 'a' still selected, plus b-d range
      expect(ids.has('a')).toBe(true);
      expect(ids.has('b')).toBe(true);
      expect(ids.has('c')).toBe(true);
      expect(ids.has('d')).toBe(true);
      expect(ids.size).toBe(4);
    });

    it('should handle single-item range', () => {
      useEmailStore.getState().toggleEmailSelection('c');
      useEmailStore.getState().selectRangeEmails('c');
      const ids = useEmailStore.getState().selectedEmailIds;
      expect(ids.has('c')).toBe(true);
      expect(ids.size).toBe(1);
    });
  });

  describe('selectAllEmails', () => {
    it('should select all emails', () => {
      useEmailStore.getState().selectAllEmails();
      expect(useEmailStore.getState().selectedEmailIds.size).toBe(5);
    });
  });

  describe('clearSelection', () => {
    it('should clear all selections and reset anchor', () => {
      useEmailStore.getState().toggleEmailSelection('a');
      useEmailStore.getState().toggleEmailSelection('b');
      useEmailStore.getState().clearSelection();
      expect(useEmailStore.getState().selectedEmailIds.size).toBe(0);
      expect(useEmailStore.getState().lastSelectedEmailId).toBeNull();
    });
  });
});
