import { describe, expect, it } from 'vitest';
import { buildMime } from '@/lib/mail-import/pst/mime';
import { parsePrivateMail } from '../mime';
import type { MailState } from '../wire';

const state: MailState = { logicalMessageId: 'mail-1', snapshotId: 'snapshot-1', version: 'version-1', mailboxIds: ['inbox'], keywords: ['$seen', '$flagged'], deletePending: false, tombstone: false, heads: ['head-1'], headsDigest: 'heads', stateDigest: 'state', height: 1, revisionCount: 1 };

describe('private RFC 5322 mail', () => {
  it('keeps the sender Date separate from the stored delivery time', async () => {
    const raw = new TextEncoder().encode('From: sender@example.test\r\nDate: Tue, 10 Nov 2026 12:00:00 +0000\r\nSubject: Times\r\n\r\nBody');
    const deliveredAt = '2026-11-10T13:00:00.123456789Z';
    const selected = await parsePrivateMail(raw, state, deliveredAt);
    expect(selected.email.sentAt).toBe('2026-11-10T12:00:00.000Z');
    expect(selected.email.receivedAt).toBe(deliveredAt);
    expect((await parsePrivateMail(raw, state)).email.receivedAt).toBe('');
  });

  it('preserves raw bytes, rich bodies, threading and attachment bytes for existing email components', async () => {
    const bytes = new Uint8Array([0, 255, 42, 13, 10]);
    const raw = buildMime({ from: { name: 'Synthetic sender', email: 'sender@example.test' }, to: [{ email: 'reader@example.test' }], cc: [], bcc: [],
      subject: 'A synthetic message — ✓', date: new Date('2026-11-10T12:00:00Z'), messageId: 'message@example.test', inReplyTo: 'parent@example.test',
      text: 'Plain body', html: '<p>Rich body<img src="cid:picture"></p>',
      attachments: [{ filename: 'binary.bin', mimeType: 'application/octet-stream', data: bytes }, { filename: 'picture.png', mimeType: 'image/png', contentId: 'picture', data: bytes }],
    }, { boundarySeed: 'synthetic' });
    const parsed = await parsePrivateMail(raw, state);
    expect(parsed.email).toMatchObject({ id: 'mail-1', mailboxIds: { inbox: true }, keywords: { $seen: true, $flagged: true }, subject: 'A synthetic message — ✓', messageId: 'message@example.test', inReplyTo: ['parent@example.test'], hasAttachment: true });
    expect(Object.values(parsed.email.bodyValues!).map(body => body.value)).toEqual(expect.arrayContaining(['Plain body', '<p>Rich body<img src="cid:picture"></p>']));
    expect(Array.from(new Uint8Array(await parsed.blobs.get(parsed.email.blobId!)!.arrayBuffer()))).toEqual(Array.from(raw));
    const binary = parsed.email.attachments!.find(part => part.name === 'binary.bin')!;
    expect(Array.from(new Uint8Array(await parsed.blobs.get(binary.blobId)!.arrayBuffer()))).toEqual(Array.from(bytes));
    expect(parsed.email.attachments!.find(part => part.cid === 'picture')).toMatchObject({ disposition: 'inline' });
  });

  it('keeps duplicate headers and address groups without trusting HTML', async () => {
    const raw = new TextEncoder().encode('From: sender@example.test\r\nTo: Team: first@example.test, second@example.test;\r\nSubject: Synthetic\r\nX-Test: first\r\nX-Test: second\r\nContent-Type: text/html; charset=utf-8\r\n\r\n<script>unsafe()</script><p>Body</p>');
    const { email } = await parsePrivateMail(raw, state);
    expect(email.to?.map(address => address.email)).toEqual(['first@example.test', 'second@example.test']);
    expect(email.headers?.['x-test']).toEqual(['first', 'second']);
    // Rendering retains the existing sanitizer boundary; MIME parsing does not render HTML.
    expect(Object.values(email.bodyValues!).some(body => body.value.includes('<script>'))).toBe(true);
  });
});
