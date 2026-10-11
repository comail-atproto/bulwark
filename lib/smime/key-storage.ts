import type { SmimeKeyRecord, SmimePublicCert } from './types';

const DB_NAME = 'smime-store';
const DB_VERSION = 2;
const KEY_RECORDS_STORE = 'key-records';
const PUBLIC_CERTS_STORE = 'public-certs';

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (event) => {
      const db = request.result;
      const oldVersion = event.oldVersion;
      if (oldVersion < 1) {
        const keyStore = db.createObjectStore(KEY_RECORDS_STORE, { keyPath: 'id' });
        keyStore.createIndex('email', 'email', { unique: false });
        keyStore.createIndex('accountId', 'accountId', { unique: false });
        const certStore = db.createObjectStore(PUBLIC_CERTS_STORE, { keyPath: 'id' });
        certStore.createIndex('email', 'email', { unique: false });
        certStore.createIndex('accountId', 'accountId', { unique: false });
      }
      if (oldVersion >= 1 && oldVersion < 2) {
        // Add accountId index to existing stores
        const tx = request.transaction!;
        const keyStore = tx.objectStore(KEY_RECORDS_STORE);
        if (!keyStore.indexNames.contains('accountId')) {
          keyStore.createIndex('accountId', 'accountId', { unique: false });
        }
        const certStore = tx.objectStore(PUBLIC_CERTS_STORE);
        if (!certStore.indexNames.contains('accountId')) {
          certStore.createIndex('accountId', 'accountId', { unique: false });
        }
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function txPromise<T>(
  db: IDBDatabase,
  storeName: string,
  mode: globalThis.IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const store = tx.objectStore(storeName);
    const req = fn(store);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// ── Key record CRUD ─────────────────────────────────────────────────

export async function saveKeyRecord(record: SmimeKeyRecord): Promise<void> {
  const db = await openDB();
  await txPromise(db, KEY_RECORDS_STORE, 'readwrite', (s) => s.put(record));
}

export async function getKeyRecord(id: string): Promise<SmimeKeyRecord | undefined> {
  const db = await openDB();
  return txPromise(db, KEY_RECORDS_STORE, 'readonly', (s) => s.get(id));
}

export async function getKeyRecordForEmail(email: string): Promise<SmimeKeyRecord | undefined> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(KEY_RECORDS_STORE, 'readonly');
    const idx = tx.objectStore(KEY_RECORDS_STORE).index('email');
    const req = idx.get(email.toLowerCase());
    req.onsuccess = () => resolve(req.result ?? undefined);
    req.onerror = () => reject(req.error);
  });
}

export async function listKeyRecords(accountId?: string): Promise<SmimeKeyRecord[]> {
  const db = await openDB();
  const all = await txPromise<SmimeKeyRecord[]>(db, KEY_RECORDS_STORE, 'readonly', (s) => s.getAll());
  if (!accountId) return all;
  return all.filter((r) => r.accountId === accountId || !r.accountId);
}

export async function deleteKeyRecord(id: string): Promise<void> {
  const db = await openDB();
  await txPromise(db, KEY_RECORDS_STORE, 'readwrite', (s) => s.delete(id));
}

// ── Public cert CRUD ────────────────────────────────────────────────

export async function savePublicCert(cert: SmimePublicCert): Promise<void> {
  const db = await openDB();
  await txPromise(db, PUBLIC_CERTS_STORE, 'readwrite', (s) => s.put(cert));
}

export async function getPublicCertForEmail(email: string): Promise<SmimePublicCert | undefined> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(PUBLIC_CERTS_STORE, 'readonly');
    const idx = tx.objectStore(PUBLIC_CERTS_STORE).index('email');
    const req = idx.get(email.toLowerCase());
    req.onsuccess = () => resolve(req.result ?? undefined);
    req.onerror = () => reject(req.error);
  });
}

export async function listPublicCerts(accountId?: string): Promise<SmimePublicCert[]> {
  const db = await openDB();
  const all = await txPromise<SmimePublicCert[]>(db, PUBLIC_CERTS_STORE, 'readonly', (s) => s.getAll());
  if (!accountId) return all;
  return all.filter((c) => c.accountId === accountId || !c.accountId);
}

export async function deletePublicCert(id: string): Promise<void> {
  const db = await openDB();
  await txPromise(db, PUBLIC_CERTS_STORE, 'readwrite', (s) => s.delete(id));
}
