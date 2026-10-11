"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useTranslations } from "next-intl";

interface QuickEventInputProps {
  top: number;
  onSubmit: (title: string) => void;
  onCancel: () => void;
}

export function QuickEventInput({ top, onSubmit, onCancel }: QuickEventInputProps) {
  const t = useTranslations("calendar");
  const [title, setTitle] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const submittedRef = useRef(false);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      const trimmed = title.trim();
      if (trimmed) {
        submittedRef.current = true;
        onSubmit(trimmed);
      } else {
        onCancel();
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      onCancel();
    }
  }, [title, onSubmit, onCancel]);

  const handleBlur = useCallback(() => {
    if (!submittedRef.current) onCancel();
  }, [onCancel]);

  return (
    <div
      className="absolute left-1 right-1 z-40"
      style={{ top }}
    >
      <input
        ref={inputRef}
        type="text"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={handleBlur}
        placeholder={t("quick_create.placeholder")}
        aria-label={t("quick_create.aria_label")}
        maxLength={500}
        className="w-full px-2 py-1 text-xs rounded border border-primary bg-primary/10 text-foreground shadow-sm focus:outline-none focus:ring-2 focus:ring-primary"
      />
    </div>
  );
}
