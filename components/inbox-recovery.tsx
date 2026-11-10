"use client";

import { Button } from "@/components/ui/button";
import { useConfig } from "@/hooks/use-config";
import { useAuthStore } from "@/stores/auth-store";
import { useAccountStore } from "@/stores/account-store";

export function InboxRecovery({ signOut = false }: { signOut?: boolean }) {
  const config = useConfig();
  const accounts = useAccountStore((state) => state.accounts);
  const logout = useAuthStore((state) => state.logout);
  const removeAccount = useAuthStore((state) => state.removeAccount);
  const error = useAuthStore((state) => state.error);
  if (config.appName !== "Comail" || !config.hostedInboxLogoutDestination) return null;
  return <div className="mt-6 space-y-3 text-sm">
    {signOut && <Button type="button" variant="outline" onClick={() => void logout()}>Sign out of Inbox</Button>}
    {error === "signout_cleanup_failed" && <p role="alert">Inbox sign-out could not finish. Please try again.</p>}
    <ul className="space-y-2">{accounts.filter((account) => account.hasError && !account.isConnected).map((account) =>
      <li key={account.id} className="flex items-center justify-between gap-3">
        <span className="min-w-0 truncate">{account.username}</span>
        <Button type="button" variant="outline" onClick={() => removeAccount(account.id)}>Remove account</Button>
      </li>)}</ul>
  </div>;
}
