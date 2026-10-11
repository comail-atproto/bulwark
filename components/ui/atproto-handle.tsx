"use client";

import { useEffect, useState } from "react";
import { useConfig } from "@/hooks/use-config";
import { resolveAtprotoProfile } from "@/lib/atproto-avatar";
import { cn } from "@/lib/utils";

interface AtprotoHandleProps {
  did?: string;
  className?: string;
}

/**
 * Non-blocking public Bluesky handle for an OAuth-verified atproto DID.
 * Resolution failures render nothing so account controls keep working offline.
 */
export function AtprotoHandle({ did, className }: AtprotoHandleProps) {
  const [handle, setHandle] = useState<string | null>(null);
  const { demoMode } = useConfig();

  useEffect(() => {
    setHandle(null);
    if (!did || demoMode) return;

    let cancelled = false;
    resolveAtprotoProfile(did)
      .then((profile) => {
        if (!cancelled) setHandle(profile?.handle ?? null);
      })
      .catch(() => {
        if (!cancelled) setHandle(null);
      });

    return () => {
      cancelled = true;
    };
  }, [did, demoMode]);

  if (!handle) return null;

  return (
    <span
      className={cn("truncate", className)}
      title={`Bluesky: @${handle}`}
    >
      @{handle}
    </span>
  );
}
