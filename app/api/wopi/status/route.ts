import { NextRequest, NextResponse } from 'next/server';
import { getStalwartCredentials } from '@/lib/stalwart/credentials';
import { getWopiActions, getWopiClientUrl } from '@/lib/wopi/discovery';

/**
 * GET /api/wopi/status
 *
 * Tells the Files UI whether a WOPI document editor is configured and which
 * file extensions it can edit/view (#425). Session-authenticated; the WOPI
 * client URL itself stays server-side.
 */
export async function GET(request: NextRequest) {
  const creds = await getStalwartCredentials(request);
  if (!creds) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const clientUrl = await getWopiClientUrl();
  if (!clientUrl) {
    return NextResponse.json({ enabled: false, editExtensions: [], viewExtensions: [] });
  }

  const actions = await getWopiActions();
  if (!actions) {
    return NextResponse.json({ enabled: false, editExtensions: [], viewExtensions: [] });
  }

  return NextResponse.json({
    enabled: true,
    editExtensions: Object.keys(actions.edit),
    viewExtensions: Object.keys(actions.view),
  });
}
