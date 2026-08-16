-- Wallet Cards Persistence
--
-- Creates the normalized `wallet_cards` table for user-owned credit/debit
-- cards. Development fixture cards (source: 'development') remain in code and
-- are NOT persisted as user data.
--
-- Ownership is enforced directly on the table via RLS, using auth.uid() as
-- the security boundary. No service-role access is required for normal
-- application operations.

begin;

-- ============================================================
-- wallet_cards
-- ============================================================
create table public.wallet_cards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id),
  name text not null,
  issuer text,
  network text not null,
  reward_currency text not null,
  last_four text,
  active boolean not null default true,
  source text not null default 'user',
  metadata jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint wallet_cards_network_check
    check (network in ('visa', 'mastercard', 'amex', 'discover', 'other')),
  constraint wallet_cards_reward_currency_check
    check (reward_currency in ('cashback', 'points', 'miles', 'none')),
  constraint wallet_cards_last_four_length_check
    check (last_four is null or length(last_four) = 4)
);

create index wallet_cards_user_active_idx
  on public.wallet_cards (user_id, active);
create index wallet_cards_user_network_idx
  on public.wallet_cards (user_id, network);

-- ============================================================
-- Row Level Security
-- ============================================================

alter table public.wallet_cards enable row level security;

create policy "wallet_cards_select_own"
  on public.wallet_cards for select
  using (user_id = auth.uid());

create policy "wallet_cards_insert_own"
  on public.wallet_cards for insert
  with check (user_id = auth.uid());

create policy "wallet_cards_update_own"
  on public.wallet_cards for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "wallet_cards_delete_own"
  on public.wallet_cards for delete
  using (user_id = auth.uid());

commit;
