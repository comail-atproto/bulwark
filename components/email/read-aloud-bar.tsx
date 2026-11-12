"use client";

import { useTranslations } from "next-intl";
import { Pause, Play, Stop, Volume2 } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ReadAloudState } from "@/hooks/use-read-aloud";

interface ReadAloudBarProps {
  state: ReadAloudState;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
  className?: string;
}

/** Pause, resume and stop while a message is read aloud. */
export function ReadAloudBar({ state, onPause, onResume, onStop, className }: ReadAloudBarProps) {
  const t = useTranslations('email_viewer');
  if (state === 'idle') return null;
  return (
    <div
      role="toolbar"
      aria-label={t('read_aloud')}
      className={cn("flex flex-wrap items-center gap-2 px-4 py-2 border-b border-border bg-muted/60 text-sm", className)}
      data-testid="read-aloud-bar"
    >
      <Volume2 className="w-4 h-4 text-muted-foreground shrink-0" aria-hidden="true" />
      <span className="me-auto text-foreground" role="status">
        {state === 'paused' ? t('read_aloud_paused') : t('read_aloud_reading')}
      </span>
      {state === 'paused' ? (
        <Button variant="outline" size="xs" onClick={onResume}>
          <Play className="w-4 h-4 me-1" aria-hidden="true" />
          {t('read_aloud_resume')}
        </Button>
      ) : (
        <Button variant="outline" size="xs" onClick={onPause}>
          <Pause className="w-4 h-4 me-1" aria-hidden="true" />
          {t('read_aloud_pause')}
        </Button>
      )}
      <Button variant="outline" size="xs" onClick={onStop}>
        <Stop className="w-4 h-4 me-1" aria-hidden="true" />
        {t('read_aloud_stop')}
      </Button>
    </div>
  );
}
