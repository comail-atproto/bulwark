"use client";

import { forwardRef, useId, type HTMLAttributes, type ReactNode } from "react";
import { focusTemporarily } from "@/lib/keyboard";

/**
 * The skip link at the top of an app: hidden until it has the focus, then
 * it moves the focus past the rail and the sidebar (WCAG 2.4.1).
 */
export function SkipLink({ targetId, children }: { targetId?: string; children: ReactNode }) {
  return (
    <a
      href={targetId ? `#${targetId}` : "#main"}
      onClick={(e) => {
        e.preventDefault();
        // Without a target, the page's <main> (there is one per app).
        const target = targetId ? document.getElementById(targetId) : document.querySelector<HTMLElement>("main");
        if (target) focusTemporarily(target);
      }}
      className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:start-2 focus:z-[70] focus:rounded-md focus:bg-background focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-foreground focus:shadow-md focus:outline-hidden"
    >
      {children}
    </a>
  );
}

interface AppMainProps extends Omit<HTMLAttributes<HTMLElement>, "role"> {
  /**
   * Inside the Pro shell, where several apps share one page: a named region
   * instead of a second <main>.
   */
  embedded?: boolean;
  /** An h1 for screen readers, naming where you are ("Inbox – Mail"). */
  heading?: string;
  /** The landmark's name when the app shows its own h1 (the calendar's date). */
  label?: string;
  /** False when the panes inside it (Mail's list and reader) take F6 instead. */
  pane?: boolean;
  children: ReactNode;
}

/**
 * An app's main content: one <main> around it (not around the rail or the
 * sidebar), a pane for F6, and with an h1 when the app has no visible one.
 */
export const AppMain = forwardRef<HTMLElement, AppMainProps>(function AppMain(
  { embedded = false, heading, label, pane = true, className, children, ...rest },
  ref,
) {
  const headingId = useId();
  const Tag = embedded ? "section" : "main";
  return (
    <Tag
      ref={ref as never}
      data-pane={pane ? "main" : undefined}
      aria-labelledby={heading ? headingId : undefined}
      aria-label={heading ? undefined : label}
      className={className}
      {...rest}
    >
      {heading && <h1 id={headingId} className="sr-only">{heading}</h1>}
      {children}
    </Tag>
  );
});
