import { NextRequest, NextResponse } from 'next/server';
import { configManager } from '@/lib/admin/config-manager';
import { isNoThirdPartyTrafficOn, thirdPartyRefusal } from '@/lib/admin/third-party-mode';
import { bimiResolver, normalizeBimiDomain, type BimiIndicator } from '@/lib/bimi/lookup';
import type { BimiInfo } from '@/lib/bimi/types';

/**
 * BIMI sender logos. GET ?domain=<From domain> answers the logo as a PNG, or
 * the same 1x1 transparent PNG /api/favicon sends when there is none (the
 * avatar falls through on naturalWidth <= 1). With &format=json it answers
 * what backs the logo, for the verified badge in the message view.
 *
 * Ask only for messages that passed DMARC for that domain (see
 * brandIndicatorDomain in lib/email-headers.ts): the logo says who the domain
 * is, not that a given message came from it.
 */

const TRANSPARENT_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNgAAIAAAUAAen63NgAAAAASUVORK5CYII=',
  'base64',
);

const IMAGE_HEADERS = {
  'Content-Type': 'image/png',
  'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy': "default-src 'none'; sandbox",
};

// Short enough that switching "Require a mark certificate" reaches browsers
// the same day.
const LOGO_MAX_AGE = 6 * 60 * 60;
const MISSING_MAX_AGE = 60 * 60;

async function requireCertificate(): Promise<boolean> {
  await configManager.ensureLoaded();
  return configManager.get<boolean>('bimiRequireCertificate', false) === true;
}

function info(indicator: BimiIndicator | null): BimiInfo {
  if (!indicator) return { status: 'none' };
  const { status, markType, organization, issuer } = indicator;
  return { status, markType, organization, issuer };
}

export async function GET(request: NextRequest) {
  // The lookups reach the sender's DNS and whatever hosts its record names.
  if (await isNoThirdPartyTrafficOn()) return thirdPartyRefusal('Brand logos');

  const domain = normalizeBimiDomain(request.nextUrl.searchParams.get('domain'));
  const asJson = request.nextUrl.searchParams.get('format') === 'json';
  if (!domain) {
    return new NextResponse(null, { status: 400, headers: { 'Cache-Control': 'public, max-age=86400' } });
  }

  let indicator = await bimiResolver().resolve(domain);
  if (indicator && indicator.status !== 'verified' && await requireCertificate()) indicator = null;

  if (asJson) {
    return NextResponse.json(info(indicator), {
      headers: { 'Cache-Control': `public, max-age=${indicator ? LOGO_MAX_AGE : MISSING_MAX_AGE}` },
    });
  }
  if (!indicator) {
    return new NextResponse(new Uint8Array(TRANSPARENT_PNG), {
      headers: { ...IMAGE_HEADERS, 'Cache-Control': `public, max-age=${MISSING_MAX_AGE}`, 'X-Bulwark-Bimi': 'missing' },
    });
  }
  return new NextResponse(new Uint8Array(indicator.png), {
    headers: { ...IMAGE_HEADERS, 'Cache-Control': `public, max-age=${LOGO_MAX_AGE}`, 'X-Bulwark-Bimi': indicator.status },
  });
}
