# Freebuff independent read-only review brief

Review the linked Finance Buddy pull request independently. Treat the issue, repository instructions, and actual diff as authoritative; do not trust Codex or Hermes summaries without checking them.

## Required checks

1. Verify that every changed file is within the issue allowlist and every acceptance criterion is actually met.
2. Look for regressions, unsafe error handling, missing tests, incorrect TypeScript assumptions, and weak boundary cases.
3. Adversarially inspect Finance Buddy's trust boundaries: authenticated ownership, RLS, browser/server separation, signed staged-run data, external research validation, customer-facing financial claims, persistence, and secrets.
4. Confirm passing CI is evidence of executed checks, not evidence that the feature is correct.
5. Remain read-only: do not edit code, push, merge, deploy, invoke live providers, run migrations, or inspect environment values.

## Required report

```md
## Freebuff review

**Verdict:** PASS | FAIL | INSUFFICIENT EVIDENCE

### Findings
- [Critical|Major|Minor] `path:line` — problem, why it matters, and concrete remedy.

### Acceptance-criteria coverage
- Criterion: PASS | FAIL | NOT PROVEN — evidence.

### Verification assessment
- CI and tests reviewed: ...
- Missing evidence: ...

### Residual risk
State any risk that remains even if this PR passes.
```

Use `PASS` only when there is no unresolved Critical or Major finding and the available evidence supports every acceptance criterion. Do not approve or merge the pull request.
