import { describe, it, expect } from 'vitest';
import {
  computeReplyThreadingHeaders,
  stripMessageIdBrackets,
} from '../email-threading';

describe('stripMessageIdBrackets', () => {
  it('strips surrounding angle brackets', () => {
    expect(stripMessageIdBrackets('<abc@example.com>')).toBe('abc@example.com');
  });

  it('handles whitespace and missing brackets', () => {
    expect(stripMessageIdBrackets('  abc@example.com  ')).toBe('abc@example.com');
    expect(stripMessageIdBrackets('<abc@example.com')).toBe('abc@example.com');
    expect(stripMessageIdBrackets('abc@example.com>')).toBe('abc@example.com');
  });
});

describe('computeReplyThreadingHeaders', () => {
  it('returns null when the parent has no Message-ID', () => {
    expect(computeReplyThreadingHeaders(undefined)).toBeNull();
    expect(computeReplyThreadingHeaders({})).toBeNull();
    expect(computeReplyThreadingHeaders({ messageId: '' })).toBeNull();
    expect(computeReplyThreadingHeaders({ messageId: '   ' })).toBeNull();
  });

  it('sets In-Reply-To to the parent Message-ID and seeds References with it', () => {
    const result = computeReplyThreadingHeaders({
      messageId: '<root@example.com>',
    });
    expect(result).toEqual({
      inReplyTo: ['root@example.com'],
      references: ['root@example.com'],
    });
  });

  it('appends the parent to existing References per RFC 5322', () => {
    const result = computeReplyThreadingHeaders({
      messageId: '<msg-2@example.com>',
      references: ['<msg-0@example.com>', '<msg-1@example.com>'],
    });
    expect(result).toEqual({
      inReplyTo: ['msg-2@example.com'],
      references: ['msg-0@example.com', 'msg-1@example.com', 'msg-2@example.com'],
    });
  });

  it('de-duplicates if the parent already appears in References', () => {
    const result = computeReplyThreadingHeaders({
      messageId: '<msg-1@example.com>',
      references: ['<msg-0@example.com>', '<msg-1@example.com>'],
    });
    expect(result?.references).toEqual([
      'msg-0@example.com',
      'msg-1@example.com',
    ]);
  });

  it('accepts bare Message-IDs without angle brackets', () => {
    const result = computeReplyThreadingHeaders({
      messageId: 'msg-2@example.com',
      references: ['msg-1@example.com'],
    });
    expect(result).toEqual({
      inReplyTo: ['msg-2@example.com'],
      references: ['msg-1@example.com', 'msg-2@example.com'],
    });
  });

  // JMAP RFC 8621 §4.1.2.3 returns messageId as String[]|null. Verify we
  // don't crash on that shape even though most call sites pass a string.
  it('accepts an array-shaped messageId per JMAP spec', () => {
    const result = computeReplyThreadingHeaders({
      messageId: ['<msg-2@example.com>'],
      references: ['<msg-1@example.com>'],
    });
    expect(result).toEqual({
      inReplyTo: ['msg-2@example.com'],
      references: ['msg-1@example.com', 'msg-2@example.com'],
    });
  });

  it('returns null for an empty messageId array', () => {
    expect(computeReplyThreadingHeaders({ messageId: [] })).toBeNull();
  });
});
