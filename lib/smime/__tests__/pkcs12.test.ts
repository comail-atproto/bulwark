// @vitest-environment node
import { describe, it, expect, beforeAll } from 'vitest';
import * as pkijs from 'pkijs';
import * as asn1js from 'asn1js';
import { importPkcs12, unlockPrivateKey, decryptPrivateKeyBytes } from '../pkcs12-import';
import { exportPkcs12 } from '../pkcs12-export';

const cryptoEngine = new pkijs.CryptoEngine({
  crypto: crypto,
  subtle: crypto.subtle,
  name: 'webcrypto',
});

function stringToAB(str: string): ArrayBuffer {
  const buf = new ArrayBuffer(str.length);
  const view = new Uint8Array(buf);
  for (let i = 0; i < str.length; i++) {
    view[i] = str.charCodeAt(i);
  }
  return buf;
}

/**
 * Build a minimal real PKCS#12 (.p12) blob for testing.
 */
async function buildTestP12(
  email: string,
  cn: string,
  p12Password: string,
): Promise<{ p12Bytes: ArrayBuffer; keyPair: globalThis.CryptoKeyPair; certDer: ArrayBuffer }> {
  // Generate RSA key pair (signing)
  const keyPair = await crypto.subtle.generateKey(
    {
      name: 'RSASSA-PKCS1-v1_5',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    true,
    ['sign', 'verify'],
  );

  // Self-signed certificate
  const cert = new pkijs.Certificate();
  cert.version = 2;
  cert.serialNumber = new asn1js.Integer({ value: 42 });

  cert.issuer.typesAndValues.push(
    new pkijs.AttributeTypeAndValue({
      type: '2.5.4.3',
      value: new asn1js.Utf8String({ value: cn }),
    }),
  );
  cert.subject.typesAndValues.push(
    new pkijs.AttributeTypeAndValue({
      type: '2.5.4.3',
      value: new asn1js.Utf8String({ value: cn }),
    }),
  );
  cert.subject.typesAndValues.push(
    new pkijs.AttributeTypeAndValue({
      type: '1.2.840.113549.1.9.1',
      value: new asn1js.IA5String({ value: email }),
    }),
  );
  cert.notBefore.value = new Date('2024-01-01T00:00:00Z');
  cert.notAfter.value = new Date('2030-12-31T23:59:59Z');

  await cert.subjectPublicKeyInfo.importKey(keyPair.publicKey, cryptoEngine);
  await cert.sign(keyPair.privateKey, 'SHA-256', cryptoEngine);

  const certDer = cert.toSchema(true).toBER(false);

  // Export private key as PKCS#8
  const pkcs8Bytes = await crypto.subtle.exportKey('pkcs8', keyPair.privateKey);

  // Build PKCS#12 structure
  const keyBag = new pkijs.PKCS8ShroudedKeyBag({
    parsedValue: pkijs.PrivateKeyInfo.fromBER(pkcs8Bytes),
  });

  const passwordBuf = stringToAB(p12Password);

  await keyBag.makeInternalValues({
    password: passwordBuf,
    contentEncryptionAlgorithm: {
      name: 'AES-CBC',
      length: 256,
    } as Parameters<typeof keyBag.makeInternalValues>[0]['contentEncryptionAlgorithm'],
    hmacHashAlgorithm: 'SHA-256',
    iterationCount: 2048,
  });

  const keyBagSafe = new pkijs.SafeBag({
    bagId: '1.2.840.113549.1.12.10.1.2',
    bagValue: keyBag,
  });

  const certBagSafe = new pkijs.SafeBag({
    bagId: '1.2.840.113549.1.12.10.1.3',
    bagValue: new pkijs.CertBag({ parsedValue: cert }),
  });

  const authenticatedSafe = new pkijs.AuthenticatedSafe({
    parsedValue: {
      safeContents: [
        { privacyMode: 0, value: new pkijs.SafeContents({ safeBags: [keyBagSafe] }) },
        { privacyMode: 0, value: new pkijs.SafeContents({ safeBags: [certBagSafe] }) },
      ],
    },
  });

  await authenticatedSafe.makeInternalValues({ safeContents: [{}, {}] });

  const pfx = new pkijs.PFX({
    parsedValue: {
      integrityMode: 0,
      authenticatedSafe,
    },
  });

  await pfx.makeInternalValues({
    password: passwordBuf,
    iterations: 2048,
    pbkdf2HashAlgorithm: 'SHA-256',
    hmacHashAlgorithm: 'SHA-256',
  });

  const p12Bytes = pfx.toSchema().toBER(false);
  return { p12Bytes, keyPair, certDer };
}

let testP12: Awaited<ReturnType<typeof buildTestP12>>;

beforeAll(async () => {
  pkijs.setEngine('test', crypto, cryptoEngine);
  testP12 = await buildTestP12('alice@example.com', 'Alice Test', 'p12pass');
});

describe('importPkcs12', () => {
  it('imports a valid PKCS#12 file and produces a key record', async () => {
    const result = await importPkcs12(testP12.p12Bytes, 'p12pass', 'storagepass');

    expect(result.keyRecord).toBeDefined();
    expect(result.keyRecord.email).toBe('alice@example.com');
    expect(result.keyRecord.subject).toContain('Alice Test');
    expect(result.keyRecord.certificate).toBeDefined();
    expect(result.keyRecord.encryptedPrivateKey.byteLength).toBeGreaterThan(0);
    expect(result.keyRecord.salt.byteLength).toBeGreaterThan(0);
    expect(result.keyRecord.iv.byteLength).toBeGreaterThan(0);
    expect(result.keyRecord.kdfIterations).toBe(600_000);
    expect(result.keyRecord.fingerprint).toBeTruthy();

    expect(result.certInfo).toBeDefined();
    expect(result.certInfo.emailAddresses).toContain('alice@example.com');
  });

  it('throws on invalid ASN.1 data', async () => {
    const garbage = new Uint8Array([0, 1, 2, 3]).buffer;
    await expect(importPkcs12(garbage, 'pass', 'store')).rejects.toThrow();
  });
});

describe('unlockPrivateKey', () => {
  it('unlocks and returns signing and decryption keys', async () => {
    const result = await importPkcs12(testP12.p12Bytes, 'p12pass', 'storagepass');
    const { signingKey, decryptionKey } = await unlockPrivateKey(result.keyRecord, 'storagepass');

    expect(signingKey).toBeDefined();
    expect(signingKey.type).toBe('private');
    expect(signingKey.extractable).toBe(false);

    expect(decryptionKey).toBeDefined();
    expect(decryptionKey!.type).toBe('private');
    expect(decryptionKey!.extractable).toBe(false);
  });

  it('throws on incorrect passphrase', async () => {
    const result = await importPkcs12(testP12.p12Bytes, 'p12pass', 'storagepass');
    await expect(unlockPrivateKey(result.keyRecord, 'wrongpass')).rejects.toThrow('Incorrect passphrase');
  });
});

describe('decryptPrivateKeyBytes', () => {
  it('returns raw PKCS#8 bytes', async () => {
    const result = await importPkcs12(testP12.p12Bytes, 'p12pass', 'storagepass');
    const pkcs8 = await decryptPrivateKeyBytes(result.keyRecord, 'storagepass');

    expect(pkcs8).toBeInstanceOf(ArrayBuffer);
    expect(pkcs8.byteLength).toBeGreaterThan(0);
  });

  it('throws on incorrect passphrase', async () => {
    const result = await importPkcs12(testP12.p12Bytes, 'p12pass', 'storagepass');
    await expect(decryptPrivateKeyBytes(result.keyRecord, 'bad')).rejects.toThrow('Incorrect passphrase');
  });
});

describe('exportPkcs12', () => {
  it('produces a valid PKCS#12 that can be re-imported', async () => {
    const imported = await importPkcs12(testP12.p12Bytes, 'p12pass', 'storagepass');

    // Export
    const p12Out = await exportPkcs12(imported.keyRecord, 'storagepass', 'exportpass');
    expect(p12Out).toBeInstanceOf(ArrayBuffer);
    expect(p12Out.byteLength).toBeGreaterThan(0);

    // Re-import
    const reimported = await importPkcs12(p12Out, 'exportpass', 'newstoragepass');
    expect(reimported.keyRecord.email).toBe('alice@example.com');
    expect(reimported.keyRecord.subject).toContain('Alice Test');
    expect(reimported.keyRecord.fingerprint).toBe(imported.keyRecord.fingerprint);
  });

  it('throws on incorrect storage passphrase', async () => {
    const imported = await importPkcs12(testP12.p12Bytes, 'p12pass', 'storagepass');
    await expect(exportPkcs12(imported.keyRecord, 'wrong', 'exportpass')).rejects.toThrow('Incorrect passphrase');
  });
});
