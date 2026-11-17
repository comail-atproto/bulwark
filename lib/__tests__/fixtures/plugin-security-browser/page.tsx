'use client';

// Test-only page. Copy into an isolated build; do not ship this route.
import { useEffect } from 'react';
import { createBackgroundInstance, createSlotInstance } from '@/lib/plugin-sandbox/host-bridge';
import type { InstalledPlugin } from '@/lib/plugin-types';

const plugin = (id: string): InstalledPlugin => ({
  id, name: id, version: '1.0.0', author: '', description: '', type: 'ui-extension',
  permissions: ['settings:read'], grantedPermissions: [], entrypoint: 'index.js',
  enabled: true, status: 'running', settings: {},
});

const code = `
  let api;
  module.exports = {
    activate(a) { api = a; },
    hooks: {
      write: async (value) => { await api.storage.set('value', value); return api.storage.get('value'); },
      read: () => api.storage.get('value'),
      denied: async () => { try { await api.app.getSettings(); return 'allowed'; } catch (e) { return String(e.message); } },
      forge: () => { parent.postMessage({type:'api-request', id:'forged', method:'storage.set', args:['value','forged']}, '*'); return 'sent'; }
    },
    slots: { 'email-banner': { component: (props) => React.createElement('div', {id:'plugin-rendered'}, props.label) } }
  };
`;

export default function PluginSecurityBrowserFixture() {
  useEffect(() => {
    const a = createBackgroundInstance({ plugin: plugin('browser-a'), code, locale: 'en' });
    const b = createBackgroundInstance({ plugin: plugin('browser-b'), code, locale: 'en' });
    const container = document.getElementById('slot')!;
    const slot = createSlotInstance({ plugin: plugin('browser-a'), code, locale: 'en', slot: 'email-banner',
      extraProps: { label: 'Plugin rendered' }, hostContainer: container, onResize: () => {} });
    Object.assign(window, { pluginBrowser: { a, b, slot } });
    return () => { a.destroy(); b.destroy(); slot.destroy(); };
  }, []);
  return <main><h1>Plugin browser fixture</h1><div id="slot" /></main>;
}
