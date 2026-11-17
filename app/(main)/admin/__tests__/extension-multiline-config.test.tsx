import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAdminUnsavedStore } from '@/stores/admin-unsaved-store';

// A plugin setting declared `multiline` (the assistant's instructions) gets a
// text box that keeps line breaks; other strings stay one-line inputs.

const calls: Array<{ url: string; method: string; body: Record<string, unknown> }> = [];
const routes: Record<string, unknown> = {};
vi.mock('@/lib/browser-navigation', () => ({
  apiFetch: vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    calls.push({ url, method, body: JSON.parse(String(init?.body ?? '{}')) });
    const data = method === 'GET' ? routes[url.split('?')[0]] ?? {} : { ok: true };
    return new Response(JSON.stringify(data), { status: 200, headers: { 'content-type': 'application/json' } });
  }),
  withBasePath: (p: string) => p,
}));
vi.mock('next/link', () => ({ default: ({ children }: { children: React.ReactNode }) => children }));
vi.mock('../_pages/use-extension-icons', () => ({ useExtensionIcons: () => () => null }));
vi.mock('@/hooks/use-plugin-slot-offers', () => ({ usePluginSlotOffers: () => [] }));
vi.mock('@/components/plugins/plugin-iframe-slot', () => ({ PluginIframeSlot: () => null }));

import { ExtensionDetailPage } from '../_pages/extension-detail';

beforeEach(() => {
  calls.length = 0;
  routes['/api/admin/plugins'] = [{
    id: 'ai-assistant', name: 'AI Writing Assistant', version: '2.1.1', enabled: true, author: 'x', description: '', permissions: [],
    configSchema: {
      model: { type: 'string', label: 'Model' },
      instructions: { type: 'string', label: 'Instructions for the assistant', multiline: true, description: 'Added to every request.' },
    },
  }];
  routes['/api/admin/plugins/ai-assistant/config'] = { instructions: 'Write in British English.\nSign off with "Kind regards".' };
});
afterEach(() => {
  useAdminUnsavedStore.setState({ dirty: {}, pendingLeave: null, pendingScope: null });
});

describe('plugin settings with several lines', () => {
  it('shows a text box for a multiline setting and saves its line breaks', async () => {
    render(<ExtensionDetailPage kind="plugin" id="ai-assistant" />);
    const box = await screen.findByRole('textbox', { name: 'Instructions for the assistant' });
    expect(box.tagName).toBe('TEXTAREA');
    await waitFor(() => expect((box as HTMLTextAreaElement).value).toBe('Write in British English.\nSign off with "Kind regards".'));
    expect(screen.getByRole('textbox', { name: 'Model' }).tagName).toBe('INPUT');

    fireEvent.change(box, { target: { value: 'Line one\nLine two' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(calls.filter((c) => c.method !== 'GET')).toEqual([
      expect.objectContaining({ url: '/api/admin/plugins/ai-assistant/config', body: { key: 'instructions', value: 'Line one\nLine two' } }),
    ]));
  });
});
