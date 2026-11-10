/** What /api/bimi?format=json answers for a From domain. Shared with the browser. */
export type BimiInfo =
  | { status: 'none' }
  | {
      /** `verified`: a VMC or CMC backs the logo. `self-asserted`: only the DNS record does. */
      status: 'verified' | 'self-asserted';
      /** VMC (registered or government mark) or CMC (prior use mark). */
      markType?: 'verified' | 'common';
      organization?: string;
      issuer?: string;
    };
