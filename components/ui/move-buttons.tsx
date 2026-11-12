"use client";

import { useEffect, useRef } from "react";
import { useTranslations } from "next-intl";
import { ArrowDown, ArrowUp } from "@/components/icons";
import { IconButton } from "@/components/ui/icon-button";
import { cn } from "@/lib/utils";

interface MoveButtonsProps {
  /** The item's place in the list and the list's length. */
  index: number;
  count: number;
  /** The item's name, for "Move Work up". */
  name: string;
  onMove: (from: number, to: number) => void;
  disabled?: boolean;
  className?: string;
}

/**
 * Move up / Move down for a list that is also ordered by dragging, so the
 * order can be changed with a keyboard or a single tap (WCAG 2.1.1, 2.5.7).
 * When the item reaches an end, the focus goes to the button that still
 * works instead of staying on a disabled one.
 */
export function MoveButtons({ index, count, name, onMove, disabled = false, className }: MoveButtonsProps) {
  const t = useTranslations("common");
  const upRef = useRef<HTMLButtonElement>(null);
  const downRef = useRef<HTMLButtonElement>(null);
  const atTop = index === 0;
  const atBottom = index === count - 1;

  useEffect(() => {
    const active = document.activeElement;
    if (atTop && active === upRef.current && !atBottom) downRef.current?.focus();
    else if (atBottom && active === downRef.current && !atTop) upRef.current?.focus();
  }, [atTop, atBottom]);

  if (count < 2) return null;
  return (
    <span className={cn("flex items-center gap-0.5 flex-shrink-0", className)}>
      <IconButton
        ref={upRef}
        label={t("move_item_up", { name })}
        disabled={disabled || atTop}
        onClick={(e) => { e.stopPropagation(); onMove(index, index - 1); }}
        data-testid="move-up"
      >
        <ArrowUp className="w-3.5 h-3.5" />
      </IconButton>
      <IconButton
        ref={downRef}
        label={t("move_item_down", { name })}
        disabled={disabled || atBottom}
        onClick={(e) => { e.stopPropagation(); onMove(index, index + 1); }}
        data-testid="move-down"
      >
        <ArrowDown className="w-3.5 h-3.5" />
      </IconButton>
    </span>
  );
}
