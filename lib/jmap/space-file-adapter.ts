import { apiFetch } from '@/lib/browser-navigation';
import { isPersonalAuthorizationUrl } from '@/lib/groupware/authorization';
import { DIRECTORY_TYPE, MAX_PRIVATE_FILE_BYTES, isSpaceFile, isSpaceFileInventory, readPrivateFileBytes, type SpaceFile, type SpaceFileInventory } from '@/lib/space-files/wire';
import type { FileNode } from './types';

type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;
type Put = { fileId: string; operationId: string; name: string; mimeType: string; bytes: string; parents: string[]; parentId?: string };
type UploadOptions = { onProgress?: (loaded: number, total: number) => void; signal?: AbortSignal };

export class SpaceFileError extends Error {
  constructor(readonly code: string, readonly authorizationUrl?: string) {
    const messages: Record<string, string> = {
      authorization_required: 'Connect private files to continue.',
      conflict: 'Your files changed. Reload Files before continuing.',
      pending_change: 'Retry the previous file change before making another edit.',
      account_changed: 'The account changed. Reopen Files to continue.',
      unsupported_sharing: 'Private file sharing is not available.',
      too_large: 'This file exceeds the private storage limit of 35 MiB.',
    };
    super(messages[code] || 'Your private files are unavailable. Try again.');
    this.name = 'SpaceFileError';
  }
}

const sha256 = async (bytes: Uint8Array<ArrayBuffer>): Promise<string> => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))).map(b => b.toString(16).padStart(2, '0')).join('');
async function stable(prefix: string, ...fields: string[]): Promise<string> {
  return `${prefix}-${await sha256(new TextEncoder().encode(`comail-private-file-authority-v1\0${prefix}\0${fields.join('\0')}`))}`;
}
function base64(bytes: Uint8Array): string {
  let raw = '';
  for (let i = 0; i < bytes.length; i += 32768) raw += String.fromCharCode(...bytes.subarray(i, i + 32768));
  return btoa(raw);
}

export class SpaceFileAdapter {
  private slot?: number;
  private inventory?: SpaceFileInventory | null;
  private staged = new Map<string, Blob>();
  private pending?: { input: string; route: string; body: string };
  private deletion?: { root: string; ids: string[] };
  private copying?: { input: string; tasks: { file: SpaceFile; name: string; parent: string | null; sourceParent?: string }[]; mapped: Map<string, string>; root?: FileNode };
  private saving = false;
  private consent?: { slot: number; expires: number; url: Promise<string> };

  constructor(private readonly getSlot: () => number | undefined, private readonly fetcher: Fetcher = apiFetch) {}

  async configured(): Promise<boolean> { this.checkSlot(); if (this.inventory === undefined) await this.load(); return this.inventory !== null; }
  async list(): Promise<FileNode[]> {
    const inventory = await this.load();
    if (!inventory) throw new SpaceFileError('not_configured');
    const ids = new Set<string>();
    const names = new Set<string>();
    for (const file of inventory.files) {
      const name = JSON.stringify([file.parentId || '', file.name]);
      if (ids.has(file.fileId) || names.has(name)) throw new SpaceFileError('conflict');
      ids.add(file.fileId);
      names.add(name);
    }
    return inventory.files.map(file => this.node(file));
  }

  async stage(file: Blob, options: UploadOptions = {}): Promise<{ blobId: string; size: number; type: string }> {
    await this.requireInventory();
    options.signal?.throwIfAborted();
    if (file.size > MAX_PRIVATE_FILE_BYTES) throw new SpaceFileError('too_large');
    const type = file.type || 'application/octet-stream';
    const key = `space-upload:${await sha256(new Uint8Array(await file.arrayBuffer()))}:${type}`;
    this.staged.set(key, file);
    options.onProgress?.(file.size, file.size);
    return { blobId: key, size: file.size, type };
  }

  async createDirectory(name: string, parentId: string | null): Promise<FileNode> {
    return this.save(`directory:${JSON.stringify([name, parentId])}`, undefined, name, DIRECTORY_TYPE, new Uint8Array(), parentId);
  }

  async create(name: string, blobId: string, type: string, size: number, parentId: string | null): Promise<FileNode> {
    const blob = this.staged.get(blobId) || await this.download(blobId);
    if (blob.size !== size || (blob.type || 'application/octet-stream') !== type) throw new SpaceFileError('invalid_request');
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const input = `create:${JSON.stringify([name, type, size, parentId, await sha256(bytes)])}`;
    const node = await this.save(input, undefined, name, type, bytes, parentId);
    this.staged.delete(blobId);
    return node;
  }

  async update(id: string, updates: Partial<Pick<FileNode, 'name' | 'parentId'>>): Promise<void> {
    const input = `update:${JSON.stringify([id, updates.name, updates.parentId])}`;
    if (this.pending?.input === input) { await this.finishPut(input); return; }
    const current = await this.current(id);
    const bytes = current.mimeType === DIRECTORY_TYPE ? new Uint8Array() : new Uint8Array(await (await this.download(this.blobID(current))).arrayBuffer());
    await this.save(input, current, updates.name ?? current.name, current.mimeType, bytes, updates.parentId === undefined ? current.parentId || null : updates.parentId);
  }

  async remove(id: string): Promise<void> {
    if (this.deletion && this.deletion.root !== id) throw new SpaceFileError('pending_change');
    if (!this.deletion) {
      const inventory = await this.requireInventory(true);
      if (new Set(inventory.files.map(f => f.fileId)).size !== inventory.files.length) throw new SpaceFileError('conflict');
      const ids: string[] = [];
      const visit = (parent: string) => {
        for (const child of inventory.files.filter(file => file.parentId === parent)) visit(child.fileId);
        ids.push(parent);
      };
      visit(id);
      this.deletion = { root: id, ids };
    }
    while (this.deletion.ids.length) {
      try { await this.removeOne(this.deletion.ids[0]); }
      catch (error) {
        if (error instanceof SpaceFileError && ['conflict', 'invalid_request', 'not_found'].includes(error.code)) this.deletion = undefined;
        throw error;
      }
      this.deletion.ids.shift();
    }
    this.deletion = undefined;
  }

  async copy(id: string, name: string, parent: string | null): Promise<FileNode> {
    const input = JSON.stringify([id, name, parent]);
    if (this.copying && this.copying.input !== input) throw new SpaceFileError('pending_change');
    if (!this.copying) {
      const inventory = await this.requireInventory(true);
      const byID = new Map(inventory.files.map(file => [file.fileId, file]));
      if (byID.size !== inventory.files.length) throw new SpaceFileError('conflict');
      const root = byID.get(id);
      if (!root) throw new SpaceFileError('not_found');
      for (let ancestor = parent; ancestor; ancestor = byID.get(ancestor)?.parentId || null) {
        if (ancestor === id) throw new SpaceFileError('conflict');
      }
      const tasks: NonNullable<SpaceFileAdapter['copying']>['tasks'] = [];
      const visit = (file: SpaceFile, nextName: string, sourceParent?: string) => {
        tasks.push({ file, name: nextName, parent, sourceParent });
        for (const child of inventory.files.filter(item => item.parentId === file.fileId)) visit(child, child.name, file.fileId);
      };
      visit(root, name);
      this.copying = { input, tasks, mapped: new Map() };
    }
    while (this.copying.tasks.length) {
      const task = this.copying.tasks[0];
      const destination = task.sourceParent ? this.copying.mapped.get(task.sourceParent)! : task.parent;
      const taskInput = `copy:${input}:${task.file.fileId}`;
      const bytes = this.pending?.input === taskInput || task.file.mimeType === DIRECTORY_TYPE ? new Uint8Array() : new Uint8Array(await (await this.download(this.blobID(task.file))).arrayBuffer());
      const node = await this.save(taskInput, undefined, task.name, task.file.mimeType, bytes, destination);
      this.copying.mapped.set(task.file.fileId, node.id);
      this.copying.root ??= node;
      this.copying.tasks.shift();
    }
    const root = this.copying.root!;
    this.copying = undefined;
    return root;
  }

  private async removeOne(id: string): Promise<void> {
    if (this.saving) throw new SpaceFileError('pending_change');
    this.saving = true;
    try {
      const input = `delete:${id}`;
      if (this.pending && this.pending.input !== input) throw new SpaceFileError('pending_change');
      if (!this.pending) {
        const file = await this.current(id);
        const operationId = await stable('op', id, crypto.randomUUID());
        this.pending = { input, route: '/tombstone', body: JSON.stringify({ fileId: id, operationId, expectedHeads: [file.revisionId] }) };
      }
      const value = await this.request('/tombstone', this.pending.body) as { deleted?: boolean } | null;
      if (value?.deleted !== true) throw new SpaceFileError('unverified_change');
      const inventory = await this.requireInventory(true);
      if (inventory.files.some(file => file.fileId === id)) throw new SpaceFileError('unverified_change');
      this.pending = undefined;
    } finally { this.saving = false; }
  }

  async download(blobId: string): Promise<Blob> {
    const file = (await this.requireInventory(true)).files.find(file => this.blobID(file) === blobId);
    if (!file || file.mimeType === DIRECTORY_TYPE) throw new SpaceFileError('not_found');
    const response = await this.send('/download', JSON.stringify({ fileId: file.fileId, revisionId: file.revisionId }));
    if (!response.ok) { await this.problem(response); throw new SpaceFileError('files_unavailable'); }
    const data = await readPrivateFileBytes(response.body);
    this.checkSlot();
    if (data.length !== file.size || await sha256(data) !== file.sha256) throw new SpaceFileError('integrity');
    return new Blob([data], { type: file.mimeType });
  }

  private async save(input: string, current: SpaceFile | undefined, name: string, mimeType: string, bytes: Uint8Array<ArrayBuffer>, parentId: string | null): Promise<FileNode> {
    if (this.saving) throw new SpaceFileError('pending_change');
    this.saving = true;
    try {
      if (this.pending && this.pending.input !== input) throw new SpaceFileError('pending_change');
      if (!this.pending) {
        const inventory = await this.requireInventory();
        const fileId = current?.fileId || await stable('file', inventory.actorDID, crypto.randomUUID());
        const put: Put = { fileId, operationId: await stable('op', fileId, crypto.randomUUID()), name, mimeType, bytes: base64(bytes), parents: current ? [current.revisionId] : [], ...(parentId ? { parentId } : {}) };
        this.pending = { input, route: '/put', body: JSON.stringify(put) };
      }
      return await this.finishPut(input);
    } finally { this.saving = false; }
  }

  private async finishPut(input: string): Promise<FileNode> {
    if (!this.pending || this.pending.input !== input || this.pending.route !== '/put') throw new SpaceFileError('pending_change');
    const put: Put = JSON.parse(this.pending.body);
    const value = await this.request('/put', this.pending.body);
    const bytes = Uint8Array.from(atob(put.bytes), c => c.charCodeAt(0));
    if (!isSpaceFile(value) || value.fileId !== put.fileId || value.operationId !== put.operationId || value.name !== put.name
      || value.mimeType !== put.mimeType || (value.parentId || '') !== (put.parentId || '') || value.size !== bytes.length || value.sha256 !== await sha256(bytes)
      || JSON.stringify(value.parents) !== JSON.stringify(put.parents)) throw new SpaceFileError('unverified_change');
    const inventory = await this.requireInventory(true);
    this.pending = undefined;
    const live = inventory.files.filter(file => file.fileId === value.fileId);
    if (live.length !== 1 || live[0].revisionId !== value.revisionId) throw new SpaceFileError('conflict');
    return this.node(live[0]);
  }

  private async current(id: string): Promise<SpaceFile> {
    const files = (await this.requireInventory(true)).files.filter(file => file.fileId === id);
    if (files.length !== 1) throw new SpaceFileError(files.length ? 'conflict' : 'not_found');
    return files[0];
  }
  private blobID(file: SpaceFile): string { return `space-file:${file.fileId}:${file.revisionId}`; }
  private node(file: SpaceFile): FileNode {
    return { source: 'space', id: file.fileId, parentId: file.parentId || null, name: file.name, type: file.mimeType,
      size: file.size, blobId: file.mimeType === DIRECTORY_TYPE ? null : this.blobID(file), created: '', modified: '',
      myRights: { mayRead: true, mayAddChildren: file.mimeType === DIRECTORY_TYPE, mayRename: true, mayDelete: true, mayModifyContent: true, mayShare: false } };
  }
  private checkSlot(): void {
    const slot = this.getSlot();
    if (this.slot !== undefined && slot !== this.slot) { this.staged.clear(); throw new SpaceFileError('account_changed'); }
    this.slot = slot;
  }
  private async load(): Promise<SpaceFileInventory | null> {
    this.checkSlot();
    if (this.slot === undefined) { this.inventory = null; return null; }
    const value = await this.request('/inventory');
    if (value === null) {
      if (this.inventory) throw new SpaceFileError('files_unavailable');
      this.inventory = null; return null;
    }
    if (!isSpaceFileInventory(value) || this.inventory && value.actorDID !== this.inventory.actorDID) throw new SpaceFileError('invalid_response');
    this.inventory = value;
    return value;
  }
  private async requireInventory(refresh = false): Promise<SpaceFileInventory> {
    this.checkSlot();
    if (refresh || !this.inventory) await this.load();
    if (!this.inventory) throw new SpaceFileError('not_configured');
    return this.inventory;
  }
  private async send(route: string, body?: string): Promise<Response> {
    this.checkSlot();
    if (this.slot === undefined) throw new SpaceFileError('not_configured');
    const response = await this.fetcher(`/api/files${route}?slot=${this.slot}`, body === undefined ? undefined : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
    this.checkSlot();
    return response;
  }
  private async request(route: string, body?: string): Promise<unknown> {
    const response = await this.send(route, body);
    if (!response.ok) return this.problem(response);
    const value: unknown = await response.json();
    this.checkSlot();
    return value;
  }
  private async problem(response: Response): Promise<null> {
    const value = await response.json() as { error?: string };
    this.checkSlot();
    if (response.status === 404 && value.error === 'not_configured' && !this.inventory) return null;
    if (value.error === 'authorization_required') {
      const slot = this.slot!;
      if (!this.consent || this.consent.slot !== slot || this.consent.expires <= Date.now()) {
        const url = (async () => {
          const response = await this.send('/authorization', '{}');
          const result = await response.json() as { status?: string; authorizationUrl?: string };
          this.checkSlot();
          if (!response.ok || result.status !== 'authorization_required' || !isPersonalAuthorizationUrl(result.authorizationUrl, 'files')) throw new SpaceFileError('invalid_response');
          return result.authorizationUrl;
        })();
        this.consent = { slot, expires: Date.now() + 60000, url };
      }
      throw new SpaceFileError('authorization_required', await this.consent.url);
    }
    if (value.error === 'conflict' || value.error === 'invalid_request') this.pending = undefined;
    throw new SpaceFileError(value.error || 'files_unavailable');
  }
}
