# Finance Buddy — Cline Project Rules

## 1. Core product architecture

Finance Buddy is a personal financial optimization platform.

The long-term product model is:

Sources of financial evidence
→ Unified Purchase Engine
→ Canonical Purchase
→ Categorization + Rewards + Savings + Wallet Benefits
→ Money Found
→ AI financial guidance

The canonical downstream object is `Purchase`.

Supported Purchase sources:
- receipt
- statement
- email
- screenshot
- manual

Do not create competing transaction/purchase models when an existing canonical Purchase model can be used.

## 2. Evidence vs inference vs calculation

Always keep these concepts separate:

VERIFIED EVIDENCE:
Information directly supported by a receipt, statement, email, screenshot, or other source.

INFERRED:
Information estimated or classified from evidence, such as a product category.

DETERMINISTIC CALCULATION:
Mathematical results derived from verified data and explicit rules, such as:
- discounts
- rewards
- points
- savings
- best-card comparisons

AI/model output must never be treated as verified financial fact without validation.

AI should extract, classify, normalize, or explain.
Deterministic application code should perform financial calculations whenever possible.

Never invent:
- card benefits
- rewards rates
- offers
- discounts
- savings
- prices
- financial transactions

Development/test fixtures must always be clearly labeled as development/test data.

## 3. Preserve working architecture

The existing receipt pipeline is working and must not be casually rewritten:

receipt upload
→ Ollama vision extraction
→ normalization
→ validation
→ product categorization
→ savings calculation
→ wallet/card optimization
→ Purchase conversion

When implementing a new feature:
- make the smallest change necessary
- preserve existing behavior
- do not refactor unrelated code
- do not replace working modules with a different architecture unless explicitly requested

## 4. Unified Purchase Engine

Purchase is the canonical downstream representation.

A Purchase may contain:
- merchant
- date
- amount
- currency
- category
- source
- source confidence
- card used
- optional line items
- discounts
- taxes
- tips
- fees
- evidence
- metadata

Statement-based purchases may legitimately have:
`items = []`

Receipt-based purchases may contain item-level detail.

Multiple evidence sources may eventually resolve to one Purchase.

Example:
receipt + matching credit-card transaction = ONE Purchase with multiple evidence entries.

Do not duplicate the same transaction simply because multiple evidence sources exist.

## 5. Receipt intelligence

Receipt extraction currently uses local Ollama vision inference.

The receipt extraction contract must remain model-agnostic.

Receipt extraction should produce structured data such as:
- merchant
- transaction date
- currency
- items
- quantity
- unit price
- total
- discounts
- subtotal
- tax
- tip
- total
- confidence
- source

Use runtime validation before downstream use.

Unknown values should be `null`, not fabricated defaults.

## 6. Product categorization

Receipt product categorization is product-level, not merchant-level.

Current categories:
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

Deterministic rules run first.

An AI fallback may be added later for ambiguous products.

Do not make broad category assumptions when a more specific product-level rule exists.

## 7. Savings / Money Found

Always distinguish:

`Already Saved`
= discounts/coupons actually shown on the receipt.

`Money Found`
= additional savings or reward value Finance Buddy identifies.

Never add Already Saved into Money Found.

Money Found must be explainable from explicit opportunities/rules.

Never claim a savings opportunity without a matching rule or verified data source.

Development offers are test fixtures only and must never be represented as real current offers.

## 8. Wallet and card benefits

Wallet contains:
- cards
- card benefits

Only active cards and active benefits should participate in matching.

Do not invent real-world card benefits.

Development card data must remain clearly labeled as development/test fixtures.

Benefit matching must be deterministic where possible.

Reward valuation must be explicit and separate from earning rules.

Never silently assume a points or miles dollar value.

## 9. AI usage

Use AI for:
- receipt vision/OCR extraction
- ambiguous product classification
- explanation
- prioritization
- future natural-language financial guidance

Do NOT rely on AI for:
- arithmetic
- reward calculations
- discount calculations
- savings calculations
- best-card arithmetic
- determining whether a financial benefit exists

Those should use deterministic code and validated data.

## 10. Performance

Receipt processing latency is a future optimization milestone.

Do not introduce performance optimization work unless specifically requested.

Future goals:
- <=10 seconds to first useful receipt result
- <=20 seconds for complete analysis

Future optimization areas include:
- image resizing/compression
- smaller vision models
- benchmarking Qwen3-VL 2B vs 4B
- progressive/staged UI feedback
- inference optimization

## 11. Scope discipline

For every task:

1. Inspect the existing implementation before editing.
2. Modify only the files necessary for the requested task.
3. Do not delete or reset unrelated work.
4. Do not modify package dependencies unless required.
5. Do not change configuration files unless explicitly required.
6. Do not change UI when the task is backend-only.
7. Do not change backend architecture when the task is UI-only.
8. Do not create duplicate abstractions when an existing module can be reused.

If a requested implementation conflicts with an existing architecture decision, stop and explain the conflict before making broad changes.

## 12. Validation and builds

After implementation:
- run `npm run build`
- fix only errors caused by the current task
- do not make speculative refactors

Do not claim a task is complete unless the build actually passes.

Report:
- files changed
- what changed
- build result
- any remaining warnings/errors

## 13. Git safety

Never:
- run `git reset --hard`
- revert unrelated user changes
- delete uncommitted work
- overwrite unrelated files

Before making broad changes, inspect:
`git status --short`

Treat existing uncommitted changes as intentional unless explicitly told otherwise.

Do not commit changes unless explicitly asked.

## 14. Error handling

Prefer clear, safe errors.

Never expose:
- environment variables
- API keys
- model prompts containing sensitive data
- receipt base64/image data
- full model output when unnecessary

Diagnostic errors may include short truncated snippets when useful.

## 15. File-writing reliability

When creating or replacing files:
- verify the file exists afterward
- verify it is non-empty
- run the build afterward

If a file-write operation fails, do not repeatedly retry the same malformed operation.

Use a different valid write method.

Never report a file as created unless it actually exists and contains the intended code.

## 16. Development fixtures

Development/test fixtures are acceptable for validating architecture.

Every development fixture must:
- clearly identify itself as development/test data
- never be described as current real-world data
- never be mixed into production claims without explicit provenance

When replacing development fixtures with production data, remove or isolate the fixtures rather than silently treating them as real.

## 17. Current roadmap priorities

Current major architecture:

1. Receipt Intelligence
2. Money Found engine
3. Wallet + Card Benefits
4. Unified Purchase Engine / Multi-Source Ingestion
5. Rewards optimization
6. Real offer/benefit integrations
7. Spending/financial intelligence
8. Pre-purchase optimization
9. AI financial copilot
10. Performance optimization
11. Productionization

The Unified Purchase Engine should eventually support:
- receipt → Purchase
- statement transaction → Purchase
- email/digital receipt → Purchase
- screenshot → Purchase
- evidence matching/deduplication

## 18. Default development behavior

When given a feature request:

- first inspect the relevant files
- identify the smallest implementation
- preserve the existing architecture
- implement only the requested scope
- build
- report exactly what changed

Do not expand the task unless the expansion is necessary to prevent a correctness or build failure.