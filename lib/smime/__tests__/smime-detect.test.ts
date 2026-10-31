import { describe, it, expect } from 'vitest';
import { detectSmime } from '../smime-detect';

describe('detectSmime', () => {
  describe('no S/MIME content', () => {
    it('returns null type when no arguments provided', () => {
      const result = detectSmime();
      expect(result.type).toBeNull();
      expect(result.supported).toBe(false);
    });

    it('returns null type for plain text content', () => {
      const result = detectSmime('text/plain');
      expect(result.type).toBeNull();
      expect(result.supported).toBe(false);
    });

    it('returns null type for multipart/mixed without S/MIME', () => {
      const result = detectSmime('multipart/mixed; boundary="abc"');
      expect(result.type).toBeNull();
      expect(result.supported).toBe(false);
    });
  });

  describe('Content-Type header detection', () => {
    it('detects enveloped-data from Content-Type', () => {
      const ct = 'application/pkcs7-mime; smime-type=enveloped-data; name="smime.p7m"';
      const body = { partId: '1', blobId: 'blob1', type: ct };
      const result = detectSmime(ct, body);
      expect(result.type).toBe('enveloped-data');
      expect(result.supported).toBe(true);
      expect(result.blobId).toBe('blob1');
      expect(result.partId).toBe('1');
    });

    it('detects signed-data from Content-Type', () => {
      const ct = 'application/pkcs7-mime; smime-type=signed-data; name="smime.p7m"';
      const body = { partId: '2', blobId: 'blob2', type: ct };
      const result = detectSmime(ct, body);
      expect(result.type).toBe('signed-data');
      expect(result.supported).toBe(true);
      expect(result.blobId).toBe('blob2');
    });

    it('detects x-pkcs7-mime variant', () => {
      const ct = 'application/x-pkcs7-mime; smime-type=enveloped-data';
      const body = { partId: '1', blobId: 'blob1', type: ct };
      const result = detectSmime(ct, body);
      expect(result.type).toBe('enveloped-data');
      expect(result.supported).toBe(true);
    });

    it('detects detached signature via multipart/signed', () => {
      const ct = 'multipart/signed; protocol="application/pkcs7-signature"; micalg=sha-256';
      const result = detectSmime(ct);
      expect(result.type).toBe('detached-sig');
      expect(result.supported).toBe(false);
    });

    it('handles generic pkcs7-mime without smime-type', () => {
      const ct = 'application/pkcs7-mime; name="smime.p7m"';
      const body = { partId: '1', blobId: 'blob1', type: ct };
      const result = detectSmime(ct, body);
      // Should default to enveloped-data for generic pkcs7-mime
      expect(result.type).toBe('enveloped-data');
      expect(result.blobId).toBe('blob1');
    });

    it('is case-insensitive for Content-Type', () => {
      const ct = 'Application/PKCS7-MIME; smime-type=Enveloped-Data';
      const body = { partId: '1', blobId: 'b1', type: ct };
      const result = detectSmime(ct, body);
      expect(result.type).toBe('enveloped-data');
      expect(result.supported).toBe(true);
    });
  });

  describe('bodyStructure detection', () => {
    it('finds pkcs7-mime part in bodyStructure tree', () => {
      const body = {
        type: 'multipart/mixed',
        subParts: [
          { partId: '1', type: 'text/plain', blobId: 'text-blob' },
          {
            partId: '2',
            type: 'application/pkcs7-mime; smime-type=enveloped-data',
            blobId: 'cms-blob',
          },
        ],
      };
      const result = detectSmime(undefined, body);
      expect(result.type).toBe('enveloped-data');
      expect(result.supported).toBe(true);
      expect(result.blobId).toBe('cms-blob');
      expect(result.partId).toBe('2');
    });

    it('detects detached sig in multipart/signed bodyStructure', () => {
      const body = {
        type: 'multipart/signed',
        subParts: [
          { partId: '1', type: 'text/plain', blobId: 'text-blob' },
          { partId: '2', type: 'application/pkcs7-signature', blobId: 'sig-blob' },
        ],
      };
      const result = detectSmime(undefined, body);
      expect(result.type).toBe('detached-sig');
      expect(result.supported).toBe(false);
    });

    it('walks nested bodyStructure', () => {
      const body = {
        type: 'multipart/mixed',
        subParts: [
          {
            type: 'multipart/alternative',
            subParts: [
              { partId: '1.1', type: 'text/plain', blobId: 'txt' },
              { partId: '1.2', type: 'text/html', blobId: 'html' },
            ],
          },
          {
            partId: '2',
            type: 'application/pkcs7-mime; smime-type=signed-data',
            blobId: 'sig-blob',
          },
        ],
      };
      const result = detectSmime(undefined, body);
      expect(result.type).toBe('signed-data');
      expect(result.supported).toBe(true);
      expect(result.blobId).toBe('sig-blob');
    });
  });

  describe('attachment detection', () => {
    it('detects .p7m attachment', () => {
      const attachments = [
        { partId: '3', blobId: 'att-blob', name: 'message.p7m', type: 'application/octet-stream' },
      ];
      const result = detectSmime(undefined, null, attachments);
      expect(result.type).toBe('enveloped-data');
      expect(result.supported).toBe(true);
      expect(result.blobId).toBe('att-blob');
    });

    it('detects .p7s attachment as detached-sig', () => {
      const attachments = [
        { partId: '3', blobId: 'sig-blob', name: 'smime.p7s', type: 'application/octet-stream' },
      ];
      const result = detectSmime(undefined, null, attachments);
      expect(result.type).toBe('detached-sig');
      expect(result.supported).toBe(false);
    });

    it('detects pkcs7-mime attachment type', () => {
      const attachments = [
        {
          partId: '2',
          blobId: 'enc-blob',
          name: 'encrypted.bin',
          type: 'application/pkcs7-mime; smime-type=enveloped-data',
        },
      ];
      const result = detectSmime(undefined, null, attachments);
      expect(result.type).toBe('enveloped-data');
      expect(result.supported).toBe(true);
    });

    it('skips non-S/MIME attachments', () => {
      const attachments = [
        { partId: '2', blobId: 'pdf-blob', name: 'document.pdf', type: 'application/pdf' },
      ];
      const result = detectSmime(undefined, null, attachments);
      expect(result.type).toBeNull();
      expect(result.supported).toBe(false);
    });
  });

  describe('priority order', () => {
    it('Content-Type takes precedence over bodyStructure', () => {
      const ct = 'application/pkcs7-mime; smime-type=enveloped-data';
      const body = {
        partId: '1',
        blobId: 'from-ct',
        type: ct,
      };
      const result = detectSmime(ct, body);
      expect(result.type).toBe('enveloped-data');
      expect(result.blobId).toBe('from-ct');
    });
  });
});
