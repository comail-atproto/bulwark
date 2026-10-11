import type { Email } from "@/lib/jmap/types";
import { buildForwardSubject } from "@/lib/subject-prefix";
import { emailExportFilename, type EmailFilenameOptions } from "@/lib/download-filename";

export interface ForwardAsAttachmentEntry {
  blobId: string;
  name: string;
  type: "message/rfc822";
  size: number;
}

export interface ForwardAsAttachmentPayload {
  subject: string;
  attachment: ForwardAsAttachmentEntry;
}

/**
 * Build the subject and synthetic attachment entry for forwarding a
 * message as a message/rfc822 attachment instead of inline-quoted text
 * (e.g. reporting spam to an upstream gateway that expects the raw
 * original as an attachment, or preserving exact formatting/headers).
 *
 * Referenced by blobId, not re-uploaded - JMAP blobs are account-scoped,
 * not per-email, so the same blobId a message already has can be attached
 * to a brand new outgoing email directly.
 *
 * `filenameOptions`, when passed, carries the user's configured space/case/
 * diacritics transforms (see useSettingsStore's filenameSpaceReplacement
 * and friends) for consistency with "Export as .eml" / drag-out. Its
 * `template`, if any, is ignored: this attachment goes out to a possibly
 * external recipient (spam gateway, another person), so the filename is
 * always just "{date}-{subject}.eml" - never the user's own from/to naming
 * template, which could otherwise leak sender/recipient names into an
 * attachment filename visible to that recipient.
 *
 * Returns null when the email has no blobId (nothing to reference).
 */
export function buildForwardAsAttachmentPayload(
  email: Email,
  forwardPrefix: string,
  filenameOptions?: EmailFilenameOptions,
): ForwardAsAttachmentPayload | null {
  if (!email.blobId) return null;

  return {
    // Match the normal Forward flow's getInitialSubject(), which leaves the
    // subject blank rather than prefix-only when the original has none -
    // buildForwardSubject("", prefix) would otherwise return just the bare
    // prefix (e.g. "Fwd:") for a subject-less message.
    subject: email.subject ? buildForwardSubject(email.subject, forwardPrefix) : "",
    attachment: {
      blobId: email.blobId,
      name: emailExportFilename(email, { ...filenameOptions, template: "{date}-{subject}" }),
      type: "message/rfc822",
      size: email.size,
    },
  };
}
