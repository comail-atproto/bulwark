import { vi } from 'vitest';

type Host = { postMessage: ReturnType<typeof vi.fn> };
const ports = new WeakMap<object, MessagePort>();

export function installRuntimeTestChannel(host: Host): void {
  class Port {
    onmessage: ((event: MessageEvent) => void) | null = null;
    peer!: Port;
    postMessage(data: unknown) { this.peer.onmessage?.(new MessageEvent('message', { data })); }
    close() { this.onmessage = null; }
  }
  class Channel {
    port1 = new Port();
    port2 = new Port();
    constructor() { this.port1.peer = this.port2; this.port2.peer = this.port1; }
  }
  vi.stubGlobal('MessageChannel', Channel);
  host.postMessage.mockImplementation((message: { type?: string }, _origin: string, transfer?: MessagePort[]) => {
    if (message.type === 'sandbox-ready' && transfer?.[1]) {
      const port = transfer[1];
      ports.set(host, port);
      port.onmessage = (event) => (host.postMessage as unknown as (message: unknown, origin: string) => void)(event.data, window.location.origin);
    }
  });
}

export function sendToRuntime(source: unknown, origin: string, data: unknown): void {
  const port = origin === window.location.origin && source && typeof source === 'object' ? ports.get(source) : undefined;
  if (!port) throw new Error('No runtime port for this host');
  port.postMessage(data);
}
