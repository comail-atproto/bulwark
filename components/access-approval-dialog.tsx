"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { CheckCircle2, Clock3, Laptop, MapPin, ShieldCheck, Smartphone } from "lucide-react";
import { apiFetch, withBasePath } from "@/lib/browser-navigation";
import { useFocusTrap } from "@/hooks/use-focus-trap";
import { Button } from "@/components/ui/button";
import {
  dismissAccessApprovalNotification,
  showAccessApprovalNotification,
} from "@/lib/access-approval/browser-notification";

type AccessRequestStatus = "pending" | "approved" | "denied" | "expired" | "cancelled" | "consumed";

type AccessRequest = {
  id: number;
  clientId: string;
  clientName: string;
  scopes: string[];
  deviceLabel: string;
  coarseLocation?: string;
  numberMatch: string;
  expiresAt: string;
  status: AccessRequestStatus;
  createdAt: string;
  authoritative: true;
  decisionApplied?: boolean;
};

type Resolution = {
  requestId: number;
  status: Exclude<AccessRequestStatus, "pending"> | "handled";
  requested?: "approved" | "denied";
  decisionApplied?: boolean;
};

type ListResponse = {
  accessRequests: AccessRequest[];
  authoritative: boolean;
};

const POLL_MS = 2_000;

function scopeLabel(scope: string): string {
  if (scope === "atproto") return "Use your Atmosphere account";
  if (scope.includes("transition:generic")) return "Access app data you approve";
  return scope.replace(/^transition:/, "").replaceAll(":", " · ");
}

export function AccessApprovalDialog() {
  const [request, setRequest] = useState<AccessRequest | null>(null);
  const [resolution, setResolution] = useState<Resolution | null>(null);
  const [disabled, setDisabled] = useState(false);
  const [submitting, setSubmitting] = useState<"approved" | "denied" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const notifiedRequestId = useRef<number | null>(null);
  const notificationInFlightId = useRef<number | null>(null);
  const requestRef = useRef<AccessRequest | null>(null);
  const approvalWakeRef = useRef(false);
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useFocusTrap({
    isActive: request !== null,
    restoreFocus: true,
  });

  const resolveRequest = useCallback((next: Resolution) => {
    requestRef.current = null;
    setRequest(null);
    setError(null);
    setResolution(next);
    void dismissAccessApprovalNotification();
  }, []);

  const poll = useCallback(
    async (force = false) => {
      if (disabled || (submitting && !force)) return;
      try {
        const response = await apiFetch("/api/access-approvals", {
          credentials: "include",
          cache: "no-store",
          headers: { Accept: "application/json" },
        });
        // 404 is the expected response for every account outside the exact-DID
        // rollout. Stop polling quietly so the feature is invisible to them.
        if (response.status === 404 || response.status === 401) {
          setDisabled(true);
          setRequest(null);
          return;
        }
        if (!response.ok) return;
        const data = (await response.json()) as ListResponse;
        const live = data.authoritative
          ? data.accessRequests.find((item) => item.status === "pending" && Date.parse(item.expiresAt) > Date.now())
          : undefined;
        const previous = requestRef.current;
        if (live) {
          requestRef.current = live;
          setRequest(live);
          setResolution(null);
          setError(null);
        } else if (previous) {
          resolveRequest({
            requestId: previous.id,
            status: Date.parse(previous.expiresAt) <= Date.now() ? "expired" : "handled",
          });
        } else if (approvalWakeRef.current) {
          approvalWakeRef.current = false;
          setResolution({ requestId: 0, status: "handled" });
          void dismissAccessApprovalNotification();
        } else {
          setRequest(null);
        }
      } catch {
        // A transient network failure should not disrupt mail; the next poll
        // retries. Decisions surface their errors because the user acted.
      }
    },
    [disabled, resolveRequest, submitting],
  );

  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get("approvalWake") !== "1") return;
    approvalWakeRef.current = true;
    url.searchParams.delete("approvalWake");
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
  }, []);

  useEffect(() => {
    void poll();
    const timer = window.setInterval(() => void poll(), POLL_MS);
    const refresh = () => void poll();
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [poll]);

  useEffect(() => {
    if (!resolution) return;
    const timer = window.setTimeout(() => setResolution(null), 5_000);
    return () => window.clearTimeout(timer);
  }, [resolution]);

  useEffect(() => {
    if (!request) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [request]);

  useEffect(() => {
    if (!request) return;

    const requestId = request.id;
    const maybeNotify = async () => {
      if (notifiedRequestId.current === requestId || notificationInFlightId.current === requestId) return;
      notificationInFlightId.current = requestId;
      const shown = await showAccessApprovalNotification(request);
      if (shown) notifiedRequestId.current = requestId;
      if (notificationInFlightId.current === requestId) notificationInFlightId.current = null;
    };

    // Try immediately for a tab that was already backgrounded, then again on
    // visibility changes so a request first seen on-screen can wake the owner
    // if they move to another tab before deciding.
    void maybeNotify();
    document.addEventListener("visibilitychange", maybeNotify);
    return () => document.removeEventListener("visibilitychange", maybeNotify);
  }, [request]);

  const secondsLeft = request ? Math.max(0, Math.ceil((Date.parse(request.expiresAt) - now) / 1_000)) : 0;
  const permissions = useMemo(() => request?.scopes.map(scopeLabel) ?? [], [request]);

  const decide = async (decision: "approved" | "denied") => {
    if (!request || submitting) return;
    const target = request;
    setSubmitting(decision);
    setError(null);
    try {
      const response = await apiFetch(`/api/access-approvals/${request.id}/decision`, {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ decision }),
      });
      if (!response.ok) {
        if (response.status === 409 || response.status === 404) {
          resolveRequest({
            requestId: target.id,
            status: "handled",
            requested: decision,
          });
          return;
        }
        throw new Error("decision failed");
      }
      const settled = (await response.json()) as Partial<AccessRequest>;
      const status = settled.status;
      resolveRequest({
        requestId: target.id,
        status: status && status !== "pending" ? status : decision,
        requested: decision,
        decisionApplied: settled.decisionApplied === true,
      });
    } catch {
      // The response can be lost after another surface wins. Re-fetch before
      // showing an error so a normal cross-device race resolves quietly.
      await poll(true);
      if (requestRef.current?.id === target.id) {
        setError("We couldn’t send your answer. Check your connection and try again.");
      }
    } finally {
      setSubmitting(null);
      window.setTimeout(() => void poll(), 0);
    }
  };

  if (resolution) {
    const copy =
      resolution.status === "approved"
        ? resolution.requested === "approved" && resolution.decisionApplied
          ? "Login allowed"
          : "Already allowed on another device"
        : resolution.status === "denied"
          ? resolution.requested === "denied" && resolution.decisionApplied
            ? "Login denied"
            : "Already denied on another device"
          : resolution.status === "expired"
            ? "This login request expired"
            : resolution.status === "consumed"
              ? "Login already completed on another device"
              : resolution.status === "cancelled"
                ? "This login request was cancelled"
                : "Request handled on another device";
    return (
      <div
        className="fixed bottom-5 left-1/2 z-[80] w-[min(92vw,30rem)] -translate-x-1/2"
        role="status"
        aria-live="polite"
      >
        <div className="flex items-center gap-3 rounded-xl border border-border bg-card p-4 text-card-foreground shadow-2xl">
          <CheckCircle2 className="h-6 w-6 shrink-0 text-[#1a5e6f] dark:text-[#6dbfd6]" aria-hidden="true" />
          <div>
            <p className="font-bold">{copy}</p>
            <p className="mt-0.5 text-sm text-muted-foreground">
              This screen is up to date. No further action is needed.
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (!request || secondsLeft <= 0) return null;

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-[#012102]/55 p-4 backdrop-blur-[2px] animate-in fade-in duration-150">
      <div
        ref={dialogRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        className="w-full max-w-lg overflow-hidden rounded-xl border border-border bg-card text-card-foreground shadow-2xl animate-in zoom-in-95 duration-200"
      >
        <div className="h-1.5 bg-[#3fa1c0]" />
        <div className="p-6 sm:p-8">
          <div className="flex items-start gap-4">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-[#cfe6ec] dark:bg-[#06322e]">
              <img src={withBasePath("/branding/comail/cammie-mark.png")} alt="" className="h-10 w-10 object-contain" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="mb-1 text-xs font-bold uppercase tracking-[0.16em] text-[#1a5e6f] dark:text-[#6dbfd6]">
                Account security
              </p>
              <h2 id={titleId} className="text-2xl leading-tight text-foreground">
                New Atmosphere login
              </h2>
              <p id={descriptionId} className="mt-2 text-sm leading-6 text-muted-foreground">
                A new phone is asking to sign in to <strong className="text-foreground">{request.clientName}</strong>.
                Is this you?
              </p>
            </div>
          </div>

          <div className="mt-6 rounded-lg border border-border bg-background/70">
            <div className="grid grid-cols-[1.5rem_6rem_1fr] items-center gap-3 border-b border-border px-4 py-3 text-sm">
              <Smartphone className="h-4 w-4 text-[#1a5e6f] dark:text-[#6dbfd6]" aria-hidden="true" />
              <span className="text-muted-foreground">Device</span>
              <span className="font-bold text-foreground">{request.deviceLabel || "New phone"}</span>
            </div>
            <div className="grid grid-cols-[1.5rem_6rem_1fr] items-center gap-3 border-b border-border px-4 py-3 text-sm">
              <Laptop className="h-4 w-4 text-[#1a5e6f] dark:text-[#6dbfd6]" aria-hidden="true" />
              <span className="text-muted-foreground">App</span>
              <span className="font-bold text-foreground">{request.clientName}</span>
            </div>
            {request.coarseLocation && (
              <div className="grid grid-cols-[1.5rem_6rem_1fr] items-center gap-3 border-b border-border px-4 py-3 text-sm">
                <MapPin className="h-4 w-4 text-[#1a5e6f] dark:text-[#6dbfd6]" aria-hidden="true" />
                <span className="text-muted-foreground">Near</span>
                <span className="font-bold text-foreground">{request.coarseLocation}</span>
              </div>
            )}
            <div className="grid grid-cols-[1.5rem_6rem_1fr] items-center gap-3 px-4 py-3 text-sm">
              <Clock3 className="h-4 w-4 text-[#1a5e6f] dark:text-[#6dbfd6]" aria-hidden="true" />
              <span className="text-muted-foreground">Expires</span>
              <span className="font-bold text-foreground">in {secondsLeft} seconds</span>
            </div>
          </div>

          <div className="mt-4 flex items-start gap-3 rounded-lg bg-[#e1c240]/20 px-4 py-3">
            <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-[#02413c] dark:text-[#e1c240]" aria-hidden="true" />
            <div className="text-sm">
              <p className="font-bold text-foreground">Match the number on your phone</p>
              <p className="mt-1 text-muted-foreground">
                Your phone should show{" "}
                <span className="font-mono text-xl font-bold tracking-[0.18em] text-foreground">
                  {request.numberMatch}
                </span>
              </p>
            </div>
          </div>

          {permissions.length > 0 && (
            <details className="mt-4 text-sm text-muted-foreground">
              <summary className="cursor-pointer font-bold text-foreground">What this app is requesting</summary>
              <ul className="mt-2 list-disc space-y-1 ps-5">
                {permissions.map((permission) => (
                  <li key={permission}>{permission}</li>
                ))}
              </ul>
            </details>
          )}

          {error && (
            <p role="alert" className="mt-4 text-sm font-bold text-destructive">
              {error}
            </p>
          )}

          <div className="mt-7 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <Button
              variant="outline"
              className="border-destructive/60 text-destructive hover:bg-destructive/10 hover:text-destructive"
              disabled={submitting !== null}
              onClick={() => void decide("denied")}
            >
              {submitting === "denied" ? "Denying…" : "No, deny"}
            </Button>
            <Button size="lg" disabled={submitting !== null} onClick={() => void decide("approved")}>
              {submitting === "approved" ? "Allowing…" : "Allow login"}
            </Button>
          </div>
          <p className="mt-4 text-center text-xs text-muted-foreground">
            If you didn’t start this, deny it. comail never sends credentials through this prompt.
          </p>
        </div>
      </div>
    </div>
  );
}
