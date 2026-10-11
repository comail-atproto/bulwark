import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildForwardAsAttachmentPayload } from '@/lib/forward-as-attachment';
import type { Email } from '@/lib/jmap/types';

// Pin TZ so the local-time date rendering in the filename test is deterministic,
// restoring it after so this doesn't leak into other test files in the same worker.
let originalTZ: string | undefined;
beforeAll(() => {
  originalTZ = process.env.TZ;
  process.env.TZ = 'UTC';
});
afterAll(() => {
  // process.env coerces to strings, so `= undefined` would leave the literal
  // string "undefined" behind when TZ was originally unset - delete instead.
  if (originalTZ === undefined) delete process.env.TZ;
  else process.env.TZ = originalTZ;
});

function makeEmail(overrides: Partial<Email> = {}): Email {
  return {
    id: 'e1',
    threadId: 't1',
    mailboxIds: { inbox: true },
    keywords: {},
    size: 12345,
    receivedAt: '2026-07-26T22:25:22Z',
    subject: 'Your waste service day is changing',
    hasAttachment: false,
    blobId: 'blob123',
    ...overrides,
  };
}

describe('buildForwardAsAttachmentPayload', () => {
  it('returns null when the email has no blobId', () => {
    const email = makeEmail({ blobId: undefined });
    expect(buildForwardAsAttachmentPayload(email, 'Fwd:')).toBeNull();
  });

  it('prefixes the subject using the given forward prefix', () => {
    const email = makeEmail({ subject: 'Missed spam example' });
    const payload = buildForwardAsAttachmentPayload(email, 'Fwd:');
    expect(payload?.subject).toBe('Fwd: Missed spam example');
  });

  it('builds a message/rfc822 attachment referencing the email\'s own blobId, not a new upload', () => {
    const email = makeEmail({ blobId: 'the-real-blob-id', size: 26489 });
    const payload = buildForwardAsAttachmentPayload(email, 'Fwd:');
    expect(payload?.attachment).toEqual({
      blobId: 'the-real-blob-id',
      name: expect.stringMatching(/\.eml$/),
      type: 'message/rfc822',
      size: 26489,
    });
  });

  it('is idempotent - repeated forwarding does not stack prefixes', () => {
    const email = makeEmail({ subject: 'Fwd: already forwarded once' });
    const payload = buildForwardAsAttachmentPayload(email, 'Fwd:');
    expect(payload?.subject).toBe('Fwd: already forwarded once');
  });

  it('leaves the subject blank (not just the bare prefix) for a subject-less message, matching normal Forward', () => {
    const email = makeEmail({ subject: undefined });
    const payload = buildForwardAsAttachmentPayload(email, 'Fwd:');
    expect(payload?.subject).toBe('');
  });

  it('applies user space/case transforms but ignores a custom filename template, unlike "Export as .eml"', () => {
    const email = makeEmail({ subject: 'Missed spam example' });
    const payload = buildForwardAsAttachmentPayload(email, 'Fwd:', {
      template: 'custom-{subject}',
      lowercase: true,
      spaceReplacement: 'dash',
    });
    expect(payload?.attachment.name).toBe('2026-07-26-22.25.22-missed-spam-example.eml');
  });

  it('uses a dash between date and subject by default', () => {
    const email = makeEmail({ subject: 'Missed spam example' });
    const payload = buildForwardAsAttachmentPayload(email, 'Fwd:');
    expect(payload?.attachment.name).toBe('2026-07-26 22.25.22-Missed spam example.eml');
  });

  it('never includes from/to in the filename, even with the default template, to avoid leaking names to the recipient', () => {
    const email = makeEmail({
      subject: 'Missed spam example',
      from: [{ name: 'Alice Sender', email: 'alice@example.com' }],
      to: [{ name: "'Bobby'", email: 'bob@example.com' }],
    });
    const payload = buildForwardAsAttachmentPayload(email, 'Fwd:');
    expect(payload?.attachment.name).not.toContain('Alice');
    expect(payload?.attachment.name).not.toContain('Bobby');
  });
});
