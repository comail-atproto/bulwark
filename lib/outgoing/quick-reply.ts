import type { Identity } from '@/lib/jmap/types';
import { appendHtmlSignature, appendPlainTextSignature } from '@/lib/signature-utils';
import { currentSignatureIdentity } from '@/lib/org/signature-state';
import { findUnfilledPlaceholders, type PlaceholderWords } from '@/lib/placeholder-check';
import { finalizeOutgoing, runPreSendChecks, type OutgoingBodies } from './send-pipeline';
// Registers the organisation signature check and the disclaimer.
import '@/lib/org/outgoing';

/** A question the composer asks before sending, asked by quick reply too. */
export type QuickReplyQuestion =
  | { kind: 'placeholders'; found: string[] }
  | { kind: 'attachment'; keyword: string }
  | { kind: 'send' };

export interface QuickReplyQuestions {
  /** The fill-in words of the placeholder warning; null when it is off. */
  placeholderWords: PlaceholderWords[] | null;
  /** The keywords of the attachment reminder; null when it is off. */
  attachmentKeywords: string[] | null;
  /** "Confirm before sending" is on. */
  confirmSend: boolean;
  /** Resolves true to send anyway. */
  ask: (question: QuickReplyQuestion) => Promise<boolean>;
}

/**
 * The bodies a quick reply sends: the typed text with the signature, as
 * HTML too when the signature is HTML, after the same warnings, pre-send
 * checks and finalisers as the composer's send. Null when one stopped the
 * send. The organisation signature applies as in the composer
 * (`signatureIdentity` is what the reply would sign with on its own,
 * `sendingIdentity` the identity it goes out from).
 */
export async function prepareQuickReply(input: {
  body: string;
  signatureIdentity: Identity | null | undefined;
  sendingIdentity?: Identity | null;
  separator: boolean;
  to: string[];
  fromEmail?: string;
  identityId?: string;
  questions?: QuickReplyQuestions;
}): Promise<OutgoingBodies | null> {
  const { body, separator, questions } = input;

  // The composer's warnings, in its order. Only the typed text counts: the
  // subject and the signature are not the user's words here.
  if (questions?.placeholderWords) {
    const found = findUnfilledPlaceholders('', body, questions.placeholderWords);
    if (found.length > 0 && !(await questions.ask({ kind: 'placeholders', found }))) return null;
  }
  // A quick reply carries no attachments, so any keyword is a reminder.
  if (questions?.attachmentKeywords) {
    const lower = body.toLowerCase();
    const keyword = questions.attachmentKeywords.find(kw => kw.trim() && lower.includes(kw.toLowerCase()));
    if (keyword && !(await questions.ask({ kind: 'attachment', keyword }))) return null;
  }

  const signatureIdentity = currentSignatureIdentity(input.signatureIdentity, input.sendingIdentity ?? undefined);
  const text = appendPlainTextSignature(body, signatureIdentity, { separator });

  // When the identity has an HTML signature, send a matching HTML body so the
  // signature keeps its formatting; appendPlainTextSignature would otherwise
  // flatten it to plain text. Text-only identities keep the plain-text-only
  // behavior (no HTML part).
  const escapedBody = body
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\n/g, '<br>');
  const html = signatureIdentity?.htmlSignature?.trim()
    ? appendHtmlSignature(`<div>${escapedBody}</div>`, signatureIdentity, { separator })
    : undefined;

  const context = {
    surface: 'quick-reply' as const,
    to: input.to,
    cc: [],
    bcc: [],
    fromEmail: input.fromEmail,
    identityId: input.identityId,
    sender: input.sendingIdentity
      ? { name: input.sendingIdentity.name, email: input.sendingIdentity.email }
      : undefined,
    mode: 'reply' as const,
    plainText: !html,
  };
  if (!(await runPreSendChecks(context))) return null;
  // Asked last, as in the composer, so an answered warning doesn't ask twice.
  if (questions?.confirmSend && !(await questions.ask({ kind: 'send' }))) return null;
  // Quick reply has no plugin step in between: both stages at once.
  return finalizeOutgoing(finalizeOutgoing({ html, text }, context), context, 'last');
}
