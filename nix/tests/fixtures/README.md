# Frozen Google Fonts responses

`google-fonts.json.gz` contains the four CSS responses and 21 WOFF2 files
captured on 2026-10-05 using the fetcher's existing Chrome User-Agent. The
response URLs are recorded in the fixture. Its CSS uses the original
`U+20AD-20C0` metadata, reconstructed from live responses whose font URLs and
all 247,620 font bytes were identical. Replaying it through the fetcher matches
the existing recursive Nix hash, `sha256-2sicALM/j6JHVFMcO4akQHhrxlyvdlGTpVbE1u/B6gI=`.

The regression suite also reproduces the failed CI bundle's hash,
`sha256-mLSXAXmS7edvfmVwluyUd6N7Sk9DwqktaAUESwSxWlc=`, with normalization
removed. No fixture requests use the network. These files are test inputs;
production continues fetching Google Fonts with the existing integrity gate.

The font families are Geist v5, Geist Mono v6, Young Serif v2 and Atkinson
Hyperlegible v12. Their SIL Open Font License notices are retained under
`licenses/`, fetched from the corresponding `ofl/<family>/OFL.txt` directories
of Google's `google/fonts` repository. The font binaries are unmodified.

Run from the repository root with Node and Nix installed:

```sh
node --test nix/tests/google-fonts-fetcher-regression.cjs
```
