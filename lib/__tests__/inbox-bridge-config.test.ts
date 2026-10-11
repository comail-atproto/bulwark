import { afterEach, describe, expect, it, vi } from 'vitest';
import { readRelayRedemptionConfig } from '@/lib/auth/relay-redemption';
import { relayBridgeUrl, signBridgeToken } from '@/lib/byomc/relay-bridge';
import { accessApprovalRelayBridgeUrl, signAccessApprovalBridgeToken } from '@/lib/access-approval/relay-bridge';

const names = ['BULWARK_INBOX_SSO_SECRET', 'INBOX_SSO_REDEEM_URL', 'INBOX_APP_PASSWORD_BRIDGE_URL', 'INBOX_ACCESS_APPROVAL_BRIDGE_URL', 'BULWARK_RELAY_SSO_SECRET', 'RELAY_SSO_REDEEM_URL', 'RELAY_APP_PASSWORD_BRIDGE_URL', 'RELAY_ACCESS_APPROVAL_BRIDGE_URL'];
afterEach(() => vi.unstubAllEnvs());
function canonical() {
  for (const name of names) vi.stubEnv(name, undefined);
  vi.stubEnv('BULWARK_INBOX_SSO_SECRET', 'i'.repeat(64));
  vi.stubEnv('INBOX_SSO_REDEEM_URL', 'https://inbox.internal.example/webmail/sso/redeem');
  vi.stubEnv('INBOX_APP_PASSWORD_BRIDGE_URL', 'https://inbox.internal.example/webmail/app-passwords');
  vi.stubEnv('INBOX_ACCESS_APPROVAL_BRIDGE_URL', 'https://inbox.internal.example/webmail/access-approvals');
}

describe('Inbox-owned private bridge configuration', () => {
  it('works without any Relay settings', () => {
    canonical();
    expect(readRelayRedemptionConfig()?.redeemUrl).toBe('https://inbox.internal.example/webmail/sso/redeem');
    expect(relayBridgeUrl()).toBe('https://inbox.internal.example/webmail/app-passwords');
    expect(accessApprovalRelayBridgeUrl()).toBe('https://inbox.internal.example/webmail/access-approvals');
    expect(signBridgeToken('owner@example.test')).not.toBeNull();
    expect(signAccessApprovalBridgeToken('owner@example.test')).not.toBeNull();
  });
  it('fails conflicting historical settings closed', () => {
    canonical(); vi.stubEnv('BULWARK_RELAY_SSO_SECRET', 'r'.repeat(64));
    expect(readRelayRedemptionConfig()).toBeNull();
    expect(signBridgeToken('owner@example.test')).toBeNull();
    expect(signAccessApprovalBridgeToken('owner@example.test')).toBeNull();
    vi.stubEnv('BULWARK_RELAY_SSO_SECRET', 'i'.repeat(64));
    vi.stubEnv('RELAY_APP_PASSWORD_BRIDGE_URL', 'https://foreign.internal.example/passwords');
    expect(relayBridgeUrl()).toBe('');
  });
  it.each(['http://foreign.example/bridge', 'https://user:password@example.test/bridge', 'https://example.test/bridge?token=canary', 'https://example.test/bridge#fragment', 'https://example.test/bridge?', 'https://example.test/bridge#'])('rejects unsafe bridge endpoint %s', (url) => {
    canonical(); vi.stubEnv('INBOX_APP_PASSWORD_BRIDGE_URL', url); vi.stubEnv('INBOX_ACCESS_APPROVAL_BRIDGE_URL', url);
    expect(relayBridgeUrl()).toBe(''); expect(accessApprovalRelayBridgeUrl()).toBe('');
  });
});
