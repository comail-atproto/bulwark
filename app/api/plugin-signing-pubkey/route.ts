import { NextResponse } from 'next/server';
import { getPublicKeyBase64 } from '@/lib/admin/plugin-signing';
import { logger } from '@/lib/logger';

/**
 * GET /api/plugin-signing-pubkey
 *
 * Returns the host's Ed25519 public key (base64-encoded raw 32 bytes) so the
 * sandboxed plugin loader can verify bundle signatures before evaluation.
 * Public - every logged-in user needs to fetch it on app boot.
 *
 * The response is long-cache-eligible (the key rotates only when an operator
 * deletes the on-disk PEM), but we keep it `no-store` for simplicity. The
 * client caches the result in memory for the lifetime of the page.
 */
export async function GET() {
  try {
    const publicKey = await getPublicKeyBase64();
    return NextResponse.json(
      { algorithm: 'ed25519', publicKey },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (err) {
    logger.error('[plugin-signing-pubkey] load failed', { error: err instanceof Error ? err.message : String(err) });
    return NextResponse.json({ error: 'Signing key unavailable' }, { status: 500 });
  }
}
