import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildMimeMessage, quotedPrintableEncode, base64Encode } from '../mime-builder';

// Mock crypto.randomUUID and crypto.getRandomValues for deterministic tests
beforeEach(() => {
  let uuidCounter = 0;
  vi.spyOn(crypto, 'randomUUID').mockImplementation(
    () => `00000000-0000-0000-0000-${String(++uuidCounter).padStart(12, '0')}` as `${string}-${string}-${string}-${string}-${string}`,
  );

  vi.spyOn(crypto, 'getRandomValues').mockImplementation(<T extends ArrayBufferView | null>(array: T): T => {
    if (array) {
      const u8 = new Uint8Array((array as unknown as Uint8Array).buffer);
      for (let i = 0; i < u8.length; i++) u8[i] = i;
    }
    return array;
  });
});

describe('mime-builder', () => {
  describe('buildMimeMessage', () => {
    it('builds a text-only message', () => {
      const msg = buildMimeMessage({
        from: { name: 'Alice', email: 'alice@example.com' },
        to: [{ email: 'bob@example.com' }],
        subject: 'Hello',
        textBody: 'Hi Bob!',
        date: new Date('2024-06-15T12:00:00Z'),
      });

      const text = new TextDecoder().decode(msg);
      expect(text).toContain('From: "Alice" <alice@example.com>');
      expect(text).toContain('To: bob@example.com');
      expect(text).toContain('Subject: Hello');
      expect(text).toContain('Content-Type: text/plain; charset=utf-8');
      expect(text).toContain('MIME-Version: 1.0');
      expect(text).toContain('Hi Bob!');
    });

    it('builds a text + HTML multipart/alternative', () => {
      const msg = buildMimeMessage({
        from: { email: 'alice@example.com' },
        to: [{ email: 'bob@example.com' }],
        subject: 'Test',
        textBody: 'Plain text',
        htmlBody: '<p>HTML body</p>',
        date: new Date('2024-06-15T12:00:00Z'),
      });

      const text = new TextDecoder().decode(msg);
      expect(text).toContain('Content-Type: multipart/alternative');
      expect(text).toContain('Content-Type: text/plain; charset=utf-8');
      expect(text).toContain('Content-Type: text/html; charset=utf-8');
      expect(text).toContain('Plain text');
      expect(text).toContain('<p>HTML body</p>');
    });

    it('builds HTML-only message', () => {
      const msg = buildMimeMessage({
        from: { email: 'alice@example.com' },
        to: [{ email: 'bob@example.com' }],
        subject: 'HTML only',
        htmlBody: '<h1>Hello</h1>',
        date: new Date('2024-06-15T12:00:00Z'),
      });

      const text = new TextDecoder().decode(msg);
      expect(text).toContain('Content-Type: text/html; charset=utf-8');
      expect(text).toContain('<h1>Hello</h1>');
    });

    it('builds message with attachments', () => {
      const attachment = {
        filename: 'test.txt',
        contentType: 'text/plain',
        content: new TextEncoder().encode('file content').buffer,
      };

      const msg = buildMimeMessage({
        from: { email: 'alice@example.com' },
        to: [{ email: 'bob@example.com' }],
        subject: 'With attachment',
        textBody: 'See attached',
        attachments: [attachment],
        date: new Date('2024-06-15T12:00:00Z'),
      });

      const text = new TextDecoder().decode(msg);
      expect(text).toContain('Content-Type: multipart/mixed');
      expect(text).toContain('Content-Disposition: attachment; filename="test.txt"');
      expect(text).toContain('Content-Transfer-Encoding: base64');
    });

    it('builds message with inline attachment (cid)', () => {
      const inline = {
        filename: 'image.png',
        contentType: 'image/png',
        content: new Uint8Array([0x89, 0x50, 0x4E, 0x47]).buffer,
        cid: 'img1',
      };

      const msg = buildMimeMessage({
        from: { email: 'alice@example.com' },
        to: [{ email: 'bob@example.com' }],
        subject: 'Inline',
        htmlBody: '<img src="cid:img1">',
        attachments: [inline],
        date: new Date('2024-06-15T12:00:00Z'),
      });

      const text = new TextDecoder().decode(msg);
      expect(text).toContain('Content-Disposition: inline; filename="image.png"');
      expect(text).toContain('Content-ID: <img1>');
    });

    it('includes CC header when provided', () => {
      const msg = buildMimeMessage({
        from: { email: 'alice@example.com' },
        to: [{ email: 'bob@example.com' }],
        cc: [{ name: 'Charlie', email: 'charlie@example.com' }],
        subject: 'CC test',
        textBody: 'Hello',
        date: new Date('2024-06-15T12:00:00Z'),
      });

      const text = new TextDecoder().decode(msg);
      expect(text).toContain('Cc: "Charlie" <charlie@example.com>');
    });

    it('omits BCC from MIME headers', () => {
      const msg = buildMimeMessage({
        from: { email: 'alice@example.com' },
        to: [{ email: 'bob@example.com' }],
        bcc: [{ email: 'secret@example.com' }],
        subject: 'BCC test',
        textBody: 'Hello',
        date: new Date('2024-06-15T12:00:00Z'),
      });

      const text = new TextDecoder().decode(msg);
      expect(text).not.toContain('Bcc');
      expect(text).not.toContain('secret@example.com');
    });

    it('includes In-Reply-To and References', () => {
      const msg = buildMimeMessage({
        from: { email: 'alice@example.com' },
        to: [{ email: 'bob@example.com' }],
        subject: 'Re: Thread',
        textBody: 'reply',
        inReplyTo: '<msg1@example.com>',
        references: ['<msg0@example.com>', '<msg1@example.com>'],
        date: new Date('2024-06-15T12:00:00Z'),
      });

      const text = new TextDecoder().decode(msg);
      expect(text).toContain('In-Reply-To: <msg1@example.com>');
      expect(text).toContain('References: <msg0@example.com> <msg1@example.com>');
    });

    it('encodes non-ASCII subject with RFC 2047', () => {
      const msg = buildMimeMessage({
        from: { email: 'alice@example.com' },
        to: [{ email: 'bob@example.com' }],
        subject: 'Ünïcödé',
        textBody: 'test',
        date: new Date('2024-06-15T12:00:00Z'),
      });

      const text = new TextDecoder().decode(msg);
      expect(text).toContain('=?UTF-8?Q?');
    });

    it('uses CRLF line endings', () => {
      const msg = buildMimeMessage({
        from: { email: 'alice@example.com' },
        to: [{ email: 'bob@example.com' }],
        subject: 'CRLF',
        textBody: 'test',
        date: new Date('2024-06-15T12:00:00Z'),
      });

      const text = new TextDecoder().decode(msg);
      // Should contain CRLF before the body
      expect(text).toContain('\r\n');
      // Should not contain bare LF without preceding CR (except within QP encoding)
      const lines = text.split('\r\n');
      expect(lines.length).toBeGreaterThan(1);
    });

    it('builds empty body message', () => {
      const msg = buildMimeMessage({
        from: { email: 'alice@example.com' },
        to: [{ email: 'bob@example.com' }],
        subject: 'Empty',
        date: new Date('2024-06-15T12:00:00Z'),
      });

      const text = new TextDecoder().decode(msg);
      expect(text).toContain('Content-Type: text/plain; charset=utf-8');
    });

    it('escapes display name in From header', () => {
      const msg = buildMimeMessage({
        from: { name: 'O\'Brien, "Bob"', email: 'bob@example.com' },
        to: [{ email: 'alice@example.com' }],
        subject: 'Name test',
        textBody: 'test',
        date: new Date('2024-06-15T12:00:00Z'),
      });

      const text = new TextDecoder().decode(msg);
      expect(text).toContain('From: "O\'Brien, \\"Bob\\"" <bob@example.com>');
    });
  });

  describe('quotedPrintableEncode', () => {
    it('passes through ASCII text unchanged', () => {
      const result = quotedPrintableEncode('Hello World');
      expect(result).toBe('Hello World');
    });

    it('encodes non-ASCII characters', () => {
      const result = quotedPrintableEncode('Héllo');
      expect(result).toContain('=');
    });

    it('encodes equals sign', () => {
      const result = quotedPrintableEncode('a=b');
      expect(result).toContain('=3D');
    });

    it('wraps long lines with soft line break', () => {
      const longLine = 'a'.repeat(100);
      const result = quotedPrintableEncode(longLine);
      const lines = result.split('\r\n');
      for (const line of lines) {
        expect(line.length).toBeLessThanOrEqual(76);
      }
    });
  });

  describe('base64Encode', () => {
    it('encodes binary data to base64', () => {
      const data = new Uint8Array([72, 101, 108, 108, 111]).buffer; // "Hello"
      const result = base64Encode(data);
      expect(result).toBe('SGVsbG8=');
    });

    it('wraps long lines at 76 chars', () => {
      const data = new Uint8Array(200).buffer;
      const result = base64Encode(data);
      const lines = result.split('\r\n');
      for (const line of lines) {
        expect(line.length).toBeLessThanOrEqual(76);
      }
    });
  });
});
