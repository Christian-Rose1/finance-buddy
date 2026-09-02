# Finance Buddy Current Handoff

## 2026-09-01 City-Aware Flight Selection Contract v1

Implemented and independently reviewed locally; no live SerpApi request,
browser operation, database action, migration, or provider call was performed.

- Flight selection retains strict airport-only endpoints and now accepts
  documented `/m/...` and `/g/...` search identifiers only with non-empty,
  unique, uppercase-IATA, bounded acceptable-airport scopes. Malformed,
  duplicate, oversized, conflicting, and origin/destination-overlapping scopes
  fail closed.
- Outbound segments must match origin scope to destination scope, and return
  segments validate the reverse direction. The normalizer receives the actual
  selected segment airport endpoints, never a city search identifier or a
  silently selected first scoped airport.
- SerpApi Google Flights `roundTripPrice` remains the exact total for the
  searched party. It is copied without multiplication, division, or inferred
  per-traveler pricing. Normalized output excludes provider metadata, URLs,
  opaque tokens, and search IDs.
- Freebuff's read-only adversarial review found no blocking defects. Duplicate
  scope rejection is intentional for this contract.
- Verification: focused selection test (19), relevant flight tests (51), and
  `npm test` (885) passed; `npx tsc --noEmit`, `npm run build`, and `git diff
  --check` passed. The existing unrelated Next.js `<img>` warning in
  `components/receipt-upload-panel.tsx` remains.

Live provider acceptance of city IDs and live returned-airport behavior remain
unverified. This milestone supplies safe local selection only; it does not
establish availability, bookability, or customer verification.

## 2026-08-28 SerpApi Price-Coverage Interpretation Correction (authoritative)

The 2026-08-28 bounded SerpApi price-coverage proof is reinterpreted before any
implementation consumes it. The earlier reading recorded in the live session
report is rejected.

- **Rejected: "the listed round-trip price is per traveler."** The structured
  Google Flights price is the total returned for the searched party. An
  identical itinerary priced $868 in the `adults=1` search and $1,736 in the
  `adults=2` search demonstrates passenger-count sensitivity: the field scales
  with the party the request searched.
- The structured price represents the searched party total. The two-adult
  response must be used directly as the two-adult price. **Never multiply an
  `adults=2` response by the traveler count.**
- The observed ratios near 2.0 prove passenger-count sensitivity; they do not
  establish a per-traveler output field. No explicit per-traveler field existed
  in the observed responses, and none may be inferred.
- Acquisition consequence: every exact-cash candidate must bind its price to
  the exact searched traveler count through the authenticated execution
  record, and any future provider-supplied per-person amount must be preserved
  separately if such a field ever appears.

## 2026-08-27 Narrative Trust Stop Final Hardening

Implemented locally on top of Narrative Trust Stop v1; no live provider search,
browser automation, database action, migration, commit, or push was performed.

- **No global evidence unlock.** Until source-bound, claim-level authorization
  exists, no exact-cash or customer-verified record may restore unrestricted
  model-authored recommendation prose. This holds for benchmark-only, exact-cash,
  customer-verified, and mixed evidence: one stronger flight cannot authorize
  hotel/budget/transfer/availability/mixed-payment/full-trip prose, and stronger
  evidence unrelated to a model-recommended option changes nothing. The
  strongest-evidence classifier
  (`strongestNarrativeEvidence` in `lib/goals/strategyNarrativeTrustGate.ts`) is
  descriptive only — it selects the fixed server-owned copy variant and future
  routing, it never grants narrative authority. The policy is explicit in code
  and tests: “Structured evidence may be displayed, but model recommendation
  prose remains suppressed until claims are bound to the specific supporting
  evidence.” Claim-level authorization is deferred to the source-bound
  candidate milestone.
- **Unconditional suppression.** Server-side (`applyNarrativeTrustGateToNarrative`)
  and at presentation (`applyNarrativeTrustGateToStrategy` /
  `buildCustomerSafeStrategyPresentation`) the model-authored headline, summary,
  actions, and alternatives are replaced with deterministic server-owned copy in
  EVERY evidence state: benchmark-only uses “Planning benchmarks found”;
  structured-evidence states use “Planning estimates found” plus copy stating no
  claim-specific recommendation is ready yet. `feasibility` is cleared to
  `insufficient_information`, `pointsGap` and recommendation IDs are nulled, and
  actions/alternatives are emptied.
- **Structured lanes stay visible.** Exact-cash and customer-verified records
  are projected with their own evidence labels (“Exact cash quote” / “Customer
  verified”), prices, dates, coverage, taxes, cancellation/baggage terms, and
  unknown-field counts. Their existence is never converted into permission to
  display unrestricted model narrative.
- **Syntax vs. semantics separated.** The shared customer-text policy
  (`lib/goals/customerTextPolicy.ts`) blocks opaque internal references,
  URLs where prohibited, and genuine technical pipeline terms
  (payload/signature/validation/provider/stage). It deliberately does NOT drop a
  sentence merely because it contains ordinary semantic words such as `live`,
  `bookable`, `guaranteed`, or `exact` — those appear in important cautionary
  statements (“No live availability was verified.”, “Exact dates were not
  confirmed.”, “This planning estimate is not bookable.”). Unsupported positive
  claims are controlled by the deterministic evidence gate and future
  claim-level authorization, never by a growing keyword blacklist.
- **Contract completeness after filtering.** A required headline or summary is
  never persisted as an empty string: fixed neutral server-owned fallbacks are
  used when syntactic filtering empties them, and the evidence gate then
  replaces the narrative with the stronger fixed trust-stop copy. An action that
  loses its required title or explanation is dropped whole; an alternative that
  loses its required title or tradeoff is dropped whole; empty assumptions and
  warnings are dropped. Fragments and raw unsafe fallback text are never
  preserved.
- Exact-cash and customer-verified production lanes remain empty by design;
  fixtures proving lane display are explicitly test-only.
- Architecture note (unchanged from v1): the active staged gateway is a private
  `WeakMap`, repository-minted running-stage authority, and a one-shot opaque
  executor; its observations are ephemeral, unpersisted, unprojected, and
  explicitly NOT candidate evidence. Historical handoff sections describing
  HMAC-sealed execution/`web_observed_candidate` evidence describe superseded
  work.
- Verification: focused trust/presentation/provider-contract/lifecycle tests,
  the full suite, `npx tsc --noEmit`, `npm run build`, and `git diff --check`
  passed. Test-count reconciliation below. No live provider, browser, database,
  migration, commit, or push was performed.

## 2026-08-27 Narrative Trust Stop v1

Implemented locally; no live provider search, browser automation, database
action, migration, commit, or push was performed.

- New deterministic narrative trust gate (`lib/goals/strategyNarrativeTrustGate.ts`):
  finalization and presentation classify the strategy by the strongest eligible
  structured evidence (`customer_verified` > `exact_cash_offer` >
  `planning_benchmark`), never by model prose. When only planning benchmarks
  exist, the entire model-authored recommendation narrative is suppressed:
  headline becomes the fixed “Planning benchmarks found”, summary becomes the
  fixed “Finance Buddy found planning benchmarks, but not a route- and
  date-specific option strong enough to recommend yet…” copy, and actions and
  alternatives are emptied. Estimate cards, saved-goal constraints, native
  points balances, ownership, verified/unverified state, deterministic points
  requirements, gaps, and allocation scenarios all remain visible. The gate is
  deliberately not a keyword blacklist: benchmark-only mode suppresses the
  whole narrative, so budget/affordability/availability/transfer/mixed-payment
  semantic detection is never attempted.
- The gate runs server-side in `generateAutomatedStrategyFromResearchStages`
  on the provider narrative before research data is merged and the strategy is
  persisted, and again in `buildCustomerSafeStrategyPresentation` as defense in
  depth (so pre-existing saved benchmark-only strategies can never display the
  old model narrative).
- Internal-reference blocking now lives in one shared policy
  (`lib/goals/customerTextPolicy.ts`): `award-N`, `card-N`, `cash-N`, `source-N`,
  `option-N`, `scenario-N`, `action-N`, `alternative-N`, `allocation-N`,
  `research-N`, `request-N`, `offer-N`, `trip-shape-N`, `flight-estimate-N`,
  `hotel-estimate-N`, and legacy source/account/goal/user/program/run-N syntaxes
  are removed from customer-visible model prose at provider-output validation
  (before persistence) and again at presentation. Complete unsafe sentences are
  dropped whole; projection-generated display keys (e.g. `flight-estimate-1`)
  are client-safe identifiers and are not affected. Server-generated
  finalization warnings (which name only the model's own cleared fabricated
  reference) are not treated as model prose.
- “Feasible” customer wording now means only what is proven: a points-arithmetic
  scenario label reads “Points balance could cover this benchmark” (or “…this
  option” for structured evidence) instead of implying trip-level feasibility.
- Final-provider fragility: benchmark-only finalization still depends on the
  strategy provider completing a contract-valid completion; the gate replaces
  the narrative afterward. A provider-skip deterministic fallback was assessed
  and deliberately NOT added in this milestone because it would change
  finalization failure/retry semantics that the refresh lifecycle, its tests,
  and “Never save malformed model output merely to make refresh succeed”
  depend on. Follow-up needed: a separate milestone that assembles the
  benchmark-only strategy without calling the narrative model, with explicit
  acceptance criteria for provider-failure behavior.
- Architecture note: the active staged gateway is a private `WeakMap`,
  repository-minted running-stage authority, and a one-shot opaque executor;
  its observations are ephemeral, unpersisted, unprojected, and explicitly NOT
  candidate evidence. Historical handoff sections describing HMAC-sealed
  execution/`web_observed_candidate` evidence describe superseded work and
  must not be confused with the active architecture.
- Verification: focused trust/presentation/provider-contract tests and the full
  suite passed; `npx tsc --noEmit`, `npm run build`, and `git diff --check`
  passed. Test count reconciliation below. No live provider, browser,
  database, migration, commit, or push was performed.

## 2026-08-27 Refresh Lifecycle and Safe Recovery Correction

A user-observed Refresh attempt on the saved strategy failed, and the panel
kept displaying active "Refreshing" progress after the attempt had stopped.
Code inspection verified the defect: `showProgress` depended on
`currentStage`, which was never reset after a terminal success or failure, so
stale progress stayed visible indefinitely. Every failure also showed one
generic message, safe stage outcomes and finalization retryability were
discarded, and initial-build previews were coupled to the active-progress
container, so hiding progress would also have hidden completed previews.

The exact underlying provider/action failure category for that refresh
remains unknown because attempt-specific logs were unavailable. The cause has
still not been identified.

The corrected implementation distinguishes outcomes the first cut of this
correction conflated:

- An outer action failure (`success: false` from a stage/finalization action
  or a transport exception) stops the client workflow, shows the allowlisted
  action-failure message, and clears the client run reference and transient
  previews while preserving the saved strategy and timestamp.
- A valid terminal degraded stage (`success: true, stageStatus: "failed"`)
  means the signed stage reached a terminal state and returned a `runId`, but
  that research lane produced no usable interpreted options. The panel
  records the degraded status, retains no options for that lane, keeps
  successful sibling previews, and continues to hotel research and
  finalization in every terminal combination (succeeded/failed ×
  succeeded/failed). A degraded stage never shows a failure notice and is
  never described as having succeeded or produced estimates.
- Retryable versus non-retryable finalization remains the finalization
  action's authoritative verdict. `runId` is retained only when finalization
  explicitly reports `retryable: true`; "Try finishing again" appears only
  for that reusable run and sends only `goalId` and the existing `runId`, so
  flight and hotel research are never rerun. A non-retryable result clears
  the client run reference and transient previews. Retry starts clear stale
  errors and are unavailable until a result explicitly restores them.
- A finalization transport exception conservatively retains the reusable run
  because the existing server-validation design demonstrably makes a repeated
  finalization attempt safe: the run permits only failed→running, stages load
  from verified server-side payloads, research is never rerun, the saved
  strategy is replaced only after successful persistence, and an expired,
  missing, or stuck-running run returns an explicit non-retryable result.

Customer wording is allowlisted per category and context: first-build versus
saved-refresh flight/hotel action-failure wording, and context-aware final
stage copy ("Finishing your plan" versus "Finishing your updated plan", with
matching retryable-failure wording). Arbitrary action, provider, status, or
exception text never reaches customers.

Safe diagnostics were corrected: the generic outer stage boundary now emits
only a fixed allowlisted field under `STRATEGY_DEBUG=1`, e.g.
`{"stage":"flight","category":"unexpected_stage_failure"}` (or the hotel
equivalent), and no longer appends error names or messages. Specialized
provider diagnostics elsewhere retain their already-reviewed fixed
categories and status fields. No raw errors, prompts, sources, payloads,
customer data, signatures, identifiers, or complete errors are logged.

The behavior lives in a pure `strategyPanelLifecycle` state model whose
events distinguish `flight_stage_completed` / `hotel_stage_completed`
(carrying the server terminal status and safe options) from
`flight_action_failed` / `hotel_action_failed`, so action failure can never
be confused with a degraded stage. Retained first-build previews render
separately from active progress under "Research completed so far" only while
their reusable run remains; saved-strategy refreshes continue suppressing
temporary previews. The saved strategy and timestamp survive every failure
and change only through a successful-finalization outcome.

Test-count reconciliation: the pre-correction tracked suite contained 737
tests, verified by running exactly the tracked test files. The first cut of
the new lifecycle suite added 13 tests (the interim report misstated 12;
737 + 13 = 750). After this correction the lifecycle suite contains 21 tests
and the full suite reports 758 (737 + 21). No existing test was modified or
removed; `git status` shows only the two new lifecycle files plus the
component, `strategyActions.ts`, and this handoff as modified.

Still required after review: one later bounded live Refresh with
`STRATEGY_DEBUG=1` safe diagnostics to observe the new lifecycle and, if a
failure recurs, identify its category from the fixed safe stage field. Do not
run that live refresh until the user explicitly approves it.

## 2026-08-27 Deterministic Strategy Timestamp Rendering

A live `/goals` hydration mismatch was observed because render-time
`Intl.DateTimeFormat` produced different punctuation on server and browser.
Saved strategy timestamps are now normalized and formatted by a pure UTC
policy with fixed grammar, then rendered as deterministic `<time>` content.
No client timestamp, locale, timezone, or hydration suppression is used.
Source inspection and pure tests remove the identified locale-formatting mismatch.
The user then manually reloaded `/goals` and verified that the hydration overlay
was gone and the page rendered without the error. This was a reload of the
existing saved strategy only; no Build or Refresh action or provider research
was run.


## 2026-08-27 Compact Goal Card Policy

The compact parent goal card intentionally shows essential context only: safe
 title, route, valid date window, cabin, traveler label, and status. Nights,
budget, and optimization priority are intentionally omitted from compact cards
for density and are now displayed as safe labels in the expanded saved-strategy
view. These facts come from the saved goal and require no additional customer
questions; no values are recomputed or inferred.


Updated: 2026-08-27, America/New_York

## 2026-08-27 Executor Assertion and Request-Isolation Finalization

Implemented locally; no live provider search, browser automation, database
action, migration, commit, or push was performed.

- Both staged planner entry points now call the gateway-owned runtime assertion
  before reading the goal, building a plan, or selecting an interpreter. The
  assertion requires membership in the gateway-private executor `WeakMap`;
  TypeScript additionally uses a non-exported `unique symbol` brand. Runtime
  identity remains authoritative, so functions, casts, structural objects,
  copies, and parsed serialized forms fail immediately. The frozen executor can
  serialize as `{}`, but that copy has no capability identity and cannot run.
- One-shot ordering is now: verify executor identity/unconsumed state and live
  repository capability; synchronously validate plan shape, stage, queries,
  domains, trip shapes, canonical membership, and duplicates; mark consumed;
  then begin parallel provider work. There is no `await` before consumption.
  Malformed input issues zero requests and leaves the executor available for
  one subsequent valid batch. Once valid execution begins, concurrent and later
  invocations make no additional requests while all first-batch siblings run.
- Explicit `AsyncLocalStorage` tests cover successful and rejected callback
  cleanup, overlapping operation isolation, nested override restoration, and
  later default visibility for both action-composition and authenticated-
  preparation dependency stores. Browser-facing actions still accept only
  their goal/run arguments; production defaults bind them to the real
  `prepareGoalStrategyContext()` path.
- The focused preparation suite tests real authentication and owned-goal
  preparation logic. The gateway action suite tests real action composition
  after mocked successful preparation. Production defaults connect those two
  paths.
- Executor state and internal observations are request-scoped through weak
  runtime ownership. They remain reachable only while the executor/request is
  reachable and are then garbage-collection eligible. There is no explicit
  persistence, replay, candidate, or browser lifecycle and no candidate
  consumer.

Verified locally: focused gateway/action/preparation/isolation/planner/
repository/cloud tests passed (202 tests, 0 failed), and `npm test` passed (682
tests, 0 failed). `npx tsc --noEmit`, `npm run build`, and `git diff --check`
passed. The existing Next.js `<img>` performance warning in
`components/receipt-upload-panel.tsx` remains. The separate finalization card-
research lane remains outside this gateway and unchanged.

## 2026-08-27 Branded One-Shot Stage Executor Correction

Implemented locally; no live provider search, browser automation, database
action, migration, commit, or push was performed.

- Staged flight/hotel planners no longer accept an arbitrary execution
  callback. They require a runtime-opaque `VerifiedStageQueryExecutor` whose
  identity is held in a gateway-private `WeakMap` and which can be minted only
  from a repository-minted `VerifiedRunningResearchStage` plus the server
  provider dependency. Functions, structural lookalikes, copies, serialized
  objects, and wrong-stage executors fail before provider execution.
- Each executor represents one stage batch. The gateway now marks it consumed
  synchronously after invariant validation and before provider awaits, so a
  concurrent or later second invocation fails without another request while
  malformed input does not consume it. The first valid invocation still runs
  all of its selected siblings.
- Selected queries are validated as a complete batch and then executed in
  bounded parallel using the existing small deterministic stage budget. Each
  query is attempted once; individual provider failures become null siblings,
  successful siblings remain, and `Promise.all` reconstruction preserves
  selected planned-query order regardless of completion order. No retry or
  generic fallback was added.
- Planner tests now obtain executors through the real repository capability and
  gateway with mocked providers. Actual action-composition tests still mock
  authenticated preparation and external provider/interpreter construction,
  then exercise the real repository/capability/gateway/save/fail path.
  Authentication and owned-goal preparation are separately tested against the
  real `prepareGoalStrategyContext()` logic using request-local repository/auth
  dependencies. Production action defaults point to that real preparation
  function, and the browser-facing action signatures accept no dependencies.
- Flight and hotel all-query-failure action tests each prove one failed-stage
  update with no retry. Cloud privacy, query-domain, saved-goal, HMAC,
  stage-order, and planning-benchmark protections remain covered.

Verified locally: focused gateway/action/preparation/planner/repository/cloud
tests passed (199 tests, 0 failed), and `npm test` passed (679 tests, 0 failed).
`npx tsc --noEmit`, `npm run build`, and `git diff --check` passed. The existing
Next.js `<img>` performance warning in `components/receipt-upload-panel.tsx`
remains. The separate finalization card-research lane is unchanged and still
requires its future Card Research Trust Boundary review.

## 2026-08-27 Gateway Action-Integration Proof and Scope Clarification

Implemented locally; no live provider search, browser automation, database
action, migration, commit, or push was performed.

- Integration tests now exercise the actual exported flight and hotel server
  actions through a request-local dependency seam. Authentication preparation
  and provider/interpreter construction are mocked, while signed-run creation,
  owned-run loading, optimistic stage transition, repository-minted capability,
  gateway execution, stage save, and failure marking use the real production
  implementations.
- The tests prove create/load and `running` transition precede provider calls,
  successful stages save once, each selected query runs at most once, partial
  provider failures preserve siblings, and all-query failure marks the stage
  failed exactly once without retry. Authentication, ownership, missing-run,
  signature, expiry, stage-order, and optimistic-transition failures make zero
  provider calls. Structural capability lookalikes remain rejected by the
  gateway tests.
- The capability inspector now returns only the gateway-used stage, expiry,
  and revision view. Run, goal, and authenticated-user identifiers remain
  captured privately in the repository-owned capability and do not enter
  provider, cloud-interpreter, or browser payloads.
- Approved domains are now constrained by travel query kind: cash flight,
  award flight, cash hotel, and award hotel each receive their applicable
  official/program/specialist policy set. The conservative hostname tests also
  cover total host length, repeated labels, invalid hyphens, and explicit HTTP
  and HTTPS default and non-default ports.
- The verified-running-stage gateway covers staged flight and hotel public-web
  research only. Initial-finalization card-offer research remains unchanged on
  its separate pre-existing path. That path is technical debt requiring a
  future Card Research Trust Boundary review and is not approved as web-
  observed candidate evidence or for candidate, funding, or recommendation
  decisions.
- Gateway observations remain internal-only, ephemeral, and unused. No
  candidate consumer exists, and this foundation requires no live run.

Verified locally: focused action/gateway/repository/planner/interpreter tests
passed (193 tests, 0 failed), and `npm test` passed (673 tests, 0 failed).
`npx tsc --noEmit`, `npm run build`, and `git diff --check` passed. The existing
Next.js `<img>` performance warning in `components/receipt-upload-panel.tsx`
remains. Candidate extraction, projection, persistence, booking, funding, and
allocation remain out of scope.

## 2026-08-27 Verified Running-Stage Execution Boundary

Implemented locally; no live Tavily/provider search, browser automation,
database action, migration, commit, or push was performed.

- The repository operation that loads and verifies the signed owned run,
  enforces expiry and stage order, and atomically transitions the exact stage
  revision to `running` now mints the sole opaque
  `VerifiedRunningResearchStage` capability. It captures the verified run,
  goal, user, stage, expiry, and returned database revision in a private
  `WeakMap`; structural lookalikes cannot be inspected or used.
- Authenticated flight and hotel action paths compose that capability with the
  provider to create a narrow same-request execution closure. The staged
  planner requires this injected closure and has no provider import, direct
  provider branch, synthetic context, or capability-free flight/hotel fallback.
- Before each request, the gateway rechecks capability identity and expiry and
  validates the complete selection against the deterministic plan. Canonical
  planned-query identity includes plan position plus normalized query, sorted
  domains, depth, stage category/kind, and ordered unique plan-owned trip-shape
  references. Identical query text in distinct valid contexts stays distinct;
  true duplicate contexts and duplicate selections fail before a provider call.
- The hostname policy is deliberately ASCII-only. Configured domains and
  provider source hosts reject Unicode, punycode IDN labels, credentials,
  explicit ports, trailing dots, empty/repeated/oversized labels, overlong
  hosts, and invalid label boundaries. Source URLs must be HTTP(S), and allowed
  subdomains must match an approved domain on an exact DNS-label boundary.
- Successful provider results are strictly normalized before ordinary planning-
  benchmark interpretation. Both OpenRouter and Ollama receive only opaque
  request/source references and bounded whitespace-normalized excerpts; raw
  queries, URLs, titles, dates, scores, provider metadata/content tails, and
  customer/account/financial/internal data remain outside the cloud payload.
- Provider observations and fixed 500-character chunks remain request-scoped,
  server-only, unpersisted, unprojected, and unused as claim evidence. They are
  foundation data only; no candidate extraction or semantic validation exists.

Verified locally: focused gateway/action/staged/interpreter/repository tests
passed (176 tests, 0 failed), and `npm test` passed (669 tests, 0 failed).
`npx tsc --noEmit`, `npm run build`, and `git diff --check` passed. The existing
Next.js `<img>` performance warning in `components/receipt-upload-panel.tsx`
remains. No live browser, database, provider, or migration action was
performed.

The rejected candidate implementation's semantic, coverage, finalization, and
client-projection tests were intentionally removed before this foundation and
are not covered by the current suite. They must be restored with new
capability-bound tests in the future candidate milestone. Candidate extraction,
projection, rendering, persistence, booking, funding, and allocation remain
out of scope and unimplemented.

> ⚠️ SUPERSEDED: the sections below (HMAC-sealed execution records and the
> `web_observed_candidate` extractor) describe removed/superseded candidate
> work, not the active architecture. The active staged gateway is a private
> `WeakMap` + repository-minted running-stage authority + one-shot opaque
> executor; its observations are ephemeral, unpersisted, unprojected, and are
> NOT candidate evidence. Do not treat HMAC candidate sections as current.

## 2026-08-27 Provider-Execution Provenance and Coverage Correction

Implemented locally; no live Tavily/provider search, browser automation,
database action, migration, commit, or push was performed.

- Replaced exported signing/minting helpers with a closed server-side provider
  wrapper. It creates a random opaque execution handle before each planned
  request, normalizes returned results immediately after success, creates
  bounded excerpt segments, then seals request/query/shape/result/excerpt/run/
  stage metadata with a process-held HMAC. Provider-returned query text is
  diagnostic only and never selects a plan binding.
- Candidate evidence consumes a sealed aggregate exactly once. It rejects
  replay, expired (15-minute) records, future-issued records beyond 60 seconds,
  run/stage/query/shape mismatch, digest mismatch, malformed results/excerpts,
  and integrity tampering. Freshness concerns only web-observation provenance;
  it is not availability evidence.
- Canonical hashing recursively sorts object keys and retains only documented
  request/result/excerpt fields. Client evidence uses a specific signed excerpt
  segment rather than unrestricted whole-result content.
- Added independent journey/traveler and stay/room/guest coverage dimensions
  alongside conservative legacy input compatibility. Incompatible or unknown
  coverage/fees cannot make an observation exact and no totals are inferred.

Verified locally: focused provenance/candidate/staged tests and `npm test`
passed (657 tests, 0 failed); `npx tsc --noEmit`, `npm run build`, and `git
diff --check` passed. The existing Next.js `<img>` warning in
`components/receipt-upload-panel.tsx` remains. No live browser/database/provider
flow was verified. The aggregate remains ephemeral, unpersisted, unrendered,
and unused for booking or allocation.

## 2026-08-27 Web-Observed Evidence Execution-Binding Correction

Implemented locally; no live Tavily/provider search, browser automation,
database action, migration, commit, or push was performed.

- Candidate evidence no longer binds a result to a plan by the provider's
  response query text. Immediately after each successful staged planned-query
  invocation, the server mints signed execution/result records containing an
  opaque execution reference, opaque planned-query and trip-shape references,
  canonical query/result digests, retrieval time, and result reference.
  Candidate context accepts only records whose HMAC, plan identity, trip shape,
  and normalized result digest verify server-side.
- Publisher domains are normalized from the signed result and must satisfy that
  planned query's include-domain policy. Source tier and role are resolved from
  server policy; provider-supplied tier is ignored. Domain metadata never
  proves a candidate fact.
- Flight coverage and fee state now prevent an exact candidate where a
  one-way/per-person figure, unknown/excluded/partial fee state, or other
  incompatible coverage is present. Hotel property/area and room requirements
  remain unknown when no saved requirement exists; guest counts are compared
  with saved travelers when both are supplied. No totals or multiplications are
  introduced.
- Candidate deduplication now uses signed underlying-result digest plus the
  normalized supported-claim fingerprint. The client projection rebuilds each
  supported-facts field individually, dropping extra nested data.

Verified locally: focused execution/candidate/evidence/payload/planner tests
and `npm test` passed (662 tests, 0 failed); `npx tsc --noEmit`, `npm run
build`, and `git diff --check` passed. The existing Next.js `<img>` warning in
`components/receipt-upload-panel.tsx` remains. No live browser/database/provider
flow was verified. Execution records are intentionally ephemeral and are not
yet persisted, rendered, or used in booking/allocation paths.

## 2026-08-27 Source-Bound Web-Observed Candidate Extraction v1

Implemented locally; no live Tavily/provider search, browser automation,
database action, migration, commit, or push was performed.

- Added a versioned, server-owned `web_observed_candidate` contract for
  candidates-to-verify. Every accepted record is explicitly
  `web_observed_not_live`, starts `not_started`, uses a fixed verify-before-
  acting instruction, and is separate from planning benchmarks, exact cash,
  customer verification, and allocation inputs.
- The extractor only accepts an opaque source/excerpt reference created from a
  retrieved result for the exact deterministic planned query and trip shape.
  It rejects missing, forged, duplicate, malformed, URL-bearing, unsupported,
  query-mismatched, or trip-mismatched proposals. Query text and an official
  domain alone cannot establish a fact.
- It preserves explicit amount coverage (`one_way`, `per_night`, etc.) and fee
  treatment without calculating totals. Policy candidates are structurally
  prohibited from carrying itinerary, property, availability, price, or award
  claims. Deterministic source-supported match dimensions retain partial and
  unknown results without making them primary recommendations.
- The explicit client projection reconstructs only opaque IDs/references,
  domain/title/category/tier/role, supported facts, coverage, unknowns, and
  verification instructions. It drops raw URLs, source bodies, query text,
  internal/provider/database IDs, signatures, model references, and unrelated
  account data.

Verified locally: focused extraction/evidence/staged-payload/planner tests and
`npm test` passed (658 tests, 0 failed); `npx tsc --noEmit`, `npm run build`,
and `git diff --check` passed. The existing Next.js `<img>` warning in
`components/receipt-upload-panel.tsx` remains. No live browser/database/provider
flow was verified. Candidate extraction is not yet rendered, persisted, used
for booking handoff, or used in funding/allocation calculations.

## 2026-08-27 Staged Web-Research Failure Isolation Correction

Implemented locally; no live Tavily/provider search, browser automation,
database action, migration, commit, or push was performed.

- Flight and hotel stages now build one deterministic, minimized saved-goal
  web-discovery plan per invocation. Each selected query is attempted once;
  completed sibling responses remain available when another request fails, and
  no stage-level template fallback, hidden retry, or broad replacement query
  is issued.
- When all selected queries in a stage fail, the stage throws the existing
  `ResearchInterpreterError` convention once. The existing signed-run action
  path records that as a failed stage; it does not fabricate availability,
  prices, recovery, or a customer-verified result.
- The staged planner receives a dedicated projection of the sanitized planner
  input: goal travel facts, owned program names, and already validated transfer
  relationships only. It excludes identifiers, owner data, balances, spending,
  source content, provider payloads, and secrets. Ownership derivation remains
  in the existing input builder. The redundant stage resolver parameter for
  customer reward programs was removed.
- Focused mocked integration tests cover one-request execution, partial
  retention, all-failure behavior, corrupt runtime priority falling back to
  `balanced` through the real builder/stage path, and serialized input/plan
  privacy checks.

Verified locally: focused tests and `npm test` passed (652 tests, 0 failed);
`npx tsc --noEmit`, `npm run build`, and `git diff --check` passed. The
existing Next.js `<img>` warning in `components/receipt-upload-panel.tsx`
remains. No live browser/database/provider flow was verified.

## 2026-08-27 Legacy Priority Safety Hardening

Implemented locally; no live Tavily/provider search, browser automation,
database action, migration, commit, or push was performed.

- Saved-goal priority lookup now treats persisted data as a runtime boundary:
  only an own key in the approved profile map selects a profile. Absent,
  legacy, malformed, and prototype-name values safely use the existing
  `balanced` profile instead of causing a `.map` failure.
- All four valid profiles retain their existing behavior, including the
  cash-only `simplest` profile and cash-plus-award `lowest_cash` comparison.
  No query budget, saved-goal workflow, transfer-policy rule, or evidence
  semantics changed.
- Focused tests force malformed and absent runtime priorities and verify no
  throw, deterministic balanced fallback, no sensitive output, and unchanged
  valid-priority behavior.

Verified locally: focused tests and `npm test` passed (644 tests, 0 failed);
`npx tsc --noEmit`, `npm run build`, and `git diff --check` passed. The
existing Next.js `<img>` warning in `components/receipt-upload-panel.tsx`
remains. No live browser/database/provider flow was verified.

## 2026-08-26 Saved Goal Priority Query-Selection Correction

Implemented locally; no live Tavily/provider search, browser automation,
database action, migration, commit, or push was performed.

- The saved-goal planner now types `optimizationPriority` to the actual Goal
  enum and applies deterministic profiles without using balances, transactions,
  account IDs, owner data, or inferred transfer relationships:
  - `lowest_cash`: cash flight, cash hotel, award flight, award hotel.
  - `best_experience`: award flight, award hotel, cash flight, cash hotel.
  - `simplest`: cash flight and cash hotel only.
  - `balanced`: cash flight, award flight, cash hotel, award hotel.
- A validated transfer relationship can still add its separate policy query
  after the profile; program/catalog names alone cannot do so. Query planning,
  flexible date shapes, unknown-detail metadata, and non-live evidence status
  remain unchanged.
- Focused tests cover every priority, determinism, material profile differences,
  real duplicate-query handling, a real sanitized-input-builder integration,
  and legacy/minimal goals with absent optional fields.

Verified locally: focused tests and `npm test` passed (643 tests, 0 failed);
`npx tsc --noEmit`, `npm run build`, and `git diff --check` passed. The
existing Next.js `<img>` warning in `components/receipt-upload-panel.tsx`
remains. No live browser/database/provider flow was verified.

## 2026-08-26 Saved-Goal-First Web Travel Discovery Foundation v1

Implemented locally; no live Tavily/provider search, browser automation,
database action, migration, commit, or push was performed.

- Flight and hotel staged research now derives its public-web plan
  deterministically from the existing sanitized saved-goal context. A model no
  longer chooses routes, dates, properties, or query count for these paths.
- The server-only planner creates at most three opaque, labeled flexible
  planning trip shapes from the saved date window and night constraints.
  Current persisted goals do not contain a separately confirmed date pair, so
  these shapes remain `flexible_planning` and explicitly suppress exact-trip
  claims.
- It defaults to four route/destination-specific cash/award flight and hotel
  discovery queries when saved program context exists; missing optional travel
  detail remains explicit unknown/assumption metadata and does not stop
  discovery. A separately bounded policy query is added only when a validated
  transfer relationship is supplied. Generic candidate-lane fallback queries
  are no longer used by staged flight/hotel research.
- This milestone adds no observed-candidate extraction, ranking, UI,
  verification handoff, new customer questions/preferences, or live-availability
  semantics. Existing planning-benchmark/evidence separation is unchanged.

Verified locally: focused planner/evidence tests and `npm test` passed (638
tests, 0 failed); `npx tsc --noEmit`, `npm run build`, and `git diff --check`
passed. The existing Next.js `<img>` warning in
`components/receipt-upload-panel.tsx` remains. No live browser/database/provider
flow was verified.

## 2026-08-26 Evidence Separation v1 boundary correction

Implemented locally; no provider connection, account creation, API-key request,
live search, browser, database, migration, commit, or push was performed.

- Client strategy projection now maps action and alternative source IDs through
  the same stable opaque `source-N` references used for flight and hotel
  options. Persisted real source IDs remain server-side.
- `currentCashOptions` now passes a strict projection before browser return.
  Invalid, incomplete, URL-bearing, or invalid-time-order exact-cash candidates are
  dropped; valid candidates are explicitly rebuilt with an opaque `cash-N` ID
  and no provider/offer/database identity, signature, or raw payload fields.
- Legacy planning benchmarks clear a matching `recommendedAwardOptionId`, and a
  legacy `available` status becomes `unknown` before customer rendering.
- Empty exact-cash UI now truthfully says no provider has been connected or
  exact-cash search run.

Verified locally: focused projection tests passed; `npm test` passed (631
tests, 0 failed); `npx tsc --noEmit`, `npm run build`, and `git diff --check`
passed. The existing Next.js `<img>` warning in
`components/receipt-upload-panel.tsx` remains. No live browser/database/provider
flow was verified.

## 2026-08-26 Evidence Separation v1 checkpoint

Implemented locally; no travel-provider account, key, term acceptance, live
search, browser, database, migration, commit, or push was performed.

- Research-interpreted flight and hotel options now explicitly normalize to
  `planning_benchmark`; legacy saved and staged options default to that level.
- Benchmark award options remain usable for deterministic points arithmetic,
  but model-authored primary award recommendations are cleared and customer UI
  calls their allocations "points planning scenarios" rather than plans or
  bookable itineraries.
- Exact-cash and customer-verified types are prepared with no fabricated data.
  Exact cash requires server-side provider/offer identity, retrieval/expiry,
  coverage, and money fields before a client-safe projection can render.
- The client receives opaque source references rather than source URLs. The
  cloud research payload now sends opaque source IDs while server validation
  retains the private source map. Provider/offer IDs never enter the public
  exact-cash projection or cloud strategy payload.
- The panel now renders separate Current cash options, Customer-verified
  options, and points-planning benchmark sections. The first two are empty
  until a future approved provider/customer-verification implementation.

Verified locally: focused tests passed; `npm test` passed (628 tests, 0
failed); `npx tsc --noEmit`, `npm run build`, and `git diff --check` passed.
The existing Next.js `<img>` warning in `components/receipt-upload-panel.tsx`
remains. No live provider/browser/database behavior was verified.

## 2026-08-26 Grounded Strategy Brief v1 checkpoint

Implemented locally; no live provider, browser, database, migration, commit, or
push was performed. Preserve the existing uncommitted OpenRouter reliability
diff alongside this milestone.

- Final narrative generation now receives a server-built `brief` with the saved
  goal constraints, resolved trip nights, verified/unverified point summaries,
  deterministic option requirements, and allocation-scenario summaries.
- Model-visible award/card/source identifiers are opaque ordered references;
  the real identifiers stay in a non-enumerable server-side map and are restored
  only while validating the returned narrative.
- Research interpretation now receives the minimal saved route/date/traveler/
  cabin/night constraints and name-only reward programs. It still uses the
  server-side full input for source, numeric, program, and relevance validation.
- Final follow-up questions are now selected through a constrained server-side
  decision-topic contract rather than free-form model prose. Existing non-live
  availability and sourced-numeric validation remains in force.
- `Goal` has no separately stored explicit date-flexibility field. Do not infer
  one from its window; adding it remains a product/schema decision.

Verified locally on 2026-08-26:

- `npm test` passed: 622 tests, 0 failed.
- `npm run build` passed, with the existing Next.js `<img>` warning in
  `components/receipt-upload-panel.tsx`.
- `npx tsc --noEmit` and `git diff --check` passed.

The bounded authenticated Euro Trip acceptance run below verified that the
current provider flow completes and saves successfully. This does not make
research planning benchmarks live availability or prove exact route/date fit.

## 2026-08-26 Grounded Strategy Brief F1/F2 correction

The final narrative contract no longer accepts model-authored follow-up question
prose. The model may select only these decision topics: `flight_time_preference`,
`layover_tolerance`, `hotel_neighborhood_preference`, `room_preference`, and
`cash_vs_points_preference`. Server validation materializes the customer-facing
question text and silently drops unknown, duplicate, unavailable, malformed,
or legacy optional topic fields without changing customer warnings. Under
`STRATEGY_DEBUG=1`, the drop emits only a fixed safe diagnostic category. It
does not use keyword, substring, or word-boundary matching. Legacy
`followUpQuestions` output is ignored safely, so it cannot invalidate an
otherwise complete strategy.

The prompt builder now excludes any award option or card offer whose source is
not in the validated source map before opaque references are created. The
former `source-unknown` placeholder is gone; excluded records are represented
only by a safe brief warning and cannot become dangling model citations.

Verified locally: focused tests passed; `npm test` passed (622 tests, 0 failed);
`npm run build`, `npx tsc --noEmit`, and `git diff --check` passed. No live
provider/browser/database/migration call, commit, or push was performed.

## 2026-08-26 Deterministic relevance and points-gap provenance correction

Verified locally; no live provider, browser, database, migration, commit, or
push was performed.

- Model-produced `exact` and `partial` relevance labels now rank as `general`.
  They cannot improve deterministic allocation priority until source-bound
  structured route/date evidence exists. `different_destination` remains only
  a conservative non-primary/conditional downgrade, and customer wording calls
  it a conditional planning alternative rather than a proven route mismatch.
- Model-authored top-level `pointsGap` is structurally validated then normalized
  to `null`; the top-level estimated-gap card and model feasibility badge are
  no longer rendered. Deterministic scenario statuses and per-allocation gaps
  are the customer-visible funding information.
- Existing traveler/night calculations, verified self-owned funding rules,
  source validation, HMAC staging, and privacy boundaries remain unchanged.

Verified locally: focused tests passed; `npm test` passed (622 tests, 0 failed);
`npx tsc --noEmit`, `npm run build`, and `git diff --check` passed. A future
source-bound structured route/date schema is still required to determine an
exact or partial match truthfully.

## 2026-08-26 bounded Euro Trip acceptance run

The user manually ran the signed-in Euro Trip flow through the authenticated
browser UI after agent browser control was unavailable. The reported result is
verified user-observed runtime evidence:

- Flight research completed in about 73 seconds.
- Hotel research completed in about 94 seconds; both hotel Tavily searches
  returned five results.
- Final strategy generation completed in about 174 seconds, within the
  deliberately bounded 245-second final-provider limit.
- No safe runtime timeout, parsing, or validation error was reported.
- Flight, hotel, and final strategy generation completed; the strategy saved
  and remained present after the user refreshed the page.

No finalization-only retry was required. Do not repeat this expensive live run
without a new, evidence-based reason. This verifies the current staged flow,
bounded finalization, save, and refresh persistence. It does not prove live
award availability or source-bound exact route/date matching.

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
