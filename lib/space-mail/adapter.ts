import { buildMime, base64Lines } from '@/lib/mail-import/pst/mime';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { applyPatchObject } from '@/lib/jmap/patch-object';
import type { Email } from '@/lib/jmap/types';
import { parsePrivateMail } from '@/lib/space-mail/mime';
import { MAIL_PROTOCOL_VERSION, MAIL_CLIENT_UPDATE_MESSAGE, isMailBootstrap, type MailBootstrap, type MailFolder, type MailInventory, type MailState, type MailSubmissionInventory, type SelectedMail } from '@/lib/space-mail/wire';

type Call = [string, Record<string, unknown>, string];
type Result = [string, Record<string, unknown>, string];
type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;
export interface PrivateMailAccount { accountId: string; did: string; username: string }
export interface PrivateSubmission {
  id: string; operationId?: string; status: string; logicalMessageId: string; fingerprint: string; sender: string;
  recipients: { address: string; status: string }[]; notBefore: number; dsnNotify: string[];
}
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const canonical = (value: unknown): string => JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);
const flags = (values: string[]) => Object.fromEntries(values.map(value => [value, true]));
const selected = (values: Record<string, unknown>) => Object.keys(values).filter(key => values[key] === true).sort();
const errorCode = (error: unknown): string => error instanceof Error
  ? 'code' in error && typeof error.code === 'string' ? error.code : error.message : '';
const notFound = (error: unknown) => errorCode(error) === 'not_found';

/** Maps existing mail requests to authenticated PDS operations. */
export class SpaceMailAdapter {
  private readonly slot: number;
  private pending?: { input: string; operation: string; body: string };
  private uploads = new Map<string, Blob>();
  private submissionEnabled = false;
  private pendingSend?: { input: string; sourceKey: string; raw: string; operationId: string; state?: MailState; request?: string };

  constructor(private readonly getSlot: () => number | undefined, readonly account: PrivateMailAccount, private readonly fetcher: Fetcher) {
    const slot = getSlot();
    if (slot === undefined) throw new Error('unauthorized');
    this.slot = slot;
  }

  clear(): void { this.uploads.clear(); this.pending = undefined; this.pendingSend = undefined; }
  async bootstrap(): Promise<MailBootstrap> {
    const value = await this.post<unknown>('bootstrap', {});
    if (!isMailBootstrap(value, this.account.did, this.account.username)
      || !value.capabilities.messageCreate || !value.capabilities.draftReplace
      || !value.capabilities.messageRead || !value.capabilities.inventory) throw new Error('mail_unavailable');
    this.submissionEnabled = value.capabilities.submission && value.capabilities.nativeSubmission === true;
    return value;
  }
  get canSubmit(): boolean { return this.submissionEnabled; }
  checkAccount(accountId?: unknown): void {
    if (this.getSlot() !== this.slot) throw new Error('account_changed');
    if (accountId !== undefined && accountId !== this.account.accountId) throw new Error('unsupported_account');
  }
  async post<T>(operation: string, input: unknown): Promise<T> {
    return this.send<T>(operation, JSON.stringify(input));
  }
  private async send<T>(operation: string, body: string): Promise<T> {
    this.checkAccount();
    const response = await this.fetcher(`/api/mail/${operation}?slot=${this.slot}`, {
      method: 'POST', credentials: 'same-origin', cache: 'no-store', headers: { 'Content-Type': 'application/json', 'X-Comail-Mail-Protocol': MAIL_PROTOCOL_VERSION }, body,
    });
    this.checkAccount();
    const value = await response.json();
    this.checkAccount();
    if (!response.ok) {
      const code = typeof value?.code === 'string' ? value.code : typeof value?.error === 'string' ? value.error : 'mail_unavailable';
      if (code === 'client_update_required') throw Object.assign(new Error(MAIL_CLIENT_UPDATE_MESSAGE), { code });
      throw new Error(code);
    }
    return value as T;
  }
  private async write<T>(input: string, operation: string, body: () => unknown): Promise<T> {
    if (this.pending && this.pending.input !== input) throw new Error('pending_change');
    this.pending ??= { input, operation, body: JSON.stringify(body()) };
    let result: T;
    try { result = await this.send<T>(this.pending.operation, this.pending.body); }
    catch (error) {
      if (['conflict', 'not_found', 'invalid_request'].includes(errorCode(error))) this.pending = undefined;
      throw error;
    }
    this.pending = undefined;
    return result;
  }
  private async inventory(): Promise<MailInventory> {
    let page = await this.post<MailInventory>('inventory', { limit: 100 });
    const folders = page.folders;
    const folderDigest = canonical(folders);
    const entries = [...page.entries];
    const cursors = new Set<string>();
    while (page.nextAfter) {
      if (cursors.has(page.nextAfter)) throw new Error('mail_unavailable');
      cursors.add(page.nextAfter);
      const next = await this.post<MailInventory>('inventory', { snapshotId: page.snapshotId, after: page.nextAfter, limit: 100 });
      if (next.snapshotId !== page.snapshotId || next.total !== page.total || canonical(next.folders) !== folderDigest) throw new Error('conflict');
      entries.push(...next.entries);
      page = next;
    }
    if (entries.length !== page.total || new Set(entries.map(entry => entry.state.logicalMessageId)).size !== entries.length) throw new Error('mail_unavailable');
    return { ...page, folders, entries, nextAfter: undefined };
  }
  private async read(state: MailState, deliveredAt?: string): Promise<Awaited<ReturnType<typeof parsePrivateMail>>> {
    const result = await this.post<SelectedMail>('messages/read', { logicalMessageId: state.logicalMessageId, fingerprint: state.version });
    if (result.deliveredAt && deliveredAt && result.deliveredAt !== deliveredAt) throw new Error('conflict');
    const bytes = Uint8Array.from(atob(result.message.raw), value => value.charCodeAt(0));
    const parsed = await parsePrivateMail(bytes, result.state, result.deliveredAt ?? deliveredAt);
    this.checkAccount();
    return parsed;
  }
  async upload(file: Blob, signal?: AbortSignal): Promise<{ blobId: string; size: number; type: string }> {
    this.checkAccount(); signal?.throwIfAborted();
    const blobId = `space-mail-upload:${bytesToHex(sha256(new Uint8Array(await file.arrayBuffer())))}:${file.type}`;
    this.checkAccount(); signal?.throwIfAborted();
    this.uploads.set(blobId, file);
    return { blobId, size: file.size, type: file.type || 'application/octet-stream' };
  }
  async blob(blobId: string): Promise<Blob> {
    this.checkAccount();
    const uploaded = this.uploads.get(blobId);
    if (uploaded) return uploaded;
    const [prefix, logicalMessageId, version] = blobId.split(':');
    if (prefix !== 'space-mail' || !logicalMessageId || !version) throw new Error('not_found');
    const inventory = await this.inventory();
    const entry = inventory.entries.find(entry => entry.state.logicalMessageId === logicalMessageId && entry.state.version === version);
    if (!entry) throw new Error('not_found');
    const result = (await this.read(entry.state)).blobs.get(blobId);
    if (!result) throw new Error('not_found');
    return result;
  }

  async saveDraft(data: Record<string, unknown>, previousId?: string): Promise<string> {
    const input = canonical({ data, previousId });
    if (this.pending && this.pending.input !== input) throw new Error('pending_change');
    if (!this.pending) {
      const inventory = await this.inventory();
      const entry = previousId ? inventory.entries.find(entry => entry.state.logicalMessageId === previousId) : undefined;
      if (previousId && !entry) throw new Error('not_found');
      if (entry && !entry.message.sourceKey) throw new Error('draft_source_missing');
      const raw = base64Lines(await this.compose(data)).replace(/\r\n/g, '');
      this.checkAccount();
      const sourceKey = entry?.message.sourceKey ?? `webmail-draft:${crypto.randomUUID()}`;
      const operation = entry ? 'drafts' : 'messages';
      const mailboxIds = selected(record(data.mailboxIds));
      const keywords = selected(record(data.keywords));
      const body = entry ? { raw, sourceKey, mutation: { ...this.mutation(entry.state, { mailboxIds, keywords }), version: undefined } }
        : { raw, sourceKey, mailboxIds, keywords };
      this.pending = { input, operation, body: JSON.stringify(body) };
    }
    return (await this.write<MailState>(input, this.pending.operation, () => ({}))).logicalMessageId;
  }

  private async compose(data: Record<string, unknown>): Promise<Uint8Array<ArrayBuffer>> {
    const bodies = record(data.bodyValues);
    const textParts: string[] = []; const htmlParts: string[] = [];
    const attachmentParts: Record<string, unknown>[] = [];
    const visit = (part: Record<string, unknown>) => {
      if (Array.isArray(part.subParts)) { part.subParts.map(record).forEach(visit); return; }
      if (part.blobId) attachmentParts.push(part);
      else if (part.partId && String(part.type ?? 'text/plain') === 'text/html') htmlParts.push(String(part.partId));
      else if (part.partId) textParts.push(String(part.partId));
    };
    if (data.bodyStructure) visit(record(data.bodyStructure));
    else {
      (Array.isArray(data.textBody) ? data.textBody : []).map(record).forEach(part => textParts.push(String(part.partId)));
      (Array.isArray(data.htmlBody) ? data.htmlBody : []).map(record).forEach(part => htmlParts.push(String(part.partId)));
      (Array.isArray(data.attachments) ? data.attachments : []).map(record).forEach(part => attachmentParts.push(part));
    }
    const join = (parts: string[]) => parts.length ? parts.map(id => String(record(bodies[id]).value ?? '')).join('\r\n') : undefined;
    const addresses = (value: unknown) => (Array.isArray(value) ? value.map(record) : []).map(value => {
      const email = String(value.email ?? '');
      if (!email || /[<>]/.test(email) || [...email].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)) throw new Error('invalid_address');
      return { email, name: typeof value.name === 'string' ? value.name : undefined };
    });
    const from = addresses(data.from)[0];
    const attachments = [];
    for (const part of attachmentParts) {
      const blob = await this.blob(String(part.blobId));
      this.checkAccount();
      if (typeof part.size === 'number' && part.size !== blob.size) throw new Error('attachment_changed');
      const data = new Uint8Array(await blob.arrayBuffer());
      this.checkAccount();
      attachments.push({ filename: String(part.name ?? 'attachment'), mimeType: String(part.type ?? blob.type), contentId: typeof part.cid === 'string' ? part.cid : undefined, data });
    }
    const headers: string[] = [];
    for (const [key, value] of Object.entries(data)) if (key.startsWith('header:')) {
      const name = key.split(':')[1];
      if (!/^[A-Za-z0-9-]+$/.test(name) || typeof value !== 'string' || /[\r\n]/.test(value)) throw new Error('invalid_header');
      headers.push(`${name}: ${value}`);
    }
    const replyTo = addresses(data.replyTo);
    if (replyTo.length) headers.push(`Reply-To: ${replyTo.map(address => address.name ? `"${address.name.replace(/[\r\n"\\]/g, '')}" <${address.email}>` : `<${address.email}>`).join(', ')}`);
    for (const [key, header] of [['references', 'References'], ['inReplyTo', 'In-Reply-To']]) if (Array.isArray(data[key])) {
      const ids = data[key] as unknown[];
      if (ids.some(id => typeof id !== 'string' || /[\r\n]/.test(id))) throw new Error('invalid_header');
      headers.push(`${header}: ${ids.map(id => `<${String(id).replace(/^<|>$/g, '')}>`).join(' ')}`);
    }
    const bytes = Uint8Array.from(buildMime({ from, to: addresses(data.to), cc: addresses(data.cc), bcc: addresses(data.bcc),
      subject: String(data.subject ?? ''), text: join(textParts), html: join(htmlParts), attachments,
      date: typeof data.sentAt === 'string' ? new Date(data.sentAt) : new Date(),
      messageId: Array.isArray(data.messageId) ? String(data.messageId[0]) : `${crypto.randomUUID()}@${from?.email.split('@')[1] ?? 'mail.invalid'}`,
    }));
    if (!headers.length) return bytes;
    const prefix = new TextEncoder().encode(`${headers.join('\r\n')}\r\n`);
    const result = new Uint8Array(prefix.byteLength + bytes.byteLength); result.set(prefix); result.set(bytes, prefix.byteLength); return result;
  }

  async sendComposed(data: Record<string, unknown>, options: { sender: string; recipients: string[]; sentMailboxId: string; delayedUntil?: string; requestDsn?: boolean }): Promise<{ state: MailState; submission: { id: string; status: string; recipients: { address: string; status: string }[] } }> {
    const { messageId: _messageId, ...stableData } = data;
    return this.sendPrepared(canonical({ data: stableData, options }), () => this.compose(data), options);
  }

  async sendRaw(blob: Blob, options: { sender: string; recipients: string[]; sentMailboxId: string; delayedUntil?: string }): Promise<{ state: MailState; submission: { id: string; status: string; recipients: { address: string; status: string }[] } }> {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    this.checkAccount();
    return this.sendPrepared(canonical({ digest: bytesToHex(sha256(bytes)), options }), async () => bytes, options);
  }

  private async sendPrepared(input: string, bytes: () => Promise<Uint8Array>, options: { sender: string; recipients: string[]; sentMailboxId: string; delayedUntil?: string; requestDsn?: boolean }): Promise<{ state: MailState; submission: { id: string; status: string; recipients: { address: string; status: string }[] } }> {
    this.checkAccount();
    if (!this.submissionEnabled) throw new Error('Mail submission is unavailable for this account');
    if (this.pendingSend && this.pendingSend.input !== input) throw new Error('pending_change');
    if (!this.pendingSend) {
      const operationId = crypto.randomUUID();
      const raw = base64Lines(await bytes()).replace(/\r\n/g, '');
      this.checkAccount();
      this.pendingSend = { input, operationId, sourceKey: `webmail-send:${operationId}`,
        raw };
    }
    const pending = this.pendingSend;
    if (!pending.state) {
      pending.state = await this.post<MailState>('messages', { sourceKey: pending.sourceKey, raw: pending.raw,
        mailboxIds: [options.sentMailboxId], keywords: ['$seen'] });
    }
    pending.request ??= JSON.stringify({ operationId: pending.operationId, logicalMessageId: pending.state.logicalMessageId,
      fingerprint: pending.state.version, sender: options.sender, recipients: options.recipients,
      ...(options.delayedUntil ? { notBefore: Math.ceil(new Date(options.delayedUntil).getTime() / 1000) } : {}),
      ...(options.requestDsn ? { dsnNotify: ['SUCCESS', 'FAILURE', 'DELAY'] } : {}) });
    let submission: { id: string; status: string; recipients: { address: string; status: string }[] };
    try { submission = await this.send<typeof submission>('submissions', pending.request); }
    catch (error) {
      if (errorCode(error) === 'account_changed' || errorCode(error) === 'client_update_required') throw error;
      try { submission = await this.submissionStatus(pending.operationId, true); }
      catch (error) {
        if (errorCode(error) === 'account_changed') throw error;
        if (notFound(error)) throw new Error('A Sent copy was saved, but delivery has not started. Check Sent before retrying.');
        throw new Error('Delivery status is unknown. Check Sent before retrying.');
      }
    }
    if (!submission.id || !Array.isArray(submission.recipients)) throw new Error('mail_unavailable');
    this.pendingSend = undefined;
    return { state: pending.state, submission };
  }

  async submissionStatus(id: string, byOperation = false): Promise<PrivateSubmission> {
    const value = await this.post<PrivateSubmission>('submissions/status', byOperation ? { operationId: id } : { submissionId: id });
    if (!value.id || !value.logicalMessageId || !value.fingerprint || !value.sender || !Array.isArray(value.recipients)) throw new Error('mail_unavailable');
    return value;
  }

  async cancelSubmission(id: string): Promise<void> {
    const value = await this.post<{ cancelled: boolean }>('submissions/cancel', { submissionId: id });
    if (value.cancelled !== true) throw new Error('mail_unavailable');
  }

  async scheduledSubmissions(): Promise<PrivateSubmission[]> {
    const pending = (await this.submissionInventory()).filter(status => {
      return ['queued', 'retry', 'partial', 'ambiguous'].includes(status.status);
    });
    return pending.sort((a, b) => a.notBefore - b.notBefore);
  }

  private async submissionInventory(): Promise<PrivateSubmission[]> {
    let page = await this.post<MailSubmissionInventory>('submissions/inventory', { limit: 100 });
    if (!Array.isArray(page?.entries) || !Number.isSafeInteger(page.total) || page.total < 0 || !page.snapshotId) throw new Error('mail_unavailable');
    const snapshotId = page.snapshotId;
    const total = page.total;
    const entries = [...page.entries];
    const cursors = new Set<string>();
    while (page.nextAfter) {
      if (cursors.has(page.nextAfter)) throw new Error('mail_unavailable');
      cursors.add(page.nextAfter);
      const next = await this.post<MailSubmissionInventory>('submissions/inventory', { snapshotId, after: page.nextAfter, limit: 100 });
      if (!Array.isArray(next?.entries) || next.snapshotId !== snapshotId || next.total !== total) throw new Error('conflict');
      entries.push(...next.entries);
      page = next;
    }
    if (entries.length !== total || entries.some(entry => !entry.operationId || !entry.id || !Array.isArray(entry.recipients))
      || new Set(entries.map(entry => entry.operationId)).size !== entries.length) throw new Error('mail_unavailable');
    return entries;
  }

  async unsubmittedSentCopies(): Promise<Email[]> {
    const inventory = await this.inventory();
    const unsent: Email[] = [];
    for (const entry of inventory.entries) {
      const sourceKey = entry.message.sourceKey;
      if (entry.state.tombstone || !sourceKey?.startsWith('webmail-send:')) continue;
      try { await this.submissionStatus(sourceKey.slice('webmail-send:'.length), true); }
      catch (error) {
        if (!notFound(error)) throw error;
        unsent.push((await this.read(entry.state, entry.deliveredAt)).email);
      }
    }
    return unsent;
  }

  async rescheduleSubmission(id: string, notBefore: number): Promise<PrivateSubmission> {
    if (!this.submissionEnabled) throw new Error('Mail submission is unavailable for this account');
    if (!Number.isSafeInteger(notBefore) || notBefore < 0) throw new Error('Invalid scheduled time');
    const previous = await this.submissionStatus(id);
    if (!['queued', 'retry', 'partial', 'canceled', 'cancelled'].includes(previous.status)) throw new Error('The previous send can no longer be rescheduled');
    const messages = await this.inventory();
    const sentFolders = new Set(messages.folders.filter(folder => folder.role === 'sent').map(folder => folder.folderId));
    const sent = messages.entries.find(entry => !entry.state.tombstone && entry.state.logicalMessageId === previous.logicalMessageId
      && entry.state.version === previous.fingerprint && entry.state.mailboxIds.some(folderId => sentFolders.has(folderId)));
    if (!sent) throw new Error('Sent message is unavailable; cancel this schedule before retrying');
    await this.read(sent.state, sent.deliveredAt);
    const remaining = previous.recipients.filter(recipient => ['queued', 'retry', 'canceled'].includes(recipient.status));
    if (!remaining.length) throw new Error('No unsent recipients remain to reschedule');
    if (!['canceled', 'cancelled'].includes(previous.status)) {
      try { await this.cancelSubmission(id); }
      catch (error) {
        const current = await this.submissionStatus(id).catch(() => null);
        if (!current || !remaining.every(recipient => current.recipients.some(next => next.address === recipient.address && next.status === 'canceled'))) throw error;
      }
    }
    const canceled = await this.submissionStatus(id);
    if (!remaining.every(recipient => canceled.recipients.some(next => next.address === recipient.address && next.status === 'canceled'))) throw new Error('The previous send may already be in delivery');
    const operationId = `reschedule:${id}:${notBefore}`;
    const input = { operationId, logicalMessageId: previous.logicalMessageId, fingerprint: previous.fingerprint,
      sender: previous.sender, recipients: remaining.map(recipient => recipient.address), notBefore,
      dsnNotify: previous.dsnNotify };
    try { return await this.post<PrivateSubmission>('submissions', input); }
    catch (error) {
      if (errorCode(error) === 'account_changed') throw error;
      try { return await this.submissionStatus(operationId, true); }
      catch (error) {
        if (errorCode(error) === 'account_changed') throw error;
        if (notFound(error)) throw new Error('The old schedule was cancelled, but the new one did not start. Retry the change.');
        throw new Error('The new schedule status is unknown. Check Scheduled before retrying.');
      }
    }
  }

  async request(calls: Call[]): Promise<{ methodResponses: Result[] }> {
    this.checkAccount();
    let inventory = await this.inventory();
    const results: Result[] = [];
    const loaded = new Map<string, Email>();
    const getEmails = async (ids?: string[]) => {
      const entries = inventory.entries.filter(entry => !entry.state.tombstone && !entry.state.deletePending && (!ids || ids.includes(entry.state.logicalMessageId)));
      for (const entry of entries) if (!loaded.has(entry.state.logicalMessageId)) loaded.set(entry.state.logicalMessageId, (await this.read(entry.state, entry.deliveredAt)).email);
      return entries.map(entry => loaded.get(entry.state.logicalMessageId)!);
    };
    for (const [method, original, callId] of calls) {
      const args = this.resolve(original, results);
      this.checkAccount(args.accountId);
      const common = { accountId: this.account.accountId, state: inventory.snapshotId };
      let result: Record<string, unknown>;
      switch (method) {
        case 'Core/echo': result = args; break;
        case 'Identity/get': {
          const identity = { id: this.account.accountId, name: this.account.username, email: this.account.username, mayDelete: false };
          result = { ...common, list: !Array.isArray(args.ids) || args.ids.includes(identity.id) ? [identity] : [],
            notFound: Array.isArray(args.ids) ? args.ids.filter(id => id !== identity.id) : [] }; break;
        }
        case 'Mailbox/get': {
          const folders = inventory.folders.filter(folder => !folder.tombstone && (!Array.isArray(args.ids) || args.ids.includes(folder.folderId)));
          result = { ...common, list: folders.map(folder => this.folder(folder, inventory)), notFound: [] }; break;
        }
        case 'Mailbox/query': {
          const filter = record(args.filter);
          const folders = inventory.folders.filter(folder => !folder.tombstone && (filter.role === undefined || folder.role === filter.role));
          result = { ...common, queryState: inventory.snapshotId, ids: folders.map(folder => folder.folderId), total: folders.length, position: 0 }; break;
        }
        case 'Mailbox/set': {
          const creates = Object.entries(record(args.create));
          const updates = Object.entries(record(args.update));
          const destroys = Array.isArray(args.destroy) ? args.destroy as string[] : [];
          if (creates.length + updates.length + destroys.length !== 1 || args.ifInState && args.ifInState !== inventory.snapshotId) throw new Error('unsupported_mailbox_mutation');
          if (creates.length) {
            const [creationId, draft] = creates[0];
            const change = record(draft);
            if (typeof change.name !== 'string' || !change.name || change.role) throw new Error('unsupported_mailbox_mutation');
            const parent = change.parentId == null ? undefined : inventory.folders.find(folder => folder.folderId === change.parentId && !folder.tombstone);
            if (change.parentId != null && !parent) throw new Error('not_found');
            const name = parent ? `${parent.name}/${change.name}` : change.name;
            const folder = await this.write<MailFolder>(canonical(args), 'folders', () => ({
              sourceKey: `webmail-folder:${crypto.randomUUID()}`, name, snapshotId: inventory.snapshotId,
              expectedHeads: [], expectedHeight: 0, expectedRevisionCount: 0, expectedStateDigest: '', tombstone: false,
            }));
            inventory.folders.push(folder); inventory.snapshotId = folder.snapshotId;
            result = { accountId: this.account.accountId, oldState: common.state, newState: inventory.snapshotId,
              created: { [creationId]: { id: folder.folderId } } }; break;
          }
          const id = updates.length ? updates[0][0] : destroys[0];
          const current = inventory.folders.find(folder => folder.folderId === id && !folder.tombstone);
          if (!current) throw new Error('not_found');
          if (current.role || inventory.folders.some(folder => !folder.tombstone && folder.name.startsWith(`${current.name}/`))) throw new Error('unsupported_mailbox_mutation');
          const deleting = destroys.length > 0;
          if (deleting && inventory.entries.some(entry => !entry.state.tombstone && entry.state.mailboxIds.includes(id))) throw new Error('mailboxHasEmail');
          const change = updates.length ? record(updates[0][1]) : {};
          if (Object.keys(change).some(key => !['name', 'parentId'].includes(key))) throw new Error('unsupported_mailbox_mutation');
          const parentName = current.name.includes('/') ? current.name.slice(0, current.name.lastIndexOf('/')) : '';
          const parent = change.parentId === undefined ? undefined : change.parentId === null ? null : inventory.folders.find(folder => folder.folderId === change.parentId && !folder.tombstone);
          if (change.parentId && !parent || parent?.folderId === id) throw new Error('not_found');
          const leaf = change.name === undefined ? current.name.slice(parentName.length ? parentName.length + 1 : 0) : change.name;
          if (!deleting && (typeof leaf !== 'string' || !leaf)) throw new Error('unsupported_mailbox_mutation');
          const parentPath = change.parentId === undefined ? parentName : parent?.name ?? '';
          const name = deleting ? '' : parentPath ? `${parentPath}/${leaf}` : leaf;
          const folder = await this.write<MailFolder>(canonical(args), 'folders', () => ({ folderId: id, name, tombstone: deleting,
            operationId: crypto.randomUUID(), snapshotId: inventory.snapshotId, expectedHeads: current.heads,
            expectedHeadsDigest: current.headsDigest, expectedStateDigest: current.stateDigest,
            expectedHeight: current.height, expectedRevisionCount: current.revisionCount }));
          inventory.folders = inventory.folders.map(value => value.folderId === id ? folder : value);
          inventory.snapshotId = folder.snapshotId;
          result = { accountId: this.account.accountId, oldState: common.state, newState: inventory.snapshotId,
            ...(deleting ? { destroyed: [id] } : { updated: { [id]: null } }) }; break;
        }
        case 'Email/query': {
          const emails = (await getEmails()).filter(email => this.matches(email, record(args.filter)));
          const sort = Array.isArray(args.sort) ? args.sort.map(record) : [{ property: 'receivedAt', isAscending: false }];
          emails.sort((a, b) => this.compare(a, b, sort));
          const unique = args.collapseThreads === true ? emails.filter((email, index) => emails.findIndex(other => other.threadId === email.threadId) === index) : emails;
          const position = typeof args.position === 'number' ? Math.max(0, args.position < 0 ? unique.length + args.position : args.position) : 0;
          const limit = typeof args.limit === 'number' ? args.limit : unique.length;
          result = { ...common, queryState: inventory.snapshotId, canCalculateChanges: false, ids: unique.slice(position, position + limit).map(email => email.id), total: unique.length, position }; break;
        }
        case 'Email/get': {
          const ids = Array.isArray(args.ids) ? args.ids as string[] : undefined;
          const emails = await getEmails(ids);
          result = { ...common, list: emails.map(email => this.properties(email, args.properties)), notFound: (ids ?? []).filter(id => !emails.some(email => email.id === id)) }; break;
        }
        case 'Thread/get': {
          const emails = await getEmails();
          const ids = Array.isArray(args.ids) ? args.ids as string[] : [...new Set(emails.map(email => email.threadId))];
          result = { ...common, list: ids.map(id => ({ id, emailIds: emails.filter(email => email.threadId === id).sort((a, b) => a.receivedAt.localeCompare(b.receivedAt)).map(email => email.id) })).filter(thread => thread.emailIds.length), notFound: [] }; break;
        }
        case 'Email/changes': case 'Mailbox/changes':
          results.push(['error', { type: 'cannotCalculateChanges' }, callId]); continue;
        case 'SearchSnippet/get': {
          const emails = await getEmails(Array.isArray(args.emailIds) ? args.emailIds as string[] : []);
          result = { ...common, list: emails.map(email => ({ emailId: email.id, subject: null, preview: null })), notFound: [] }; break;
        }
        case 'Email/set': {
          if (args.ifInState && args.ifInState !== inventory.snapshotId) throw new Error('conflict');
          if (Object.keys(record(args.create)).length) throw new Error('unsupported_email_create');
          const updates = Object.entries(record(args.update));
          const destroys = Array.isArray(args.destroy) ? args.destroy as string[] : [];
          if (updates.some(([, patch]) => Object.keys(record(patch)).some(key => !['mailboxIds', 'keywords'].includes(key.split('/')[0])))
            || destroys.some(id => typeof id !== 'string')) throw new Error('unsupported_email_property');
          const updated: Record<string, null> = {};
          const notUpdated: Record<string, { type: string }> = {};
          const destroyed: string[] = [];
          const notDestroyed: Record<string, { type: string }> = {};
          for (const [id, patch, deleting] of [
            ...updates.map(([id, patch]) => [id, patch, false] as const),
            ...destroys.map(id => [id, {}, true] as const),
          ]) {
            const entry = inventory.entries.find(entry => entry.state.logicalMessageId === id);
            const failures = deleting ? notDestroyed : notUpdated;
            if (!entry) { failures[id] = { type: 'notFound' }; continue; }
            try {
              const state = await this.write<MailState>(deleting ? `delete:${id}` : canonical({ id, patch }), 'state', () => {
                const changed = deleting ? null : applyPatchObject({ keywords: flags(entry.state.keywords), mailboxIds: flags(entry.state.mailboxIds) }, record(patch));
                const change = changed ? { keywords: selected(changed.keywords), mailboxIds: selected(changed.mailboxIds) } : { tombstone: true };
                return this.mutation({ ...entry.state, snapshotId: inventory.snapshotId }, change);
              });
              entry.state = state; inventory.snapshotId = state.snapshotId; loaded.delete(id);
              if (deleting) destroyed.push(id); else updated[id] = null;
            } catch (error) {
              if (!notFound(error) && errorCode(error) !== 'conflict') throw error;
              failures[id] = { type: notFound(error) ? 'notFound' : 'stateMismatch' };
              inventory = await this.inventory(); loaded.clear();
            }
          }
          result = { accountId: this.account.accountId, oldState: common.state, newState: inventory.snapshotId,
            updated, notUpdated, destroyed, notDestroyed }; break;
        }
        default: throw new Error(`unsupported_method:${method}`);
      }
      results.push([method, result, callId]);
    }
    inventory = { ...inventory, entries: [] };
    this.checkAccount();
    return { methodResponses: results };
  }

  private mutation(state: MailState, change: Partial<MailState>): Record<string, unknown> {
    return { logicalMessageId: state.logicalMessageId, snapshotId: state.snapshotId, operationId: crypto.randomUUID(),
      expectedHeads: state.heads, expectedHeadsDigest: state.headsDigest, expectedStateDigest: state.stateDigest,
      expectedHeight: state.height, expectedRevisionCount: state.revisionCount, version: state.version,
      mailboxIds: state.mailboxIds, keywords: state.keywords, deletePending: state.deletePending, tombstone: state.tombstone, ...change };
  }
  private resolve(input: Record<string, unknown>, results: Result[]): Record<string, unknown> {
    const args = { ...input };
    for (const [key, value] of Object.entries(input)) if (key.startsWith('#')) {
      const ref = record(value);
      const result = results.find(([name, , id]) => name === ref.name && id === ref.resultOf);
      if (!result || typeof ref.path !== 'string') throw new Error('invalid_result_reference');
      let values: unknown[] = [result[1]];
      for (const segment of ref.path.split('/').slice(1)) values = segment === '*' ? values.flatMap(value => Array.isArray(value) ? value : Object.values(record(value))) : values.map(value => record(value)[segment]);
      args[key.slice(1)] = values.flat(); delete args[key];
    }
    return args;
  }
  private folder(folder: MailFolder, inventory: MailInventory): Record<string, unknown> {
    const entries = inventory.entries.filter(entry => !entry.state.tombstone && !entry.state.deletePending && entry.state.mailboxIds.includes(folder.folderId));
    const unread = entries.filter(entry => !entry.state.keywords.includes('$seen')).length;
    const parent = inventory.folders.find(candidate => folder.name.startsWith(`${candidate.name}/`) && folder.name.slice(candidate.name.length + 1).indexOf('/') === -1);
    return { id: folder.folderId, name: parent ? folder.name.slice(parent.name.length + 1) : folder.name, parentId: parent?.folderId ?? null, role: folder.role ?? null,
      sortOrder: 0, isSubscribed: true, totalEmails: entries.length, unreadEmails: unread, totalThreads: entries.length, unreadThreads: unread,
      myRights: { mayReadItems: true, mayAddItems: true, mayRemoveItems: true, maySetSeen: true, maySetKeywords: true, mayCreateChild: true, mayRename: !folder.role, mayDelete: !folder.role, maySubmit: this.submissionEnabled, mayShare: false } };
  }
  private properties(email: Email, properties: unknown): Record<string, unknown> {
    if (!Array.isArray(properties)) return { ...email };
    return Object.fromEntries([...new Set(['id', ...properties as string[]])].map(key => {
      if (key.startsWith('header:')) {
        const header = email.headers?.[key.split(':')[1].toLowerCase()];
        return [key, Array.isArray(header) ? header.join(', ') : header ?? null];
      }
      return [key, email[key as keyof Email] ?? null];
    }));
  }
  private matches(email: Email, filter: Record<string, unknown>): boolean {
    if (filter.operator) {
      const conditions = Array.isArray(filter.conditions) ? filter.conditions.map(record) : [];
      if (filter.operator === 'AND') return conditions.every(condition => this.matches(email, condition));
      if (filter.operator === 'OR') return conditions.some(condition => this.matches(email, condition));
      if (filter.operator === 'NOT') return !conditions.some(condition => this.matches(email, condition));
      throw new Error('unsupported_filter');
    }
    const body = Object.values(email.bodyValues ?? {}).map(value => value.value).join(' ');
    for (const [key, value] of Object.entries(filter)) {
      if (key === 'inMailbox' && !email.mailboxIds[String(value)]) return false;
      else if (key === 'inMailboxOtherThan' && Array.isArray(value) && !Object.keys(email.mailboxIds).some(id => !value.includes(id))) return false;
      else if (key === 'hasKeyword' && !email.keywords[String(value)]) return false;
      else if (key === 'notKeyword' && email.keywords[String(value)]) return false;
      else if (key === 'hasAttachment' && email.hasAttachment !== value) return false;
      else if (key === 'before' && email.receivedAt >= String(value)) return false;
      else if (key === 'after' && email.receivedAt < String(value)) return false;
      else if (key === 'minSize' && email.size < Number(value)) return false;
      else if (key === 'maxSize' && email.size >= Number(value)) return false;
      else if (['from', 'to', 'cc', 'bcc'].includes(key)) {
        const addresses = email[key as 'from' | 'to' | 'cc' | 'bcc'] ?? [];
        if (!addresses.some(address => `${address.name ?? ''} ${address.email}`.toLowerCase().includes(String(value).toLowerCase()))) return false;
      } else if (['text', 'body', 'subject'].includes(key)) {
        const text = key === 'subject' ? email.subject ?? '' : key === 'body' ? body : JSON.stringify([email.subject, email.from, email.to, email.cc, email.bcc, body]);
        if (!text.toLowerCase().includes(String(value).toLowerCase())) return false;
      } else if (key === 'header' && Array.isArray(value)) {
        const header = email.headers?.[String(value[0]).toLowerCase()];
        if (header === undefined || value[1] !== undefined && !String(header).toLowerCase().includes(String(value[1]).toLowerCase())) return false;
      } else if (!['inMailbox', 'inMailboxOtherThan', 'hasKeyword', 'notKeyword', 'hasAttachment', 'before', 'after', 'minSize', 'maxSize'].includes(key)) throw new Error('unsupported_filter');
    }
    return true;
  }
  private compare(a: Email, b: Email, sort: Record<string, unknown>[]): number {
    for (const order of sort) {
      const property = String(order.property);
      let difference: number;
      if (property === 'hasKeyword') difference = Number(!!a.keywords[String(order.keyword)]) - Number(!!b.keywords[String(order.keyword)]);
      else if (property === 'size') difference = a.size - b.size;
      else if (['receivedAt', 'sentAt', 'subject', 'from', 'to'].includes(property)) {
        const value = (email: Email) => ['from', 'to'].includes(property) ? (email[property as 'from' | 'to']?.[0]?.name || email[property as 'from' | 'to']?.[0]?.email || '') : String(email[property as keyof Email] ?? '');
        difference = value(a).localeCompare(value(b));
      } else throw new Error('unsupported_sort');
      if (difference) return order.isAscending === false ? -difference : difference;
    }
    return a.id.localeCompare(b.id);
  }
}
