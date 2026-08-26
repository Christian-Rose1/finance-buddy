# Finance Buddy Current Handoff

Updated: 2026-08-26, America/Boise

## Read this first

This handoff supersedes the 2026-08-21 strategy-pipeline handoff. The repository
is authoritative. Start with `git status --short`, inspect the current code and
tests, and treat any discrepancy here as something to verify rather than a
reason to overwrite the working tree.

The project has accumulated substantial related changes. Do not discard or
recreate them. Preserve the dirty worktree until a coherent checkpoint is
reviewed and explicitly committed.

## Current objective

The reliability, trust, workflow, maintainability, dependency, accessibility,
financial-semantics, and import-boundary pass is complete locally. The next
operational step is a maintainer-reviewed deployment of the six pending
2026-08-26 migrations,
followed by authenticated browser/database/provider verification. Do not deploy
the application changes that depend on import drafts before those migrations and
the private import signing secret have been provisioned.

## Latest verified live run

The user started Next.js with `STRATEGY_DEBUG=1` and captured:

```text
/tmp/finance-buddy-hotel-validation.log
```

Observed sequence:

1. Flight-stage request completed with HTTP 200.
2. Hotel-stage request completed with HTTP 200.
3. Finalization request returned HTTP 200 at the Next.js action layer but the
   action reported a safe internal failure.

Relevant logs:

```text
[strategy-research-plan-fallback] {"error":"OpenRouter research planner returned HTTP 429."}
[strategy-finalize-error] StrategyProviderError: OpenRouter returned HTTP 429.
```

Interpretation:

- The research planner hit OpenRouter 429 and correctly used its deterministic
  fallback research plan.
- Tavily returned useful hotel evidence.
- The final strategy provider then hit OpenRouter 429, so finalization failed.
- The Next.js `POST /goals 200` only means the server action completed; it does
  not mean strategy generation succeeded.

Do not diagnose this as a Tavily or hotel-query failure.

## Latest hotel evidence

The fallback hotel plan issued two searches:

1. A Chase/program-oriented hotel award query for Paris.
2. A destination-generic Paris hotel award pricing query.

Tavily returned strong destination-specific evidence, including:

- Hôtel du Louvre in Paris, World of Hyatt Category 7, cited at 25,000–35,000
  points per night depending on off-peak/standard/peak pricing.
- Other Paris hotel examples cited at 30,000, 35,000, 55,000, or 60,000 points
  per night in specialist sources.
- Chase transfer-partner material discussing World of Hyatt and changing
  transfer ratios.

The exact live travel dates and rooms were not confirmed. These remain planning
benchmarks, not availability claims.

## Implemented strategy architecture

The exact working-tree signatures must be confirmed before editing, but the
following capabilities were implemented and repeatedly built/tested.

### Provider-neutral research

- Shared research-interpreter contract, schema, prompt/validation helpers, and
  `ResearchInterpreterError`.
- Ollama and OpenRouter research interpreters.
- Provider selection through a factory.
- Research focuses include legacy `award_options`, `card_offers`, and dedicated
  `flight_options` / `hotel_options`.
- Flight, hotel, and optional card interpretation are focused and isolated.
- Cloud research payloads exclude the complete goal/customer context and send
  only the approved public research fields.

### Research planning

- A research planner produces targeted flight, hotel, card, temporal, and value
  queries, with a deterministic fallback when the model planner fails.
- Hotel planning now produces both a program-specific query and a broader
  destination benchmark query.
- Flight, hotel, and card searches can run concurrently where used by the full
  planner; staged actions run flight and hotel separately for incremental UI.

### Research validation

- Source IDs are canonicalized from exact URL IDs or unique exact source-title
  aliases.
- Required facts remain strict; unsupported optional numeric fields normalize
  safely where designed.
- Award options classify flight versus hotel and record pricing basis.
- Nullable optional itinerary, fees, seats, cabin, transfer, and valuation
  fields allow partial but sourced planning options.
- Coverage semantics distinguish traveler and night coverage.
- Goal relevance distinguishes exact, partial, general, and different
  destination options with mismatch reasons.
- Hotel per-night category ranges may support a native hotel-program points
  value inside the cited range. Flight pricing remains strict.
- A hotel `per_night` option may use single-night coverage without requiring a
  literal digit `1` when the source says “per night.”
- Hotel interpretation may drop an invalid trust-boundary option while retaining
  valid sibling hotel options. Structural errors still propagate. Flights keep
  whole-stage strictness.
- Prompts prohibit multiplying native hotel prices by transfer ratios and
  prohibit inventing total-stay prices from per-night figures.

### Deterministic customer calculations

- Points inventory is built from customer reward accounts without exposing
  `userId` or `ownerKey` in the returned strategy.
- Verified and unverified balances remain distinct.
- Accounts and currencies are not improperly merged.
- Flight and hotel requirement calculators account for pricing basis and
  coverage.
- Trip-night calculation uses `minimumNights` first, then `maximumNights`, then
  calendar span. The current Euro Trip therefore uses 8 nights rather than the
  27-day date-window span.
- Allocation builder returns flight-first, hotel-first, balanced, and fallback
  scenarios and uses only verified self-owned accounts for funding.
- Allocation scenarios are attached deterministically to the final strategy;
  the narrative model cannot invent them.

### Strategy rendering and persistence

- The strategy panel renders saved status, points inventory, allocation
  scenarios, flight options, hotel options, actions, alternatives, assumptions,
  warnings, and follow-up questions.
- Raw option/account identifiers are not rendered to customers.
- A successful generated strategy is saved as the latest strategy per goal.
- The goals page batch-loads saved strategies and initializes panels from them.
- Failed rebuilds preserve the previous saved strategy.

### Signed staged runs

- Flight research, hotel research, and finalization are separate server actions.
- The browser sends only `goalId` and `runId`; it never supplies research
  options, payloads, signatures, balances, or strategy JSON.
- Stage payloads use HMAC-SHA256 signatures bound to version, run, goal, user,
  expiration, stage, and exact serialized payload.
- The repository verifies ownership, expiration, run signature, and stage
  signatures.
- Stage payloads use strict provider-neutral validation and sanitization.
- Finalization loads verified server-side stage payloads, optionally performs
  card research, generates the narrative once, attaches deterministic data,
  and saves only a complete validated strategy.
- Failed or unsaved runs are retained for retry; successfully finalized runs may
  be deleted after the saved strategy is secure.
- UI shows flight and hotel previews incrementally and preserves them and the
  prior strategy when finalization fails.

## Resiliency changes already made

- Research-planner model failure falls back to a deterministic plan.
- Invalid model-recommended award/card IDs are cleared with warnings instead of
  crashing finalization.
- Hotel option validation is tolerant per option for specific evidence-boundary
  failures.
- Safe development diagnostics exist for research and staged execution.

### 2026-08-25 provider-resilience checkpoint

Repository inspection confirmed that the staged finalization retry path was
already present: flight/hotel results stay in the server-side signed run, the
run permits `failed → running`, and the panel retries finalization with only
`goalId` and the existing `runId`.

The OpenRouter strategy provider now makes at most two total attempts. It
retries one HTTP 429 only when `Retry-After` is absent, valid, and capped at
five seconds; it also retries one malformed model response. Raw provider/model
responses are no longer logged, including under `STRATEGY_DEBUG`, because they
can contain customer-specific strategy content. The error returned after the
bounded attempts remains safe and the failed run remains retriable until its
existing expiry.

Verified locally on 2026-08-25:

- `npm test` passed: 597 tests.
- `npm run build` passed. It emitted an existing Next.js `<img>` performance
  warning in `components/receipt-upload-panel.tsx`.
- `git diff --check` passed.

Still required: the live browser/provider run listed below. In particular,
confirm that a real OpenRouter 429 or malformed completion leaves the preview
and retry control visible, and that a later finalization-only retry saves the
strategy without rerunning flight/hotel research.

Finalization retries now also skip optional card planning, Tavily searches, and
card interpretation. A retry uses only the verified signed flight/hotel stages
to regenerate the narrative. A non-terminal staged run is explicitly marked
non-retryable so the panel directs the customer to rebuild instead of offering
an impossible finalization retry.

Do not duplicate these mechanisms without first confirming the current code.

### 2026-08-26 customer-trust checkpoint

Production customer flows no longer use development offers or the development
wallet to calculate or display financial value. Receipt analysis now reports
only discounts evidenced on the receipt, preserves an unknown discount as
unknown, and leaves Money Found/opportunities empty until customer-specific
verified inputs are available. Purchase detail no longer falls back to a fake
wallet when the customer has no linked cards.

The dashboard's hard-coded monthly-spend and savings-health claims were removed
and replaced with neutral values derived from loaded purchases. Landing-page
sample metrics are now explicitly labeled illustrative. The development
benefit-matching API returns 404 in production before parsing a request or using
fixtures.

Verified locally on 2026-08-26:

- Focused trust-boundary tests passed: 6 tests.
- `npm test` passed: 614 tests.
- `npm run lint` passed with the existing receipt `<img>` warning.
- `npm run build` passed with non-secret placeholder public Supabase values.
- The compiled production benefit-test endpoint returned HTTP 404.

The later database-hardening checkpoint resolved the mixed/unknown-currency
dashboard aggregation issue described during this review.

## Persistence and migrations

The user reported successfully applying these remote migrations, and
`supabase migration list` showed local/remote alignment through them:

- `20260821120000_seed_chase_transfer_reward_programs.sql`
- `20260822120000_create_goal_strategies.sql`
- `20260823120000_create_goal_strategy_runs.sql`

The last migration creates the signed staged-run table. It was applied on
2026-08-23. Treat all three as applied historical artifacts: do not edit them.
Any schema change requires a new migration.

The staged-run table's authenticated ownership RLS does not itself distinguish
browser writes from server-action writes. HMAC verification is therefore the
trust boundary preventing browser-forged staged payloads from being finalized.
Do not weaken or bypass signature verification.

### 2026-08-26 database-hardening checkpoint

New local migration (not remotely applied):

- `20260826120000_harden_database_integrity.sql`

The migration adds composite goal ownership foreign keys, one benefit-state row
per card/product benefit, stricter currency/last-four/range checks, database-owned
`updated_at` triggers, and bounded Storage MIME/size policies. Purchase imports
now use content-derived source keys; `persist_purchase` is idempotent and the new
`persist_purchases` RPC writes a complete statement in one transaction.

New/updated saved goal strategies carry an HMAC over canonical strategy JSON,
goal, user, and generation time. Existing rows remain readable as legacy rows,
but RLS requires every future insert or update to use signed integrity metadata.
Raw Ollama research responses are no longer logged.

Application changes authenticate before receipt/statement parsing, enforce the
same upload limits as Storage, validate user-owned Storage paths, preserve
statement Storage provenance, list each user's actual Storage folder, reject
mixed/unknown-currency dashboard aggregation, validate OAuth redirect targets,
and perform a real Supabase sign-out.

Verified locally on 2026-08-26:

- Focused database/trust tests passed: 39 tests.
- `npm test` passed: 634 tests.
- `npx tsc --noEmit` passed.
- `npm run lint` passed with the existing receipt `<img>` warning.
- `npm run build` passed with non-secret placeholder public Supabase values.

The new migration must be reviewed and applied before deploying these application
changes. It was not pushed to the shared database in this session. SQL runtime
execution was not verified locally because no local PostgreSQL/Supabase CLI is
available in this snapshot.

## Configuration and privacy

Known configuration names include:

```text
STRATEGY_RESEARCH_PROVIDER
OPENROUTER_API_KEY
OPENROUTER_RESEARCH_MODEL
STRATEGY_RUN_SIGNING_SECRET
STRATEGY_DEBUG
```

There may be additional current provider variables in the repository. Inspect
code for names, but never print secret values or copy `.env.local` contents.

The latest run used OpenRouter/free infrastructure and encountered HTTP 429.
Earlier runs showed that `openrouter/free` may route different stages to
different free models, producing inconsistent quality. A pinned free model can
improve consistency but does not eliminate rate limits or availability risk.

The current strategy-provider payload must remain appropriate for cloud use.
Do not send raw authenticated context containing user IDs, internal IDs,
owner labels/keys, receipt or statement data, or unnecessary personal details
to OpenRouter. Confirm the current sanitized strategy-prompt boundary before
changing provider wiring.

## Immediate next work

First diagnose the current code rather than editing immediately:

1. Inspect the strategy-provider core, OpenRouter strategy provider, provider
   factory, finalization action, and strategy panel retry behavior.
2. Confirm whether the final provider already implements bounded retry,
   `Retry-After` handling, malformed-output retry, or model fallback.
3. Confirm whether the UI can retry finalization using the existing signed
   `runId` without rerunning successful flight/hotel research.
4. Confirm the run remains valid and in a retriable final status after the 429.

Then design the smallest improvement that achieves this product behavior:

- A transient final-provider 429 must not discard completed flight/hotel stages.
- The customer should be able to retry only finalization while the signed run is
  unexpired, rather than paying the latency/cost of repeating research.
- Retry must be bounded and must respect provider rate-limit signals where
  available.
- The previous saved strategy and incremental previews remain visible.
- No client-supplied model data is accepted.
- No silent switch to a provider that violates the sanitized cloud-data
  boundary.

Whether to implement provider-side retry, a finalization-only UI retry, or both
is a decision to make after inspecting current behavior. Do not assume HTTP 429
can be fixed by changing Tavily queries or relaxing validation.

## Required live verification after the next change

With safe development logging enabled, rebuild the same Euro Trip and confirm:

1. Flight stage finishes or returns a safe isolated failure.
2. Hotel stage finishes and reports at least one validated hotel option when the
   cited evidence is interpreted successfully.
3. Hotel options use native program points and 8-night deterministic math.
4. A final-provider transient failure preserves the staged run and exposes a
   finalization-only retry path.
5. A successful retry creates and saves the complete strategy without rerunning
   flight/hotel research.
6. Page refresh loads the saved strategy.
7. No logs expose customer data, research bodies, signatures, payloads, or
   secrets.

Run focused tests, `npm run build`, and `git diff --check` before the browser
test. Review the real diff afterward.

## Known product/data facts

- Current test goal: Denver to Paris/Europe, economy, 2 travelers, date window
  2027-04-03 through 2027-04-30, with minimum 8 nights and maximum 16 nights.
- Verified customer balance used in testing: 80,000 Chase Ultimate Rewards
  points, manually entered and marked verified.
- Catalog includes Chase transfer-partner program identities. Catalog membership
  does not imply customer ownership, a current transfer ratio, or availability.
- A previously successful strategy was saved and survived page refresh.

## Do not do next

- Do not rerun or edit applied migrations.
- Do not weaken HMAC, ownership, stage-envelope, source, or numeric validation.
- Do not make hotel ranges or per-night exceptions apply to flights.
- Do not hard-code the Paris/Hyatt evidence into application logic.
- Do not treat an HTTP 200 server-action response as generation success.
- Do not rerun all research merely because final narrative generation was rate
  limited if the signed run can be retried safely.
- Do not expose raw error bodies or provider credentials to the client.
- Do not remove the last saved strategy on a failed rebuild.
- Do not commit `.env.local`, logs, temporary files, or unrelated worktree
  changes.

### 2026-08-26 incomplete-workflows checkpoint (Developer 5)

Goal and wallet-benefit workflows are now complete in the local application
code. Existing goals can be edited across every persisted customer field and
deleted from `/goals`; both actions derive ownership from the authenticated
session, validate UUIDs and form values, and retain explicit `user_id` filters.
A saved strategy older than an edited goal is hidden and labeled stale until
the customer builds a replacement.

For linked wallet cards, `/wallet` now lists active benefit definitions from
the exact linked catalog product even before user state exists. A customer can
start tracking a definition, edit bounded remaining/used values and dates, and
activate or deactivate it. Catalog titles, rules, values, and product links are
never accepted from the browser or written by these actions. Repository checks
require an owned card, the exact current card-product link, and an owned state
row before mutation; stale cross-product state is excluded from downstream
benefit reads.

No migration was added or applied. The existing local, not-yet-applied
`20260826120000_harden_database_integrity.sql` already supplies the unique
card/benefit constraint needed to close concurrent duplicate creation.

Developer 5 verification:

- Focused goal/wallet suite: 60 passed.
- `npx tsc --noEmit`: passed.
- Owned-file ESLint: passed.
- `npm run lint`: passed with the existing receipt `<img>` warning.
- Production `npm run build` with non-secret placeholder public Supabase values:
  passed.
- Full `npm test` passed after concurrent work settled: 713 tests.
- Unauthenticated HTTP checks returned `307` to `/login` for `/goals` and
  `/wallet`, and `/login` returned `200`.
- Authenticated browser/database mutation was not exercised in this session.

Separate tester checklist:

1. Edit a goal, refresh, and confirm all values/status persist and an older
   strategy is labeled stale rather than displayed as current.
2. Delete an owned goal and confirm its strategy/run children cascade; attempt
   a non-owned UUID and confirm no record changes.
3. Link a card to the seeded Chase Sapphire Preferred product, start tracking
   its hotel credit, update usage/period dates, deactivate/reactivate it, and
   refresh after each operation.
4. Submit another card's state ID or another product's benefit ID and confirm
   the action is rejected without creating or changing state.

Tester 5 follow-up rework is complete. `deleteWalletCard` now requires the
delete query to return one owned row, so missing and cross-user card IDs produce
the same generic failure instead of a false success. While any benefit mutation
is pending, every benefit mutation button and editable field in that card's
benefit manager is disabled; the active row still shows its specific progress
label and success/error result. Tester assertions were not changed.

Rework verification:

- Focused wallet suite: 46 tests passed.
- Full `npm test`: 713 tests passed.
- `npx tsc --noEmit`: passed.
- `npm run lint`: passed with the existing receipt `<img>` warning.
- Production `npm run build` with non-secret placeholder public Supabase values:
  passed.

## 2026-08-26 integration coverage checkpoint

Issue 6 added a separately runnable integration suite and production HTTP
smoke command without adding dependencies or changing application behavior.

- `npm run test:integration` covers a signed statement draft through approval,
  canonical purchase conversion, batch persistence, rehydration, idempotent
  confirmation, spending aggregation, and stored-payload tamper rejection.
- The same suite covers signed flight/hotel stage creation, ownership filtering,
  stage validation, final-state transitions, signed final-strategy persistence,
  reload, and stored-strategy tamper rejection.
- `npm run test:production-smoke` builds with fixed synthetic configuration,
  starts the compiled Next server on an available localhost port, verifies
  `GET /` returns the public Finance Buddy HTML, and verifies malformed input to
  `POST /api/receipts/benefits-test` returns the production-safe JSON 404.

Verified locally on 2026-08-26:

- `npm run test:integration` passed: 2 tests.
- `npm test` passed: 679 tests.
- `npx tsc --noEmit` passed.
- `npm run lint` passed with the existing receipt `<img>` warning.
- `npm run test:production-smoke` passed, including its fresh build and both
  HTTP assertions.
- `npm run build` passed with non-secret placeholder Supabase values. A bare
  build without those values fails while prerendering `/dashboard`, as expected
  for this configuration.

The persistence integration tests use in-memory Supabase-compatible clients;
no live database, migration, external provider, commit, or push was performed.
This workspace snapshot has no `.git` metadata, so Git status/diff checks were
not available; a direct whitespace scan of the changed files was clean.

Issue 6 review follow-up corrected the default test discovery pattern. `npm
test` now includes non-overlapping `lib/**/*.test.ts`,
`components/**/*.test.ts`, and `components/**/*.test.tsx` patterns while
`npm run test:integration` remains independently runnable. On Node v26.4.0
(within the declared Node >=22 range), the default suite passed 768 tests: the
previous 754 tests plus all 14 component tests, with the 3 integration tests
observed exactly once. Integration, lint, TypeScript, and the production
build/HTTP smoke also passed; lint retained only the existing receipt `<img>`
warning.

## 2026-08-26 module-size refactor checkpoint (Developer 7)

Issue 7 received a bounded, behavior-preserving split of the two largest owned
modules. `components/goal-strategy-panel.tsx` is now 149 lines (previously
1,330). Its staged generation flow is implemented by an extracted hook and a
pure reducer, while award options, progress, points inventory, allocation
scenarios, and final strategy presentation live in focused components under
`components/goal-strategy/`.

`lib/goals/ollamaResearchInterpreter.ts` is now 200 lines (previously 1,662).
The unchanged prompt block moved to `researchInterpreterPrompt.ts`; source and
evidence validation helpers moved to
`researchInterpreterValidationHelpers.ts`; output validation moved to
`researchInterpreterValidation.ts`. Existing exports from the Ollama module
remain available. No prompt, validation rule, provider request shape, customer
text, action signature, or persistence boundary was intentionally changed.

Developer 7 verification:

- Extracted component reducer/presentation tests passed: 11 tests.
- Ollama and OpenRouter interpreter tests passed: 90 tests.
- Goals suite passed: 512 tests.
- `npm test` passed: 713 tests.
- `npx tsc --noEmit` passed.
- `npm run lint` passed with the existing receipt `<img>` warning.
- `npm run build` passed with non-secret synthetic public Supabase values.
- A source-block comparison confirmed the prompt and provider class are exact
  moves and the validation block differs only by exports and the shared
  source-builder name.
- Direct trailing-whitespace scan passed. Git status/diff checks remain
  unavailable because this workspace snapshot has no `.git` metadata.

No migration, live database/provider call, authenticated browser test, commit,
or push was performed.

Tester handoff:

1. Open `/goals` with a saved strategy and confirm all inventory, allocation,
   flight/hotel, action, warning, and caveat sections render as before.
2. Rebuild a strategy and confirm flight and hotel previews appear
   incrementally while the previous saved strategy remains visible.
3. Force a retryable finalization failure and confirm `Try finishing again`
   retains previews and retries only finalization with the existing run.
4. Force a non-retryable/expired run and confirm the UI offers a full rebuild.
5. Complete a rebuild, refresh, and confirm the newly saved strategy reloads.

## 2026-08-26 UI accessibility and responsive-polish checkpoint (Developer 10)

Issue 10 is complete within the assigned dashboard, wallet, purchase-card,
goal-card, and strategy-presentation surfaces. The dashboard sidebar now uses
real links to existing routes instead of inert buttons. Purchase card selection
has an associated label/help relationship, one unambiguous unknown option,
visible save/error feedback, and rollback to the last successfully persisted
selection. Wallet product-link feedback now uses typed action results instead
of guessing from message text and remains visible after the editor closes.

Wallet card, benefit, goal deletion, and strategy-generation actions expose
specific pending labels, `aria-busy`, polite status updates, or assertive error
alerts as appropriate. Decorative icons are hidden from assistive technology;
goal edit controls expose their expanded region; destructive controls name the
affected card or goal. Wallet and dashboard action/value rows now wrap or stack
at narrow widths without changing the existing visual system.

Developer 10 verification:

- Focused presentation suite passed: 13 tests.
- `npm test` passed: 741 tests.
- `npx tsc --noEmit` passed.
- Owned-file ESLint passed.
- `npm run lint` passed with the existing receipt `<img>` warning only.
- Production `npm run build` passed with synthetic public configuration.
- `npm run test:production-smoke` passed after a fresh build, including public
  HTML 200 and the production-safe fixture 404.
- Responsive source inspection confirmed wrapping/stacking behavior in each
  assigned action row. In-app browser automation could not initialize, so no
  authenticated visual/mutation walkthrough was claimed.

Tester handoff:

1. At 320px and desktop widths, open `/wallet`; verify card actions wrap, link
   and benefit actions remain readable, and benefit fields retain their labels.
2. Force card-product link and card-used save failures; verify the error is
   visible, announced, and the prior persisted selection remains displayed.
3. Activate/deactivate/remove a wallet card and edit/delete a goal; verify the
   affected action names its pending state and destructive confirmation is
   explicit.
4. Build and retry a goal strategy with a screen reader; verify stage progress,
   final success, save warnings, and build errors are announced once and the
   visible previews/strategy remain intact.

No migration, authenticated database/provider mutation, commit, or push was
performed.

## 2026-08-26 ingestion breadth checkpoint (Developer 2)

Receipt ingestion now supports JPEG, PNG, WebP, and text-based PDF receipts.
PDF text is extracted locally with the existing `pdf-parse` dependency and sent
to the configured `OLLAMA_RECEIPT_MODEL` through the same strict receipt
normalization/validation, signed import-draft review, and approval-only purchase
persistence path used by receipt images. Filenames are not sent to Ollama, and
raw model output and parser causes are not retained in surfaced provider errors.

PDF extraction now fails closed with separate safe outcomes for empty,
malformed/corrupt, password-protected, and textless/scanned documents. Scanned
receipt PDFs must be uploaded as a supported image. Both receipt and statement
file pickers are native keyboard-operable buttons and state their accepted
formats explicitly.

Statement ingestion remains intentionally limited to text-based Chase
credit-card PDF statements; no CSV or other bank format was added. The route
now requires both Chase identity and recognized statement structure before
parsing. Transaction and statement dates receive real calendar validation,
optional Chase posting-date columns and dollar signs are parsed
deterministically, implausibly large rows are ignored, and December-to-January
statement periods assign late-year transactions to the preceding year.

Verified locally on 2026-08-26:

- Focused parser/receipt/import/upload suite passed: 58 tests.
- `npm test` passed: 739 tests.
- `npm run test:integration` passed: 2 tests.
- `npx tsc --noEmit` passed.
- `npm run lint` passed with the existing receipt `<img>` warning.
- `npm run build` passed with non-secret synthetic configuration.
- `npm run test:production-smoke` passed, including its fresh build and HTTP
  assertions.
- A generated text PDF was read through the real `pdf-parse` implementation;
  focused tests mock PDF extraction for the full PDF-to-Ollama request path.
- Direct trailing-whitespace scan passed. Git status/diff checks remain
  unavailable because this workspace snapshot has no `.git` metadata.

No migration, live database/provider call, authenticated browser test, commit,
or push was performed. Existing migrations `20260826120000`,
`20260826130000`, and `20260826140000` and all import signing/workflow modules
were left unchanged.

Tester handoff:

1. Upload a text-based receipt PDF and confirm a review appears before any
   purchase is saved; approve it and confirm exactly one purchase appears.
2. Upload scanned and password-protected receipt PDFs and confirm each produces
   the specific safe error; upload the scanned page as an image and confirm the
   existing image path still works.
3. Upload a supported Chase statement PDF and verify every parsed date, merchant,
   amount, and category before approving the all-at-once import.
4. Test a December-to-January Chase statement and confirm December transactions
   use the preceding year.
5. Upload a non-Chase, scanned, encrypted, and malformed statement PDF and
   confirm each is rejected without creating an import review.

## 2026-08-26 issue 10 tester rework

Developer 10 completed the accessibility follow-up without changing the three
tester regression files. Each `WalletCardForm` now uses a stable React `useId`
instance prefix for every label/control pair, so create and edit forms can be
rendered together without duplicate IDs. The card-product disclosure trigger
remains mounted while its chooser is expanded, preserves its stable
`aria-controls` target, and reports `aria-expanded=true` until the same control
closes it.

A failed card-used persistence action still renders an alert and restores the
last persisted selection, but no longer marks that restored valid select with
`aria-invalid`. Decorative wallet and goals page-header icons are now hidden
from assistive technology.

Rework verification:

- Unchanged tester regressions passed: 3 tests.
- Broader focused presentation suite passed: 16 tests.
- `npm test` passed: 754 tests.
- `npx tsc --noEmit` passed.
- Owned-file ESLint passed.
- `npm run lint` passed with the existing receipt `<img>` warning only.
- Production `npm run build` passed with synthetic public configuration.
- `npm run test:production-smoke` passed after its fresh production build.

No migration, authenticated database mutation, test assertion edit, commit, or
push was performed.

### Tester 2 rework

The ingestion regression tests added by Tester 2 were kept unchanged and now
pass. Chase recognition examines only the pre-transaction statement header and
requires a strong issuer marker (`JPMorgan Chase Bank`, a Chase card-services
header, or a standalone `CHASE` header), so a Chase merchant on another bank's
statement cannot establish issuer identity. Statement dates are now derived
only from labeled closing/statement/period evidence or a month-year in the
bounded non-legal header; the prior bare-year fallback was removed.

Parsed transactions retain their optional posting date. Deduplication and the
stable transaction ID include that posting date, preserving otherwise identical
transactions posted on different dates while still removing exact duplicate
PDF extraction rows. Posting dates also receive defensive calendar validation
when converted.

Ollama output is now eligible for normalization only when it has the complete,
typed receipt response shape. Empty/incomplete JSON, fully evidence-empty
receipts, and placeholder items with no name or monetary value fail with
`invalid_output`. Runtime receipt-schema validation remains mandatory after
normalization; no provider response is trusted because JSON response mode was
requested.

Rework verification on 2026-08-26:

- Unchanged Tester 2 focused suite passed: 31 tests.
- Affected parser/receipt/import/upload suite passed: 67 tests.
- `npm run test:integration` passed: 3 tests, including receipt approval-only
  persistence.
- `npx tsc --noEmit` passed.
- `npm run lint` passed with the existing receipt `<img>` warning.
- `npm run build` passed with non-secret synthetic configuration.
- `npm run test:production-smoke` passed after a fresh build and both HTTP
  assertions.
- `npm test` passed after concurrent work settled: 754 tests.

No migration, import workflow/signing change, live database/provider call,
commit, or push was performed.

## 2026-08-26 issuer-neutral CSV statement checkpoint

Statement ingestion now dispatches between the existing hardened Chase PDF
path and issuer-neutral UTF-8 CSV exports. CSV parsing uses `csv-parse` so
quoted commas, BOMs, and CRLF records are handled without ad hoc splitting.
The accepted, case-insensitive header aliases are `Date` / `Transaction Date`,
optional `Post Date` / `Posting Date`, `Description` / `Merchant` / `Merchant
Name`, `Amount` or the pair `Debit` + `Credit`, and optional `Currency` and
`Category`. Underscores and hyphens normalize to spaces.

CSV dates require `YYYY-MM-DD` or `MM/DD/YYYY` and real calendar validity. A
single amount column preserves its sign; split debit/credit columns require
exactly one unsigned value per row and map debits positive and credits
negative. Unknown, duplicate, missing, or ambiguous headers; malformed or
empty rows; invalid UTF-8; invalid currencies; and nonfinite or oversized
amounts fail closed. CSV records are preserved in source order, including
identical records, with the stable row position and optional posting date in
their identity. The Chase PDF path continues to remove only exact extraction
duplicates.

Both formats feed the same canonical statement transactions into the existing
signed import-draft workflow. Parsing creates a pending review draft and does
not persist purchases; only explicit approval can invoke the existing atomic
confirmation path.

New local migration, not applied:

- `20260826150000_allow_statement_csv_uploads.sql` adds CSV MIME types to the
  private `statements` bucket without changing its 20 MiB limit or RLS. Apply it
  after `20260826140000_secure_import_confirmation.sql`.

Verification:

- Focused CSV/parser/import suite passed: 63 tests.
- `npm test` passed: 784 tests.
- `npm run test:integration` passed: 4 tests, including CSV parsing through a
  signed pending draft and explicit approval.
- `npx tsc --noEmit` passed.
- `npm run lint` passed with the existing receipt `<img>` warning only.
- `npm run build` passed with isolated HOME and non-secret synthetic config.
- `npm run test:production-smoke` passed after a fresh build and both HTTP
  assertions.
- `npm audit --omit=dev` reported zero vulnerabilities.

No migration was applied, and no live authenticated browser, Storage, database,
or provider flow was exercised. No commit or push was performed.

### Tester 2 CSV currency rework

The Tester 2 currency regressions were kept unchanged and now pass. Explicit
CSV currency values are normalized to uppercase and checked against
`Intl.supportedValuesOf("currency")`; runtimes without that API use a small,
documented fallback set of common ISO 4217 codes rather than accepting any
three letters.

Amount parsing now retains whether a dollar sign was present until row-level
currency validation completes. The conservative contract treats `$` as
compatible only with explicit `USD`; `$` paired with another currency fails
closed. A dollar sign does not infer USD when the currency column is absent or
blank, so canonical currency remains `null`.

Verification:

- Unchanged focused CSV/dispatch/draft regressions passed: 17 tests.
- `npm test` passed: 786 tests.
- `npm run test:integration` passed: 4 tests.
- `npx tsc --noEmit` passed.
- `npm run lint` passed with the existing receipt `<img>` warning only.
- `npm run build` passed with isolated HOME and non-secret synthetic config.
- `npm run test:production-smoke` passed after a fresh build and both HTTP
  assertions.
- `npm audit --omit=dev` reported zero vulnerabilities.

No test, migration, import-signing/workflow module, commit, push, live database,
or live provider flow was changed or performed in this rework.

### Tester 2 CSV compatibility rework

CSV header validation still requires one date role, one merchant/description
role, and exactly one signed amount column or the complete debit/credit pair.
Duplicate normalized headers and multiple aliases resolving to one semantic
role remain errors. Unique unconsumed export metadata columns are now ignored,
which allows normal issuer exports to retain fields such as `Type`, `Memo`,
`Reference Number`, `Card No.`, `Member Name`, and `Address` without weakening
the consumed-field contract.

New aliases include `Posted Date`, `Payee`, `Transaction Description`,
`Purchase Date`, `Trans Date`, `Merchant Description`, `Transaction Amount`,
`Currency Code`, and `Transaction Category`. `Posted Date` is used as the
posting date when a primary transaction-date column exists; otherwise it is the
required transaction date. Dates, amount signs, debit/credit semantics,
currency validation, row identity, signed draft review, and approval-only
persistence remain unchanged.

Verification:

- Focused CSV compatibility/dispatch/draft suite passed: 22 tests.
- `npm test` passed: 791 tests.
- `npm run test:integration` passed: 4 tests.
- `npx tsc --noEmit` passed.
- `npm run lint` passed with the existing receipt `<img>` warning only.
- `npm run build` passed with isolated HOME and non-secret synthetic config.
- `npm run test:production-smoke` passed after a fresh build and both HTTP
  assertions.
- `npm audit --omit=dev` reported zero vulnerabilities.

No migration was added or applied, and no commit, push, live database, Storage,
or provider flow was performed in this rework.

### Main-agent CSV currency presentation review

The final end-to-end review found that parsed CSV currency was preserved in the
draft payload but statement review and later purchase views still formatted
every amount as USD when currency was missing. A shared formatter now renders
known ISO currencies with their proper currency formatting and labels missing
currency as unknown instead of inventing dollars. Statement review now includes
the parser's currency field, and purchase history, purchase detail, and dashboard
amounts use the same formatter.

Final verification:

- Focused CSV/parser/import/currency suite passed: 24 tests.
- `npm test` passed: 792 tests.
- `npm run test:integration` passed: 4 tests.
- `npx tsc --noEmit` passed.
- `npm run lint` passed with the existing receipt `<img>` warning only.
- `npm run build` passed with isolated HOME and non-secret synthetic config.
- `npm run test:production-smoke` passed after a fresh build and both HTTP
  assertions.

No migration was applied, and no commit, push, live database, Storage, provider,
or authenticated browser flow was performed in this review.

## 2026-08-26 remediation completion checkpoint

The follow-up remediation pass addressed the highest-confidence review findings
across financial semantics, strategy calculations, import integrity, and direct
purchase mutation boundaries.

- CSV statement amounts now normalize issuer transaction types into positive
  purchases and negative credits/refunds; unknown currency fails closed in
  reward/value calculations.
- Benefit opportunities now require the owning card, active catalog/state, a
  valid purchase currency, and an in-range purchase date. Receipt and statement
  provenance now points at persisted evidence UUIDs.
- Strategy allocation applies transfer ratios, cash budgets, option preferences,
  and impossible stay-length checks. Staged runs reject edited goals, provider
  fallback output is not saved over prior strategies, optional card research is
  isolated, and explicit research-provider selection is respected.
- Storage provenance verifies the uploaded bytes against the owned Storage
  object. Import lifecycle cleanup and source-envelope conflict checks are
  present in new migrations.
- Direct authenticated purchase/item/evidence mutation is revoked. Card-used
  and booking-channel confirmation use narrow ownership-checked RPCs.

Final local verification:

- `npm test`: 818 tests passed.
- `npm run test:integration`: 4 tests passed.
- `npx tsc --noEmit`: passed.
- `npm run lint`: passed with the existing receipt `<img>` warning only.
- `npm audit --omit=dev`: 0 vulnerabilities.
- Synthetic production build and `npm run test:production-smoke`: passed.

New local migrations, not applied, after the existing four 2026-08-26
migrations:

5. `20260826160000_close_import_lifecycle_and_source_conflicts.sql`
6. `20260826170000_restrict_purchase_mutations.sql`

No migration was pushed, no live database/Storage/provider/browser flow was
verified, and no commit or push was performed. The workspace still has no Git
metadata.

## 2026-08-26 nine-issue completion checkpoint

All requested issue streams completed separate development and test reviews.
Rework was required and completed for provider-error classification, import
claim concurrency and database bypasses, wallet deletion reporting, benefit
pending-state behavior, parser false positives/deduplication, and accessibility
relationships.

The final merged verification passed:

- `npm test`: 768 tests, including 14 component tests and three integration
  tests exactly once.
- `npm run test:integration`: 3 tests.
- `npx tsc --noEmit`.
- `npm run lint`, with only the existing receipt `<img>` warning.
- `npm run test:production-smoke`, including a clean build, public HTML 200,
  and the production-only fixture endpoint returning safe JSON 404.
- `npm audit --omit=dev`: zero vulnerabilities.

Dependency versions now include Next 15.5.24, Next-scoped PostCSS 8.5.23,
Nano ID 3.3.18, Sharp 0.35.4, and csv-parse 6.2.1. The default `npm test`
command includes both library and component tests.

Pending local migrations, in required order:

1. `20260826120000_harden_database_integrity.sql`
2. `20260826130000_create_import_drafts.sql`
3. `20260826140000_secure_import_confirmation.sql`
4. `20260826150000_allow_statement_csv_uploads.sql`
5. `20260826160000_close_import_lifecycle_and_source_conflicts.sql`
6. `20260826170000_restrict_purchase_mutations.sql`

After applying them, a database owner must provision the dedicated
`IMPORT_DRAFT_SIGNING_SECRET` in
`finance_buddy_private.import_draft_signing_config`. Imports intentionally fail
closed until application and database secrets match. No migration, commit, or
push was performed in this checkpoint. Live authenticated browser, PostgreSQL,
Storage, Tavily, Ollama, and OpenRouter flows remain unverified.
