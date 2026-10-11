"use client";

import React from "react";
import { ShieldCheck, ShieldAlert, ShieldX, Lock, LockOpen, AlertTriangle, Info } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTranslations } from "next-intl";
import type { SmimeStatus } from "@/lib/smime/types";

interface SmimeStatusBannerProps {
  status: SmimeStatus;
  onUnlockKey?: () => void;
  className?: string;
}

type SmimeVariant = 'success' | 'warning' | 'error' | 'info';

const variantTone: Record<SmimeVariant, string> = {
  success: 'bg-success/15 text-success',
  warning: 'bg-warning/15 text-warning',
  error: 'bg-destructive/15 text-destructive',
  info: 'bg-info/15 text-info',
};

export function SmimeStatusBanner({ status, onUnlockKey, className }: SmimeStatusBannerProps) {
  const t = useTranslations('smime');

  const items: Array<{
    icon: React.ReactNode;
    text: string;
    variant: SmimeVariant;
  }> = [];

  // Encryption status
  if (status.isEncrypted) {
    if (status.decryptionError) {
      if (status.decryptionError === 'locked') {
        items.push({
          icon: <Lock className="w-5 h-5" />,
          text: t('unlock_key_desc'),
          variant: 'warning',
        });
      } else if (status.decryptionError === 'no-key') {
        items.push({
          icon: <Lock className="w-5 h-5" />,
          text: t('status_encrypted_no_key'),
          variant: 'warning',
        });
      } else {
        items.push({
          icon: <ShieldX className="w-5 h-5" />,
          text: t('status_encrypted_failed'),
          variant: 'error',
        });
      }
    } else {
      items.push({
        icon: <LockOpen className="w-5 h-5" />,
        text: t('status_encrypted_ok'),
        variant: 'success',
      });
    }
  }

  // Signature status
  if (status.isSigned) {
    if (status.signatureValid === true) {
      if (status.selfSigned) {
        items.push({
          icon: <AlertTriangle className="w-5 h-5" />,
          text: t('status_signed_self_signed'),
          variant: 'warning',
        });
      } else if (status.signerEmailMatch === false) {
        items.push({
          icon: <AlertTriangle className="w-5 h-5" />,
          text: t('status_signed_mismatch'),
          variant: 'warning',
        });
      } else {
        items.push({
          icon: <ShieldCheck className="w-5 h-5" />,
          text: t('status_signed_valid'),
          variant: 'success',
        });
      }
    } else if (status.signatureValid === false) {
      items.push({
        icon: <ShieldAlert className="w-5 h-5" />,
        text: status.signatureError || t('status_signed_invalid'),
        variant: 'error',
      });
    }
  }

  // Unsupported S/MIME
  if (status.unsupportedReason) {
    items.push({
      icon: <Info className="w-5 h-5" />,
      text: t('status_unsupported'),
      variant: 'info',
    });
  }

  if (items.length === 0) return null;

  return (
    <div className={cn("flex flex-col gap-3 py-1", className)}>
      {items.map((item, i) => (
        <div key={i} className="flex items-start gap-3">
          <div className={cn(
            "w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 shadow-sm",
            variantTone[item.variant],
          )}>
            {item.icon}
          </div>
          <div className="flex-1 min-w-0 flex items-center justify-between gap-2">
            <div className="min-w-0 flex-1">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                S/MIME
              </div>
              <div className="text-sm font-medium text-foreground break-words">
                {item.text}
              </div>
            </div>
            {item.variant === 'warning' && status.decryptionError === 'locked' && onUnlockKey && (
              <button
                onClick={onUnlockKey}
                className="text-xs font-medium underline hover:no-underline flex-shrink-0"
              >
                {t('unlock_key')}
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
