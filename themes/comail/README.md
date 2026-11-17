# Comail theme

`manifest.json`, `theme.css`, and `skin.css` form a Bulwark Theme API v2 package.
The theme keeps the `builtin-comail` ID so saved choices, default policy, disabled
built-in lists, and forced-theme policy keep their meaning.

Run `scripts/bulwark npm run build:theme` and `scripts/bulwark refresh` after
changing these files. Commit the generated ZIP in
`public/branding/comail/`; it includes the repository's AGPL license. Bump the manifest
version for each release that changes the package, because browsers cache its
versioned URL. Retain the preceding ZIP while its app release remains supported.

The Comail theme provider uses upstream's ZIP validator and theme store to load
this bundled package. Registration keeps the built-in controls and works without
IndexedDB. The other built-in themes, user choices, and operator policy continue
through upstream's provider. A failed download leaves the app usable and logs a
warning; reloading retries it. Bulwark 1.14.2's admin upload path does not preserve
Theme API v2 skins, so this package uses the client loader.

Run `COMAIL_BROWSER_TESTS=1 scripts/bulwark npm test` for the package, startup, login, sidebar,
Mountain View, and light/dark checks. Comail appearance tests read the packaged ZIP.
