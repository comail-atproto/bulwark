import { describe, it, expect, beforeAll } from 'vitest';
import {
  pemToDer,
  derToPem,
  isPem,
  parseCertificateDer,
  parseCertificatePemOrDer,
  computeFingerprint,
  classifyCapabilities,
  extractCertificateInfo,
} from '../certificate-utils';
import * as pkijs from 'pkijs';
import * as asn1js from 'asn1js';

// Generate a self-signed test certificate using Web Crypto + pkijs
let testCertDer: ArrayBuffer;
let testCert: pkijs.Certificate;
let testKeyPair: globalThis.CryptoKeyPair;

beforeAll(async () => {
  const cryptoEngine = new pkijs.CryptoEngine({
    crypto: crypto,
    subtle: crypto.subtle,
    name: 'webcrypto',
  });
  pkijs.setEngine('test', crypto, cryptoEngine);

  // Generate RSA key pair
  testKeyPair = await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify'],
  );

  // Build a minimal self-signed X.509 certificate
  testCert = new pkijs.Certificate();
  testCert.version = 2; // v3
  testCert.serialNumber = new asn1js.Integer({ value: 1 });

  testCert.issuer.typesAndValues.push(new pkijs.AttributeTypeAndValue({
    type: '2.5.4.3', // CN
    value: new asn1js.Utf8String({ value: 'Test CA' }),
  }));

  testCert.subject.typesAndValues.push(new pkijs.AttributeTypeAndValue({
    type: '2.5.4.3', // CN
    value: new asn1js.Utf8String({ value: 'Test User' }),
  }));

  testCert.subject.typesAndValues.push(new pkijs.AttributeTypeAndValue({
    type: '1.2.840.113549.1.9.1', // emailAddress
    value: new asn1js.IA5String({ value: 'test@example.com' }),
  }));

  testCert.notBefore.value = new Date('2024-01-01T00:00:00Z');
  testCert.notAfter.value = new Date('2030-12-31T23:59:59Z');

  await testCert.subjectPublicKeyInfo.importKey(testKeyPair.publicKey, cryptoEngine);

  // Add KeyUsage extension: digitalSignature + keyEncipherment
  const bitArray = new ArrayBuffer(1);
  const bitView = new Uint8Array(bitArray);
  bitView[0] = 0b10100000; // digitalSignature (bit 0) + keyEncipherment (bit 2)

  testCert.extensions = [
    new pkijs.Extension({
      extnID: '2.5.29.15', // keyUsage
      critical: true,
      extnValue: new asn1js.OctetString({
        valueHex: new Uint8Array(new asn1js.BitString({
          valueHex: bitArray,
          unusedBits: 3,
        }).toBER(false)),
      }).toBER(false) as ArrayBuffer,
      parsedValue: {
        digitalSignature: true,
        contentCommitment: false,
        keyEncipherment: true,
        dataEncipherment: false,
        keyAgreement: false,
        keyCertSign: false,
        cRLSign: false,
        encipherOnly: false,
        decipherOnly: false,
      },
    }),
  ];

  await testCert.sign(testKeyPair.privateKey, 'SHA-256', cryptoEngine);

  // toBER may return a non-standard ArrayBuffer in jsdom; normalize it
  const rawDer = testCert.toSchema(true).toBER(false);
  testCertDer = new Uint8Array(rawDer).buffer;
});

describe('certificate-utils', () => {
  describe('pemToDer / derToPem roundtrip', () => {
    it('converts PEM to DER and back', () => {
      const pem = derToPem(testCertDer, 'CERTIFICATE');
      expect(pem).toContain('-----BEGIN CERTIFICATE-----');
      expect(pem).toContain('-----END CERTIFICATE-----');

      const der2 = pemToDer(pem);
      expect(new Uint8Array(der2)).toEqual(new Uint8Array(testCertDer));
    });

    it('derToPem wraps lines at 64 chars', () => {
      const pem = derToPem(testCertDer, 'CERTIFICATE');
      const lines = pem.split('\n');
      // All content lines (not headers) should be <= 64 chars
      for (const line of lines) {
        if (!line.startsWith('-----')) {
          expect(line.length).toBeLessThanOrEqual(64);
        }
      }
    });
  });

  describe('isPem', () => {
    it('returns true for certificate PEM', () => {
      expect(isPem('-----BEGIN CERTIFICATE-----\nMIIB...\n-----END CERTIFICATE-----')).toBe(true);
    });

    it('returns true for PKCS12 PEM', () => {
      expect(isPem('-----BEGIN PKCS12-----\ndata\n-----END PKCS12-----')).toBe(true);
    });

    it('returns true for private key PEM', () => {
      expect(isPem('-----BEGIN PRIVATE KEY-----\ndata\n-----END PRIVATE KEY-----')).toBe(true);
    });

    it('returns true for encrypted private key PEM', () => {
      expect(isPem('-----BEGIN ENCRYPTED PRIVATE KEY-----\ndata\n-----END ENCRYPTED PRIVATE KEY-----')).toBe(true);
    });

    it('returns false for non-PEM data', () => {
      expect(isPem('hello world')).toBe(false);
      expect(isPem('')).toBe(false);
      expect(isPem('MIIB...')).toBe(false);
    });
  });

  describe('parseCertificateDer', () => {
    it('parses a valid DER certificate', () => {
      const cert = parseCertificateDer(testCertDer);
      expect(cert).toBeInstanceOf(pkijs.Certificate);
    });

    it('throws on invalid DER data', () => {
      const garbage = new Uint8Array([0, 1, 2, 3]).buffer;
      expect(() => parseCertificateDer(garbage)).toThrow();
    });
  });

  describe('parseCertificatePemOrDer', () => {
    it('parses DER ArrayBuffer', () => {
      const cert = parseCertificatePemOrDer(testCertDer);
      expect(cert).toBeInstanceOf(pkijs.Certificate);
    });

    it('parses PEM string', () => {
      const pem = derToPem(testCertDer, 'CERTIFICATE');
      const cert = parseCertificatePemOrDer(pem);
      expect(cert).toBeInstanceOf(pkijs.Certificate);
    });

    it('throws on non-PEM string', () => {
      expect(() => parseCertificatePemOrDer('not a pem')).toThrow('String input is not PEM-encoded');
    });
  });

  describe('computeFingerprint', () => {
    it('returns hex fingerprint with colons', async () => {
      const fp = await computeFingerprint(testCertDer);
      expect(fp).toMatch(/^[0-9a-f]{2}(:[0-9a-f]{2}){31}$/);
    });

    it('is deterministic', async () => {
      const fp1 = await computeFingerprint(testCertDer);
      const fp2 = await computeFingerprint(testCertDer);
      expect(fp1).toBe(fp2);
    });
  });

  describe('classifyCapabilities', () => {
    it('detects sign + encrypt from KeyUsage', () => {
      const caps = classifyCapabilities(testCert);
      expect(caps.canSign).toBe(true);
      expect(caps.canEncrypt).toBe(true);
    });
  });

  describe('extractCertificateInfo', () => {
    it('extracts full certificate metadata', async () => {
      const info = await extractCertificateInfo(testCert, testCertDer);

      expect(info.subject).toContain('CN=Test User');
      expect(info.issuer).toContain('CN=Test CA');
      expect(info.notBefore).toBe('2024-01-01T00:00:00.000Z');
      expect(info.notAfter).toBe('2030-12-31T23:59:59.000Z');
      expect(info.fingerprint).toMatch(/^[0-9a-f]{2}(:[0-9a-f]{2}){31}$/);
      expect(info.algorithm).toMatch(/^RSA/);
      expect(info.emailAddresses).toContain('test@example.com');
      expect(info.capabilities.canSign).toBe(true);
      expect(info.capabilities.canEncrypt).toBe(true);
    });

    it('returns serialNumber as hex', async () => {
      const info = await extractCertificateInfo(testCert, testCertDer);
      // Serial number 1 → should be hex string
      expect(info.serialNumber).toBeTruthy();
    });
  });
});
