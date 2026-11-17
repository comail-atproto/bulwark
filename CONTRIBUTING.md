# Contributing to Comail Bulwark

Comail Bulwark is a fork of [Bulwark Webmail](https://github.com/bulwarkmail/webmail).
Use the [upstream development guide](https://bulwarkmail.org/docs/development/contributing)
for architecture, translations, accessibility and code style. Use the rules below
for contributions to this fork, and follow [AI_POLICY.md](AI_POLICY.md).

## Checks and pull requests

Start from current main on a feature branch. Run the checks in
[Testing](docs/testing.md); authentication and account changes also need the
[Stalwart integration suite](integration/README.md). Keep changes focused and
include useful regression tests. Keep secrets and personal data out of code,
fixtures, logs and review attachments.

Use a Conventional Commit PR title and signed commits that GitHub marks Verified.
Link the relevant issue, or explain `No-Issue: <reason>` for a small change. The PR
body needs `## What & why`, `## Test evidence` and `## Deployment impact` sections.
Describe actual checks and gaps, deployment effects and how to undo the change.
Attach UI screenshots or recordings directly to the PR using synthetic data.

Required checks and an approving review must pass before merge. The protected,
maintainer-approved Comail source publisher may automatically merge its own
qualified `source/*` PRs after all checks pass. This exception does not apply to
interactive changes or human-owned PRs.

Contributions are deliberately imported into private development before a later
checked source release. See the [release policy](README.md#release-policy).
Report suspected vulnerabilities privately through [SECURITY.md](SECURITY.md).

Use `npm test` for unit checks and `npm run test:integration` for integration.
These commands select the configuration shipped with that source snapshot.
