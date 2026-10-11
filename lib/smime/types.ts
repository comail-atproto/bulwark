/** Stored record for an imported S/MIME private key + certificate. */
export interface SmimeKeyRecord {
  id: string;
  accountId?: string;
  email: string;
  certificate: ArrayBuffer;           // DER-encoded X.509 leaf cert
  certificateChain: ArrayBuffer[];    // DER-encoded intermediates
  encryptedPrivateKey: ArrayBuffer;   // AES-GCM wrapped PKCS#8 bytes
  salt: ArrayBuffer;                  // PBKDF2 salt
  iv: ArrayBuffer;                    // AES-GCM IV
  kdfIterations: number;
  issuer: string;
  subject: string;
  serialNumber: string;
  notBefore: string;                  // ISO 8601
  notAfter: string;                   // ISO 8601
  fingerprint: string;               // SHA-256 hex of DER cert
  algorithm: string;                  // e.g. "RSA-2048", "RSA-4096", "ECDSA-P256"
  capabilities: SmimeKeyCapabilities;
}

/** What a certificate can be used for based on KeyUsage/ExtendedKeyUsage. */
export interface SmimeKeyCapabilities {
  canSign: boolean;
  canEncrypt: boolean;
}

/** Runtime-only unlocked private key handle (never persisted). */
export interface SmimeUnlockedKey {
  id: string;
  email: string;
  privateKey: CryptoKey; // imported as non-extractable
}

/** A recipient or contact public certificate. */
export interface SmimePublicCert {
  id: string;
  accountId?: string;
  email: string;
  certificate: ArrayBuffer;           // DER-encoded X.509
  issuer: string;
  subject: string;
  notBefore: string;
  notAfter: string;
  fingerprint: string;
  source: 'manual' | 'contact' | 'signed-email';
  contactId?: string;
}

/** Status of S/MIME processing for a single email message. */
export interface SmimeStatus {
  isSigned: boolean;
  isEncrypted: boolean;
  signatureValid?: boolean;
  signatureError?: string;
  signerCert?: SmimePublicCert;
  signerEmailMatch?: boolean;
  /** True when the signer certificate is self-signed (not chained to a trusted CA). */
  selfSigned?: boolean;
  decryptionSuccess?: boolean;
  decryptionError?: string;
  unsupportedReason?: string;
}

/** Metadata extracted from a parsed X.509 certificate. */
export interface CertificateInfo {
  subject: string;
  issuer: string;
  serialNumber: string;
  notBefore: string;
  notAfter: string;
  fingerprint: string;
  algorithm: string;
  keyUsage?: string[];
  extendedKeyUsage?: string[];
  emailAddresses: string[];
  capabilities: SmimeKeyCapabilities;
}

/** Result of PKCS#12 import parsing. */
export interface Pkcs12ImportResult {
  keyRecord: SmimeKeyRecord;
  certInfo: CertificateInfo;
}
