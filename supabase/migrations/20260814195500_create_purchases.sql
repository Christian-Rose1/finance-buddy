-- Purchase Persistence
-- Source of truth: lib/purchases/persistenceDesign.md
--
-- Creates:
--   purchases
--   purchase_items
--   purchase_evidence
--
-- Canonical downstream object is Purchase. Items are normalized (NOT JSONB).
-- Evidence is one-to-many. Ownership inherits through purchase_id for child
-- tables. Verified is explicit: verified defaults to false; extraction alone
-- is unverified.

begin;

-- ============================================================
-- purchases
-- ============================================================
create table public.purchases (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id),
  merchant text,
  date date,
  amount numeric(12, 2),
  currency char(3),
  category text,
  source text not null,
  source_confidence numeric(4, 3) not null,
  card_id text, -- intentionally TEXT until a persisted wallet_cards table exists
  discount numeric(12, 2),
  tax numeric(12, 2),
  tip numeric(12, 2),
  fees numeric(12, 2),
  provenance jsonb not null default '{}'::jsonb,
  metadata jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint purchases_source_check
    check (source in ('receipt', 'statement', 'email', 'screenshot', 'manual')),
  constraint purchases_source_confidence_range_check
    check (source_confidence >= 0 and source_confidence <= 1)
);

create index purchase_user_date_idx
  on public.purchases (user_id, date);
create index purchase_user_merchant_idx
  on public.purchases (user_id, merchant);
create index purchase_source_idx
  on public.purchases (source);

-- ============================================================
-- purchase_items (normalized)
-- ============================================================
create table public.purchase_items (
  id uuid primary key default gen_random_uuid(),
  purchase_id uuid not null references public.purchases (id) on delete cascade,
  name text,
  quantity numeric(12, 4),
  unit_price numeric(12, 2),
  total numeric(12, 2),
  discount numeric(12, 2),
  category text,
  confidence numeric(4, 3) not null,
  created_at timestamptz not null default now(),

  constraint purchase_items_confidence_range_check
    check (confidence >= 0 and confidence <= 1)
);

create index purchase_items_purchase_idx
  on public.purchase_items (purchase_id);
create index purchase_items_category_idx
  on public.purchase_items (category);

-- ============================================================
-- purchase_evidence
-- ============================================================
create table public.purchase_evidence (
  id uuid primary key default gen_random_uuid(),
  purchase_id uuid not null references public.purchases (id) on delete cascade,
  type text not null,
  source_id text, -- stable source identifier when the source provides one
  source_name text,
  confidence numeric(4, 3) not null,
  verified boolean not null default false, -- EXPLICITLY verified only; extraction alone is unverified
  metadata jsonb, -- storage bucket/path/file details live here, not in columns
  created_at timestamptz not null default now(),

  constraint purchase_evidence_type_check
    check (type in ('receipt', 'statement', 'email', 'screenshot', 'manual')),
  constraint purchase_evidence_confidence_range_check
    check (confidence >= 0 and confidence <= 1)
);

create index purchase_evidence_purchase_idx
  on public.purchase_evidence (purchase_id);
create index purchase_evidence_source_idx
  on public.purchase_evidence (source_id);

-- Evidence idempotency: unique on (purchase_id, type, source_id)
-- only when source_id is NOT NULL. Null-source-id rows (e.g., manual) are
-- de-duplicated at the application layer instead.
create unique index uq_purchase_evidence_source
  on public.purchase_evidence (purchase_id, type, source_id)
  where source_id is not null;

-- ============================================================
-- Row Level Security
-- ============================================================

-- purchases
alter table public.purchases enable row level security;

create policy "purchases_select_own"
  on public.purchases for select
  using (user_id = auth.uid());

create policy "purchases_insert_own"
  on public.purchases for insert
  with check (user_id = auth.uid());

create policy "purchases_update_own"
  on public.purchases for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "purchases_delete_own"
  on public.purchases for delete
  using (user_id = auth.uid());

-- purchase_items (ownership inherited through purchase_id)
alter table public.purchase_items enable row level security;

create policy "purchase_items_select_own"
  on public.purchase_items for select
  using (
    exists (
      select 1 from public.purchases p
      where p.id = purchase_id and p.user_id = auth.uid()
    )
  );

create policy "purchase_items_insert_own"
  on public.purchase_items for insert
  with check (
    exists (
      select 1 from public.purchases p
      where p.id = purchase_id and p.user_id = auth.uid()
    )
  );

create policy "purchase_items_update_own"
  on public.purchase_items for update
  using (
    exists (
      select 1 from public.purchases p
      where p.id = purchase_id and p.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.purchases p
      where p.id = purchase_id and p.user_id = auth.uid()
    )
  );

create policy "purchase_items_delete_own"
  on public.purchase_items for delete
  using (
    exists (
      select 1 from public.purchases p
      where p.id = purchase_id and p.user_id = auth.uid()
    )
  );

-- purchase_evidence (ownership inherited through purchase_id)
alter table public.purchase_evidence enable row level security;

create policy "purchase_evidence_select_own"
  on public.purchase_evidence for select
  using (
    exists (
      select 1 from public.purchases p
      where p.id = purchase_id and p.user_id = auth.uid()
    )
  );

create policy "purchase_evidence_insert_own"
  on public.purchase_evidence for insert
  with check (
    exists (
      select 1 from public.purchases p
      where p.id = purchase_id and p.user_id = auth.uid()
    )
  );

create policy "purchase_evidence_update_own"
  on public.purchase_evidence for update
  using (
    exists (
      select 1 from public.purchases p
      where p.id = purchase_id and p.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.purchases p
      where p.id = purchase_id and p.user_id = auth.uid()
    )
  );

create policy "purchase_evidence_delete_own"
  on public.purchase_evidence for delete
  using (
    exists (
      select 1 from public.purchases p
      where p.id = purchase_id and p.user_id = auth.uid()
    )
  );

commit;