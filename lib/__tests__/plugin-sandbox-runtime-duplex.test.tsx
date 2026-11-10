import React, { StrictMode } from 'react';
import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const parentDescriptor = Object.getOwnPropertyDescriptor(window, 'parent');
const marker = globalThis as { __duplexStarted?: boolean };
let host: { postMessage: ReturnType<typeof vi.fn> };

beforeEach(() => {
  vi.resetModules();
  delete marker.__duplexStarted;
  host = { postMessage: vi.fn() };
  Object.defineProperty(window, 'parent', { configurable: true, get: () => host as unknown as Window });
});
afterEach(() => {
  cleanup();
  if (parentDescriptor) Object.defineProperty(window, 'parent', parentDescriptor);
});

describe('sandbox runtime RPC port', () => {
  it('survives StrictMode immediate cleanup and closes on final cleanup', async () => {
    const { SandboxRuntime } = await import('@/lib/plugin-sandbox/runtime');
    const view = render(<StrictMode><SandboxRuntime /></StrictMode>);
    expect(host.postMessage).toHaveBeenCalledOnce();
    const ports = host.postMessage.mock.calls[0][2] as MessagePort[];
    const received = vi.fn();
    ports[1].onmessage = received;
    ports[1].postMessage({ type: 'init', payload: { mode: 'background', pluginId: 'x', locale: 'en', manifest: { id: 'x', version: '1', permissions: [], settings: {} }, code: 'globalThis.__duplexStarted = true; module.exports = {};' } });
    await waitFor(() => expect(marker.__duplexStarted).toBe(true));
    await waitFor(() => expect(received).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ type: 'init-done' }) })));
    expect(host.postMessage).toHaveBeenCalledOnce();
    const close = vi.spyOn(MessagePort.prototype, 'close');
    view.unmount();
    await Promise.resolve();
    expect(close).toHaveBeenCalled();
    close.mockRestore();
    ports[0].close();
    ports[1].close();
  });
});
