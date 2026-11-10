import type { Recipient } from '@/lib/email-composer-utils';

export type RecipientField = 'to' | 'cc' | 'bcc';
export const RECIPIENT_FIELDS: readonly RecipientField[] = ['to', 'cc', 'bcc'];

export type RecipientFields = Record<RecipientField, Recipient[]>;

/** What a screen reader hears after the recipients changed. */
export type RecipientChange =
  | { kind: 'added' | 'removed'; field: RecipientField; names: string[] }
  | { kind: 'moved'; field: RecipientField; names: string[] };

/** The name a chip is spoken by: its display name, else its address. */
export function recipientDisplayName(recipient: Recipient): string {
  return recipient.name?.trim() || recipient.email;
}

function recipientKey(recipient: Recipient): string {
  if (recipient.group) {
    return `group:${recipient.name ?? ''}:${recipient.group.members.map((m) => m.email.toLowerCase()).join(',')}`;
  }
  return recipient.email.trim().toLowerCase();
}

/**
 * The recipients added to, removed from or moved between To, Cc and Bcc from
 * one state to the next. A recipient that left one field and arrived in
 * another counts as moved. Plugin enrichment (colours, icons) and reordering
 * change nothing.
 */
export function describeRecipientChanges(prev: RecipientFields, next: RecipientFields): RecipientChange[] {
  const removed: Array<{ key: string; field: RecipientField; name: string }> = [];
  const added: Array<{ key: string; field: RecipientField; name: string }> = [];

  for (const field of RECIPIENT_FIELDS) {
    const before = new Map<string, Recipient[]>();
    for (const r of prev[field]) {
      const key = recipientKey(r);
      before.set(key, [...(before.get(key) ?? []), r]);
    }
    for (const r of next[field]) {
      const key = recipientKey(r);
      const left = before.get(key);
      if (left && left.length > 0) left.pop();
      else added.push({ key, field, name: recipientDisplayName(r) });
    }
    for (const [key, left] of before) {
      for (const r of left) removed.push({ key, field, name: recipientDisplayName(r) });
    }
  }

  const changes: RecipientChange[] = [];
  const push = (kind: RecipientChange['kind'], field: RecipientField, name: string) => {
    const last = changes.find((c) => c.kind === kind && c.field === field);
    if (last) last.names.push(name);
    else changes.push({ kind, field, names: [name] });
  };

  for (const a of added) {
    const from = removed.findIndex((r) => r.key === a.key && r.field !== a.field);
    if (from !== -1) {
      removed.splice(from, 1);
      push('moved', a.field, a.name);
    } else {
      push('added', a.field, a.name);
    }
  }
  for (const r of removed) push('removed', r.field, r.name);
  return changes;
}
