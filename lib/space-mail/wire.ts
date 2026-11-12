export const MAX_MAIL_BYTES = 10 * 1024 * 1024;
export interface MailState {
  logicalMessageId: string; snapshotId: string; version: string;
  mailboxIds: string[]; keywords: string[]; deletePending: boolean; tombstone: boolean;
  heads: string[]; headsDigest: string; stateDigest: string; height: number; revisionCount: number;
}
export interface SelectedMail {
  snapshotId: string; state: MailState;
  message: { uri: string; rkey: string; fingerprint: string; logicalMessageId: string; sourceKey?: string; sha256: string; size: number; raw: string };
  folders: unknown[];
}
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every(v => typeof v === 'string');
const identifier = (value: unknown): value is string => typeof value === 'string' && /^sha256-[a-f0-9]{64}$/.test(value);
export function isMailState(value: unknown): value is MailState {
  return object(value) && ['logicalMessageId', 'snapshotId', 'version', 'headsDigest', 'stateDigest'].every(key => identifier(value[key]))
    && ['mailboxIds', 'keywords', 'heads'].every(key => strings(value[key]))
    && typeof value.deletePending === 'boolean' && typeof value.tombstone === 'boolean'
    && Number.isSafeInteger(value.height) && (value.height as number) > 0
    && Number.isSafeInteger(value.revisionCount) && (value.revisionCount as number) >= (value.height as number);
}
export function isSelectedMail(value: unknown, did: string): value is SelectedMail {
  if (!object(value) || !identifier(value.snapshotId) || !isMailState(value.state) || !object(value.message) || !Array.isArray(value.folders)) return false;
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
