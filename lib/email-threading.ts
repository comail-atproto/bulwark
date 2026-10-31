/**
 * RFC 5322 §3.6.4 reply threading.
 *
 * Computes the In-Reply-To and References headers an outgoing reply must
 * carry so MUAs can stitch the conversation back together.
 *
 *   In-Reply-To = parent.Message-ID
 *   References  = parent.References (if any) + parent.Message-ID
 *
 * Bare msg-ids only - angle brackets are stripped because JMAP RFC 8621
 * §4.1.2.3 stores Message-IDs without them.
 */

export interface ParentThreadingInfo {
  // JMAP RFC 8621 §4.1.2.3 specifies messageId as String[]|null, but the
  // codebase has historically typed it as string. Accept either shape.
  messageId?: string | string[];
  references?: string[];
}

export interface ReplyThreadingHeaders {
  inReplyTo: string[];
  references: string[];
}

export function stripMessageIdBrackets(id: string): string {
  return id.trim().replace(/^<+/, '').replace(/>+$/, '').trim();
}

export function computeReplyThreadingHeaders(
  parent: ParentThreadingInfo | undefined,
): ReplyThreadingHeaders | null {
  const rawId = Array.isArray(parent?.messageId) ? parent.messageId[0] : parent?.messageId;
  const parentId = rawId ? stripMessageIdBrackets(rawId) : '';
  if (!parentId) return null;

  const ancestors = (parent?.references ?? [])
    .map(stripMessageIdBrackets)
    .filter(Boolean);

  // De-dupe while preserving order; the parent's id closes the chain.
  const seen = new Set<string>();
  const references: string[] = [];
  for (const id of [...ancestors, parentId]) {
    if (seen.has(id)) continue;
    seen.add(id);
    references.push(id);
  }

  return { inReplyTo: [parentId], references };
}
