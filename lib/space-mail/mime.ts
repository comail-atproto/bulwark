import PostalMime, { type Address } from 'postal-mime';
import type { Email, EmailAddress, EmailBodyPart } from '@/lib/jmap/types';
import { authenticationResultsOnReceipt, parseAuthenticationResults } from '@/lib/email-headers';
import type { MailState } from './wire';

const addresses = (values: Address[] = []): EmailAddress[] => values.flatMap(value => value.group
  ? addresses(value.group) : value.address ? [{ email: value.address, ...(value.name ? { name: value.name } : {}) }] : []);
const messageIds = (value?: string): string[] => value?.match(/<[^<>]+>/g)?.map(id => id.slice(1, -1)) ?? (value ? value.trim().split(/\s+/) : []);

/** Decoded parts remain in browser memory; the raw message stays available for export and S/MIME. */
export async function parsePrivateMail(raw: Uint8Array, state: MailState, deliveredAt?: string): Promise<{ email: Email; blobs: Map<string, Blob> }> {
  const bytes = Uint8Array.from(raw);
  const parsed = await PostalMime.parse(bytes, { forceRfc822Attachments: true });
  const prefix = `space-mail:${state.logicalMessageId}:${state.version}`;
  const blobs = new Map<string, Blob>([[prefix, new Blob([bytes], { type: 'message/rfc822' })]]);
  const headers: Record<string, string | string[]> = {};
  for (const header of parsed.headers) {
    const previous = headers[header.key];
    headers[header.key] = previous === undefined ? header.value : [...(Array.isArray(previous) ? previous : [previous]), header.value];
  }
  const bodyValues: NonNullable<Email['bodyValues']> = {};
  const bodyPart = (partId: string, value: string | undefined, type: string): EmailBodyPart[] => {
    if (value === undefined) return [];
    const blob = new Blob([value], { type });
    const blobId = `${prefix}:${partId}`;
    blobs.set(blobId, blob);
    bodyValues[partId] = { value, isEncodingProblem: false, isTruncated: false };
    return [{ partId, blobId, size: blob.size, type, charset: 'utf-8' }];
  };
  const textBody = bodyPart('text', parsed.text, 'text/plain');
  const htmlBody = bodyPart('html', parsed.html, 'text/html');
  const attachments = parsed.attachments.map((attachment, index) => {
    const partId = `attachment-${index}`;
    const blobId = `${prefix}:${partId}`;
    const content = attachment.content;
    if (typeof content === 'string') throw new Error('Unexpected MIME attachment encoding');
    const bytes = content instanceof Uint8Array ? Uint8Array.from(content) : new Uint8Array(content);
    const blob = new Blob([bytes], { type: attachment.mimeType });
    blobs.set(blobId, blob);
    return { partId, blobId, size: blob.size, name: attachment.filename ?? undefined, type: attachment.mimeType,
      cid: attachment.contentId?.replace(/^<|>$/g, ''), disposition: attachment.related ? 'inline' : attachment.disposition ?? 'attachment' };
  });
  const inReplyTo = messageIds(parsed.inReplyTo);
  const references = messageIds(parsed.references);
  const date = parsed.date && Number.isFinite(Date.parse(parsed.date)) ? new Date(parsed.date).toISOString() : undefined;
  const email: Email = {
    id: state.logicalMessageId, threadId: references[0] ?? inReplyTo[0] ?? parsed.messageId?.replace(/^<|>$/g, '') ?? state.logicalMessageId,
    blobId: prefix, size: raw.byteLength, mailboxIds: Object.fromEntries(state.mailboxIds.map(id => [id, true])),
    keywords: Object.fromEntries(state.keywords.map(key => [key, true])), receivedAt: deliveredAt ?? '', sentAt: date,
    from: parsed.from ? addresses([parsed.from]) : [], to: addresses(parsed.to), cc: addresses(parsed.cc), bcc: addresses(parsed.bcc), replyTo: addresses(parsed.replyTo),
    authenticationResultsOnReceipt: authenticationResultsOnReceipt(parsed.headers.map(header => ({ name: header.originalKey, value: header.value }))),
    authenticationResults: headers['authentication-results'] ? parseAuthenticationResults(headers['authentication-results']) : undefined,
    subject: parsed.subject ?? '', messageId: parsed.messageId?.replace(/^<|>$/g, ''), inReplyTo, references, headers,
    preview: (parsed.text ?? '').replace(/\s+/g, ' ').slice(0, 256), textBody, htmlBody, bodyValues, attachments,
    hasAttachment: attachments.some(part => part.disposition !== 'inline'),
    bodyStructure: { partId: 'root', blobId: prefix, size: raw.byteLength, type: 'multipart/mixed', subParts: [...textBody, ...htmlBody, ...attachments] },
  };
  return { email, blobs };
}
