-- Create goals and reward accounts tables for goal planning

begin;

-- Create goals table
create table public.goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id),
  type text not null default 'travel',
  title text not null,
  status text not null default 'draft',
  origin text[] not null default '{}'::text[],
  destinations text[] not null default '{}'::text[],
  earliest_departure date null,
  latest_return date null,
  minimum_nights integer null,
  maximum_nights integer null,
  traveler_count integer not null default 1,
  cabin_preference text not null default 'flexible',
  optimization_priority text not null default 'balanced',
  maximum_cash_budget numeric(12,2) null,
  currency text not null default 'USD',
  allow_new_cards boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Add checks for goals
alter table public.goals
  add constraint goals_type_check check (type in ('travel')),
  add constraint goals_status_check check (status in ('draft', 'active', 'completed', 'paused')),
  add constraint goals_title_not_empty_check check (length(trim(title)) > 0),
  add constraint goals_traveler_count_positive_check check (traveler_count > 0),
  add constraint goals_minimum_nights_positive_check check (minimum_nights is null or minimum_nights > 0),
  add constraint goals_maximum_nights_positive_check check (maximum_nights is null or maximum_nights > 0),
  add constraint goals_nights_range_check check (maximum_nights is null or maximum_nights >= minimum_nights),
  add constraint goals_dates_range_check check (latest_return is null or latest_return >= earliest_departure),
  add constraint goals_cabin_preference_check check (cabin_preference in ('economy', 'premium_economy', 'business', 'first', 'flexible')),
  add constraint goals_optimization_priority_check check (optimization_priority in ('lowest_cash', 'best_experience', 'simplest', 'balanced')),
  add constraint goals_maximum_cash_budget_non_negative_check check (maximum_cash_budget is null or maximum_cash_budget >= 0),
  add constraint goals_currency_length_check check (length(currency) = 3);

-- Add index for goals
create index goals_user_id_status_idx on public.goals (user_id, status);

-- Create reward_accounts table
create table public.reward_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id),
  reward_program_id uuid not null references public.reward_programs (id),
  owner_key text not null,
  owner_label text not null,
  owner_type text not null,
  balance numeric(18,2) not null default 0,
  balance_as_of timestamptz not null,
  origin text not null default 'manual',
  verification_status text not null default 'unverified',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Add checks for reward_accounts
alter table public.reward_accounts
  add constraint reward_accounts_owner_key_not_empty_check check (length(trim(owner_key)) > 0),
  add constraint reward_accounts_owner_label_not_empty_check check (length(trim(owner_label)) > 0),
  add constraint reward_accounts_owner_type_check check (owner_type in ('self', 'companion')),
  add constraint reward_accounts_balance_non_negative_check check (balance >= 0),
  add constraint reward_accounts_origin_check check (origin in ('manual', 'evidence', 'connected')),
  add constraint reward_accounts_verification_status_check check (verification_status in ('unverified', 'verified'));

-- Add unique constraint for reward_accounts
alter table public.reward_accounts
  add constraint reward_accounts_user_program_owner_key_unique unique (user_id, reward_program_id, owner_key);

-- Add index for reward_accounts
create index reward_accounts_user_id_owner_type_idx on public.reward_accounts (user_id, owner_type);

-- Enable RLS on goals
alter table public.goals enable row level security;

-- Create user-owned policies for goals
create policy "goals_select_own" on public.goals
  for select using (user_id = auth.uid());

create policy "goals_insert_own" on public.goals
  for insert with check (user_id = auth.uid());

create policy "goals_update_own" on public.goals
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "goals_delete_own" on public.goals
  for delete using (user_id = auth.uid());

-- Enable RLS on reward_accounts
alter table public.reward_accounts enable row level security;

-- Create user-owned policies for reward_accounts
create policy "reward_accounts_select_own" on public.reward_accounts
  for select using (user_id = auth.uid());

create policy "reward_accounts_insert_own" on public.reward_accounts
  for insert with check (user_id = auth.uid());

create policy "reward_accounts_update_own" on public.reward_accounts
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "reward_accounts_delete_own" on public.reward_accounts
  for delete using (user_id = auth.uid());

commit;