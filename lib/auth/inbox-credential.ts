import { logger } from '@/lib/logger';
import { relayBridgeUrl, signBridgeToken } from '@/lib/byomc/relay-bridge';

// Inbox supplies the credential IDs; browser input cannot select them. A failed
// revocation must not prevent local sign-out; Inbox also expires these
// credentials independently after 30 days.
export async function revokeInboxCredential(mailbox: string, credentialId?: string): Promise<void> {
  if (!credentialId) return;
  try {
    const base = relayBridgeUrl();
    const token = signBridgeToken(mailbox);
    if (!base || !token || !/^[A-Za-z0-9_-]{1,128}$/.test(credentialId)) {
      throw new Error('Invalid revocation configuration');
    }
    const response = await fetch(`${base}/${encodeURIComponent(credentialId)}`, {
      method: 'DELETE',
      cache: 'no-store',
      redirect: 'error',
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(3000),
    });
    if (response.status !== 204 && response.status !== 404) throw new Error('Credential revocation rejected');
  } catch {
    logger.warn('Inbox session credential revocation failed', { event: 'inbox_credential_revoke_failed' });
  }
}
