import { authHooks } from "@/lib/plugin-hooks";
import {
    PLUGIN_OAUTH_EVENT,
    PLUGIN_OAUTH_STORAGE_KEY,
} from "@/lib/plugin-oauth";
import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PluginOAuthCallbackListener } from "../providers/plugin-oauth-callback-listener";

vi.mock("next/navigation", () => ({
  usePathname: vi.fn(),
}));

import { usePathname } from "next/navigation";
const mockUsePathname = vi.mocked(usePathname);

function emitStorageEvent(newValue: string | null) {
  act(() => {
    window.dispatchEvent(
      new StorageEvent("storage", {
        key: PLUGIN_OAUTH_STORAGE_KEY,
        newValue,
      }),
    );
  });
}

describe("PluginOAuthCallbackListener", () => {
  let handler: (payload: unknown) => Promise<void>;
  let disposable: { dispose: () => void };

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mockUsePathname.mockReturnValue("/en/mail");
    handler = vi.fn<(payload: unknown) => Promise<void>>().mockResolvedValue(undefined);
    disposable = authHooks.onOAuthCallback.register("test-plugin", handler);
  });

  afterEach(() => {
    disposable.dispose();
  });

  it("delivers a success payload via the storage event", () => {
    const { unmount } = render(<PluginOAuthCallbackListener />);
    const payload = { code: "abc", state: "xyz", receivedAt: 1 };
    localStorage.setItem(PLUGIN_OAUTH_STORAGE_KEY, JSON.stringify(payload));

    emitStorageEvent(JSON.stringify(payload));

    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({ code: "abc", state: "xyz" }),
    );
    // Best-effort cleanup after delivery
    expect(localStorage.getItem(PLUGIN_OAUTH_STORAGE_KEY)).toBeNull();
    unmount();
  });

  it("delivers an error payload (denial) with state", () => {
    const { unmount } = render(<PluginOAuthCallbackListener />);
    const payload = { state: "xyz", error: "access_denied", receivedAt: 1 };
    localStorage.setItem(PLUGIN_OAUTH_STORAGE_KEY, JSON.stringify(payload));

    emitStorageEvent(JSON.stringify(payload));

    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({ state: "xyz", error: "access_denied" }),
    );
    unmount();
  });

  it("does nothing on the callback route", () => {
    mockUsePathname.mockReturnValue("/en/plugins/oauth/callback");
    const { unmount } = render(<PluginOAuthCallbackListener />);
    const payload = { code: "abc", state: "xyz", receivedAt: 1 };
    localStorage.setItem(PLUGIN_OAUTH_STORAGE_KEY, JSON.stringify(payload));

    emitStorageEvent(JSON.stringify(payload));
    act(() => {
      window.dispatchEvent(
        new CustomEvent(PLUGIN_OAUTH_EVENT, { detail: payload }),
      );
    });

    expect(handler).not.toHaveBeenCalled();
    // No cleanup either - the payload stays parked for the other tab
    expect(localStorage.getItem(PLUGIN_OAUTH_STORAGE_KEY)).toBe(payload ? JSON.stringify(payload) : null);
    unmount();
  });

  it("ignores malformed payloads", () => {
    const { unmount } = render(<PluginOAuthCallbackListener />);

    emitStorageEvent("not json");
    emitStorageEvent(JSON.stringify({ foo: "bar" }));
    emitStorageEvent(JSON.stringify({ code: 123, state: "xyz" }));
    emitStorageEvent(null);

    expect(handler).not.toHaveBeenCalled();
    unmount();
  });

  it("ignores payloads without state", () => {
    const { unmount } = render(<PluginOAuthCallbackListener />);

    // A payload with no state at all cannot be matched to any pending flow,
    // so the listener drops it rather than broadcasting an unmatchable event.
    emitStorageEvent(JSON.stringify({ code: "abc", receivedAt: 1 }));
    emitStorageEvent(JSON.stringify({ error: "server_error", receivedAt: 1 }));

    expect(handler).not.toHaveBeenCalled();
    unmount();
  });

  it("deduplicates identical payloads within the window", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(0);
      const { unmount } = render(<PluginOAuthCallbackListener />);
      const payload = { code: "abc", state: "xyz", receivedAt: 1 };
      localStorage.setItem(PLUGIN_OAUTH_STORAGE_KEY, JSON.stringify(payload));

      emitStorageEvent(JSON.stringify(payload));
      emitStorageEvent(JSON.stringify(payload));

      expect(handler).toHaveBeenCalledOnce();

      // Outside the dedup window the same payload is delivered again
      vi.setSystemTime(61_000);
      emitStorageEvent(JSON.stringify(payload));
      expect(handler).toHaveBeenCalledTimes(2);

      unmount();
    } finally {
      vi.useRealTimers();
    }
  });

  it("delivers same-tab custom events", () => {
    const { unmount } = render(<PluginOAuthCallbackListener />);
    const payload = { code: "abc", state: "xyz", receivedAt: 1 };

    act(() => {
      window.dispatchEvent(
        new CustomEvent(PLUGIN_OAUTH_EVENT, { detail: payload }),
      );
    });

    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({ code: "abc", state: "xyz" }),
    );
    unmount();
  });

  it("stops listening after unmount", () => {
    const { unmount } = render(<PluginOAuthCallbackListener />);
    unmount();

    const payload = { code: "abc", state: "xyz", receivedAt: 1 };
    localStorage.setItem(PLUGIN_OAUTH_STORAGE_KEY, JSON.stringify(payload));
    emitStorageEvent(JSON.stringify(payload));
    act(() => {
      window.dispatchEvent(
        new CustomEvent(PLUGIN_OAUTH_EVENT, { detail: payload }),
      );
    });

    expect(handler).not.toHaveBeenCalled();
  });
});
