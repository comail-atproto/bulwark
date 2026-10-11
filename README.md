# Comail Bulwark

Comail Bulwark is [Comail](https://comail.at)'s fork of
[Bulwark Webmail](https://github.com/bulwarkmail/webmail), a JMAP webmail client
for [Stalwart Mail Server](https://stalw.art/).

This repository contains a checked source snapshot of Comail Bulwark 1.13.0,
based on upstream commit `3d48b122046a5898189012e610bf35e2a7ddab3e`.
It includes Comail sign-in, branding, S/MIME, tests, and pinned build inputs.
Private deployment automation and private Git history are excluded.
Automated source publishing is not active yet.

## Release policy

Development happens privately. Checked source releases will be published here
and on Tangled under the Comail account no earlier than seven days after their
verified private production release. Build, test, source, license, privacy,
and dependency checks must pass. Failed checks or a security hold can extend
the delay. The first source snapshot is a manually reviewed launch exception
to the seven-day delay. Future releases retain the delay unless an explicit
release exception is approved. Tangled publication is still being prepared.

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
release checks and delay. Contributors remain responsible for correctness,
licenses, and the required DCO sign-off. AI contributions are allowed.

Report suspected vulnerabilities privately to security@comail.team. Include the
affected version, reproduction steps using synthetic data, and the impact.
Avoid posting credentials, private mail, user data, or exploit details publicly.

## License and attribution

The application is licensed under AGPL-3.0-only, with any additional permissions
preserved in each release's LICENSE. Releases retain the fork lineage, contributor
attribution, and third-party notices. Upstream's releases and container images
belong to Bulwark Webmail; this repository does not publish a Comail container image.
