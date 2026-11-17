export const MAX_PRIVATE_FILE_BYTES = 35 * 1024 * 1024;
export const DIRECTORY_TYPE = 'inode/directory';
export const fileID = /^file-[0-9a-f]{64}$/;
export const revisionID = /^revision-[0-9a-f]{64}$/;
export const operationID = /^op-[0-9a-f]{64}$/;

export interface SpaceFile {
  $type: 'email.atmos.filePersonal.file';
  fileId: string;
  revisionId: string;
  operationId: string;
  name: string;
  mimeType: string;
  blob: { cid: string; mimeType: string; size: number };
  sha256: string;
  size: number;
  parents: string[];
  parentId?: string;
}
export interface SpaceFileInventory { actorDID: string; files: SpaceFile[] }

export function isSpaceFile(value: unknown): value is SpaceFile {
  if (!value || typeof value !== 'object') return false;
  const f = value as SpaceFile;
  return f.$type === 'email.atmos.filePersonal.file' && fileID.test(f.fileId) && revisionID.test(f.revisionId)
    && operationID.test(f.operationId) && typeof f.name === 'string' && f.name.length > 0
    && new TextEncoder().encode(f.name).length <= 255 && !/[\0\r\n/]/.test(f.name)
    && typeof f.mimeType === 'string' && /^[\w!#$&^.+-]+\/[\w!#$&^.+-]+$/.test(f.mimeType) && f.mimeType.length <= 255
    && Number.isSafeInteger(f.size) && f.size >= 0 && f.size <= MAX_PRIVATE_FILE_BYTES
    && !!f.blob && typeof f.blob.cid === 'string' && /^[\w.~+-]{1,512}$/.test(f.blob.cid)
    && f.blob.mimeType === f.mimeType && f.blob.size === f.size && /^[0-9a-f]{64}$/.test(f.sha256)
    && Array.isArray(f.parents) && f.parents.length <= 10000 && f.parents.every((id, index) => revisionID.test(id) && (index === 0 || f.parents[index - 1] < id))
    && (f.parentId === undefined || fileID.test(f.parentId))
    && (f.mimeType !== DIRECTORY_TYPE || f.size === 0 && f.sha256 === 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
}

export function isSpaceFileInventory(value: unknown): value is SpaceFileInventory {
  if (!value || typeof value !== 'object') return false;
  const inventory = value as SpaceFileInventory;
  const valid = typeof inventory.actorDID === 'string' && /^did:(plc|web):\S+$/.test(inventory.actorDID)
    && Array.isArray(inventory.files) && inventory.files.length <= 10000 && inventory.files.every(isSpaceFile)
    && new Set(inventory.files.map(file => `${file.fileId}/${file.revisionId}`)).size === inventory.files.length;
  if (!valid) return false;
  const files = new Map(inventory.files.map(file => [file.fileId, file]));
  // Conflicting heads are retained for the adapter to report; never pick one.
  if (files.size !== inventory.files.length) return true;
  const visited = new Map<string, number>();
  const visit = (file: SpaceFile): boolean => {
    if (visited.get(file.fileId) === 1) return false;
    if (visited.get(file.fileId) === 2) return true;
    visited.set(file.fileId, 1);
    if (file.parentId) {
      const parent = files.get(file.parentId);
      if (!parent || parent.mimeType !== DIRECTORY_TYPE || !visit(parent)) return false;
    }
    visited.set(file.fileId, 2);
    return true;
  };
  return inventory.files.every(visit);
}

export async function readPrivateFileBytes(body: ReadableStream<Uint8Array> | null): Promise<Uint8Array<ArrayBuffer>> {
  if (!body) return new Uint8Array();
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_PRIVATE_FILE_BYTES) throw new Error('File exceeds the private storage limit.');
      chunks.push(value);
    }
  } finally { await reader.cancel(); reader.releaseLock(); }
  const result = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.byteLength; }
  return result;
}
