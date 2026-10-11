#!/usr/bin/env node
// Fixed-output fetcher for the Google Fonts data Bulwark's `next/font/google`
// imports request at build time. `next/font/google` (in
// node_modules/next/dist/compiled/@next/font/dist/google/) fetches CSS from
// fonts.googleapis.com AND the woff2 binaries it references from
// fonts.gstatic.com — both blocked by the Nix sandbox (no network). Next.js
// exposes exactly ONE network-free escape hatch: the
// NEXT_FONT_GOOGLE_MOCKED_RESPONSES env var, which points at a JS module that
// exports `{ [googleapisCssUrl]: cssString }`. next/font returns that CSS
// instead of fetching; for each `src: url(...)` in the CSS, if the URL starts
// with `/`, next/font readFileSync's it (fetchFontFile). So we rewrite the
// gstatic woff2 URLs in the CSS to ABSOLUTE LOCAL PATHS and write the binaries
// alongside the mock module. The fonts are REAL (not stubbed) — next/font still
// emits them to .next/static/media and rewrites the @font-face src to
// /_next/static/media/*.woff2, byte-identical to a networked `next build`.
//
// The googleapis CSS URLs below are derived from the 4 next/font/google
// declarations in web-bulwark/app/(main)/layout.tsx (Geist, Geist Mono,
// Young Serif, Atkinson Hyperlegible). They were produced by running next/font's
// OWN get-google-fonts-url.js (kept in web-bulwark/node_modules) against those
// declarations, then hardcoded here so the FOD is self-contained — it does
// NOT need the bulwark node_modules tree at fetch time (which would be awkward
// to plumb into a fixed-output derivation). They only change when layout.tsx's
// font declarations change; if they drift, next/font's build-time lookup keys
// won't match and the build fails with "Missing mocked response for URL" —
// regenerate by running get-google-fonts-url.js locally (see the script in
// git history / the comment block at the top of this file's predecessors).
//
// HTTP fetches use `curl` (NOT node https) because the remote NixOS builder's
// node has no CA bundle in its trust path (UNABLE_TO_GET_ISSUER_CERT_LOCALLY),
// while curl trusts the system `cacert` package. The Chrome User-Agent is
// passed so Google returns woff2 (next/font rejects non-woff2); copied from
// node_modules/next/dist/compiled/@next/font/dist/google/fetch-resource.js.
//
// Output layout ($out):
//   $out/mock-responses.js   — module.exports = { [cssUrl]: rewrittenCss }
//   $out/fonts/font-N.woff2   — the woff2 binaries next/font will readFileSync
//
// Run by the `bulwarkGoogleFontMocks` fixed-output derivation in flake.nix.
// Reads $OUT_DIR from env (runCommand sets $out). Determinism: the output hash
// pins the exact bytes; if Google ships a new font version the woff2 URLs (and
// thus the bytes) change, the hash mismatches, and someone re-prefetches —
// exactly the prefetch-npm-deps contract.
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const out = process.env.OUT_DIR;
if (!out) throw new Error("OUT_DIR not set");
fs.mkdirSync(path.join(out, "fonts"), { recursive: true });

// User-Agent MUST match fetch-resource.js's UA exactly — Google returns woff2
// only to modern-browser UAs (and next/font rejects non-woff2). Copied from
// node_modules/next/dist/compiled/@next/font/dist/google/fetch-resource.js.
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/104.0.0.0 Safari/537.36";

// Fetch a URL to a Buffer via curl (trusts the system cacert bundle; node
// https on the remote builder has no CA trust path). -sS silences progress but
// surfaces errors; -L follows redirects; --fail errors on non-2xx.
function fetchBuf(url) {
  return Buffer.from(
    execFileSync("curl", [
      "-sS", "-L", "--fail",
      "-A", UA,
      url,
    ]),
  );
}

// Derived from web-bulwark/app/(main)/layout.tsx (see comment block above):
//   Geist({ subsets:["latin"] })                         → wght@100..900
//   Geist_Mono({ subsets:["latin"] })                    → wght@100..900
//   Young_Serif({ weight:"400", display:"swap" })        → wght@400
//   Atkinson_Hyperlegible({ weight:["400","700"], style:["normal","italic"], display:"swap" })
//                                                        → ital,wght@0,400;0,700;1,400;1,700
// (display:"swap" → &display=swap; the two variable fonts default to swap.)
const CSS_URLS = [
  "https://fonts.googleapis.com/css2?family=Geist:wght@100..900&display=swap",
  "https://fonts.googleapis.com/css2?family=Geist+Mono:wght@100..900&display=swap",
  "https://fonts.googleapis.com/css2?family=Young+Serif:wght@400&display=swap",
  "https://fonts.googleapis.com/css2?family=Atkinson+Hyperlegible:ital,wght@0,400;0,700;1,400;1,700&display=swap",
];

(async () => {
  const mock = {};
  let fontIdx = 0;
  // Map a gstatic woff2 URL → its absolute store path under $out/fonts/. The
  // same woff2 can be referenced by multiple @font-face blocks; dedupe so we
  // only store + readFileSync it once.
  const gstaticToPath = {};
  for (const cssUrl of CSS_URLS) {
    process.stderr.write(`fetching CSS: ${cssUrl}\n`);
    // Google currently alternates only this latin-ext range for identical
    // requests and font binaries. Preserve the reviewed C0 CSS metadata;
    // all other CSS and every font byte remain covered by the original NAR hash.
    const css = fetchBuf(cssUrl).toString("utf8")
      .replaceAll("U+20AD-20C4", "U+20AD-20C0");
    let rewritten = css;
    // findFontFilesInCss matches `src: url(<this>)`; rewrite each to an absolute
    // path so fetchFontFile takes the readFileSync branch (url.startsWith('/')).
    for (const line of css.split("\n")) {
      const m = /src: url\((.+?)\)/.exec(line);
      if (!m) continue;
      const gstaticUrl = m[1];
      if (gstaticToPath[gstaticUrl] === undefined) {
        const buf = fetchBuf(gstaticUrl);
        const ext = /\.(woff2?|eot|ttf|otf)$/.exec(gstaticUrl)[1];
        const name = `font-${fontIdx}.${ext}`;
        fs.writeFileSync(path.join(out, "fonts", name), buf);
        // __dirname at require() time = $out (the mock module lives at
        // $out/mock-responses.js, the woff2s at $out/fonts/). Absolute path
        // starting with "/" → fetchFontFile readFileSync branch.
        gstaticToPath[gstaticUrl] = `" + __dirname + "/fonts/${name}`;
        process.stderr.write(`  ${gstaticUrl} → fonts/${name} (${buf.length}b)\n`);
        fontIdx++;
      }
      // Replace in the CSS we'll hand to next/font. The replacement is a JS
      // string-concat expression (eval'd inside the mock module) so we don't
      // have to bake the store hash into the source.
      rewritten = rewritten.split(gstaticUrl).join(gstaticToPath[gstaticUrl]);
    }
    mock[cssUrl] = rewritten;
  }

  // Emit the mock module. Each CSS value is emitted as a concatenation: the
  // JSON-stringified CSS (which contains `"+__dirname+"/fonts/font-N.woff2` as
  // a literal substring where we rewrote it) closed and reopened around the
  // __dirname reference. This keeps the store path out of the source so the
  // derivation stays content-addressable by its inputs, not its own hash.
  const entries = Object.entries(mock)
    .map(([url, css]) => {
      // css already has `"<path-expr>"` placeholders inlined as text like:
      //   " + __dirname + "/fonts/font-0.woff2
      // Split on that sentinel and rebuild as a JS concatenation.
      const parts = css.split('" + __dirname + "');
      // Re-emit: JSON-stringify the static fragments, splice in __dirname.
      const expr = parts
        .map((p, i) =>
          i === 0
            ? JSON.stringify(p)
            : `+__dirname+${JSON.stringify("/" + p.replace(/^\/fonts\//, "fonts/"))}`,
        )
        .join("");
      return `  ${JSON.stringify(url)}: ${expr},`;
    })
    .join("\n");
  fs.writeFileSync(
    path.join(out, "mock-responses.js"),
    `// AUTO-GENERATED by infra/bulwark-google-fonts-fetcher.js.\n` +
      `// Mocked responses for NEXT_FONT_GOOGLE_MOCKED_RESPONSES so next/font\n` +
      `// does not hit fonts.googleapis.com / fonts.gstatic.com at build time\n` +
      `// (no network in the Nix sandbox). The CSS values are the real Google\n` +
      `// Fonts CSS with src: url(...) rewritten to absolute paths under this\n` +
      `// module's __dirname so next/font readFileSync's the real woff2s.\n` +
      `module.exports = {\n${entries}\n};\n`,
  );
  process.stderr.write(`wrote ${Object.keys(mock).length} mock entries\n`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
