"use client";

import type { AnchorHTMLAttributes, MouseEvent, ReactNode } from "react";
import { requestInternalMailto } from "@/lib/protocol-handlers/mailto";

interface MailtoLinkProps extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href" | "onClick"> {
  /** Bare address, or a full mailto: URL when subject/body are needed. */
  to: string;
  children: ReactNode;
}

/**
 * An address in the app's own chrome (contact cards, sidebars, contact
 * details). Handing a `mailto:` URL to the OS mail handler goes nowhere in a
 * webmail client - unless the user happened to register Bulwark as their
 * system handler - so the click opens the built-in composer instead.
 *
 * Deliberately still an anchor with a real href: right-click "Copy email
 * address", middle-click and assistive technology all keep working, and a
 * plain click is simply redirected. Modified clicks are left alone.
 *
 * Only for app chrome. Links inside message content are untrusted and keep
 * their existing behaviour.
 */
export function MailtoLink({ to, children, ...anchorProps }: MailtoLinkProps) {
  const href = to.toLowerCase().startsWith("mailto:") ? to : `mailto:${to}`;

  const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
    // Let the browser handle "open in new tab/window" style clicks.
    if (event.defaultPrevented || event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (!requestInternalMailto(href)) return;
    event.preventDefault();
  };

  return (
    <a href={href} onClick={handleClick} {...anchorProps}>
      {children}
    </a>
  );
}
