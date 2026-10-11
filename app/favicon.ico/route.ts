// Browsers request /favicon.ico unconditionally, before any HTML is parsed.
// The App Router otherwise 404s that path because branding only wires
// /branding/comail/comail-favicon.png (issue #1768). Redirect the well-known
// path to the Comail favicon PNG so the request resolves with a real icon.
//
// The redirect target carries the deployment subpath: under a base-path mount
// (e.g. /webmail) the icon lives at /webmail/branding/comail/comail-favicon.png.
// The redirect is scoped to this exact route, so it cannot shadow the other
// /branding/* asset routes.

const BASE_PATH = (process.env.NEXT_PUBLIC_BASE_PATH ?? "").replace(/\/+$/, "");
const FAVICON_TARGET = `${BASE_PATH}/branding/comail/comail-favicon.png`;

export function GET(): Response {
  return new Response(null, {
    status: 307,
    headers: {
      Location: FAVICON_TARGET,
      // The icon itself is cacheable, but keep the redirect fresh so a
      // rebrand that changes the target path takes effect promptly.
      "Cache-Control": "public, max-age=3600",
    },
  });
}
