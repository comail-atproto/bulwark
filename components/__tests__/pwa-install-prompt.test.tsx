import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  PWA_INSTALL_PROMPT_VISIBILITY_EVENT,
  PWAInstallPrompt,
} from "../pwa-install-prompt";

vi.mock("@/hooks/use-config", () => ({
  useConfig: () => ({
    appName: "Bulwark",
    faviconUrl: "",
    appLogoLightUrl: "",
    appLogoDarkUrl: "",
  }),
}));

describe("PWAInstallPrompt", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("closes after the browser install prompt is dismissed", async () => {
    const prompt = vi.fn().mockResolvedValue(undefined);
    const event = new Event("beforeinstallprompt");
    Object.assign(event, {
      prompt,
      userChoice: Promise.resolve({ outcome: "dismissed" }),
    });

    render(<PWAInstallPrompt />);
    act(() => window.dispatchEvent(event));
    expect(screen.getByText("title")).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByText("install"));
      await Promise.resolve();
    });

    expect(prompt).toHaveBeenCalledOnce();
    expect(screen.queryByText("title")).not.toBeInTheDocument();
  });

  it("announces that it is hidden after Not now", () => {
    const visibility: boolean[] = [];
    const listener = (event: Event) => {
      visibility.push(
        (event as CustomEvent<{ visible?: boolean }>).detail?.visible === true,
      );
    };
    window.addEventListener(PWA_INSTALL_PROMPT_VISIBILITY_EVENT, listener);

    try {
      const event = new Event("beforeinstallprompt");
      Object.assign(event, {
        prompt: vi.fn(),
        userChoice: Promise.resolve({ outcome: "dismissed" }),
      });

      render(<PWAInstallPrompt />);
      act(() => window.dispatchEvent(event));
      fireEvent.click(screen.getByText("not_now"));

      expect(visibility).toContain(true);
      expect(visibility.at(-1)).toBe(false);
    } finally {
      window.removeEventListener(PWA_INSTALL_PROMPT_VISIBILITY_EVENT, listener);
    }
  });

  it("snoozes after Not now without permanently dismissing the prompt", () => {
    const event = new Event("beforeinstallprompt");
    Object.assign(event, {
      prompt: vi.fn(),
      userChoice: Promise.resolve({ outcome: "dismissed" }),
    });

    render(<PWAInstallPrompt />);
    act(() => window.dispatchEvent(event));
    fireEvent.click(screen.getByText("not_now"));

    const snoozedUntil = Number(
      localStorage.getItem("pwa-install-snoozed-until"),
    );
    expect(Number.isFinite(snoozedUntil)).toBe(true);
    expect(snoozedUntil).toBeGreaterThan(Date.now());
    expect(localStorage.getItem("pwa-install-dismissed")).toBeNull();
  });

  it("honors the permanent dismissal key", () => {
    localStorage.setItem("pwa-install-dismissed", "1");
    const event = new Event("beforeinstallprompt");
    Object.assign(event, {
      prompt: vi.fn(),
      userChoice: Promise.resolve({ outcome: "dismissed" }),
    });

    render(<PWAInstallPrompt />);
    act(() => window.dispatchEvent(event));

    expect(screen.queryByText("install")).not.toBeInTheDocument();
  });
});
