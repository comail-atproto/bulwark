import { SandboxRuntime } from '@/lib/plugin-sandbox/runtime';

// Must be dynamic so the per-request CSP nonce from proxy.ts is embedded in
// Next's injected hydration/chunk scripts. With force-static, those scripts
// render without a nonce and the strict sandbox CSP blocks them.
export const dynamic = 'force-dynamic';

export default function PluginSandboxPage() {
  return <SandboxRuntime />;
}
