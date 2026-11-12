import { afterEach, describe, it, expect, vi } from 'vitest';
import type { InstalledPlugin } from '../plugin-types';

vi.mock('../plugin-sandbox/host-api', () => ({
  dispatchApiCall: vi.fn(async () => 'ok'),
}));

import { createSlotInstance } from '../plugin-sandbox/host-bridge';

function plugin(): InstalledPlugin {
  return {
    id: 'p1', name: 'P', version: '1.0.0', author: '', description: '', type: 'hook',
    permissions: [], entrypoint: 'index.js', enabled: true, status: 'running', settings: {},
  };
}

const instances: Array<{ destroy(): void }> = [];
const ports: MessagePort[] = [];
afterEach(() => {
  for (const i of instances.splice(0)) i.destroy();
  for (const port of ports.splice(0)) port.close();
});

// A slot iframe of 300x100 px; messages arrive through its RPC port.
function slot() {
  const onFloatingDropdown = vi.fn();
  const inst = createSlotInstance({
    plugin: plugin(), slot: 'plugin-dialog', code: '', locale: 'en', tier: 'untrusted', extraProps: {},
    hostContainer: document.body, onResize: vi.fn(), onFloatingDropdown,
  });
  instances.push(inst);
  inst.iframe.getBoundingClientRect = () => ({ left: 0, top: 0, right: 300, bottom: 100, width: 300, height: 100, x: 0, y: 0, toJSON: () => ({}) });
  const activity = new MessageChannel();
  const rpc = new MessageChannel();
  ports.push(activity.port1, rpc.port1);
  window.dispatchEvent(new MessageEvent('message', {
    data: { type: 'sandbox-ready' }, origin: 'null', source: inst.iframe.contentWindow,
    ports: [activity.port2, rpc.port2],
  }));
  const post = (data: unknown) => rpc.port1.postMessage(data);
  return { onFloatingDropdown, post };
}

const goodRect = { left: 10, top: 20, bottom: 50, width: 200, height: 30 };

describe('floating dropdown messages from a plugin', () => {
  it('passes a well-formed open message through', async () => {
    const { onFloatingDropdown, post } = slot();
    post({
      type: 'floating-dropdown-open', id: 'x-listbox', rect: goodRect,
      options: [{ value: 'a', label: 'A' }], selectedValues: [], highlightedIndex: 0,
    });
    await vi.waitFor(() => expect(onFloatingDropdown).toHaveBeenCalledTimes(1));
    expect(onFloatingDropdown.mock.calls[0][0]).toMatchObject({ id: 'x-listbox', rect: goodRect, options: [{ value: 'a', label: 'A' }] });
  });

  it('drops an open message whose options are not a list, so the host never renders it', async () => {
    const { onFloatingDropdown, post } = slot();
    post({ type: 'floating-dropdown-open', id: 'x', rect: goodRect, options: 'boom', selectedValues: [], highlightedIndex: 0 });
    post({ type: 'floating-dropdown-close', id: 'after-invalid' });
    await vi.waitFor(() => expect(onFloatingDropdown).toHaveBeenCalledTimes(1));
    expect(onFloatingDropdown).toHaveBeenCalledWith({ type: 'floating-dropdown-close', id: 'after-invalid' });
  });

  it('keeps only options with string labels and fills in missing selectedValues', async () => {
    const { onFloatingDropdown, post } = slot();
    post({
      type: 'floating-dropdown-open', id: 'x', rect: goodRect, highlightedIndex: 0,
      options: [{ value: 'a', label: { $$typeof: 'x' } }, { value: 'b', label: 'B' }, null],
    });
    await vi.waitFor(() => expect(onFloatingDropdown).toHaveBeenCalledOnce());
    const msg = onFloatingDropdown.mock.calls[0][0];
    expect(msg.options).toEqual([{ value: 'b', label: 'B' }]);
    expect(msg.selectedValues).toEqual([]);
  });

  it('clamps the anchor rect to the plugin frame', async () => {
    const { onFloatingDropdown, post } = slot();
    post({
      type: 'floating-dropdown-open', id: 'x', options: [], selectedValues: [], highlightedIndex: -1,
      rect: { left: -900, top: 5000, bottom: 6000, width: 99999, height: 1000 },
    });
    await vi.waitFor(() => expect(onFloatingDropdown).toHaveBeenCalledOnce());
    expect(onFloatingDropdown.mock.calls[0][0].rect).toEqual({ left: 0, top: 100, bottom: 100, width: 300, height: 0 });
  });

  it('ignores a bad rect in an update but keeps the rest', async () => {
    const { onFloatingDropdown, post } = slot();
    post({ type: 'floating-dropdown-update', id: 'x', rect: { left: 'a' }, highlightedIndex: 2 });
    await vi.waitFor(() => expect(onFloatingDropdown).toHaveBeenCalledOnce());
    expect(onFloatingDropdown.mock.calls[0][0]).toEqual({ type: 'floating-dropdown-update', id: 'x', highlightedIndex: 2 });
  });
});
