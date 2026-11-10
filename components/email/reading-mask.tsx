"use client";

import { useEffect, useRef, useState, type RefObject } from "react";

interface ReadingMaskProps {
  /** The element the mask covers; must be positioned (relative). */
  containerRef: RefObject<HTMLElement | null>;
  /** The message frame, whose pointer and caret moves the page never sees. */
  frame: HTMLIFrameElement | null;
  /** Height of the clear band, in px. */
  bandHeight: number;
}

/** Where the clear band sits, in viewport px, for a pointer or caret at `clientY`. */
export function maskBand(clientY: number, bandHeight: number, top: number, bottom: number): { start: number; end: number } {
  const half = bandHeight / 2;
  const center = Math.min(Math.max(clientY, top + half), Math.max(top + half, bottom - half));
  return { start: center - half, end: center + half };
}

/**
 * Reading mask (Settings > Accessibility): dims the open message except a band
 * of a few lines that follows the pointer, the caret, and stays put on screen
 * while the message scrolls under it. Drawn over the body with
 * pointer-events off, so clicks and selection go through, and without any
 * transition.
 */
export function ReadingMask({ containerRef, frame, bandHeight }: ReadingMaskProps) {
  // The band's centre in viewport coordinates.
  const lastY = useRef<number | null>(null);
  const [box, setBox] = useState<{ top: number; height: number; start: number; end: number } | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let raf = 0;
    const update = () => {
      raf = 0;
      const rect = container.getBoundingClientRect();
      if (lastY.current === null) lastY.current = Math.max(rect.top, 0) + bandHeight;
      const band = maskBand(lastY.current, bandHeight, rect.top, rect.bottom);
      setBox({ top: rect.top, height: rect.height, start: band.start - rect.top, end: band.end - rect.top });
    };
    const schedule = () => { if (!raf) raf = requestAnimationFrame(update); };
    const moveTo = (y: number) => { lastY.current = y; schedule(); };

    const onPointer = (e: PointerEvent) => {
      const rect = container.getBoundingClientRect();
      if (e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom) return;
      moveTo(e.clientY);
    };
    // The caret (selection made with the keyboard), in either document.
    const caretY = (doc: Document, offsetTop: number) => {
      const selection = doc.getSelection();
      if (!selection || selection.rangeCount === 0) return;
      const node = selection.focusNode;
      if (!node || !container.contains(frame && doc !== document ? frame : node)) return;
      const range = selection.getRangeAt(0).cloneRange();
      range.collapse(false);
      const r = range.getClientRects()[0] ?? range.getBoundingClientRect();
      if (r && (r.top || r.bottom)) moveTo(offsetTop + (r.top + r.bottom) / 2);
    };
    const onSelection = () => caretY(document, 0);

    window.addEventListener('pointermove', onPointer, { passive: true });
    window.addEventListener('scroll', schedule, { capture: true, passive: true });
    window.addEventListener('resize', schedule);
    document.addEventListener('selectionchange', onSelection);
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(schedule) : null;
    observer?.observe(container);

    const frameDoc = frame?.contentDocument ?? null;
    const onFramePointer = (e: PointerEvent) => {
      const rect = frame!.getBoundingClientRect();
      moveTo(rect.top + e.clientY);
    };
    const onFrameSelection = () => {
      if (frame && frameDoc) caretY(frameDoc, frame.getBoundingClientRect().top);
    };
    frameDoc?.addEventListener('pointermove', onFramePointer, { passive: true });
    frameDoc?.addEventListener('selectionchange', onFrameSelection);
    schedule();

    return () => {
      if (raf) cancelAnimationFrame(raf);
      window.removeEventListener('pointermove', onPointer);
      window.removeEventListener('scroll', schedule, { capture: true });
      window.removeEventListener('resize', schedule);
      document.removeEventListener('selectionchange', onSelection);
      observer?.disconnect();
      frameDoc?.removeEventListener('pointermove', onFramePointer);
      frameDoc?.removeEventListener('selectionchange', onFrameSelection);
    };
  }, [containerRef, frame, frame?.contentDocument, bandHeight]);

  if (!box) return null;
  const shade = 'absolute inset-x-0 pointer-events-none bg-black/55 dark:bg-black/65';
  return (
    <div className="absolute inset-0 z-[5] pointer-events-none" aria-hidden="true" data-testid="reading-mask">
      <div className={shade} style={{ top: 0, height: Math.max(0, box.start) }} />
      <div className={shade} style={{ top: Math.max(0, box.end), bottom: 0 }} />
    </div>
  );
}
