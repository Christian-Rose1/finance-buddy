# Purchase Persistence Design

> **Status:** Design only. No SQL migrations or database tables are created by this
> document. This is the final persistence design for the Unified Purchase Engine.

## 1. Scope

This document defines the final persistence design for:

- `purchases`
- `purchase_items`
- `purchase_evidence`
- field-level `Purchase.provenance` persistence

It covers schema, Row Level Security (RLS), provenance storage, and the evidence
uniqueness rule.

## 2. Design principles

1. **Canonical downstream object is `Purchase`.** No competing transaction/purchase
   model is persisted.
2. **Items are normalized**, not stored as JSONB. Receipt items are queried and
   aggregated (categories, spending by item) at scale.
3. **Evidence is one-to-many.** A single Purchase may have multiple evidence rows
   (e.g., a receipt AND a matching statement transaction).
4. **Ownership inherits through `purchase_id`.** Child tables do not duplicate
   `user_id`; they inherit ownership via their parent purchase. RLS enforces this.
5. **Verified is explicit.** Extraction alone is *unverified*. A value is only
   `verified` when explicitly confirmed (e.g., by the user or an authoritative
   process).
6. **Provenance is preserved.** `evidence`, `inferred`, `calculated`, and `manual`
   origins are never collapsed into a single "source" field.
7. **Matching does not merge.** Evidence matching produces *match candidates*.
   Merging is an explicit, separate, user-driven operation. Matching never
   automatically merges Purchases.

## 3. Supported sources

The schema supports all Purchase sources:

- `receipt`
- `statement`
- `email`
- `screenshot`
- `manual`

A single Purchase may attach multiple evidence rows from different sources, e.g.:

```
receipt evidence row
statement evidence row
```
attached to **one** Purchase.

## 4. `purchases` table

| column              | type               | notes                                                                 |
| ------------------- | ------------------ | --------------------------------------------------------------------- |
| `id`                | uuid               | PK                                                                    |
| `user_id`           | uuid               | NOT NULL, references `auth.users(id)`                                  |
| `merchant`          | text               | nullable                                                              |
| `date`              | date               | nullable                                                              |
| `amount`            | numeric(12,2)      | nullable                                                              |
| `currency`          | char(3)            | nullable, 3-letter ISO code (e.g., `USD`)                             |
| `category`          | text               | nullable, inferred category                                           |
| `source`            | text               | NOT NULL: `receipt`/`statement`/`email`/`screenshot`/`manual`          |
| `source_confidence` | numeric(4,3)       | NOT NULL, 0–1                                                         |
| `card_id`           | text               | nullable, **text** until a persisted `wallet_cards` table exists       |
| `discount`          | numeric(12,2)      | nullable                                                              |
| `tax`               | numeric(12,2)      | nullable                                                              |
| `tip`               | numeric(12,2)      | nullable                                                              |
| `fees`              | numeric(12,2)      | nullable                                                              |
| `provenance`        | jsonb              | NOT NULL default `{}`, field-level provenance (see §7)                |
| `metadata`          | jsonb              | nullable, purchase-level metadata                                     |
| `created_at`        | timestamptz        | default `now()`                                                       |
| `updated_at`        | timestamptz        | default `now()`                                                       |

### Key decisions

- **Monetary values** (`amount`, `discount`, `tax`, `tip`, `fees`) use
  `numeric(12,2)` — exact currency math, no floating point.
- **Currency** uses `char(3)` (e.g., `USD`). Fixed-width, always uppercase.
- **`card_id` is `text`**, not a foreign key, until a persisted `wallet_cards`
  table exists. Once that table is added, `card_id` becomes a `uuid` FK in a
  separate migration. This is an intentional, temporary design.
- **`provenance` is JSONB** (see §7 for rationale).

### Indexes

- `purchase_user_date_idx` on `(user_id, date)` — primary list/range query.
- `purchase_user_merchant_idx` on `(user_id, merchant)` — merchant lookup and
  evidence matching support.
- `purchase_source_idx` on `(source)` — source-type filtering.

---

## 5. `purchase_items` table (normalized)

Items are normalized rows, NOT a JSONB array. This supports item-level category
aggregation, per-item discount reporting, and item-level dashboarding.

| column       | type          | notes                                    |
| ------------ | ------------- | ---------------------------------------- |
| `id`         | uuid          | PK                                       |
| `purchase_id`| uuid          | NOT NULL, FK → `purchases(id)`            |
| `name`       | text          | nullable                                 |
| `quantity`   | numeric(12,4) | nullable (supports fractional quantities)|
| `unit_price` | numeric(12,2) | nullable                                 |
| `total`      | numeric(12,2) | nullable                                 |
| `discount`   | numeric(12,2) | nullable                                 |
| `category`   | text          | nullable, product-level category         |
| `confidence` | numeric(4,3)  | NOT NULL, 0–1                            |
| `created_at` | timestamptz   | default `now()`                          |

> Statement-based purchases legitimately have **zero** `purchase_items` rows.

### Decisions

- Fully **normalized** — never JSONB. Items are the most granular queryable unit.
- `quantity` is `numeric(12,4)` because line items may be fractional (e.g., weight
  purchases in some receipt formats), while all money is `numeric(12,2)`.
- A Purchase with no items (statement) simply has no child rows.

### Indexes

- `purchase_items_purchase_idx` on `(purchase_id)` — FK lookup and cascade join.
- `purchase_items_category_idx` on `(category)` — category aggregation.

---

## 6. `purchase_evidence` table

Every Purchase has one or more evidence rows. Multiple sources may attach to one
Purchase (e.g., receipt + statement).

| column         | type               | notes                                                     |
| -------------- | ------------------ | --------------------------------------------------------- |
| `id`           | uuid               | PK                                                        |
| `purchase_id`  | uuid               | NOT NULL, FK → `purchases(id)`                             |
| `type`         | text               | NOT NULL: `receipt`/`statement`/`email`/`screenshot`/`manual` |
| `source_id`    | text               | nullable, **stable source identifier** (see below)         |
| `source_name`  | text               | nullable, human-readable source name (e.g., merchant)      |
| `confidence`   | numeric(4,3)       | NOT NULL, 0–1                                              |
| `verified`     | boolean            | NOT NULL default `false` — **explicitly** verified only     |
| `metadata`     | jsonb              | nullable, evidence metadata (see below)                    |
| `created_at`   | timestamptz        | default `now()`                                            |

### `source_id` — stable source identifier

`source_id` is a **stable identifier from the source**, NOT a row UUID:

- `receipt` → the receipt source id (e.g., upload/service key)
- `statement` → the statement transaction id
- `email` → an email/digital-receipt message id if stable
- `screenshot` → a stable image/source key if available
- `manual` → may be `null` (manual entries have no external source id)

`source_id` is `null` when the source does not provide a stable identifier. See
§9 for the uniqueness rule that depends on it.

### Evidence metadata

Storage bucket/path/file details belong in **evidence metadata**, not in columns:

```json
{
  "bucket": "receipts",
  "path": "user-uuid/receipt-abc.jpg",
  "mimeType": "image/jpeg",
  "sizeBytes": 1048576
}
```

Statement/email/screenshot evidence may similarly store their own
fingerprint/path/hash keys in `metadata`. This keeps storage details flexibly
structured and out of the relational schema.

### Indexes

- `purchase_evidence_purchase_idx` on `(purchase_id)` — FK lookup and cascade join.
- `purchase_evidence_source_idx` on `(source_id)` — evidence idempotency at the
  source level.

---

## 7. Field-level provenance persistence

`Purchase.provenance` is a sparse map:

```ts
Record<string, PurchaseFieldProvenance>
```

where each record carries:

- `field`
- `origin`: `evidence` | `inferred` | `calculated` | `manual`
- `evidenceIds: string[]` (references `purchase_evidence.id`)
- `confidence: number | null`
- `verificationStatus`: `unverified` | `verified`
- `method: string | null`

### Persistence decision: JSONB on `purchases`

`provenance` is persisted as a **JSONB column on `purchases`**, NOT as a
normalized child table.

Rationale:

1. Provenance is a **sparse keyed map** keyed by field name. A normalized table
   would force a fixed key with no natural single identity.
2. Provenance is generally read whole with the Purchase and rarely filtered on
   in SQL. JSONB is the correct fit.
3. Keeping provenance on `purchases` preserves referential integrity with the
   purchase and avoids an extra join for the common read path.
4. `purchase_items` are normalized because they are **queried and aggregated**
   (categories, totals). Provenance is not aggregated at scale.

### Provenance rules enforced at the application layer

- **`evidence`**: value directly supported by source evidence (e.g., merchant
  extracted from a receipt). `verificationStatus` defaults to `unverified`.
- **`inferred`**: value inferred from evidence (e.g., `category` from a merchant
  name). `verificationStatus` defaults to `unverified`.
- **`calculated`**: deterministic computation (e.g., discount/tax total,
  best-card comparison). Confidence is `null`. `verificationStatus` defaults to
  `unverified`.
- **`manual`**: user-supplied/corrected. Defaults to `verified` (user input is an
  authoritative act).

> **Verified is explicit.** Extraction or parsing alone never sets
> `verificationStatus = "verified"`; only an explicit confirmation (user review,
> authoritative process) may do so.

`provenance` JSONB shape example:

```json
{
  "merchant": {
    "field": "merchant",
    "origin": "evidence",
    "evidenceIds": ["evidence-uuid-1"],
    "confidence": 0.97,
    "verificationStatus": "unverified",
    "method": "receipt-extraction"
  },
  "category": {
    "field": "category",
    "origin": "inferred",
    "evidenceIds": ["evidence-uuid-1"],
    "confidence": 1,
    "verificationStatus": "unverified",
    "method": "deterministic-category-rule"
  }
}
```

`evidenceIds` values reference `purchase_evidence.id` UUIDs. The document does not
dictate a DB-level FK from within JSONB; referential integrity is enforced by the
application when writing provenance.

---

## 8. Row Level Security (RLS)

RLS is enabled on all three tables: `purchases`, `purchase_items`,
`purchase_evidence`.

### Ownership model

- `purchases.user_id` references `auth.users(id)` and governs ownership.
- `purchase_items` and `purchase_evidence` inherit ownership **through
  `purchase_id`** — they do not carry their own `user_id`.

### Policies

| table                | operation                 | policy                                                              |
| -------------------- | ------------------------- | ------------------------------------------------------------------- |
| `purchases`          | SELECT / UPDATE / DELETE  | `user_id = auth.uid()`                                              |
| `purchases`          | INSERT                    | `user_id = auth.uid()`                                              |
| `purchase_items`     | SELECT / UPDATE / DELETE  | `EXISTS (SELECT 1 FROM purchases p WHERE p.id = purchase_id AND p.user_id = auth.uid())` |
| `purchase_items`     | INSERT                    | `EXISTS (SELECT 1 FROM purchases p WHERE p.id = purchase_id AND p.user_id = auth.uid())` |
| `purchase_evidence`  | SELECT / UPDATE / DELETE  | `EXISTS (SELECT 1 FROM purchases p WHERE p.id = purchase_id AND p.user_id = auth.uid())` |
| `purchase_evidence`  | INSERT                    | `EXISTS (SELECT 1 FROM purchases p WHERE p.id = purchase_id AND p.user_id = auth.uid())` |

### RLS notes

- Child-row INSERT policies verify ownership via the parent `purchases` row so a
  user cannot attach evidence/items to another user's purchase.
- Because ownership inherits through `purchase_id`, a correct-enforced FK
  `(purchase_id)` plus the EXISTS policy guarantees cross-user isolation.
- `purchases INSERT` policy must reject any request that would set `user_id`
  different from `auth.uid()`.

---

## 9. Evidence idempotency (uniqueness rule)

Duplicate evidence insertion is prevented deterministically.

### Rule

A `purchase_evidence` row is unique on:

```
(purchase_id, type, source_id)
```

**when `source_id` is not null.**

- If `source_id` is not null → uniqueness enforced by the constraint above.
- If `source_id` is null (manual, or no stable id) → no uniqueness constraint;
  idempotency falls back to application-layer de-duplication (e.g., by
  `purchase_id + type + metadata fingerprint`).

### Partial unique index

```sql
CREATE UNIQUE INDEX uq_purchase_evidence_source
  ON purchase_evidence (purchase_id, type, source_id)
  WHERE source_id IS NOT NULL;
```

This is a **partial unique index**: it only treats rows as duplicate when a
stable `source_id` exists. This avoids blocking legitimate multiple null-source-id
manual evidence rows.

### Consequences

- Re-importing the same statement transaction id twice → second insert conflicts,
  so ingesting the same source twice is idempotent.
- The same receipt re-uploaded with the same `source_id` on the same purchase →
  conflict, no duplicate evidence row.
- Matching may collect evidence IDs from both purchases, but **matching never
  merges**. Merging is a separate explicit operation (see §2).

---

## 10. Relationship to matching/merge

- `matchPurchaseEvidence` produces match *candidates* referencing `evidenceIds`
  across two separately persisted Purchases.
- A match does **not** change the persisted rows.
- Only an explicit user/flow-driven `mergePurchases` operation consolidates two
  Purchases into one, carrying their evidence rows forward onto the single
  surviving purchase (de-duplicated by evidence id) before de-persisting the
  secondary.
- Because merging is explicit and evidence is one-to-many, a Purchase can end up
  with both a `receipt` and a `statement` evidence row, each with its own
  `source_id`.

---

## 11. Non-goals (this design)

- No `wallet_cards` table yet → `card_id` stays `text`.
- No storage-bucket schema here → storage lives in `purchase_evidence.metadata`.
- No RLS trigger/security-invoker function definitions; policies above are the
  contract.
- No migration files. This document is the design source of truth for a future
  migration.