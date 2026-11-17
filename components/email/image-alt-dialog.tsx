"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

interface ImageAltDialogProps {
  isOpen: boolean;
  /** The image's alt text now: null when it has none, "" when it is decorative. */
  currentAlt: string | null;
  /** A preview of the image, so it's clear which one is meant. */
  src?: string;
  /** The new alt text; "" marks the image as decorative. */
  onSave: (alt: string) => void;
  onClose: () => void;
}

/**
 * Asks what an image shows, for people who can't see it. "Decorative"
 * gives it an empty alt, so screen readers skip it. Never fills in the
 * file name: "IMG_2041.png" tells nobody anything.
 */
export function ImageAltDialog({ isOpen, currentAlt, src, onSave, onClose }: ImageAltDialogProps) {
  const t = useTranslations("email_composer.image_alt");
  const tCommon = useTranslations("common");
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState(currentAlt ?? "");
  const [decorative, setDecorative] = useState(currentAlt === "");

  useEffect(() => {
    if (!isOpen) return;
    setText(currentAlt ?? "");
    setDecorative(currentAlt === "");
  }, [isOpen, currentAlt]);

  const trimmed = text.trim();
  const canSave = decorative || trimmed.length > 0;

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title={t("title")}
      description={t("hint")}
      showClose={false}
      initialFocus={inputRef}
      testId="image-alt-dialog"
      onSubmit={(e) => {
        e.preventDefault();
        if (!canSave) return;
        onSave(decorative ? "" : trimmed);
        onClose();
      }}
      footer={
        <>
          <Button type="button" variant="outline" onClick={onClose}>
            {t("skip")}
          </Button>
          <Button type="submit" variant="default" disabled={!canSave}>
            {tCommon("save")}
          </Button>
        </>
      }
    >
      {src && (
        // A data: or blob: preview of the image being described.
        <img src={src} alt="" className="mt-4 max-h-32 max-w-full rounded border border-border object-contain" />
      )}
      <label htmlFor={`${id}-alt`} className="mt-4 block text-sm font-medium text-foreground">
        {t("label")}
      </label>
      <Input
        id={`${id}-alt`}
        ref={inputRef}
        type="text"
        value={decorative ? "" : text}
        disabled={decorative}
        onChange={(e) => setText(e.target.value)}
        className="mt-1.5"
      />
      <label className="mt-3 flex items-center gap-2 text-sm text-foreground">
        <input
          type="checkbox"
          checked={decorative}
          onChange={(e) => setDecorative(e.target.checked)}
          className="h-4 w-4"
        />
        {t("decorative")}
      </label>
    </Dialog>
  );
}
