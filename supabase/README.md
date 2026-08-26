# Finance Buddy Database

Finance Buddy uses hosted Supabase for PostgreSQL, authentication, and private
file storage. Schema changes are append-only SQL migrations in `migrations/`.
Never edit a migration that has already been applied.

## Data model

```text
auth.users
  |-- purchases --< purchase_items
  |             `--< purchase_evidence
  |-- wallet_cards --< wallet_benefits >-- product_benefits
  |                 `--> card_products --> reward_programs
  |-- reward_accounts --------------------> reward_programs
  `-- goals -- goal_strategies
            `--< goal_strategy_runs
```

- Catalog tables (`reward_programs`, `card_products`, `earning_rules`, and
  `product_benefits`) are shared, authenticated-read-only data.
- Customer tables carry `user_id` and are protected by Row Level Security.
- Goal strategy child rows also have composite foreign keys to
  `goals(id, user_id)`, so ownership is relationally enforced in addition to
  RLS.
- A wallet card can have at most one state row for each product benefit.

## Write paths

- Ordinary goal, wallet, reward-account, and confirmation writes use a
  cookie-authenticated Supabase client and explicit `user_id` filters.
- Receipt and statement extraction creates short-lived import drafts. The
  database verifies their dedicated HMAC and `confirm_import_draft` writes only
  the exact stored canonical envelope after an atomic claim.
- Direct authenticated purchase inserts and direct execution of the
  JSON-taking `persist_purchase` / `persist_purchases` helpers are revoked. A
  non-null `source_key` keeps approved retries idempotent, and statement batches
  remain transactional.
- New and updated saved strategies carry an application HMAC. Existing rows
  created before the integrity migration remain readable as legacy rows, but
  RLS requires every future insert or update to opt into signed integrity.
- Strategy run payloads use separate run/stage HMACs and expire after 24 hours.

## Storage

The `receipts` and `statements` buckets are private. Object names begin with the
authenticated user ID and Storage RLS checks that prefix. Current database
limits are:

| Bucket | Limit | MIME types |
| --- | ---: | --- |
| `receipts` | 10 MiB | JPEG, PNG, WebP, PDF |
| `statements` | 20 MiB | PDF, CSV |

Application routes enforce the same byte limits before reading file contents.

## Migration workflow

1. Add a new timestamped migration; never rewrite applied history.
2. Review constraints and RLS against existing rows before deployment.
3. Run unit tests, lint, and a production build.
4. Have the designated maintainer inspect `supabase migration list` and run
   `supabase db push` against the shared project.

The import migrations follow `20260826120000_harden_database_integrity.sql` in
this order: `20260826130000_create_import_drafts.sql`,
`20260826140000_secure_import_confirmation.sql`, then
`20260826150000_allow_statement_csv_uploads.sql`. Before imports can run, a
database owner must securely provision the application
`IMPORT_DRAFT_SIGNING_SECRET` in
`finance_buddy_private.import_draft_signing_config`. No secret value belongs in
source control or migration files.
