"use client";

import { createContext, useContext } from "react";

/**
 * Width of the pane that's hosting the current subtree, in CSS pixels.
 * `null` means "no pane is providing a size" - fall back to viewport-based
 * media queries. Set by the Pro shell on each split pane via ResizeObserver.
 */
export const PaneSizeContext = createContext<number | null>(null);

export function usePaneSize(): number | null {
  return useContext(PaneSizeContext);
}
