import { normalizeCid } from '@/lib/attachment-visibility';

/** An attachment handed to createDraft / sendEmail. */
export interface OutgoingAttachment {
  blobId: string;
  name: string;
  type: string;
  size?: number;
  disposition?: 'attachment' | 'inline';
  cid?: string;
}

/** An Email/set bodyStructure part (RFC 8621 §4.1.4, EmailBodyPart). */
export interface OutgoingBodyPart {
  type: string;
  partId?: string;
  blobId?: string;
  name?: string;
  disposition?: string;
  cid?: string;
  subParts?: OutgoingBodyPart[];
}

/** The part ids createDraft and sendEmail give the text and HTML bodyValues. */
export const TEXT_PART_ID = 'text';
export const HTML_PART_ID = 'html';

function attachmentPart(att: OutgoingAttachment): OutgoingBodyPart {
  return {
    blobId: att.blobId,
    type: att.type,
    name: att.name,
    disposition: att.disposition ?? 'attachment',
    ...(att.cid ? { cid: att.cid } : {}),
  };
}

/** The `attachments` list for an Email/set create built from textBody/htmlBody. */
export function attachmentParts(attachments: OutgoingAttachment[]): OutgoingBodyPart[] {
  return attachments.map(attachmentPart);
}

function referencedByHtml(html: string, cid: string): boolean {
  const ref = `cid:${normalizeCid(cid)}`.toLowerCase();
  const lower = html.toLowerCase();
  return lower.includes(ref) || lower.includes(encodeURI(ref));
}

/**
 * The MIME tree for an HTML message whose body shows images by `cid:`
 * reference, or null when it shows none.
 *
 * Given textBody, htmlBody and attachments, the server decides where each
 * part goes, and Stalwart puts every attachment, inline ones included, in
 * the outer multipart/mixed. Recipients then don't find the images the HTML
 * points to, and Stalwart 1.0 doesn't even list them as attachments, so our
 * own Sent view can't show them either (#1451). Images belong in a
 * multipart/related next to the HTML part (RFC 2387):
 *
 *   multipart/mixed            (only with regular attachments)
 *     multipart/alternative
 *       text/plain
 *       multipart/related
 *         text/html
 *         image/png  (inline, Content-ID)
 *     attachment
 *
 * The text parts refer to the `text` and `html` bodyValues.
 */
export function relatedBodyStructure(
  htmlBody: string | undefined,
  attachments: OutgoingAttachment[] | undefined,
): OutgoingBodyPart | null {
  if (!htmlBody || !attachments?.length) return null;
  const isRelated = (att: OutgoingAttachment) =>
    !!att.cid && att.disposition !== 'attachment' && referencedByHtml(htmlBody, att.cid);
  const related = attachments.filter(isRelated);
  if (related.length === 0) return null;
  const others = attachments.filter((att) => !isRelated(att));

  const alternative: OutgoingBodyPart = {
    type: 'multipart/alternative',
    subParts: [
      { partId: TEXT_PART_ID, type: 'text/plain' },
      {
        type: 'multipart/related',
        subParts: [
          { partId: HTML_PART_ID, type: 'text/html' },
          ...related.map((att) => attachmentPart({ ...att, disposition: 'inline' })),
        ],
      },
    ],
  };
  if (others.length === 0) return alternative;
  return { type: 'multipart/mixed', subParts: [alternative, ...others.map(attachmentPart)] };
}
