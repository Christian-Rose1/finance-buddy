-- Wallet Benefits Persistence
--
-- Creates the shared `product_benefits` catalog table and the user-owned
-- `wallet_benefits` table that stores per-user state for a product benefit.
--
-- Separation of concerns:
--   product_benefits    = shared product-level benefit definition (catalog)
--   wallet_cards        = user-owned card instance
--   wallet_benefits     = user-specific benefit state for a card+benefit
--
-- A wallet_benefit row links the authenticated owner, their wallet card, and
-- the shared product benefit. It tracks whether the benefit is active/eligible,
-- when it was activated, when it expires, how much value remains, and how
-- much has been used/claimed.
--
-- Ownership is enforced via RLS (user_id = auth.uid()) AND a trigger that
-- guarantees the wallet_card belongs to the same user, so a user cannot
-- attach benefit state to another user's card.
--
-- Targeted offers are intentionally NOT modeled yet.

begin;

-- ============================================================
-- product_benefits (shared catalog, non-user-owned)
-- ============================================================
create table public.product_benefits (
  id uuid primary key default gen_random_uuid(),
  card_product_id uuid not null references public.card_products (id) on delete cascade,
  type text not null,
  title text not null,
  description text,
  eligible_category text null,
  eligible_merchant text null,
  fixed_value numeric(12,2) null,
  annual_limit numeric(12,2) null,
  requires_activation boolean not null default false,
  source text not null,
  last_verified_at timestamptz null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint product_benefits_type_check
    check (type in (
      'statement_credit',
      'travel_credit',
      'lounge_access',
      'purchase_protection',
      'extended_warranty',
      'trip_delay',
      'free_checked_bag',
      'hotel_status',
      'other'
    ))
);

create index product_benefits_card_product_idx
  on public.product_benefits (card_product_id);
create index product_benefits_active_idx
  on public.product_benefits (active);

-- ============================================================
-- wallet_benefits (user-owned)
-- ============================================================
create table public.wallet_benefits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id),
  wallet_card_id uuid not null references public.wallet_cards (id) on delete cascade,
  product_benefit_id uuid not null references public.product_benefits (id),
  active boolean not null default true,
  activated_at timestamptz null,
  expires_at timestamptz null,
  remaining_value numeric(12,2) null,
  used_value numeric(12,2) not null default 0,
  metadata jsonb null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint wallet_benefits_remaining_value_check
    check (remaining_value is null or remaining_value >= 0),
  constraint wallet_benefits_used_value_check
    check (used_value >= 0)
);

create index wallet_benefits_user_card_idx
  on public.wallet_benefits (user_id, wallet_card_id);
create index wallet_benefits_user_active_idx
  on public.wallet_benefits (user_id, active);

-- ============================================================
-- Ownership enforcement: wallet_card must belong to same user
-- ============================================================
create or replace function public.wallet_benefits_owner_check()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  card_owner uuid;
begin
  select user_id into card_owner
  from public.wallet_cards
  where id = new.wallet_card_id;

  if card_owner is null then
    raise exception 'wallet_card does not exist';
  end if;

  if card_owner <> new.user_id then
    raise exception 'wallet_card does not match user';
  end if;

  return new;
end;
$$;

create trigger wallet_benefits_owner_trigger
  before insert or update on public.wallet_benefits
  for each row
  execute function public.wallet_benefits_owner_check();

-- ============================================================
-- Row Level Security
-- ============================================================

-- product_benefits is shared catalog data: authenticated users may read it,
-- but ordinary authenticated access cannot modify it.
alter table public.product_benefits enable row level security;

create policy "product_benefits_select_authenticated"
  on public.product_benefits for select
  to authenticated
  using (true);

create policy "product_benefits_no_write"
  on public.product_benefits
  as restrictive
  for all
  to authenticated
  using (false)
  with check (false);

-- wallet_benefits is user-owned data.
alter table public.wallet_benefits enable row level security;

create policy "wallet_benefits_select_own"
  on public.wallet_benefits for select
  using (user_id = auth.uid());

create policy "wallet_benefits_insert_own"
  on public.wallet_benefits for insert
  with check (user_id = auth.uid());

create policy "wallet_benefits_update_own"
  on public.wallet_benefits for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "wallet_benefits_delete_own"
  on public.wallet_benefits for delete
  using (user_id = auth.uid());

commit;