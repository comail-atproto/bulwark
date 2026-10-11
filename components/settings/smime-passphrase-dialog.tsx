"use client";

import { useState, useId } from "react";
import { useFocusTrap } from "@/hooks/use-focus-trap";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { KeyRound, Eye, EyeOff } from "lucide-react";

interface SmimePassphraseDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (passphrase: string) => void | Promise<void>;
  title: string;
  description?: string;
  submitText?: string;
  error?: string | null;
  /** Show a second passphrase field for import/export confirmation. */
  showConfirm?: boolean;
}

export function SmimePassphraseDialog({
  isOpen,
  onClose,
  onSubmit,
  title,
  description,
  submitText,
  error,
  showConfirm = false,
}: SmimePassphraseDialogProps) {
  const t = useTranslations("smime");
  const id = useId();
  const [passphrase, setPassphrase] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const dialogRef = useFocusTrap({
    isActive: isOpen,
    onEscape: onClose,
    restoreFocus: true,
  });

  if (!isOpen) return null;

  const mismatch = showConfirm && passphrase !== confirm && confirm.length > 0;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!passphrase || (showConfirm && passphrase !== confirm)) return;
    setIsSubmitting(true);
    try {
      await onSubmit(passphrase);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClose = () => {
    setPassphrase("");
    setConfirm("");
    setShowPassword(false);
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-[1px] flex items-center justify-center z-[60] p-4 animate-in fade-in duration-150">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        aria-describedby={description ? `${id}-desc` : undefined}
        className="bg-background border border-border rounded-lg shadow-xl w-full max-w-md animate-in zoom-in-95 duration-200"
      >
        <form onSubmit={handleSubmit}>
          <div className="p-6">
            <div className="flex items-start gap-4">
              <div className="flex-shrink-0 w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                <KeyRound className="w-5 h-5 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <h2
                  id={`${id}-title`}
                  className="text-lg font-semibold text-foreground"
                >
                  {title}
                </h2>
                {description && (
                  <p
                    id={`${id}-desc`}
                    className="text-sm text-muted-foreground mt-1"
                  >
                    {description}
                  </p>
                )}
              </div>
            </div>

            <div className="mt-4 space-y-3">
              <div className="relative">
                <Input
                  type={showPassword ? "text" : "password"}
                  value={passphrase}
                  onChange={(e) => setPassphrase(e.target.value)}
                  placeholder={t("passphrase_placeholder")}
                  autoFocus
                  className="pr-10"
                  autoComplete="off"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-foreground"
                  aria-label={showPassword ? t("hide_passphrase") : t("show_passphrase")}
                >
                  {showPassword ? (
                    <EyeOff className="w-4 h-4" />
                  ) : (
                    <Eye className="w-4 h-4" />
                  )}
                </button>
              </div>

              {showConfirm && (
                <div>
                  <Input
                    type={showPassword ? "text" : "password"}
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    placeholder={t("confirm_passphrase_placeholder")}
                    autoComplete="off"
                  />
                  {mismatch && (
                    <p className="text-xs text-destructive mt-1">
                      {t("passphrase_mismatch")}
                    </p>
                  )}
                </div>
              )}

              {error && (
                <p className="text-sm text-destructive">{error}</p>
              )}
            </div>
          </div>

          <div className="flex justify-end gap-2 px-6 pb-6">
            <Button
              type="button"
              variant="ghost"
              onClick={handleClose}
              disabled={isSubmitting}
            >
              {t("cancel")}
            </Button>
            <Button
              type="submit"
              disabled={!passphrase || isSubmitting || (showConfirm && passphrase !== confirm)}
            >
              {isSubmitting ? t("processing") : (submitText ?? t("unlock"))}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
