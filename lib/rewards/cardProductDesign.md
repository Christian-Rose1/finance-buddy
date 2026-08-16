# Finance Buddy — Card Product Catalog + Verified Earning-Rule Architecture

## Status

Design document only. No production TypeScript, migrations, or database changes yet.

---

## 1. Goal

Distinguish three ideas that the current code conflates:

1. **Card product** — a shared/global definition of a credit-card product (e.g. "American Express Gold Card").
2. **User wallet card** — a user's ownership of that product (e.g. "Christian owns this card, last-four 1234, currently active").
3. **Earning rules / benefits / offers** — what rewards or perks the product provides under specific eligibility conditions.

This design keeps the three concepts separate while preserving the existing `wallet_cards` table and the existing development optimizer.

---

## 2. Proposed Entities

### 2.1 `CardProduct` — shared catalog entry

A global, read-mostly catalog of credit-card products. Owned/administrated by Finance Buddy, not by any user.

```typescript
interface CardProduct {
  /** Stable product identifier (UUID). */
  id: string;

  /** Issuing bank or institution, e.g. "American Express". */
  issuer: string;

  /** Official product name, e.g. "American Express Gold Card". */
  name: string;

  /** Card network. */
  network: CardNetwork;

  /** Reward program this product participates in. */
  rewardProgramId: string;

  /** Primary reward currency of the product. */
  rewardCurrency: RewardCurrency;

  /** Annual fee in the product's home currency, if known. */
  annualFee: number | null;

  /** Whether the product is currently offered/marketed. */
  active: boolean;

  /** Product family or variant slug, e.g. "gold". */
  family: string | null;

  /** Authoritative source reference. */
  source: CardProductSource;

  /** ISO timestamp when this product definition was last verified. */
  lastVerifiedAt: string | null;

  /** Additional structured metadata (URLs, product codes, etc.). */
  metadata: Record<string, unknown> | null;
}
```

**MVP fields only.** No signup bonuses, affiliate links, issuer API ids, or transfer partners yet.

```typescript
type CardProductSource =
  | "issuer_website"
  | "issuer_disclosure"
  | "manual_research"
  | "development_fixture"
  | "unknown";
```

### 2.2 `RewardProgram` — points/miles/cashback ecosystem

A reward program is the currency/ecosystem behind a product. It is separate from both the product and the user's wallet card.

```typescript
interface RewardProgram {
  /** Stable program identifier. */
  id: string;

  /** Program name, e.g. "Chase Ultimate Rewards", "Amex Membership Rewards". */
  name: string;

  /** Reward currency: cashback, points, or miles. */
  currency: RewardCurrency;

  /** Optional program family, e.g. "bank_points", "airline_miles". */
  family: "cashback" | "bank_points" | "airline_miles" | "hotel_points" | "other";

  /** Source / verification metadata. */
  source: CardProductSource;
  lastVerifiedAt: string | null;

  /** Metadata for future transfer partners, partners, etc. */
  metadata: Record<string, unknown> | null;
}
```

**MVP scope:** only `id`, `name`, `currency`, `family`, `source`, and `lastVerifiedAt`. Balances, transfer partners, and redemption values are future work.

### 2.3 `EarningRule` — how a product earns rewards

An earning rule belongs to a `CardProduct` and describes how that product rewards eligible transactions.

```typescript
interface EarningRule {
  /** Stable rule identifier. */
  id: string;

  /** The card product this rule applies to. */
  cardProductId: string;

  /** Canonical category this rule applies to, if category-based. */
  eligibleCategory: CanonicalCategoryKey | null;

  /** Specific merchant pattern this rule applies to, if merchant-specific. */
  eligibleMerchant: string | null;

  /** Merchants explicitly excluded from this rule. */
  excludedMerchants: string[];

  /** Reward currency. Usually matches the product, but may differ (e.g. co-brand). */
  rewardCurrency: RewardCurrency;

  /** For percentage-based earning (e.g. 4 for 4%). */
  percentage: number | null;

  /** For fixed-point multipliers (e.g. 3 points per dollar). */
  multiplier: number | null;

  /** Human-readable explanation. */
  explanation: string;

  /** Authoritative source. */
  source: CardProductSource;

  /** ISO timestamp when this rule was last verified. */
  lastVerifiedAt: string | null;

  /** Effective dates, when known. */
  effectiveFrom: string | null;
  effectiveTo: string | null;

  /** Whether the rule is currently active. */
  active: boolean;

  /** Future extension fields (reserved but not implemented now). */
  metadata: Record<string, unknown> | null;
}
```

**MVP fields:** `id`, `cardProductId`, `eligibleCategory`, `eligibleMerchant`, `excludedMerchants`, `rewardCurrency`, `percentage` **or** `multiplier`, `explanation`, `source`, `lastVerifiedAt`, `active`. Everything else is nullable and reserved.

### 2.4 `ProductBenefit` — non-earning perks

Benefits are perks, credits, protections, and memberships. They are separate from earning rules because they do not produce transaction-level rewards.

```typescript
interface ProductBenefit {
  /** Stable benefit identifier. */
  id: string;

  /** The card product this benefit belongs to. */
  cardProductId: string;

  /** Benefit classification. */
  type:
    | "statement_credit"
    | "travel_credit"
    | "lounge_access"
    | "purchase_protection"
    | "extended_warranty"
    | "trip_delay"
    | "free_checked_bag"
    | "hotel_status"
    | "other";

  /** Short title. */
  title: string;

  /** Longer description. */
  description: string;

  /** Category or merchant this benefit relates to, if any. */
  eligibleCategory: CanonicalCategoryKey | null;
  eligibleMerchant: string | null;

  /** Fixed dollar value, when applicable. */
  fixedValue: number | null;

  /** Annual limit or cap, when applicable. */
  annualLimit: number | null;

  /** Activation required. */
  requiresActivation: boolean;

  /** Source / verification. */
  source: CardProductSource;
  lastVerifiedAt: string | null;

  /** Active flag. */
  active: boolean;
}
```

**MVP scope:** only the minimum fields needed to display a benefit list per product. User-specific usage tracking and remaining caps are future work.

### 2.5 `ProductOffer` — targeted/card-linked offers

Offers are potentially targeted, user-specific, or time-bound deals. They are not universal product benefits.

```typescript
interface ProductOffer {
  /** Stable offer identifier. */
  id: string;

  /** The card product this offer is associated with. */
  cardProductId: string;

  /** Merchant or category pattern. */
  eligibleMerchant: string | null;
  eligibleCategory: CanonicalCategoryKey | null;

  /** Spend threshold, if any. */
  minimumSpend: number | null;

  /** Reward amount. */
  rewardValue: number | null;
  rewardCurrency: RewardCurrency;

  /** Expiration, if known. */
  expiresAt: string | null;

  /** Activation required. */
  requiresActivation: boolean;

  /** Source. */
  source: CardProductSource;
  lastVerifiedAt: string | null;

  /** Active flag. */
  active: boolean;
}
```

**MVP scope:** define the shape only. Do not implement offer ingestion or user-targeted delivery yet.

### 2.6 `WalletCard` — user's ownership record

The existing `wallet_cards` table remains the source of truth for user ownership. Add an optional foreign key to `card_products`.

```typescript
interface WalletCard {
  // Existing fields, preserved:
  id: string;
  userId: string;
  name: string;
  issuer: string;
  network: CardNetwork;
  rewardCurrency: RewardCurrency;
  lastFour: string | null;
  active: boolean;
  source: WalletCardSource;
  metadata: Record<string, unknown> | null;

  // New optional relationship:
  cardProductId: string | null;
}
```

When `cardProductId` is present, the product's verified earning rules and benefits are used. When it is `null`, the user-entered fields (`name`, `issuer`, `network`, `rewardCurrency`) remain authoritative and the optimizer falls back to no rules/benefits.

---

## 3. Proposed Relationships

```
RewardProgram 1––* CardProduct
CardProduct 1––* EarningRule
CardProduct 1––* ProductBenefit
CardProduct 1––* ProductOffer
CardProduct 1––* WalletCard (optional, nullable)
```

- A `CardProduct` belongs to exactly one `RewardProgram`.
- A `CardProduct` may have zero or more `EarningRule`, `ProductBenefit`, and `ProductOffer` records.
- A `WalletCard` may optionally reference one `CardProduct`.

---

## 4. Minimum MVP Tables

Do not create these now. This section records the planned schema for a future migration.

### `card_products`

| Column | Type | Notes |
|--------|------|-------|
| id | uuid pk | |
| issuer | text not null | |
| name | text not null | unique per issuer + name |
| network | text not null | check constraint |
| reward_program_id | uuid → reward_programs | not null |
| reward_currency | text not null | check constraint |
| annual_fee | numeric(12,2) | nullable |
| active | boolean not null default true | |
| family | text | nullable |
| source | text not null | |
| last_verified_at | timestamptz | nullable |
| metadata | jsonb | nullable |
| created_at | timestamptz default now() | |
| updated_at | timestamptz default now() | |

No RLS required; this is global catalog data. Application reads only.

### `reward_programs`

| Column | Type | Notes |
|--------|------|-------|
| id | uuid pk | |
| name | text not null | |
| currency | text not null | check constraint |
| family | text not null | |
| source | text not null | |
| last_verified_at | timestamptz | nullable |
| metadata | jsonb | nullable |
| created_at | timestamptz default now() | |
| updated_at | timestamptz default now() | |

### `earning_rules`

| Column | Type | Notes |
|--------|------|-------|
| id | uuid pk | |
| card_product_id | uuid → card_products | not null, cascade delete |
| eligible_category | text | references canonical key |
| eligible_merchant | text | nullable |
| excluded_merchants | text[] | default {} |
| reward_currency | text not null | check constraint |
| percentage | numeric(6,4) | nullable |
| multiplier | numeric(8,4) | nullable |
| explanation | text not null | |
| source | text not null | |
| last_verified_at | timestamptz | nullable |
| effective_from | timestamptz | nullable |
| effective_to | timestamptz | nullable |
| active | boolean not null default true | |
| metadata | jsonb | nullable |
| created_at | timestamptz default now() | |
| updated_at | timestamptz default now() | |

### `product_benefits`

| Column | Type | Notes |
|--------|------|-------|
| id | uuid pk | |
| card_product_id | uuid → card_products | not null, cascade delete |
| type | text not null | check constraint |
| title | text not null | |
| description | text | |
| eligible_category | text | nullable |
| eligible_merchant | text | nullable |
| fixed_value | numeric(12,2) | nullable |
| annual_limit | numeric(12,2) | nullable |
| requires_activation | boolean not null default false | |
| source | text not null | |
| last_verified_at | timestamptz | nullable |
| active | boolean not null default true | |
| created_at | timestamptz default now() | |
| updated_at | timestamptz default now() | |

### `product_offers`

| Column | Type | Notes |
|--------|------|-------|
| id | uuid pk | |
| card_product_id | uuid → card_products | not null, cascade delete |
| eligible_category | text | nullable |
| eligible_merchant | text | nullable |
| minimum_spend | numeric(12,2) | nullable |
| reward_value | numeric(12,2) | nullable |
| reward_currency | text not null | check constraint |
| expires_at | timestamptz | nullable |
| requires_activation | boolean not null default false | |
| source | text not null | |
| last_verified_at | timestamptz | nullable |
| active | boolean not null default true | |
| created_at | timestamptz default now() | |
| updated_at | timestamptz default now() | |

### `wallet_cards` — migration addition only

Add a single nullable column:

```sql
alter table public.wallet_cards
  add column card_product_id uuid null references public.card_products (id);
```

Existing data, RLS, and repository functions remain unchanged. A wallet card without a `card_product_id` continues to work as a user-entered card.

---

## 5. Compatibility Strategy for `wallet_cards`

1. **No breaking changes.** Existing `wallet_cards` rows keep all current fields.
2. **Optional link.** `card_product_id` is nullable. Most early user cards will have `card_product_id = null`.
3. **Display fallback.** When `card_product_id` is null, use the user-entered `name`, `issuer`, `network`, and `reward_currency`.
4. **Optimization fallback.** When `card_product_id` is null, no verified earning rules exist, so the optimizer returns no recommendation for that card. The user can still deactivate or remove the card.
5. **Linking flow (future).** Add a "Link to a known card product" action on the Wallet page. When the user confirms a match, set `card_product_id`. Do not auto-link based on text similarity.
6. **Source labeling.** User-entered cards remain `source = 'user'`. Linked cards remain `source = 'user'` for the ownership record; the product/rules have their own `source` field.

---

## 6. Source / Verification Strategy

Every catalog record carries explicit source and verification metadata:

- `source` enum:
  - `issuer_website` — terms from the issuer's public website.
  - `issuer_disclosure` — Schumer box / official rates and fees.
  - `manual_research` — manually entered by Finance Buddy maintainers.
  - `development_fixture` — fake data for testing.
  - `unknown` — placeholder; should not be presented as authoritative.
- `last_verified_at` — ISO timestamp of the last human or automated verification.
- `effective_from` / `effective_to` — optional validity window for rules.

### Verification rules for recommendations

- A rule with `source = 'development_fixture'` is never shown as real advice.
- A rule with `source = 'unknown'` or `last_verified_at` older than a policy threshold is shown as stale/unknown, not verified.
- Personalized recommendations should only use rules with `source in ('issuer_website', 'issuer_disclosure')` and a recent `last_verified_at`.
- The UI must label development or stale recommendations clearly.

---

## 7. Recommendation Safety

Finance Buddy should compute a `RuleConfidence` for every rule used in optimization:

```typescript
type RuleConfidence =
  | "verified"           // issuer-backed, recently verified
  | "stale"              // issuer-backed but old
  | "manual"             // maintainer-entered, not issuer-backed
  | "development_fixture" // test data
  | "insufficient_information"; // missing source/date
```

The optimizer and UI must:

1. Show `verified` rules as the primary recommendation.
2. Show `manual` rules with a "maintainer-provided" label.
3. Show `stale` rules with a "may be outdated" label and avoid dollar-value claims.
4. Never present `development_fixture` or `insufficient_information` rules as personalized advice.

---

## 8. MVP Implementation Sequence

The smallest path from the current state to verified best-existing-card recommendations:

1. **Persist reward programs.**
   - Create `reward_programs` table and seed the few programs needed for MVP (e.g. Chase Ultimate Rewards, Amex Membership Rewards, Capital One Miles, Cashback).

2. **Persist card product catalog.**
   - Create `card_products` table.
   - Seed a small number of well-known products (e.g. Amex Gold, Chase Sapphire Preferred, Capital One Venture X).
   - Each product references a reward program.

3. **Persist earning rules.**
   - Create `earning_rules` table.
   - Seed verified rules for the seeded products using canonical categories.
   - Use `source = 'issuer_website'` or `'issuer_disclosure'` and set `last_verified_at`.

4. **Link wallet cards to products (optional).**
   - Add `card_product_id` to `wallet_cards`.
   - Add UI flow for the user to link an owned card to a catalog product.

5. **Build an optimizer that uses verified rules.**
   - Load active cards for the user.
   - For each linked card, load its product's active earning rules.
   - Evaluate rules against the Purchase using the existing `evaluateEligibility` logic.
   - Apply verification filtering (prefer verified, label manual/stale).
   - Return the best existing card and explanation.

6. **Keep development fixtures isolated.**
   - `DEVELOPMENT_WALLET` remains in code with `source = 'development'`.
   - Development fixture rules are never persisted as real rules.
   - The development optimizer continues to work for tests and local demos.

7. **Add product benefits and offers later.**
   - After earning rules are verified end-to-end, add `product_benefits` and `product_offers` tables.

---

## 9. Non-Goals

- New-card recommendations.
- Signup bonuses.
- Reward balances.
- Transfer partners.
- Affiliate links or referral tracking.
- MCC-based matching.
- Caps / remaining-cap tracking.
- Activation/enrollment workflows.
- Geography or channel restrictions.
- User-specific offer targeting.

---

## 10. Open Questions Before Implementation

1. Should `card_products` have a `slug` or `issuer_product_code` for stable identification beyond UUID?
2. How should Finance Buddy verify issuer websites automatically without violating terms of service?
3. Should earning rules support both `percentage` and `multiplier` simultaneously, or only one per rule?
4. Should the user be allowed to override a product's earning rule for their own wallet card (e.g. grandfathered benefits)?
5. Should product benefits be versioned so rule changes over time are auditable?
