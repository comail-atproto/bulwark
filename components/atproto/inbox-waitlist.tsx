"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Check, Loader2 } from "@/components/icons";
import { withBasePath } from "@/lib/browser-navigation";

interface WaitlistSession {
  csrf: string;
  identity: string;
}

type WaitlistError = "try_again" | "proof_required" | "inbox_available" | "invalid_email" | "rate_limited";

function responseError(code: unknown): WaitlistError {
  switch (code) {
    case "waitlist_proof_required": return "proof_required";
    case "inbox_available": return "inbox_available";
    case "invalid_email": return "invalid_email";
    case "rate_limited": return "rate_limited";
    default: return "try_again";
  }
}

const REQUEST_TIMEOUT_MS = 10_000;

export function InboxWaitlist({ loginUrl, callbackError }: { loginUrl: string; callbackError: string | null }) {
  const t = useTranslations("login");
  const [session, setSession] = useState<WaitlistSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<WaitlistError | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [notification, setNotification] = useState<"pending" | "confirmed" | null>(null);
  const notificationRequest = useRef<AbortController | null>(null);

  // Inbox owns this proof and its root routes, even with a mounted Bulwark UI.
  let endpoint: string | null = null;
  try {
    const configured = new URL(loginUrl);
    if (configured.origin === window.location.origin && configured.pathname === "/webmail/login" && !configured.search && !configured.hash) {
      endpoint = new URL("/inbox/waitlist", configured.origin).href;
    }
  } catch { /* An invalid or external login cannot receive the proof. */ }

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    async function load() {
      setLoading(true);
      setSession(null);
      setNotification(null);
      setError(null);
      try {
        if (callbackError === "try_again" || callbackError === "inbox_available") {
          setError(callbackError);
          return;
        }
        if (!endpoint) throw new Error("unavailable");
        const response = await fetch(endpoint + "/session", {
          credentials: "same-origin", headers: { Accept: "application/json" }, signal: controller.signal,
        });
        const data = await response.json();
        if (!active) return;
        if (response.ok && data?.state === "waitlist" && data.recorded === true && typeof data.csrf === "string" && data.csrf && typeof data.did === "string" && data.did.startsWith("did:")) {
          setSession({ csrf: data.csrf, identity: typeof data.handle === "string" && data.handle ? "@" + data.handle : data.did });
        } else {
          setError(responseError(data?.error));
        }
      } catch {
        if (active) setError("try_again");
      } finally {
        clearTimeout(timeout);
        if (active) setLoading(false);
      }
    }
    void load();
    return () => { active = false; clearTimeout(timeout); controller.abort(); };
  }, [endpoint, callbackError, attempt]);

  useEffect(() => () => { notificationRequest.current?.abort(); notificationRequest.current = null; }, []);

  async function requestNotification(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!endpoint || !session || notificationRequest.current) return;
    const controller = new AbortController();
    notificationRequest.current = controller;
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch(endpoint, {
        method: "POST", credentials: "same-origin", signal: controller.signal,
        headers: { "Content-Type": "application/json", "X-Comail-Waitlist-CSRF": session.csrf },
        body: JSON.stringify({ notification_email: email.trim(), notify_when_available: true }),
      });
      const data = await response.json();
      if (notificationRequest.current !== controller) return;
      if (response.ok && data?.state === "confirmation_pending") setNotification("pending");
      else if (response.ok && data?.state === "recorded") setNotification("confirmed");
      else setError(responseError(data?.error));
    } catch {
      if (notificationRequest.current === controller) setError("try_again");
    } finally {
      clearTimeout(timeout);
      if (notificationRequest.current === controller) { setSubmitting(false); notificationRequest.current = null; }
    }
  }

  return (
    <>
      <h1 className="text-4xl leading-tight text-foreground">{session ? t("waitlist.title") : t("waitlist.checking")}</h1>
      {loading && <p className="mt-4 flex items-center gap-2 text-muted-foreground" role="status"><Loader2 className="h-5 w-5 animate-spin" />{t("waitlist.loading")}</p>}
      {session && <>
        <p className="mt-4 break-words text-base leading-relaxed text-muted-foreground">{t("waitlist.identity", { identity: session.identity })}</p>
        <div className="mt-8 space-y-2">
          <p className="flex items-center gap-2 font-bold text-foreground" role="status"><Check className="h-5 w-5" aria-hidden="true" />{t("waitlist.saved")}</p>
          <p className="text-sm leading-relaxed text-muted-foreground">{t("waitlist.close")}</p>
        </div>
        <section className="mt-8 border-t border-sidebar-border pt-6" aria-labelledby="waitlist-email-title">
          <h2 id="waitlist-email-title" className="text-xl text-foreground">{t("waitlist.email_title")}</h2>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{t("waitlist.optional")}</p>
          {!notification && <details className="mt-5">
            <summary className="cursor-pointer text-sm font-bold text-foreground">{t("waitlist.add_email")}</summary>
            <form onSubmit={requestNotification} className="mt-5 space-y-5">
              <div className="space-y-2">
                <label htmlFor="waitlist-email" className="block text-sm font-bold text-foreground">{t("waitlist.email_label")}</label>
                <Input id="waitlist-email" type="email" autoComplete="email" required value={email} onChange={event => setEmail(event.target.value)} className="h-12 rounded-sm px-4 text-base" disabled={submitting} aria-describedby="waitlist-email-help" />
                <p id="waitlist-email-help" className="text-sm leading-relaxed text-muted-foreground">{t("waitlist.email_hint")}</p>
              </div>
              <Button type="submit" variant="ghost" className="comail-login-submit min-h-12 w-full justify-between rounded-sm text-base font-bold whitespace-normal text-start" disabled={submitting}>
                <span>{submitting ? t("waitlist.sending") : t("waitlist.notify")}</span><span aria-hidden="true">→</span>
              </Button>
            </form>
          </details>}
          {notification && <div className="mt-5 space-y-2" role="status">
            <p className="font-bold text-foreground">{t(notification === "pending" ? "waitlist.check_email" : "waitlist.email_confirmed")}</p>
            <p className="break-words text-sm leading-relaxed text-muted-foreground">{t(notification === "pending" ? "waitlist.confirmation_sent" : "waitlist.notifications_enabled", { email: email.trim() })}</p>
            <p className="text-sm leading-relaxed text-muted-foreground">{t("waitlist.already_saved")}</p>
          </div>}
        </section>
      </>}
      {error && <div className="mt-6 space-y-3">
        <p className="text-sm leading-relaxed text-foreground" role="alert">{t(`waitlist.${error}`)}</p>
        {(error === "proof_required" || error === "inbox_available" || callbackError) ? <a className="text-sm underline underline-offset-4" href={withBasePath("/login")}>{t("waitlist.sign_in")}</a> : !session && <Button type="button" variant="outline" onClick={() => setAttempt(value => value + 1)}>{t("waitlist.retry")}</Button>}
      </div>}
    </>
  );
}
