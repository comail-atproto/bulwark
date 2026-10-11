"use client";

import { useCallback } from "react";
import { useTranslations } from "next-intl";
import { appUrl } from "@/lib/deep-links";
import { toast } from "@/stores/toast-store";

/**
 * Puts a permalink to an app-relative path on the clipboard (#733), as the
 * absolute URL a colleague or a dashboard can actually open.
 *
 * The Clipboard API is unavailable on insecure origins and can be refused by
 * permission policy, so failures are reported rather than swallowed - a button
 * that silently does nothing reads as a broken link.
 */
export function useCopyLink(): (path: string) => Promise<void> {
  const t = useTranslations("deep_link");

  return useCallback(async (path: string) => {
    try {
      await navigator.clipboard.writeText(appUrl(path));
      toast.success(t("copied"));
    } catch {
      toast.error(t("copy_failed"));
    }
  }, [t]);
}
