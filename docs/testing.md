# Testing

Use Node 24 and install locked dependencies with `npm ci`. Run `npm run lint`,
`npm run typecheck`, and `npm test`. Tests use synthetic accounts and data.

For browser regressions, install Chromium with `npx playwright install chromium`
and run `COMAIL_BROWSER_TESTS=1 npm test`.

Build the standalone application with `npx next build --webpack`, or build
the pinned Nix package with `nix build .#bulwark`. The Nix font fixture and its
license notices are included; run `node --test nix/tests/google-fonts-fetcher-regression.cjs`
to verify the pinned responses.

See [integration/README.md](../integration/README.md) for the disposable
Docker/Stalwart harness. A passing synthetic test does not certify a live provider.
