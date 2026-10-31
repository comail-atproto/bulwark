import type { SieveScript, SieveCapabilities } from '@/lib/jmap/sieve-types';

export function createDemoSieveCapabilities(): SieveCapabilities {
  return {
    implementation: 'Demo Sieve Engine',
    maxSizeScript: 65536,
    sieveExtensions: ['fileinto', 'reject', 'vacation', 'imap4flags', 'comparator-i;ascii-casemap', 'body', 'envelope'],
    notificationMethods: [],
    externalLists: [],
  };
}

export function createDemoSieveScripts(): SieveScript[] {
  return [
    {
      id: 'demo-sieve-1',
      name: 'Default Filters',
      blobId: 'demo-sieve-blob-1',
      isActive: true,
    },
  ];
}

// Sieve script content keyed by blobId
export function createDemoSieveContent(): Record<string, string> {
  return {
    'demo-sieve-blob-1': [
      'require ["fileinto", "imap4flags"];',
      '',
      '# Newsletters to Receipts',
      'if address :contains "from" "newsletter@" {',
      '  fileinto "Receipts";',
      '  stop;',
      '}',
      '',
      '# Flag emails from boss',
      'if address :is "from" "alice.johnson@example.com" {',
      '  addflag "\\\\Flagged";',
      '}',
      '',
      '# Move project updates',
      'if header :contains "subject" "[Project]" {',
      '  fileinto "Projects";',
      '  stop;',
      '}',
    ].join('\n'),
  };
}
