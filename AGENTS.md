# Finance Buddy Agent Instructions

This file contains durable operating rules for coding agents working in the
Finance Buddy repository. The repository and current compiler/test output are
authoritative. Read `CURRENT_HANDOFF.md` for the current milestone and known
runtime evidence.

## Product mission

Finance Buddy turns a customer's own financial data into trustworthy,
personalized actions that help them use cards, rewards, benefits, and points
more effectively.

Optimize in this order:

1. Correctness and customer trust.
2. Useful personalization from customer data.
3. A coherent, actionable customer plan.
4. Reliability and recoverability.
5. Maintainability and development speed.
6. Provider cost and latency.

Do not optimize for an impressive-looking answer at the expense of evidence,
ownership boundaries, or transparent uncertainty.

## Start every task

Before editing:

1. Read this file and `CURRENT_HANDOFF.md` completely.
2. Run `git status --short` and `git log -3 --oneline`.
3. Inspect the relevant implementation and tests. Do not assume an earlier
   agent summary matches the working tree.
4. Preserve all existing user changes, including untracked files.
5. State the intended scope before making material changes.

Use `rg`/`rg --files` for repository searches when available. If `rg` is not
installed, use a narrow alternative without changing project dependencies.

## Editing discipline

- Make the smallest coherent change that solves the demonstrated problem.
- Keep task scope explicit. If another subsystem is required, explain why
  before expanding scope.
- Do not rewrite unrelated code, migrations, prompts, schemas, or UI.
- Do not revert, overwrite, or delete pre-existing changes merely because the
  worktree is dirty.
- Never use destructive Git commands such as `git reset --hard` or broad
  `git restore` operations.
- Do not commit or push unless the user explicitly asks.
- Do not add dependencies unless the task truly requires one and the user has
  accepted the tradeoff.
- Prefer focused, reviewable edits over broad refactors.

## Verification and evidence

After implementation, run:

1. The smallest relevant unit tests.
2. The broader affected test group when practical.
3. `npm run build`.
4. `git diff --check`.
5. `git status --short`, `git diff --stat`, and the actual relevant diff.

When applicable, also verify the browser flow and inspect safe server logs.
A claimed passing build, agent summary, or HTTP 200 is not proof that the
product behavior is correct. Distinguish:

- verified facts from code, tests, database output, or runtime logs;
- hypotheses that still need evidence;
- product decisions that require user approval.

Do not change code merely to make a fixture pass if the fixture contradicts a
valid trust or ownership rule.

## Financial trust rules

- Never invent balances, prices, eligibility, award availability, transfer
  ratios, fees, card offers, or customer preferences.
- Preserve the distinction among evidence, inference, calculation, manual
  input, and verification.
- `verified` requires explicit customer confirmation or an authoritative
  verification mechanism.
- Prefer deterministic TypeScript for arithmetic, coverage, feasibility,
  account matching, ranking, and allocations.
- Keep points and miles in their native program units. Never combine currencies
  or assign dollar values without an explicit sourced valuation system.
- Never combine different customer accounts merely because they share a reward
  program. Respect ownership and companion boundaries.
- Keep Money Found, Available Benefits, Potential Opportunities, Already Saved,
  and Rewards semantically separate.
- Research prices are planning estimates, not live inventory. Never label an
  award `available` without authoritative live evidence.
- Unknown information should remain unknown, nullable, or explicitly caveated.

## Personalization rules

Finance Buddy's value comes from combining validated public facts with the
customer's own data. Recommendations should use the relevant available inputs,
including:

- goal origin, destination, date flexibility, cabin, travelers, and trip nights;
- verified and unverified reward-account balances, kept separate;
- wallet cards and their linked reward programs;
- allowed-new-card preference;
- categorized and aggregated spending when relevant;
- validated flight, hotel, card-offer, and source data;
- deterministic coverage, funding, gap, and allocation calculations.

Do not ask the customer to provide data already present in the authenticated
context. Do not send unnecessary customer data to a cloud model. Cloud payloads
must exclude internal IDs, user IDs, account-owner identifiers/labels, raw
transactions, receipts, statements, credentials, and other data not required
for the model task.

## AI and research boundaries

- Treat all provider output as untrusted input.
- Validate source identity, program identity, numeric facts, enums, focus,
  goal relevance, coverage, pricing basis, and availability claims at runtime.
- Keep flight, hotel, card, and final-strategy tasks focused rather than asking
  a small/free model to solve unrelated contracts in one response.
- Reuse validated staged flight/hotel payloads during finalization. Do not accept
  research results, sources, signatures, balances, or options from the browser.
- Research stages may degrade independently when designed as best-effort, but
  structural, ownership, signature, and trust-boundary failures must not be
  silently ignored.
- Do not add hard-coded award facts as fallbacks.
- Rate limits, timeouts, malformed provider responses, and unavailable free
  models are expected operational conditions. Preserve completed work and make
  retries narrow and safe.
- Debug logs may include safe provider/stage summaries, never prompts, source
  bodies, customer financial data, payloads, signatures, tokens, headers,
  cookies, secrets, stacks, causes, or complete error objects.

## Security, authentication, and persistence

- Server actions derive `userId` from the authenticated Supabase session. Never
  trust a client-supplied user ID or strategy JSON.
- Preserve explicit ownership filters and Supabase RLS.
- Never expose or introduce service-role credentials into ordinary user flows.
- Signed strategy-run payloads must be verified server-side before use.
- Persist only fully validated, server-generated strategies.
- A failed rebuild or failed save must not overwrite the last saved strategy.
- Preserve the previous saved strategy during staged generation and failures.
- `.env.local` and all secrets must never be read aloud, logged, committed, or
  copied into documentation. It is acceptable to check whether a required key
  is configured without printing its value.

## Database migrations

- Never run `supabase db reset`.
- Do not edit a migration that has already been applied or committed as history.
- Use a new migration for new database behavior.
- The user reviews and explicitly runs remote `supabase db push` unless the user
  directly asks the agent to do so.
- Preserve schema qualification, transactions, constraints, RLS, ownership,
  and cascade behavior established by the repository.
- Do not weaken RLS or add permissive browser writes for convenience.

Known applied migrations are recorded in `CURRENT_HANDOFF.md`; verify remote
migration state before relying on that list for future changes.

## Git and temporary data

- Before staging, confirm `.env.local`, logs, `/tmp` recovery data, generated
  diagnostics, and unrelated files are excluded.
- Do not commit temporary debug logging unless it is deliberately safe,
  development-gated observability.
- A migration being applied before commit is a special risk: preserve the exact
  applied migration file and do not rewrite it afterward.
- If recovery is necessary, back up only exact target files and restore only
  known committed targets. Never restore the whole worktree.

## Completion report

Report:

- the outcome first;
- exact files changed;
- important behavior and trust-boundary changes;
- exact verification commands and results;
- anything not verified in a live browser/database/provider flow;
- migration, commit, and push status.

Update `CURRENT_HANDOFF.md` after a meaningful milestone or when the next agent
would otherwise need conversation history to continue safely.
