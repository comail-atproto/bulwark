# Comail Bulwark

Comail Bulwark is [Comail](https://comail.at)'s fork of
[Bulwark Webmail](https://github.com/bulwarkmail/webmail), a JMAP webmail client
for [Stalwart Mail Server](https://stalw.art/).

This repository contains a checked source snapshot of Comail Bulwark 1.19.1,
based on upstream commit `4887ed457c729722b31bc5ddd1ffb87eee52eebe`.
It includes Comail sign-in, the packaged theme, PDS groupware, tests, and pinned build inputs.
Unused native S/MIME code is removed; stored keys and certificates are preserved.
Private deployment automation and private Git history are excluded.
The weekly source workflow publishes checked snapshots after their production delay.

## Release policy

Development happens privately. Checked source releases will be published here
and on Tangled under the Comail account no earlier than seven days after their
verified private production release. Build, test, source, license, privacy,
and dependency checks must pass. Failed checks or a security hold can extend
the delay. The first source snapshot is a manually reviewed launch exception
to the seven-day delay. Future releases retain the delay unless an explicit
release exception is approved. The initial snapshot is also available on [Tangled](https://tangled.org/comail.at/bulwark).
Later snapshots are mirrored after review.

The seven-day delay concerns general publication. A deployed version must offer
its network users the corresponding source for that version during the delay,
as required by AGPL-3.0. Source recipients retain their redistribution rights.
A delayed public snapshot can differ from the version currently served.

## Build and test

Use Node 24:

```sh
npm ci
npm run lint
npm run typecheck
npm test
npx next build --webpack
```

Copy `.env.example` to `.env.local` and configure your JMAP server for a real
deployment. `.env.dev.example` enables the synthetic development server.
Nix users can run `nix build .#bulwark`. See [Testing](docs/testing.md) and
[the integration harness](integration/README.md) for the browser and Stalwart checks.
Operators of modified builds must configure `NEXT_PUBLIC_CORRESPONDING_SOURCE_URL`
or the runtime source URL to identify their own complete source.

## Contributions and security

Report Comail-specific issues in this repository. Contributions will be reviewed
and deliberately imported into private development before going through the same
release checks and delay. Contributors remain responsible for correctness
and licenses. AI contributions are allowed.

Report suspected vulnerabilities privately to security@comail.team. Include the
affected version, reproduction steps using synthetic data, and the impact.
Avoid posting credentials, private mail, user data, or exploit details publicly.

## License and attribution

The application is licensed under AGPL-3.0-only, with any additional permissions
preserved in each release's LICENSE. Releases retain the fork lineage, contributor
attribution, and third-party notices. Upstream's releases and container images
belong to Bulwark Webmail; this repository does not publish a Comail container image.

See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for component licenses,
source links and fork lineage. Upstream notices remain in [NOTICE](NOTICE).
