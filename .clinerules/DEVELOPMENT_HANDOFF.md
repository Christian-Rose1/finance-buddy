# Finance Buddy — Development Handoff

## Purpose

This document contains the current verified Finance Buddy development state so a new Cline context/model can continue without reconstructing project history.

Permanent engineering principles live in `.clinerules`.

This document should contain current state, current limitations, and the next task.

---

# Current Status

Finance Buddy has progressed from a receipt-processing prototype into a multi-source financial Purchase architecture with a working MVP dashboard and first optimization prototype.

Current major milestone:

**MVP Dashboard & Development Best-Card Optimization — VERIFIED COMPLETE**

The authenticated Purchase History dashboard, Purchase Detail page, and first development best-card optimization prototype are wired and verified in the browser.

Verified complete:

- Google OAuth/session works.
- Chase statement PDF uploaded through the private user-scoped `statements` Storage flow.
- `POST /api/parse-statement` returned HTTP 200.
- The real Chase statement produced 151 StatementTransactions.
- 151 Purchases were returned and persisted.
- Statement Purchases use `source = "statement"`.
- Statement Purchases legitimately have `items = []`.
- Persisted statement Purchases belong to the authenticated user.
- Statement evidence persisted successfully.
- Statement provenance persisted successfully.
- Database verification through Supabase SQL confirmed the persisted statement data.
- The statement parser/year-detection path is working with the real Chase statement.
- `npm run build` passes.
- Temporary persistence/test artifacts were removed.
- Purchase History dashboard (`/dashboard`) renders authenticated user's persisted Purchases.
- Recent Purchases link to individual Purchase Detail pages (`/purchases/[id]`).
- Purchase Detail page shows merchant, date, amount, currency, source, category, evidence count, additional charges (discount/tax/tip/fees) when present, and item list for receipt Purchases.
- Statement Purchases with `items = []` render cleanly without an empty item section.
- `getPurchasesForUser` and `getPurchaseForUser` repository functions read only the authenticated user's data via the cookie-aware server Supabase client; RLS is the security boundary.
- `purchaseToReceiptExtraction` adapter converts a canonical `Purchase` into the `ReceiptExtraction` shape consumed by the existing `optimizeReceiptCard()`.
- Statement Purchases with no items use `purchase.category` as a fallback signal for the optimizer.
- Development Best Card optimization prototype on Purchase Detail shows the recommended development card, estimated reward value, recommendation, and matched benefit reasons only when `bestEstimatedValue > 0`.
- The optimization section is clearly labeled "Development test data — not real card advice."
- No "missed value" or personalized claim such as "you could have earned $X more" is shown; `Purchase.cardId` is not currently populated from a real user wallet.
- Browser verification completed successfully.
- `npm run build` passes.
- Canonical spending/rewards category taxonomy design is complete and captured in `lib/rewards/categoryDesign.md` and `lib/rewards/categories.ts`.
- Created and revised the verified MVP Card Product Catalog seed set (`supabase/migrations/20260816110000_seed_card_product_catalog.sql`): 4 products, 3 reward programs, and 9 earning rules, all sourced from official issuer websites on 2026-08-16. Four rules were deferred because the current evaluator cannot enforce their conditions: Chase Freedom Unlimited 5% Chase Travel (channel), Chase Sapphire Preferred 5% Chase Travel, 2% other travel, and 3% online grocery/streaming (channel, merchant, and conditional exclusions), and Amex Gold 4X U.S. supermarkets (merchant-category exclusions).
- Personalized best-card recommendation is wired end-to-end: Purchase Detail loads the authenticated user's WalletCards, uses explicit user-linked CardProducts, evaluates active catalog earning rules through the canonical eligibility layer, and recommends the best eligible user-owned card. When no linked user card exists, the page falls back to the isolated development-wallet recommendation, clearly labeled as test data.

Earlier verified milestones that remain valid:
- Receipt Purchase Persistence — verified complete with real authenticated browser request.
- Statement Purchase Persistence — verified complete with real authenticated browser request.
- Generic persistence integration — `persistPurchase()` works in the real Next.js request context, atomic `persist_purchase` RPC works, `ON DELETE CASCADE` was verified.

Known architectural limitations:

1. Each Purchase is persisted atomically through `persistPurchase()` / `persist_purchase`, but an entire statement import is not currently one atomic batch. A failure partway through a statement import could therefore leave a partial import.
2. The development wallet uses simplified categories such as "Travel" and "Groceries", while persisted statement Purchases currently use categories such as "Travel / Transportation" and "Bills & Subscriptions". The deterministic optimizer correctly produces no match when categories do not align. A canonical spending/rewards category taxonomy and mapping strategy is needed before personalized card optimization can be reliably shown across all sources.
3. The rewards eligibility evaluator produces `likely_eligible` for category-based rule matches and `confirmed_eligible` only for explicit merchant matches. Personalized recommendations must never represent `likely_eligible` as guaranteed eligible. The MVP catalog seed therefore defers rules that depend on channel/booking-source restrictions or merchant-category exclusions that the current evaluator cannot enforce.
4. Points and miles earning rules are recommended when they match, but the optimizer does not silently convert them to dollar values. Only percentage-based cashback, statement credits, and fixed-value offers contribute to `bestEstimatedValue`. The UI shows the eligible rule explanation so the user sees the points/miles earn rate.

---

# Project Root

`/Users/christianrosenberger/finance-buddy-starter`

---

# Current Build State

Latest verified:

`npm run build` ✅

TypeScript/type checking passes.

Known unrelated warning:

`experimental.typedRoutes` has moved to `typedRoutes`.

Do not change this warning unless explicitly requested.

---

# Supabase

Supabase CLI is installed, authenticated, and linked.

Remote project ref:

`degqtzguwbyoxfmdalro`

IMPORTANT:

Cline must not run remote `supabase db push`.

The user manually applies migrations from Terminal.

Never run `supabase db reset`.

---

# Canonical Architecture

Financial evidence sources:

Receipt
Statement
Email (future)
Screenshot (future)
Manual (future)

↓

Canonical `Purchase`

↓

Categorization
Savings
Rewards
Wallet Benefits
Money Found
Financial Intelligence

---

# Receipt Pipeline

Working flow:

Receipt image
→ local Ollama vision extraction
→ ReceiptExtraction
→ validation
→ deterministic item categorization
→ savings
→ wallet/card optimization
→ Purchase conversion

Current receipt vision model:

`qwen3-vl:4b-instruct`

Receipt extraction is model-agnostic at the application-contract level.

Unknown extracted values should remain null rather than fabricated.

Receipt performance optimization is deferred.

---

# Receipt Categorization

Current product-level categories:

- Groceries
- Dining
- Household
- Personal Care
- Pet
- Electronics
- Clothing
- Health
- Entertainment
- Travel
- Other

Deterministic categorization runs first.

---

# Savings / Money Found

Already Saved:
discounts/coupons demonstrably already applied.

Money Found:
additional financial value identified by Finance Buddy.

Never combine Already Saved into Money Found.

Development offer fixtures exist and are not real-world offers.

---

# Wallet / Card Benefits

Development Wallet architecture exists.

Includes:
- cards
- benefits
- matching
- reward valuation
- best-card optimizer

Current card/benefit data is development fixture data.

Real benefit/offer sources are a future milestone.

---

# Canonical Purchase

Primary type:

`lib/purchases/types.ts`

Purchase supports:

- id
- merchant
- date
- amount
- currency
- category
- source
- sourceConfidence
- cardId
- items
- discount
- tax
- tip
- fees
- evidence
- metadata
- optional provenance

Statement Purchases may have:

`items = []`

Receipt Purchases may contain detailed items.

---

# Receipt → Purchase

Implemented:

`lib/purchases/fromReceipt.ts`

Verified with a real Walmart receipt.

The receipt Purchase preserved:
- merchant
- date
- amount
- currency
- item detail
- categories
- evidence
- provenance

---

# Statement Ingestion

Working architecture:

Chase PDF
→ pdf-parse v2
→ text
→ chaseParser
→ StatementTransaction[]
→ Purchase[]

Relevant files:

- `lib/parser/pdfTextExtractor.ts`
- `lib/parser/chaseParser.ts`
- `lib/parser/toStatementTransaction.ts`
- `lib/purchases/statementTypes.ts`
- `lib/purchases/fromStatement.ts`
- `app/api/parse-statement/route.ts`

`pdf-parse` is externalized in Next.js config because pdfjs-dist failed when bundled.

---

# Chase Parser Current State

A real Chase statement was tested.

Current verified output:

151 StatementTransactions
→ 151 Purchases

Statement Purchases have:

`source = "statement"`
`items = []`

Confirmed parser protections include:
- statement noise filtering
- duplicate extracted-row removal
- explicit VISA DIRECT cash-advance filtering

Known limitation:

Two Venmo transactions totaling $88.58 could not be reliably distinguished from ordinary Venmo transactions using extracted PDF text alone.

Do NOT broadly filter all VENMO transactions.

Do not resume speculative Chase parser tuning unless specifically requested.

---

# Purchase Evidence Matching

Implemented:

`lib/purchases/matching.ts`

Candidate matching currently uses:
- normalized merchant
- exact date
- exact amount
- compatible currency

Confidence:
- 1.0 for exact known-currency match
- 0.9 when one currency is missing

Matching does not automatically merge Purchases.

---

# Purchase Merge

Implemented:

`lib/purchases/merge.ts`

Exports:
- PurchaseMergeError
- mergePurchases()

Behavior:
- explicit merge only
- evidence combined/deduplicated
- receipt items preserved
- statement card information may enrich Purchase
- conflicting financial facts throw
- primary Purchase ID preserved

Tested successfully.

---

# Purchase Provenance

Implemented:

`lib/purchases/provenance.ts`

Origins:
- evidence
- inferred
- calculated
- manual

Verification statuses:
- unverified
- verified

Important:

Evidence-backed does NOT equal verified.

Receipt/statement extraction defaults to unverified.

Manual user corrections may be verified.

Receipt and statement Purchase adapters populate provenance.

---

# Persistence Design

Design document:

`lib/purchases/persistenceDesign.md`

Canonical persistence uses:

- purchases
- purchase_items
- purchase_evidence

Purchase items are normalized, not JSONB.

Purchase provenance is persisted as JSONB on purchases.

`card_id` remains TEXT temporarily until persisted wallet cards exist.

Evidence uses stable source identifiers where available.

Storage bucket/path/file information belongs in evidence metadata.

---

# Supabase Schema — DEPLOYED

Tables:

- public.purchases
- public.purchase_items
- public.purchase_evidence

RLS is enabled on all three.

There are 4 policies per table / 12 total.

Ownership:

`purchases.user_id → auth.users.id`

Children inherit ownership through `purchase_id`.

Child foreign keys use ON DELETE CASCADE.

Money uses numeric(12,2).

purchase_items.quantity uses numeric(12,4).

currency uses char(3).

provenance uses JSONB.

---

# Evidence Idempotency

A partial unique index exists on:

`purchase_evidence(purchase_id, type, source_id)`

when:

`source_id IS NOT NULL`

This protects against duplicate evidence attachment when stable source identifiers exist.

---

# Applied Supabase Migrations

Applied:

`20260814195500_create_purchases.sql`

`20260815084500_create_persist_purchase_rpc.sql`

`20260815090700_revoke_persist_purchase_anon.sql`

`20260815092100_fix_persist_purchase_rpc_keys.sql`

Do not edit these applied migrations.

Future database changes require new migrations.

# Pending Migrations

Created and ready for manual application:

`20260816104000_create_card_product_catalog.sql` — shared catalog schema (reward_programs, card_products, earning_rules).

`20260816110000_seed_card_product_catalog.sql` — verified seed data for 4 card products and 9 earning rules.

---

# Atomic Purchase Persistence RPC

Deployed:

`public.persist_purchase(uuid, jsonb, jsonb, jsonb)`

Arguments:

- p_user_id
- p_purchase
- p_items
- p_evidence

Repository payload keys are snake_case.

Important keys include:

- source_confidence
- card_id
- unit_price
- source_id
- source_name

The RPC inserts:
1. purchases
2. purchase_items
3. purchase_evidence

inside one Postgres function transaction.

---

# RPC Security

Verified:

- SECURITY DEFINER
- controlled search_path = public
- p_user_id must equal auth.uid()
- authenticated has EXECUTE
- anon does NOT have EXECUTE
- PUBLIC does NOT have EXECUTE

Do not weaken these properties.

---

# Purchase Repository

File:

`lib/purchases/repository.ts`

Public API:

`persistPurchase(purchase, userId): Promise<Purchase>`

Current behavior:

1. Uses server Supabase client.
2. Converts Purchase to snake_case RPC payload.
3. Calls atomic `persist_purchase`.
4. Receives parent Purchase row.
5. Reads purchase_items.
6. Reads purchase_evidence.
7. Rehydrates a complete Purchase.
8. Returns complete Purchase.

Safe generic errors are used rather than exposing database internals.

---

# Supabase Client Architecture

## Browser

`lib/supabase.ts`

Browser-oriented Supabase client.

Used by client-side pages/components.

Do not replace it with the server client.

## Server

`lib/supabase-server.ts`

Created for authenticated server-side operations.

Uses:
- `@supabase/ssr`
- Next.js `cookies()`

`lib/purchases/repository.ts` uses this server client.

Latest build/typecheck passed after this change.

---

# Important Testing History

Standalone Node/tsx testing of `persistPurchase()` was not valid for authenticated server behavior because the previous browser-style Supabase client did not share a request-cookie session.

This was classified as a test-harness/session limitation rather than an RPC failure.

The RPC itself was separately proven to accept the corrected snake_case contract when invoked through an authenticated client.

The server-client architecture was then corrected.

The authenticated end-to-end test passed in a real Next.js request context:
- Browser Google OAuth flow completed.
- `/auth/callback` exchanged the OAuth code and established cookie-based session.
- `AuthGuard` recognized the user.
- `app/api/dev/test-persist/route.ts` recognized the same user via the server client.
- `persistPurchase()` wrote the parent Purchase, one item, and one evidence row.
- Repository rehydrated the complete Purchase.
- Cascade delete removed children when the parent was deleted.
- No test data remained.

The temporary `app/api/dev/test-persist` route has been removed.

---

# Immediate Current Task

Wire receipt Purchase persistence end-to-end. When a receipt is extracted and converted to a canonical Purchase, persist it via `persistPurchase()` using the authenticated server client, then verify it appears in the authenticated user's Purchase History. The seed migration and personalized best-card optimizer are complete; the next milestone is connecting the receipt pipeline to persistence.

---

# Next Milestones After Reconciliation

1. Implement persisted evidence reconciliation/deduplication.
2. Add Statement Import / Ingestion Batch architecture:
   - assign an identity to each statement import
   - associate all Purchases created from one statement with that import
   - detect/prevent duplicate statement imports
   - support safe retries
   - audit import results
   - track source-document provenance
   - support future rollback/recovery of a specific import
3. Add email/digital receipt ingestion.
4. Add screenshot ingestion.
5. Normalize canonical Purchase category taxonomy.
6. Persist Wallet/Card data.
7. Replace development offers/benefits with real sources.
8. Expand Money Found.
9. Add spending/financial intelligence.
10. Add subscription intelligence.
11. Add travel intelligence.
12. Add pre-purchase optimization.
13. Add AI financial copilot.
14. Optimize receipt-processing performance.
15. Productionize.

---

# Deferred Performance Milestone

Receipt processing currently has unacceptable latency for production.

This work is intentionally deferred.

Future work includes:
- resize/compress images before inference
- benchmark smaller vision models
- benchmark Qwen3-VL 2B vs 4B
- staged/progressive UI
- inference optimization

Targets:

approximately <=10 seconds to first useful result

approximately <=20 seconds to complete receipt analysis

---

# Maintenance / Agent Continuity

Permanent rules should remain generalized.

This handoff should be updated:
- after major verified milestones
- before switching Cline contexts/models
- when database state materially changes
- when the exact next task changes significantly

At checkpoints:
- run npm run build
- inspect git status
- remove temporary artifacts
- verify database state where relevant
- create Git checkpoints when appropriate

Different Cline models should be able to read `.clinerules` + this file and continue without relying on previous model conversation history.

---

# Known Agent/Tool Behavior

Free Cline models may have weaker long-horizon tool behavior.

Keep tasks small.

If a tool call repeatedly fails:
- retry at most once with a reasonable alternative
- then stop and report

Do not create repeated temporary diagnostic scripts merely because the agent itself is failing.

Actual repository state and successful builds are the source of truth.

---

# Handoff Instruction to Next Agent

Before doing work:

1. Read `.finance-buddy.md`.
2. Read this file.
3. Inspect:
   - `lib/supabase-server.ts`
   - `lib/purchases/repository.ts`
   - `app/api/receipts/extract/route.ts`
4. Confirm current build state if necessary.
5. Work ONLY on wiring receipt Purchase persistence.

Do not redesign Purchase.
Do not change Supabase schema.
Do not change applied migrations.
Do not change receipt/statement pipelines beyond the persistence wiring point.

Continue from the current implementation.
