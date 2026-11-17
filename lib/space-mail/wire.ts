export const MAIL_PROTOCOL_VERSION = '1';
export const MAIL_CLIENT_UPDATE_MESSAGE = 'Update Comail to access your PDS mailbox.';
export const MAX_MAIL_BYTES = 10 * 1024 * 1024;
export interface MailBootstrap {
  did: string; mailbox: string; identities: string[];
  capabilities: { messageCreate: boolean; draftReplace: boolean; messageRead: boolean; inventory: boolean; submission: boolean; nativeSubmission?: boolean; maxDelayedSendSeconds?: number; submissionReauthorizationRequired?: boolean };
}
export interface MailSubmission {
  id: string; operationId?: string; status: string; logicalMessageId: string; fingerprint: string; sender: string;
  recipients: { address: string; status: string; smtpCode?: number }[]; notBefore: number; dsnNotify: string[];
}
export interface MailSubmissionInventory {
  snapshotId: string; total: number; entries: (MailSubmission & { operationId: string })[]; nextAfter?: string;
}
export function isMailBootstrap(value: unknown, did: string, mailbox: string): value is MailBootstrap {
  if (!object(value) || value.did !== did || value.mailbox !== mailbox || !strings(value.identities)
    || !(value.identities as string[]).includes(mailbox) || !object(value.capabilities)) return false;
  const capabilities = value.capabilities as Record<string, unknown>;
  return ['messageCreate', 'draftReplace', 'messageRead', 'inventory', 'submission']
    .every(key => typeof capabilities[key] === 'boolean')
    && (capabilities.nativeSubmission === undefined || typeof capabilities.nativeSubmission === 'boolean')
    && (capabilities.submissionReauthorizationRequired === undefined || typeof capabilities.submissionReauthorizationRequired === 'boolean')
    && (capabilities.maxDelayedSendSeconds === undefined || Number.isSafeInteger(capabilities.maxDelayedSendSeconds) && (capabilities.maxDelayedSendSeconds as number) > 0);
}
export interface MailState {
  logicalMessageId: string; snapshotId: string; version: string;
  mailboxIds: string[]; keywords: string[]; deletePending: boolean; tombstone: boolean;
  heads: string[]; headsDigest: string; stateDigest: string; height: number; revisionCount: number;
}
export interface SelectedMail {
  snapshotId: string; state: MailState; deliveredAt?: string;
  message: { uri: string; rkey: string; fingerprint: string; logicalMessageId: string; sourceKey?: string; sha256: string; size: number; raw: string };
  folders: unknown[];
}
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every(v => typeof v === 'string');
const identifier = (value: unknown): value is string => typeof value === 'string' && /^sha256-[a-f0-9]{64}$/.test(value);
const deliveryTime = (value: unknown): value is string => typeof value === 'string'
  && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
  && Number.isFinite(Date.parse(value));
export function isMailSubmission(value: unknown): value is MailSubmission {
  return object(value) && typeof value.id === 'string' && value.id.length > 0 && typeof value.status === 'string'
    && identifier(value.logicalMessageId) && identifier(value.fingerprint)
    && typeof value.sender === 'string' && value.sender.length > 0 && !/[\r\n]/.test(value.sender)
    && Array.isArray(value.recipients) && value.recipients.length > 0 && value.recipients.length <= 1000
    && value.recipients.every(recipient => object(recipient) && typeof recipient.address === 'string' && recipient.address.length > 0
      && typeof recipient.status === 'string' && (recipient.smtpCode === undefined || Number.isSafeInteger(recipient.smtpCode)))
    && Number.isSafeInteger(value.notBefore) && (value.notBefore as number) >= 0
    && strings(value.dsnNotify) && (value.dsnNotify as string[]).every(item => ['NEVER', 'SUCCESS', 'FAILURE', 'DELAY'].includes(item));
}
export function isMailSubmissionInventory(value: unknown): value is MailSubmissionInventory {
  return object(value) && identifier(value.snapshotId) && Number.isSafeInteger(value.total) && (value.total as number) >= 0
    && Array.isArray(value.entries) && value.entries.length <= 100 && value.entries.every(entry => isMailSubmission(entry)
      && typeof entry.operationId === 'string' && entry.operationId.length > 0)
    && (value.nextAfter === undefined || typeof value.nextAfter === 'string' && value.nextAfter.length > 0);
}
export function isMailState(value: unknown): value is MailState {
  return object(value) && ['logicalMessageId', 'snapshotId', 'version', 'headsDigest', 'stateDigest'].every(key => identifier(value[key]))
    && ['mailboxIds', 'keywords', 'heads'].every(key => strings(value[key]))
    && typeof value.deletePending === 'boolean' && typeof value.tombstone === 'boolean'
    && Number.isSafeInteger(value.height) && (value.height as number) > 0
    && Number.isSafeInteger(value.revisionCount) && (value.revisionCount as number) >= (value.height as number);
}
export function isSelectedMail(value: unknown, did: string): value is SelectedMail {
  if (!object(value) || !identifier(value.snapshotId) || !isMailState(value.state) || !object(value.message) || !Array.isArray(value.folders)
    || value.deliveredAt !== undefined && !deliveryTime(value.deliveredAt)) return false;
  const message = value.message;
  return typeof message.uri === 'string' && /^at:\/\/did:[^/?#\s]+\/space\/[^?#\s]+$/.test(message.uri)
    && message.uri.endsWith(`/${did}/email.atmos.message/${message.rkey}`)
    && value.state.snapshotId === value.snapshotId
    && typeof message.rkey === 'string' && typeof message.sha256 === 'string' && /^[a-f0-9]{64}$/.test(message.sha256)
    && message.logicalMessageId === value.state.logicalMessageId && message.fingerprint === value.state.version
    && typeof message.raw === 'string' && /^[A-Za-z0-9+/]*={0,2}$/.test(message.raw)
    && message.raw.length % 4 === 0
    && message.raw.length / 4 * 3 - (message.raw.endsWith('==') ? 2 : message.raw.endsWith('=') ? 1 : 0) === message.size
    && Number.isSafeInteger(message.size) && (message.size as number) > 0 && (message.size as number) <= MAX_MAIL_BYTES;
}

export interface MailFolder {
  folderId: string; snapshotId: string; name: string; role?: string; tombstone: boolean;
  heads: string[]; headsDigest: string; stateDigest: string; height: number; revisionCount: number;
}
export type MailMetadata = Omit<SelectedMail['message'], 'raw'>;
export interface MailInventory {
  snapshotId: string; folders: MailFolder[]; entries: { message: MailMetadata; state: MailState; deliveredAt?: string }[];
  total: number; nextAfter?: string;
}

export function isMailFolder(value: unknown): value is MailFolder {
  return object(value) && typeof value.folderId === 'string' && /^folder-[a-f0-9]{64}$/.test(value.folderId)
    && identifier(value.snapshotId) && typeof value.name === 'string' && (value.role === undefined || typeof value.role === 'string')
    && typeof value.tombstone === 'boolean' && strings(value.heads) && identifier(value.headsDigest) && identifier(value.stateDigest)
    && Number.isSafeInteger(value.height) && (value.height as number) > 0
    && Number.isSafeInteger(value.revisionCount) && (value.revisionCount as number) >= (value.height as number);
}
export function isMailInventory(value: unknown, did: string): value is MailInventory {
  if (!object(value) || !identifier(value.snapshotId) || !Array.isArray(value.folders) || !value.folders.every(isMailFolder)
    || !Array.isArray(value.entries) || !Number.isSafeInteger(value.total) || (value.total as number) < value.entries.length
    || value.nextAfter !== undefined && !identifier(value.nextAfter)) return false;
  return value.entries.every(entry => object(entry) && isMailState(entry.state) && object(entry.message)
    && (entry.deliveredAt === undefined || deliveryTime(entry.deliveredAt))
    && entry.state.snapshotId === value.snapshotId && entry.message.logicalMessageId === entry.state.logicalMessageId
    && entry.message.fingerprint === entry.state.version && typeof entry.message.rkey === 'string'
    && typeof entry.message.uri === 'string' && /^at:\/\/did:[^/?#\s]+\/space\/[^?#\s]+$/.test(entry.message.uri)
    && entry.message.uri.endsWith(`/${did}/email.atmos.message/${entry.message.rkey}`)
    && Number.isSafeInteger(entry.message.size) && (entry.message.size as number) > 0 && (entry.message.size as number) <= MAX_MAIL_BYTES);
}
