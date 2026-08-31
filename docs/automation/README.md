# Finance Buddy agent workflow

GitHub issues and pull requests are the authoritative record for each bounded milestone.

1. The project manager creates an **Implementation milestone** issue with a small scope, explicit allowlist, acceptance criteria, verification commands, and stop conditions.
2. Codex implements only that issue on a dedicated branch and opens a draft pull request. It does not merge, deploy, alter secrets, or run live provider/database operations without the repository owner's explicit instruction.
3. GitHub Actions runs the required objective checks. A failed check blocks the pull request.
4. Hermes produces a read-only evidence review using `HERMES_PR_REVIEW.md`.
5. Freebuff performs an independent, read-only adversarial review using `FREEBUFF_REVIEW.md`.
6. The repository owner decides whether to request changes or merge. An agent report is evidence, never merge authorization.

## Required PR state

A pull request is ready for owner approval only when all of the following are true:

- The linked issue has complete acceptance criteria and an edit allowlist.
- The PR description contains actual verification results.
- The `Verify pull request` workflow is green.
- Hermes returns `READY FOR OWNER APPROVAL` with no unresolved blocker.
- Freebuff returns `PASS` or the owner explicitly accepts documented findings.
- The PR has no unapproved scope expansion.

## GitHub settings to apply manually

Protect `main` in GitHub repository settings:

- require a pull request before merging;
- require the `Verify pull request` status check;
- dismiss stale approvals when new commits are pushed;
- require all review conversations to be resolved;
- do not allow force pushes or direct pushes that bypass the rule.

Keep merge authority with the repository owner. Do not grant Hermes, Codex, Freebuff, or a GitHub Action permission to merge or deploy.
