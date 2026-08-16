-- Card Product Catalog Foundation
--
-- Creates the shared, non-user-owned catalog tables that support verified
-- card-product earning rules:
--
--   reward_programs  - points/miles/cashback ecosystems
--   card_products    - shared credit-card product definitions
--   earning_rules    - how a product earns rewards for eligible transactions
--
-- Also adds an optional card_product_id foreign key to wallet_cards so a
-- user's owned card can be linked to a catalog product without breaking
-- existing user-entered cards.
--
-- IMPORTANT:
-- - These tables contain shared catalog data, not user financial data.
-- - wallet_cards remains user-owned via RLS.
-- - No real credit-card data is seeded here.
-- - product_benefits and product_offers are intentionally NOT created yet.

begin;

-- ============================================================
-- reward_programs
-- ============================================================
create table public.reward_programs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  currency text not null,
  family text not null default 'other',
  source text not null,
  last_verified_at timestamptz null,
  metadata jsonb null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint reward_programs_currency_check
    check (currency in ('cashback', 'points', 'miles', 'none')),
  constraint reward_programs_family_check
    check (family in ('cashback', 'bank_points', 'airline_miles', 'hotel_points', 'other'))
);

-- ============================================================
-- card_products
-- ============================================================
create table public.card_products (
  id uuid primary key default gen_random_uuid(),
  reward_program_id uuid null references public.reward_programs (id),
  issuer text not null,
  name text not null,
  network text not null,
  active boolean not null default true,
  annual_fee numeric(12,2) null,
  source text not null,
  last_verified_at timestamptz null,
  metadata jsonb null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint card_products_network_check
    check (network in ('visa', 'mastercard', 'amex', 'discover', 'other')),

  unique (issuer, name)
);

create index card_products_reward_program_idx
  on public.card_products (reward_program_id);
create index card_products_active_idx
  on public.card_products (active);

-- ============================================================
-- earning_rules
-- ============================================================
create table public.earning_rules (
  id uuid primary key default gen_random_uuid(),
  card_product_id uuid not null references public.card_products (id) on delete cascade,
  type text not null default 'earning_rate',
  eligible_category text null,
  eligible_merchant text null,
  excluded_merchants text[] not null default '{}',
  reward_currency text not null,
  reward_value numeric(12,4) not null default 0,
  percentage numeric(6,4) null,
  fixed_value numeric(12,2) null,
  explanation text not null,
  source text not null,
  last_verified_at timestamptz null,
  metadata jsonb null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint earning_rules_type_check
    check (type in ('earning_rate', 'statement_credit', 'offer')),
  constraint earning_rules_reward_currency_check
    check (reward_currency in ('cashback', 'points', 'miles', 'none')),
  constraint earning_rules_eligible_target_check
    check (
      eligible_category is not null
      or eligible_merchant is not null
      or array_length(excluded_merchants, 1) > 0
    )
);

create index earning_rules_card_product_idx
  on public.earning_rules (card_product_id);
create index earning_rules_active_idx
  on public.earning_rules (active);
create index earning_rules_category_idx
  on public.earning_rules (eligible_category);

-- ============================================================
-- wallet_cards: optional link to card_products
-- ============================================================
alter table public.wallet_cards
  add column card_product_id uuid null references public.card_products (id);

create index wallet_cards_card_product_idx
  on public.wallet_cards (card_product_id);

-- ============================================================
-- Row Level Security
-- ============================================================

-- Catalog tables are shared, read-only data for authenticated users.
-- Only service-role or database admins should modify them.
alter table public.reward_programs enable row level security;
alter table public.card_products enable row level security;
alter table public.earning_rules enable row level security;

create policy "reward_programs_select_authenticated"
  on public.reward_programs for select
  to authenticated
  using (true);

create policy "card_products_select_authenticated"
  on public.card_products for select
  to authenticated
  using (true);

create policy "earning_rules_select_authenticated"
  on public.earning_rules for select
  to authenticated
  using (true);

-- Restrict all writes on catalog tables from ordinary authenticated access.
-- Application code must never insert/update/delete catalog rows.
create policy "reward_programs_no_write"
  on public.reward_programs
  as restrictive
  for all
  to authenticated
  using (false)
  with check (false);

create policy "card_products_no_write"
  on public.card_products
  as restrictive
  for all
  to authenticated
  using (false)
  with check (false);

create policy "earning_rules_no_write"
  on public.earning_rules
  as restrictive
  for all
  to authenticated
  using (false)
  with check (false);

commit;
