# Agent instructions

Follow CONTRIBUTING.md and AI_POLICY.md. Use a feature branch and pull request.
GitHub changes require signed, Verified commits, a DCO sign-off, passing checks,
and an approving review before merge. Keep secrets and personal data out of
code, fixtures, logs, and review attachments.

Open Comail GitHub PRs as `comail-agents[bot]`, keeping the contributor's name
and verified email on commits. When squash-merging a source release or a
single-author PR, pass that author's verified email to `gh pr merge` with
`--author-email <email>`. Check the resulting author email before mirroring to
Tangled. Do not add AI coauthor trailers.
