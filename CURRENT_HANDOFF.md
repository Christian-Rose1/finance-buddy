# Finance Buddy Current Handoff

Updated: 2026-08-25, America/New_York

## Read this first

This handoff supersedes the 2026-08-21 strategy-pipeline handoff. The repository
is authoritative. Start with `git status --short`, inspect the current code and
tests, and treat any discrepancy here as something to verify rather than a
reason to overwrite the working tree.

The project has accumulated substantial related changes. Do not discard or
recreate them. Preserve the dirty worktree until a coherent checkpoint is
reviewed and explicitly committed.

## Current objective

Make the staged travel-strategy flow reliably return and save a useful,
customer-specific flight, hotel, and points-redemption plan even when free
OpenRouter models are rate-limited or return malformed output.

The immediate demonstrated blocker is provider reliability during finalization,
not a lack of hotel research evidence.

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
