type Capabilities = Record<string, unknown>;

type SessionOptions = {
  accountCapabilities: Capabilities;
  serverCapabilities?: Capabilities;
  isPersonal?: boolean;
  // Overrides replace each field; primary-account maps are not merged.
  overrides?: {
    apiUrl?: string;
    downloadUrl?: string;
    eventSourceUrl?: string;
    primaryAccounts?: Record<string, string>;
    capabilities?: Capabilities;
  };
};

// Server and account capabilities are independent: global advertisement must
// not hide permissions revoked from a personal account.
export function jmapSession({
  accountCapabilities,
  serverCapabilities = {},
  isPersonal = true,
  overrides = {},
}: SessionOptions) {
  return {
    capabilities: structuredClone({ 'urn:ietf:params:jmap:core': {}, ...serverCapabilities }),
    accounts: {
      'acct-1': { name: 'test', isPersonal, accountCapabilities: structuredClone(accountCapabilities) },
    },
    primaryAccounts: { 'urn:ietf:params:jmap:mail': 'acct-1' },
    apiUrl: 'https://mail.example.com/jmap/api',
    downloadUrl: 'https://mail.example.com/jmap/download/{accountId}/{blobId}/{name}',
    uploadUrl: 'https://mail.example.com/jmap/upload/{accountId}/',
    eventSourceUrl: 'https://mail.example.com/jmap/eventsource',
    ...overrides,
  };
}
