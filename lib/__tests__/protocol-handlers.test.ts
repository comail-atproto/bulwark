import { afterEach, describe, expect, it, vi } from "vitest";
import { parseMailto } from "../protocol-handlers/mailto";
import { listenForMailtoRequests } from "../protocol-handlers/session";
import { parseWebcal } from "../protocol-handlers/webcal";

const originalServiceWorkerDescriptor = Object.getOwnPropertyDescriptor(navigator, "serviceWorker");

function installServiceWorkerMock() {
  const listeners = new Set<(event: MessageEvent) => void>();
  const worker = { postMessage: vi.fn() };
  const serviceWorker = {
    ready: Promise.resolve({ active: worker }),
    controller: worker,
    addEventListener: vi.fn((type: string, listener: EventListener) => {
      if (type === "message") listeners.add(listener as (event: MessageEvent) => void);
    }),
    removeEventListener: vi.fn((type: string, listener: EventListener) => {
      if (type === "message") listeners.delete(listener as (event: MessageEvent) => void);
    }),
  };

  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    value: serviceWorker,
  });

  return {
    dispatch(data: unknown) {
      listeners.forEach((listener) => listener(new MessageEvent("message", { data })));
    },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  if (originalServiceWorkerDescriptor) {
    Object.defineProperty(navigator, "serviceWorker", originalServiceWorkerDescriptor);
    return;
  }
  Reflect.deleteProperty(navigator, "serviceWorker");
});

describe("protocol handlers", () => {
  describe("parseMailto", () => {
    it("parses a single path recipient", () => {
      expect(parseMailto("mailto:alice@example.com")).toEqual({
        to: ["alice@example.com"],
        cc: [],
        bcc: [],
        subject: "",
        body: "",
      });
    });

    it("parses multiple recipients with subject and body", () => {
      expect(parseMailto("mailto:alice@example.com,bob@example.com?subject=Hello&body=Hi")).toMatchObject({
        to: ["alice@example.com", "bob@example.com"],
        subject: "Hello",
        body: "Hi",
      });
    });

    it("parses to, cc, and bcc query recipients", () => {
      expect(parseMailto("mailto:?to=alice@example.com&cc=bob@example.com&bcc=eve@example.com")).toMatchObject({
        to: ["alice@example.com"],
        cc: ["bob@example.com"],
        bcc: ["eve@example.com"],
      });
    });

    it("decodes subject and body values", () => {
      expect(parseMailto("mailto:alice@example.com?subject=Hello%20World&body=line1%0Aline2")).toMatchObject({
        subject: "Hello World",
        body: "line1\nline2",
      });
    });

    it("preserves literal plus signs in query values", () => {
      expect(parseMailto("mailto:?to=user+tag@example.com&subject=C++&body=a+b")).toMatchObject({
        to: ["user+tag@example.com"],
        subject: "C++",
        body: "a+b",
      });
    });

    it("rejects non-mailto URLs", () => {
      expect(parseMailto("https://example.com")).toBeNull();
    });

    it("allows an empty mailto URL", () => {
      expect(parseMailto("mailto:")).toEqual({
        to: [],
        cc: [],
        bcc: [],
        subject: "",
        body: "",
      });
    });

    it("removes control characters and caps recipients", () => {
      const recipients = Array.from({ length: 250 }, (_, index) => `user${index}@example.com`).join(",");
      const parsed = parseMailto(`mailto:${recipients}?subject=Hi%0ABcc:evil@example.com`);
      expect(parsed?.to).toHaveLength(200);
      expect(parsed?.subject).toBe("HiBcc:evil@example.com");
    });
  });

  describe("parseWebcal", () => {
    it("normalizes webcal to https", () => {
      expect(parseWebcal("webcal://example.com/calendar.ics")?.subscriptionUrl).toBe("https://example.com/calendar.ics");
    });

    it("normalizes webcals to https", () => {
      expect(parseWebcal("webcals://example.com/calendar.ics")?.subscriptionUrl).toBe("https://example.com/calendar.ics");
    });

    it("accepts https URLs", () => {
      expect(parseWebcal("https://example.com/calendar.ics")?.subscriptionUrl).toBe("https://example.com/calendar.ics");
    });

    it("rejects unsupported protocols", () => {
      expect(parseWebcal("ftp://example.com/calendar.ics")).toBeNull();
    });

    it("suggests a name from the path", () => {
      expect(parseWebcal("webcal://example.com/team.ics")?.suggestedName).toBe("team");
    });

    it("falls back to hostname for suggested name", () => {
      expect(parseWebcal("webcal://example.com/")?.suggestedName).toBe("example.com");
    });

    it("prefers a name query parameter", () => {
      expect(parseWebcal("webcal://example.com/team.ics?name=Team%20Calendar")?.suggestedName).toBe("Team Calendar");
    });
  });

  describe("listenForMailtoRequests", () => {
    const mailtoValue = {
      to: ["alice@example.com"],
      cc: [],
      bcc: [],
      subject: "Hello",
      body: "Hi",
    };

    it("accepts legacy service-worker mailto messages without a client id", () => {
      const serviceWorker = installServiceWorkerMock();
      const onMailto = vi.fn();
      vi.spyOn(window, "focus").mockImplementation(() => undefined);

      const cleanup = listenForMailtoRequests(onMailto, () => ({ path: "/", standalone: false }));
      serviceWorker.dispatch({ type: "mailto-request", id: "legacy", value: mailtoValue });

      expect(onMailto).toHaveBeenCalledWith(mailtoValue);
      cleanup();
    });

    it("ignores service-worker mailto messages for another client", () => {
      const serviceWorker = installServiceWorkerMock();
      const onMailto = vi.fn();

      const cleanup = listenForMailtoRequests(onMailto, () => ({ path: "/", standalone: false }));
      serviceWorker.dispatch({ type: "mailto-request", id: "targeted", clientId: "other-client", value: mailtoValue });

      expect(onMailto).not.toHaveBeenCalled();
      cleanup();
    });
  });
});
