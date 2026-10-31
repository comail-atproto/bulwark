# Third-Party Notices

Comail's webmail and the inbox service it fronts are built on third-party
software. This file records the principal components, their licenses, and
where to obtain their source. It supplements — and does not replace — the
`LICENSE` and `NOTICE` files in this repository.

## Bulwark Webmail (this application)

This repository is a modified version of **Bulwark Webmail**, distributed
under the **GNU Affero General Public License, version 3 only (AGPL-3.0)**.

- Upstream: https://github.com/bulwarkmail/webmail
- Fork lineage and preserved MIT attribution: see [`NOTICE`](./NOTICE)
- Full license text: see [`LICENSE`](./LICENSE)
- Corresponding Source (AGPL-3.0 §13): offered in-app under
  **Settings → About**, and published at the repository's public mirror.

## Stalwart Mail Server (the mail backend)

The Comail inbox is served by **Stalwart Mail Server**, an independent
project that provides the JMAP / IMAP / SMTP backend this webmail connects
to. Comail deploys an **unmodified upstream build** (`nixpkgs
stalwart-mail`) as a separate network service; it is not modified, and it is
not linked into Comail's own code.

- License: **AGPL-3.0** (Stalwart community edition)
- Source: https://github.com/stalwartlabs/stalwart

Because Comail runs Stalwart unmodified, the corresponding source for that
component is the upstream repository linked above. No warranty is provided
by Comail for Stalwart; see the upstream project for its terms.

## Fork lineage (MIT)

The earliest ancestor in this fork's lineage was MIT-licensed. That
attribution is preserved verbatim in [`NOTICE`](./NOTICE):

- https://github.com/root-fr/jmap-webmail — MIT, Copyright (c) 2025
  Matthieu MALVACHE

---

_Other bundled JavaScript/TypeScript dependencies retain their own licenses
as declared in `package.json` / `package-lock.json` and their respective
`node_modules/*/LICENSE` files._
