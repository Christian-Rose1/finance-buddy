# Finance Buddy — Cline Project Rules

## Purpose

Finance Buddy is a personal financial optimization platform.

The long-term architecture is:

Financial Evidence Sources
→ Unified Purchase Engine
→ Canonical Purchase
→ Categorization + Savings + Rewards + Wallet Benefits
→ Money Found
→ Financial Intelligence
→ AI Guidance

The canonical downstream financial object is `Purchase`.

Supported and planned Purchase sources include:
- receipt
- statement
- email
- screenshot
- manual

Do not create competing transaction or purchase models when the canonical Purchase model can be used.

---

## 1. Evidence, Inference, Calculation, and Verification

Always distinguish:

### Evidence
Information directly supported by a source such as a receipt, statement, email, screenshot, or user-provided record.

### Inferred
Information classified or inferred from evidence, such as a product or spending category.

### Calculated
Information produced deterministically from known inputs, such as:
- discounts
- reward amounts
- points
- savings
- best-card comparisons

### Manual
Information explicitly supplied or corrected by the user.

Evidence-backed does NOT automatically mean verified.

`verified` means explicitly confirmed by a user or another authoritative verification process.

Extraction from a document is normally evidence-backed but unverified.

Never silently treat AI/model output as verified financial fact.

---

## 2. AI Usage

Use AI where appropriate for:
- receipt/image extraction
- ambiguous classification
- normalization
- explanation
- prioritization
- natural-language financial guidance

Prefer deterministic application logic for:
- arithmetic
- discounts
- rewards
- points
- savings
- card comparisons
- offer matching
- financial totals

Never invent:
- transactions
- prices
- discounts
- offers
- card benefits
- reward rates
- savings
- financial facts

Development/test fixtures must always be clearly labeled as development/test data.

---

## 3. Unified Purchase Engine

`Purchase` is the canonical downstream representation.

A Purchase may contain:
- merchant
- date
- amount
- currency
- category
- source
- source confidence
- card
- items
- discount
- tax
- tip
- fees
- evidence
- metadata
- field-level provenance

Receipt-based Purchases may contain item-level detail.

Statement-based Purchases may legitimately contain:
`items = []`

Multiple pieces of evidence may belong to one Purchase.

Example:

receipt
+
matching statement transaction
→ ONE Purchase with multiple evidence records

Candidate matching must not automatically imply merging.

Two purchases with the same merchant/date/amount may still be legitimate separate purchases.

Merging must remain explicit unless a future verified reconciliation policy says otherwise.

---

## 4. Provenance

Preserve the distinction between:

- evidence
- inferred
- calculated
- manual

Field-level provenance should identify where important Purchase values came from.

Do not treat all Purchase fields as equally authoritative.

Evidence identifiers should point to the supporting PurchaseEvidence records when applicable.

Provenance should remain model-agnostic.

Do not encode temporary model names into the canonical Purchase contract unless they belong in source metadata.

---

## 5. Receipt Intelligence

The receipt extraction contract must remain model-agnostic.

Unknown values should be `null`, not fabricated defaults.

Validate structured model output before downstream use.

Receipt product categorization is product-level where possible.

Deterministic categorization runs before any future AI fallback.

Do not broadly classify an entire retail purchase when item-level evidence supports more specific categories.

---

## 6. Already Saved and Money Found

Always distinguish:

`Already Saved`
= discounts/coupons demonstrably already applied to the purchase.

`Money Found`
= additional financial value Finance Buddy identifies.

Never include Already Saved inside Money Found.

Money Found must be explainable from explicit rules, benefits, offers, or verified data.

Never claim a savings opportunity without a supporting rule or data source.

Development offers must never be presented as real current offers.

---

## 7. Wallet and Card Benefits

Wallet architecture may contain:
- cards
- benefits
- reward rules
- credits
- offers
- protections

Only active cards and active benefits should participate in matching.

Do not invent real-world card benefits.

Development fixtures must remain clearly identified as development data.

Reward earning and reward valuation are separate concepts.

Never silently assume a dollar value for points or miles.

`Purchase.cardId` may remain a temporary text reference until persisted wallet cards exist.

When persisted wallet cards are introduced, plan to migrate this to an appropriate foreign key.

---

## 8. Purchase Persistence Architecture

Canonical Purchases are persisted using normalized storage.

Core persistence entities:

- purchases
- purchase_items
- purchase_evidence

Do not store Purchase items as a JSONB array when normalized item rows are available.

`purchases` directly owns `user_id`.

`purchase_items` and `purchase_evidence` inherit ownership through `purchase_id`.

Field-level Purchase provenance may be persisted as JSONB because it is a sparse keyed map that is generally read with the Purchase rather than independently aggregated.

Evidence should use stable source identifiers where available.

Storage bucket/path/file information belongs in evidence metadata rather than being hard-coded into the canonical Purchase model.

Evidence persistence should be idempotent when stable source identifiers exist.

---

## 9. Atomic Purchase Persistence

Purchase persistence must be atomic.

The approved architecture is:

Purchase repository
→ database RPC/server-side transaction
→ purchases + purchase_items + purchase_evidence

Do not replace an atomic persistence mechanism with independent client-side inserts.

Do not pretend multiple Supabase JS insert calls form a database transaction.

After persistence, child records may be re-read to rehydrate a complete Purchase.

---

## 10. Supabase Client Architecture

Browser and server Supabase clients have different responsibilities.

### Browser client

The browser client is used by client-side pages/components.

Do not import server-only Next.js APIs into browser-client modules.

### Server client

Authenticated server-side operations must use a cookie-aware server Supabase client.

Server persistence must not rely on browser-style in-memory session behavior.

Never expose service-role credentials to client code.

Do not use a service-role key as a workaround for missing authenticated server context.

---

## 11. Purchase Persistence Security

Security-sensitive persistence functions must enforce user ownership.

Do not trust a `user_id` contained in a Purchase payload.

User identity must come from the authenticated server context and explicit persistence boundary.

Security-definer database functions must:
- use a controlled search_path
- explicitly enforce ownership
- restrict EXECUTE privileges appropriately

Do not weaken RLS or RPC security to make tests easier.

---

## 12. Row Level Security

User financial data must remain user-owned.

RLS should protect all user financial tables.

Child records should be accessible only when their parent Purchase belongs to the authenticated user.

INSERT policies must prevent users from attaching child records to another user's Purchase.

Do not bypass RLS from ordinary application code without a deliberate, reviewed architecture reason.

---

## 13. Supabase Migration Safety

Supabase migrations live under:

`supabase/migrations/`

Applied migrations are historical records.

Do not edit already-applied migrations to change deployed database behavior.

Create a new migration for subsequent schema, function, privilege, or policy changes.

Never run:

`supabase db reset`

unless explicitly instructed by the user.

Cline must NOT run remote:

`supabase db push`

The user applies remote Supabase migrations manually from Terminal.

Cline may:
- create migrations
- inspect SQL
- review migrations
- perform read-only verification

After creating a migration, stop and tell the user it is ready to apply.

Never expose database passwords, tokens, connection strings, or service-role credentials.

---

## 14. Scope Discipline

For every task:

1. Inspect the relevant existing implementation.
2. Identify the smallest required change.
3. Modify only necessary files.
4. Preserve working behavior.
5. Do not refactor unrelated code.
6. Do not expand scope without a correctness/build reason.
7. Build after implementation.
8. Report exactly what changed.

Do not change UI for backend-only tasks.

Do not redesign backend architecture for UI-only tasks.

Do not create duplicate abstractions when existing modules can be reused.

If a requested change conflicts with an established architecture decision, stop and explain the conflict before making broad changes.

---

## 15. Preserve Working Pipelines

Do not casually rewrite working ingestion, parsing, savings, wallet, matching, merge, or persistence pipelines.

Prefer extension over replacement.

When changing a working pipeline:
- identify the exact reason
- preserve its existing contract when practical
- verify downstream behavior afterward

---

## 16. Validation and Builds

After implementation:

`npm run build`

Fix only errors caused by the current task.

Do not make speculative refactors merely because unrelated warnings exist.

Do not claim completion unless the build actually passes.

A successful build and actual repository state are more authoritative than an agent's narrative summary.

---

## 17. Git Safety

Never:
- run `git reset --hard`
- revert unrelated changes
- delete uncommitted user work
- overwrite unrelated files

Treat existing user changes as intentional unless explicitly told otherwise.

Do not commit unless explicitly requested.

Before risky or broad changes:
- inspect Git state
- preserve known-good checkpoints

Generated TypeScript build-info files (`*.tsbuildinfo`) must not be committed.

Recommend Git checkpoints after significant verified milestones.

---

## 18. Temporary Test and Diagnostic Files

Temporary diagnostic/test files must not become permanent project files unless explicitly requested.

Prefer `/tmp` for standalone diagnostics when practical.

If a temporary application route or project file is necessary:

1. Clearly identify it as temporary.
2. Use development/test data only.
3. Remove it after testing.
4. Verify removal before reporting completion.

Do not leave temporary users, Purchases, items, evidence, or diagnostic data in Supabase.

Never claim cleanup succeeded without verification.

---

## 19. Tool Failure Discipline

If a tool call repeatedly fails:

1. Do not endlessly retry the identical call.
2. Try at most one reasonable alternative.
3. If that also fails, stop and report the blocker.

Do not create increasingly complicated shell commands to work around agent/tool failures.

Do not repeatedly generate diagnostic scripts while troubleshooting the agent itself.

Distinguish:
- code failure
- database failure
- authentication/session failure
- test-harness limitation
- agent/tool failure

Do not modify production architecture merely to make an inappropriate test harness work.

---

## 20. Free-Model Task Discipline

Finance Buddy may use free coding models with weaker long-horizon agent behavior.

Keep tasks narrow.

Preferred workflow:

inspect
→ report
→ small implementation
→ build
→ test
→ report

Avoid combining:
- architecture design
- broad inspection
- multi-file implementation
- database operations
- integration testing
- cleanup
- verification

into one task when they can be separated.

If a task becomes unexpectedly complex, stop and report instead of autonomously expanding scope.

Rules must remain model-agnostic.

Do not encode assumptions about a specific Cline model into project architecture.

---

## 21. Agent Continuity

Different coding models must be able to continue from the same verified project state.

Permanent project rules contain durable engineering principles.

Current implementation state belongs in:

`DEVELOPMENT_HANDOFF.md`

Before:
- switching models
- switching Cline contexts
- major architecture work
- ending a major development session

review whether the handoff needs updating.

Do not place volatile implementation details in permanent rules merely to help the next model.

---

## 22. Handoff Maintenance

`DEVELOPMENT_HANDOFF.md` should capture:

- current architecture
- completed milestones
- current database/migration state
- known limitations
- current blocker
- exact next task
- recent verified build state

Update it at meaningful verified checkpoints, not after every trivial edit.

Keep it concise enough that a new coding model can read it quickly.

---

## 23. Maintenance Hygiene

At major milestones:

1. Run `npm run build`.
2. Inspect `git status`.
3. Remove temporary diagnostic/test artifacts.
4. Confirm generated artifacts are ignored.
5. Verify important database changes when applicable.
6. Update DEVELOPMENT_HANDOFF.md when state materially changed.
7. Review whether any newly learned constraint belongs in permanent rules.
8. Create/recommend a Git checkpoint when appropriate.

---

## 24. Rules Maintenance

Keep `.clinerules` generalized, durable, and relatively stable.

Update permanent rules when:
- a major architectural principle changes
- a recurring agent failure reveals a durable safety rule
- a new persistent security requirement emerges
- a new cross-cutting engineering constraint becomes established

Do NOT update permanent rules for:
- temporary blockers
- one-off bugs
- exact test counts
- current task status
- temporary model/provider availability
- transient implementation details

Those belong in the handoff instead.

---

## 25. Performance

Receipt-processing latency is a future optimization milestone.

Do not introduce performance work unless specifically requested.

Future areas include:
- image resizing/compression
- smaller vision models
- model benchmarking
- staged/progressive UI feedback
- inference optimization

Long-term targets:
- approximately <=10 seconds to first useful result
- approximately <=20 seconds for complete receipt analysis

---

## 26. Default Development Behavior

When given a feature task:

- read the relevant rules
- inspect relevant files
- read DEVELOPMENT_HANDOFF.md when current state matters
- implement the smallest safe change
- preserve existing architecture
- build
- test only what is necessary
- clean temporary artifacts
- report exact results honestly

Never fabricate a successful test.
Never hide a known failure.
Never silently broaden the task.