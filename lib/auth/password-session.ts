import type { AccountEntry } from '@/stores/account-store';

/**
 * The session was signed in with the account's own password, so the server
 * holds a password (and maybe TOTP) the user can manage here. A password plus
 * TOTP login runs on OAuth tokens (authMode 'oauth') but is still one of them
 * (#1432). A sign-in through the identity provider may come from an outside
 * IdP that holds the password instead, and a pasted access token says nothing
 * about how the account signs in. Accounts signed in before `providerSession`
 * was recorded count as provider sign-ins.
 */
export function isPasswordSession(
  authMode: AccountEntry['authMode'] | null | undefined,
  account: Pick<AccountEntry, 'providerSession'> | null | undefined,
): boolean {
  if (authMode === 'basic') return true;
  return authMode === 'oauth' && account?.providerSession === false;
}
