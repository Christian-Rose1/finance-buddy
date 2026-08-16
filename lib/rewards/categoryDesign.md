# Finance Buddy — Canonical Spending & Rewards Category Design

## Status

Design document only. No production code, types, database, or optimizer changes have been made yet.

---

## 1. Guiding Principle: Separate Spending Categories from Rewards Eligibility

Finance Buddy must keep two questions distinct:

1. **Spending category** — "What did the user spend money on?"
2. **Rewards eligibility** — "How does this card/benefit treat this transaction?"

A Walmart receipt may contain groceries, pet supplies, and household items. Finance Buddy can split those for spending analytics. That does **not** mean Walmart is a supermarket for card-reward purposes.

This document proposes a single canonical spending taxonomy, a separate rewards-eligibility layer, and a compatibility path from the current flat strings stored in existing Purchases.

---

## 2. Proposed Canonical Spending Taxonomy

Use a **two-level hierarchy** for spending analytics. The root gives a stable public key for reports, charts, and reward mapping. The leaf preserves useful granularity without exploding the surface area.

### 2.1 Root Categories (stable keys)

| Key | Display label | Notes |
|-----|---------------|-------|
| `food` | Food | Includes groceries, dining, coffee, delivery, alcohol |
| `travel` | Travel | Trip-related lodging/transport bookings |
| `transportation` | Transportation | Everyday transit/rideshare/gas/parking/tolls |
| `shopping` | Shopping | Discretionary retail and merchandise |
| `home` | Home | Improvement, household goods, services |
| `bills` | Bills & Subscriptions | Recurring payments, utilities, insurance, subscriptions |
| `health` | Health | Pharmacy, medical, fitness |
| `entertainment` | Entertainment | Media, events, hobbies, recreation |
| `personal_care` | Personal Care | Grooming, cosmetics, spa services |
| `pet` | Pet | Pet food, supplies, veterinary |
| `education` | Education | Tuition, books, courses, training |
| `business` | Business | Business expenses, professional services (future) |
| `other` | Other | Catch-all for ambiguous or unclassified spend |

### 2.2 Leaf Categories (selected examples)

```
food
  - groceries
  - dining
  - coffee
  - delivery
  - alcohol

travel
  - airfare
  - hotels
  - rental_cars
  - other_travel

transportation
  - transit
  - rideshare
  - gas
  - ev_charging
  - parking
  - tolls

shopping
  - clothing
  - electronics
  - general_merchandise
  - online_retail
  - gifts

home
  - home_improvement
  - household
  - services
  - furnishings

bills
  - utilities
  - internet
  - phone
  - insurance
  - subscriptions
  - streaming

health
  - pharmacy
  - medical
  - dental
  - vision
  - fitness

entertainment
  - streaming
  - events
  - gaming
  - hobbies

personal_care
  - grooming
  - cosmetics
  - spa

pet
  - pet_food
  - pet_supplies
  - veterinary

education
  - tuition
  - books
  - courses
```

### 2.3 Evaluation of the Proposed Taxonomy

The proposed taxonomy from the task description is adopted almost as-is, with these small changes before implementation:

- **Split `Travel` and `Transportation` into separate root categories.** Card rewards treat them differently (e.g., travel portals vs. gas). Keeping them together makes reward mapping noisy.
- **Add `food` as a root rather than promoting `Groceries`/`Dining` to top-level roots.** This preserves intuitive reporting while still letting rewards rules target `food:groceries` or `food:dining` directly.
- **Add `business` placeholder.** Even if not used in MVP, it prevents personal expenses from being forced into `other` later.
- **Keep `bills` broad.** The current statement string `"Bills & Subscriptions"` maps cleanly to this root. Subscriptions and utilities are separate leaves under it.
- **Keep `shopping` broad.** The current statement string `"Shopping"` maps directly to this root.
- **Keep `home` broad.** The current statement string `"Home / Services"` maps directly to this root.
- **Keep `other` as a valid canonical category.** Not every merchant will classify cleanly; do not fabricate confidence.

---

## 3. Storage and Representation

### 3.1 Canonical Purchase Category

Keep `Purchase.category` as a single string. Store the **leaf key** (e.g., `food:groceries`). When the leaf is unknown, store the root key with a wildcard convention, e.g., `food` or `food:unknown`. For truly unclassified spend, use `other`.

Rationale:

- One string is simple to persist, query, and index.
- The colon separator is stable and human-readable.
- Existing string categories migrate with a mapping table rather than a schema change.

### 3.2 Purchase Items

Keep `PurchaseItem.category` as the **same leaf-key format**. Item-level categories support spending analytics and item-level receipt detail. They do **not** directly drive card reward matching unless an explicit merchant/item rule says so.

### 3.3 Where the Taxonomy Lives

**Short term (MVP):** define the taxonomy in a single TypeScript module, e.g. `lib/rewards/categories.ts`:

- `type CanonicalCategoryKey = "food" | "food:groceries" | ...`
- `const ROOT_CATEGORIES: Record<string, { label: string; leaves: string[] }>`
- `function parseCanonicalCategory(key: string): { root: string; leaf: string | null }`
- `function isLeafOf(key: string, root: string): boolean`

**Long term:** once users or rules need to customize categories, move the root/leaves to a database table or admin-managed catalog. Benefits and offer catalogs should always reference the **stable canonical key**, never free-form strings.

---

## 4. Rewards Eligibility Model (MVP)

### 4.1 Goal

The smallest representation that lets the optimizer answer: "For this Purchase, which card rules are likely eligible, and what is the estimated reward?"

### 4.2 Proposed MVP Rule Shape

```typescript
interface RewardEligibilityRule {
  /** Stable rule id. */
  id: string;

  /** Card or benefit this rule belongs to. */
  cardId: string;

  /** Reward structure: multiplier or fixed credit. */
  type: "earning_rate" | "statement_credit" | "offer";

  /** Canonical category key this rule applies to, if any. */
  eligibleCategory: string | null; // e.g. "food:dining" or "travel"

  /** Specific merchant pattern this rule applies to, if any. */
  eligibleMerchant: string | null;

  /** Specific merchant patterns that are excluded, even if category matches. */
  excludedMerchants: string[];

  /** Reward currency: cashback, points, miles, none. */
  rewardCurrency: "cashback" | "points" | "miles" | "none";

  /** For earning_rate: points/miles per dollar or percentage. */
  rewardValue: number;

  /** For percentage-based earning (e.g. 3%). */
  percentage: number | null;

  /** For fixed credits/offers. */
  fixedValue: number | null;

  /** Eligibility confidence. */
  confidence: "confirmed_eligible" | "likely_eligible" | "unknown" | "not_eligible";

  /** Human-readable explanation template. */
  explanation: string;

  /** Provenance. */
  source: string; // "development" for fixtures; "issuer" / "network" for real data
}
```

### 4.3 Matching Logic (MVP)

For a given `Purchase`:

1. **Merchant exclusion wins.** If the purchase merchant matches any `excludedMerchant`, rule is `not_eligible`.
2. **Specific merchant match wins.** If `eligibleMerchant` matches and no exclusion applies, rule is `confirmed_eligible`.
3. **Category match.** If `eligibleCategory` matches the purchase's canonical category (root or leaf), rule is `likely_eligible` unless a merchant exclusion overrides it.
4. **No match.** Rule is `not_eligible` and produces no estimated value.

Key product rule: the optimizer must be able to explain why a rule did **not** match, e.g.:

> "This purchase appears to be groceries, but this merchant is a superstore and is excluded from your card's supermarket bonus."

This means the model must carry **exclusion reasons**, not just positive matches.

### 4.4 What is NOT in the MVP

These are intentionally left for future iterations:

- MCC codes (reserved field, not required yet)
- Caps / remaining caps (annual/quarterly/monthly)
- Activation/enrollment requirements
- Geography
- Online/in-store channel
- Effective dates / expiration
- Statement-period tracking
- Authorized-user rules

The rule shape should grow into these without changing the core matching contract.

### 4.5 Future Growth Path

Later additions can be non-breaking additions to the rule object:

```typescript
interface RewardEligibilityRuleV2 extends RewardEligibilityRule {
  /** MCC codes eligible for this rule. */
  eligibleMccs: string[];

  /** MCC codes excluded. */
  excludedMccs: string[];

  /** Spending cap structure. */
  cap: { type: "annual" | "quarterly" | "monthly"; limit: number; remaining: number | null } | null;

  /** Activation required. */
  requiresActivation: boolean;
  activated: boolean | null;

  /** Geography. */
  geography: { country: string[]; region: string[] } | null;

  /** Channel restriction. */
  channel: "online" | "in_store" | null;

  /** Effective dates. */
  effectiveFrom: string | null;
  effectiveTo: string | null;

  /** Authoritative source and verification date. */
  authoritativeSource: string | null;
  lastVerifiedAt: string | null;
}
```

---

## 5. Migration and Compatibility Strategy

Existing Purchases already store flat strings such as:

- `"Travel / Transportation"`
- `"Bills & Subscriptions"`
- `"Groceries"`
- `"Dining"`
- `"Home / Services"`
- `"Shopping"`
- `"Other"`

Do **not** rewrite historical data in place. Instead:

1. **Introduce a mapping table in code** (and later optionally in the database):

   ```typescript
   const LEGACY_TO_CANONICAL: Record<string, string> = {
     "Travel / Transportation": "transportation",
     "Bills & Subscriptions": "bills",
     "Groceries": "food:groceries",
     "Dining": "food:dining",
     "Home / Services": "home",
     "Shopping": "shopping",
     "Other": "other",
   };
   ```

2. **Read path normalization.** Repository functions and optimizers normalize the persisted `category` through the mapping table before use. If a key is already canonical, it passes through unchanged. Unknown legacy strings fall back to `other` and are logged for review.

3. **New data uses canonical keys.** After the taxonomy is implemented, receipt and statement adapters write canonical keys only. `categorizeMerchant` in the Chase parser is updated to emit canonical keys.

4. **Gradual backfill is optional.** A future migration can rewrite legacy strings to canonical keys, but it is not required for the MVP. Compatibility/mapping is preferred over an immediate data rewrite.

5. **Receipt categorizer migration.** The current `ReceiptCategory` union (`"Groceries"`, `"Dining"`, etc.) is replaced by the canonical leaf keys. Keyword rules map directly to canonical leaves:
   - `Groceries` → `food:groceries`
   - `Dining` → `food:dining`
   - `Household` → `home:household`
   - `Personal Care` → `personal_care:grooming`
   - `Pet` → `pet:pet_supplies`
   - `Electronics` → `shopping:electronics`
   - `Clothing` → `shopping:clothing`
   - `Health` → `health:pharmacy`
   - `Entertainment` → `entertainment`
   - `Travel` → `travel` (or `transportation` depending on keyword context)
   - `Other` → `other`

---

## 6. Optimizer Evolution Strategy

Current: `Purchase → optimizeReceiptCard()` via `purchaseToReceiptExtraction()` using exact category string matching.

Target flow:

```
Purchase
  ↓
[1] Normalize purchase to canonical category (root + leaf)
  ↓
[2] Evaluate rewards eligibility
      - merchant exclusions first
      - merchant-specific rules second
      - category rules third
      - assign confidence: confirmed / likely / unknown / not_eligible
  ↓
[3] Collect eligible card rules
  ↓
[4] Value rewards (cashback directly; points/miles via valuation catalog)
  ↓
[5] Pick best existing card and produce explanation
```

Step 2 is the new responsibility. The rest of the optimizer can reuse the existing grouping/summing/valuation logic, but it should no longer match by exact string. It should match by:

- `Purchase.merchant` against `excludedMerchants` / `eligibleMerchant`
- `Purchase.category` (canonical) against `eligibleCategory`
- `Purchase.source` and future fields for channel/online hints when available

Statement Purchases with `items = []` continue to use `purchase.category` as the reward signal. Receipt Purchases continue to use item-level detail for **spending analytics**, but the reward evaluation stays at the transaction level unless a merchant-specific item rule exists.

---

## 7. Product Principle: Explain Why a Rule Does Not Match

The system must produce recommendations like:

> "This purchase looks like groceries, but the merchant is a superstore, which is excluded from your card's supermarket bonus."

To support this, the rule model must retain:

- The positive `eligibleCategory` and `eligibleMerchant`.
- The `excludedMerchants` list.
- A templated `explanation` string for both positive and negative outcomes.

The optimizer should return both matched and excluded rules with reasons so the UI can display them honestly.

---

## 8. Recommended First Implementation Step

1. Create `lib/rewards/categories.ts` with:
   - The canonical root/leaf taxonomy as constants.
   - `LEGACY_TO_CANONICAL` mapping table.
   - Helper functions: `parseCanonicalCategory`, `isLeafOf`, `normalizeCategory`.

2. Update `lib/receipts/categorizer.ts` to emit canonical leaf keys instead of the flat `ReceiptCategory` strings. Do not change the keyword logic otherwise.

3. Update `lib/parser/chaseParser.ts` `categorizeMerchant()` to return canonical keys. The current heuristic merchant strings map to canonical roots/leaves via the mapping table.

4. Update `lib/wallet/cards.ts` development fixtures to use canonical keys (`food:dining`, `food:groceries`, `travel`) for `category` values.

5. Update `lib/wallet/matching.ts` to match on canonical category keys (root-aware) and to respect merchant exclusions before category matches.

6. Update `lib/purchases/optimizePurchase.ts` to normalize `purchase.category` before passing it to the optimizer, so statement Purchases continue to work.

7. Add tests for the mapping and matching rules. Do not modify the database schema or the persistence RPC.

8. Run `npm run build` and verify the optimizer still works with the development fixtures.

---

## 9. Non-Goals

- Do not change `Purchase` types yet.
- Do not change `Wallet` types yet.
- Do not add a database table for categories yet.
- Do not implement MCC matching yet.
- Do not implement caps, activation, geography, or channel rules yet.
- Do not rewrite historical persisted Purchases in place yet.
- Do not change the UI or ingestion pipelines beyond the category strings produced.

---

## 10. Open Questions Before Implementation

1. Should `Purchase.category` store the leaf key (`food:groceries`) or the root key with a separate leaf field? This document recommends the colon-delimited leaf key for simplicity, but a two-field structure would be more query-friendly in SQL. Consider a database migration if analytics queries need root-level aggregation.

2. Should the legacy mapping live only in code, or in a `canonical_category_mappings` table so non-engineers can tweak it? Start in code; move to a table once the taxonomy stabilizes.

3. How should the optimizer handle a purchase that is `food:groceries` at a merchant like Walmart? The current design says: category is `food:groceries`, but the card rule's `excludedMerchants` contains `Walmart`, so the rule is `not_eligible`. This is the correct product behavior.

4. Should the receipt adapter set `Purchase.category` at all when items span multiple categories? Current behavior sets it only when all items share the same category. This remains valid; mixed-category receipts stay `null` or `other` at the purchase level, and item-level categories retain the detail.

---
