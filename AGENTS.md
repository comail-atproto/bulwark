# Agent instructions

Follow CONTRIBUTING.md and AI_POLICY.md. Use a feature branch and pull request.
GitHub changes require signed, Verified commits, passing checks,
and an approving review before merge. Keep secrets and personal data out of
code, fixtures, logs, and review attachments.

The maintainer-approved Comail source publisher may automatically merge its own
qualified `source/*` PRs after all checks pass. This exception does not apply to
interactive changes, human-owned PRs or changes to the publishing policy.

Use unmodified upstream dependencies by default, with ordinary release pins,
lockfiles, checksums and standard packaging. Do not add vendor packages,
dependency forks, package-manager overrides, source patches or install-time
source rewriting. Bulwark is a retained application fork; its other dependencies
still follow this rule. New exceptions need Scott's explicit instruction.
Preserve features and security checks during cleanup.
