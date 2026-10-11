"use client";

import { useEffect } from "react";
import { parseMailto } from "@/lib/protocol-handlers/mailto";
import { requestOpenMailtoInExistingClient, savePendingMailto } from "@/lib/protocol-handlers/session";
import { useSettingsStore } from "@/stores/settings-store";

type StandaloneNavigator = Navigator & { standalone?: boolean };

function getProtocolPathPrefix(): string {
  const marker = "/protocol/mailto";
  const index = window.location.pathname.indexOf(marker);
  return index > 0 ? window.location.pathname.slice(0, index) : "";
}

function returnToSourcePage() {
  window.close();

  window.setTimeout(() => {
    if (window.history.length > 1) {
      window.history.back();
    }
  }, 150);
}

function openFallbackAppTab(raw: string): boolean {
  const url = `${getProtocolPathPrefix()}/protocol/mailto?url=${encodeURIComponent(raw)}&fallback=1`;
  const opened = window.open(url, "_blank");
  if (!opened) return false;
  opened.opener = null;
  return true;
}

function shouldOpenFallbackAppTab(): boolean {
  const standalone = window.matchMedia?.("(display-mode: standalone)").matches
    || (navigator as StandaloneNavigator).standalone === true;
  return !standalone && window.history.length > 1;
}

async function focusExistingClient() {
  if (!("serviceWorker" in navigator)) return;

  try {
    const registration = await navigator.serviceWorker.ready;
    const worker = navigator.serviceWorker.controller ?? registration.active;
    worker?.postMessage({ type: "focus-existing-mailto-client" });
  } catch {
    // Focusing is a progressive enhancement; the composer handoff still works.
  }
}

interface MailtoProtocolClientProps {
  openingText: string;
}

export function MailtoProtocolClient({ openingText }: MailtoProtocolClientProps) {
  useEffect(() => {
    let cancelled = false;

    async function handleMailto() {
      const params = new URLSearchParams(window.location.search);
      const raw = params.get("url");
      const isFallbackAppTab = params.get("fallback") === "1";
      const openMode = useSettingsStore.getState().protocolOpenMode;
      const parsed = raw ? parseMailto(raw) : null;

      if (parsed) {
        if (!isFallbackAppTab && openMode === "new-tab") {
          if (raw && shouldOpenFallbackAppTab() && openFallbackAppTab(raw)) {
            returnToSourcePage();
            return;
          }
        } else if (!isFallbackAppTab) {
          const delivered = await requestOpenMailtoInExistingClient(parsed);
          if (cancelled) return;

          if (delivered) {
            void focusExistingClient();
            returnToSourcePage();
            return;
          }

          if (raw && shouldOpenFallbackAppTab() && openFallbackAppTab(raw)) {
            returnToSourcePage();
            return;
          }
        }

        savePendingMailto(parsed);
      }

      window.location.replace(`${getProtocolPathPrefix()}/`);
    }

    void handleMailto();

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className="flex min-h-screen items-center justify-center">
      <p>{openingText}</p>
    </main>
  );
}
