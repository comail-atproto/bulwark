"use client";

import { createContext, useContext } from "react";

/**
 * True when the surrounding shell (currently only Pro) is rendering this
 * page as a tab body rather than as the top-level route. Standard routes
 * read this to hide their own NavigationRail and let the shell own the
 * chrome.
 *
 * Provided via context by the Pro shell - no URL coupling, no iframe.
 */
export const EmbeddedContext = createContext<boolean>(false);

export function useIsEmbedded(): boolean {
  return useContext(EmbeddedContext);
}
