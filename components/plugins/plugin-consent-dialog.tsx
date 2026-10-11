'use client';

// Modal shown the first time a plugin is enabled, listing every permission
// the plugin's manifest declares. Accepting persists the grant on the
// plugin record so future enables skip the prompt.

import React, { useEffect, useSyncExternalStore } from 'react';
import { head, resolveHead, subscribe, describePermission } from '@/lib/plugin-sandbox/consent';

export function PluginConsentDialog(): React.JSX.Element | null {
  const current = useSyncExternalStore(subscribe, head, () => null);

  useEffect(() => {
    if (!current) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        resolveHead(false);
      }
    }
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [current]);

  if (!current) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="plugin-consent-title"
      style={{
        position: 'fixed', inset: 0,
        background: 'rgba(0,0,0,0.55)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 100001,
      }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) resolveHead(false); }}
    >
      <div style={{
        background: 'var(--background, #fff)',
        color: 'var(--foreground, #0f172a)',
        border: '1px solid var(--border, #e2e8f0)',
        borderRadius: 12,
        padding: 20,
        maxWidth: 560,
        width: '92%',
        boxShadow: '0 16px 48px rgba(0,0,0,0.35)',
      }}>
        <h2 id="plugin-consent-title" style={{ fontSize: 16, fontWeight: 600, margin: '0 0 6px 0' }}>
          Allow “{current.pluginName}” to access your data?
        </h2>
        <p style={{ fontSize: 12, color: 'var(--muted-foreground, #64748b)', margin: '0 0 14px 0' }}>
          This plugin is requesting the permissions below. You can revoke them by uninstalling the plugin.
        </p>

        <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 16px 0', maxHeight: 320, overflowY: 'auto' }}>
          {current.permissions.map((perm) => {
            const desc = describePermission(perm);
            return (
              <li
                key={perm}
                style={{
                  padding: '10px 12px',
                  marginBottom: 6,
                  borderRadius: 8,
                  background: 'var(--accent, #f1f5f9)',
                  border: '1px solid var(--border, #e2e8f0)',
                }}
              >
                <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 2 }}>{desc.title}</div>
                <div style={{ fontSize: 12, color: 'var(--muted-foreground, #64748b)' }}>{desc.body}</div>
                <code style={{ fontSize: 10, color: 'var(--muted-foreground, #94a3b8)', display: 'block', marginTop: 4 }}>{perm}</code>
              </li>
            );
          })}
        </ul>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button
            type="button"
            onClick={() => resolveHead(false)}
            style={{
              padding: '8px 16px', borderRadius: 8, fontSize: 13, fontWeight: 500,
              cursor: 'pointer',
              border: '1px solid var(--border, #e2e8f0)',
              background: 'transparent',
              color: 'inherit',
            }}
          >
            Deny
          </button>
          <button
            type="button"
            autoFocus
            onClick={() => resolveHead(true)}
            style={{
              padding: '8px 16px', borderRadius: 8, fontSize: 13, fontWeight: 500,
              cursor: 'pointer',
              border: '1px solid transparent',
              background: '#3b82f6',
              color: '#fff',
            }}
          >
            Allow
          </button>
        </div>
        <div style={{ marginTop: 12, fontSize: 11, color: 'var(--muted-foreground, #94a3b8)', textAlign: 'right' }}>
          Plugin: {current.pluginId}
        </div>
      </div>
    </div>
  );
}
