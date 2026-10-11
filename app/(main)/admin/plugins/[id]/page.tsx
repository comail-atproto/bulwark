import { redirect } from 'next/navigation';

// Inline panel handles plugin config now - see _tabs/plugin-config-panel.tsx.
// Old deep links land on the plugins tab; the user clicks the gear again.
export default function Page() {
  redirect('/admin?tab=plugins');
}
