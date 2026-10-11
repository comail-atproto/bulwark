import { describe, it, expect } from 'vitest';
import 'fake-indexeddb/auto';

// Each test file gets a fresh global indexedDB via fake-indexeddb/auto.
// Since openDB() caches connections implicitly, we re-import the module for each test.
// However, to keep it simple, we'll just test in order and accept cumulative state,
// or we can test with unique IDs.

import {
  saveKeyRecord,
  getKeyRecord,
  getKeyRecordForEmail,
  listKeyRecords,
  deleteKeyRecord,
  savePublicCert,
  getPublicCertForEmail,
  listPublicCerts,
  deletePublicCert,
} from '../key-storage';
import type { SmimeKeyRecord, SmimePublicCert } from '../types';

function makeKeyRecord(overrides: Partial<SmimeKeyRecord> = {}): SmimeKeyRecord {
  return {
    id: 'key-1',
    email: 'user@example.com',
    certificate: new ArrayBuffer(10),
    certificateChain: [],
    encryptedPrivateKey: new ArrayBuffer(32),
    salt: new ArrayBuffer(16),
    iv: new ArrayBuffer(12),
    kdfIterations: 600000,
    issuer: 'CN=Test CA',
    subject: 'CN=Test User',
    serialNumber: '01',
    notBefore: '2024-01-01T00:00:00Z',
    notAfter: '2030-12-31T23:59:59Z',
    fingerprint: 'aa:bb:cc',
    algorithm: 'RSA-2048',
    capabilities: { canSign: true, canEncrypt: true },
    ...overrides,
  };
}

function makePublicCert(overrides: Partial<SmimePublicCert> = {}): SmimePublicCert {
  return {
    id: 'cert-1',
    email: 'recipient@example.com',
    certificate: new ArrayBuffer(10),
    issuer: 'CN=Test CA',
    subject: 'CN=Recipient',
    notBefore: '2024-01-01T00:00:00Z',
    notAfter: '2030-12-31T23:59:59Z',
    fingerprint: 'dd:ee:ff',
    source: 'manual',
    ...overrides,
  };
}

// Use unique IDs for each test to avoid state leakage
let testCounter = 0;
function uid() { return `test-${++testCounter}-${Date.now()}`; }

describe('key-storage', () => {
  describe('key records', () => {
    it('saves and retrieves a key record by id', async () => {
      const id = uid();
      const record = makeKeyRecord({ id });
      await saveKeyRecord(record);
      const retrieved = await getKeyRecord(id);
      expect(retrieved).toBeDefined();
      expect(retrieved!.id).toBe(id);
      expect(retrieved!.email).toBe('user@example.com');
    });

    it('returns undefined for non-existent key record', async () => {
      const result = await getKeyRecord('absolutely-non-existent-' + uid());
      expect(result).toBeUndefined();
    });

    it('retrieves key record by email', async () => {
      const id = uid();
      const email = `alice-${id}@example.com`;
      const record = makeKeyRecord({ id, email });
      await saveKeyRecord(record);
      const result = await getKeyRecordForEmail(email);
      expect(result).toBeDefined();
      expect(result!.email).toBe(email);
    });

    it('lists key records (includes previously saved)', async () => {
      const id1 = uid();
      const id2 = uid();
      await saveKeyRecord(makeKeyRecord({ id: id1, email: `${id1}@example.com` }));
      await saveKeyRecord(makeKeyRecord({ id: id2, email: `${id2}@example.com` }));
      const records = await listKeyRecords();
      expect(records.length).toBeGreaterThanOrEqual(2);
      expect(records.find(r => r.id === id1)).toBeDefined();
      expect(records.find(r => r.id === id2)).toBeDefined();
    });

    it('deletes a key record', async () => {
      const id = uid();
      const record = makeKeyRecord({ id });
      await saveKeyRecord(record);
      await deleteKeyRecord(id);
      const result = await getKeyRecord(id);
      expect(result).toBeUndefined();
    });

    it('updates existing record with same id', async () => {
      const id = uid();
      const record1 = makeKeyRecord({ id, email: 'old@example.com' });
      await saveKeyRecord(record1);
      const record2 = makeKeyRecord({ id, email: 'new@example.com' });
      await saveKeyRecord(record2);
      const retrieved = await getKeyRecord(id);
      expect(retrieved!.email).toBe('new@example.com');
    });
  });

  describe('public certs', () => {
    it('saves and retrieves by email', async () => {
      const id = uid();
      const email = `recipient-${id}@example.com`;
      const cert = makePublicCert({ id, email });
      await savePublicCert(cert);
      const result = await getPublicCertForEmail(email);
      expect(result).toBeDefined();
      expect(result!.email).toBe(email);
    });

    it('lists public certs (includes previously saved)', async () => {
      const id1 = uid();
      const id2 = uid();
      await savePublicCert(makePublicCert({ id: id1, email: `${id1}@test.com` }));
      await savePublicCert(makePublicCert({ id: id2, email: `${id2}@test.com` }));
      const certs = await listPublicCerts();
      expect(certs.find(c => c.id === id1)).toBeDefined();
      expect(certs.find(c => c.id === id2)).toBeDefined();
    });

    it('deletes a public cert', async () => {
      const id = uid();
      const cert = makePublicCert({ id });
      await savePublicCert(cert);
      await deletePublicCert(id);
      const certs = await listPublicCerts();
      expect(certs.find(c => c.id === id)).toBeUndefined();
    });
  });

  describe('accountId filtering', () => {
    it('listKeyRecords filters by accountId', async () => {
      const id1 = uid();
      const id2 = uid();
      await saveKeyRecord(makeKeyRecord({ id: id1, email: `${id1}@a.com`, accountId: 'acct-1' }));
      await saveKeyRecord(makeKeyRecord({ id: id2, email: `${id2}@b.com`, accountId: 'acct-2' }));

      const acct1Records = await listKeyRecords('acct-1');
      expect(acct1Records.find(r => r.id === id1)).toBeDefined();
      expect(acct1Records.find(r => r.id === id2)).toBeUndefined();
    });

    it('listKeyRecords includes records without accountId when filtering', async () => {
      const id1 = uid();
      const id2 = uid();
      await saveKeyRecord(makeKeyRecord({ id: id1, email: `${id1}@a.com` }));
      await saveKeyRecord(makeKeyRecord({ id: id2, email: `${id2}@b.com`, accountId: 'acct-1' }));

      const acct1Records = await listKeyRecords('acct-1');
      expect(acct1Records.find(r => r.id === id1)).toBeDefined();
      expect(acct1Records.find(r => r.id === id2)).toBeDefined();
    });

    it('listPublicCerts filters by accountId', async () => {
      const id1 = uid();
      const id2 = uid();
      await savePublicCert(makePublicCert({ id: id1, email: `${id1}@a.com`, accountId: 'acct-1' }));
      await savePublicCert(makePublicCert({ id: id2, email: `${id2}@b.com`, accountId: 'acct-2' }));

      const acct1Certs = await listPublicCerts('acct-1');
      expect(acct1Certs.find(c => c.id === id1)).toBeDefined();
      expect(acct1Certs.find(c => c.id === id2)).toBeUndefined();
    });

    it('listPublicCerts includes certs without accountId when filtering', async () => {
      const id1 = uid();
      const id2 = uid();
      await savePublicCert(makePublicCert({ id: id1, email: `${id1}@a.com` }));
      await savePublicCert(makePublicCert({ id: id2, email: `${id2}@b.com`, accountId: 'acct-1' }));

      const acct1Certs = await listPublicCerts('acct-1');
      expect(acct1Certs.find(c => c.id === id1)).toBeDefined();
      expect(acct1Certs.find(c => c.id === id2)).toBeDefined();
    });
  });
});
