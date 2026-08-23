-- Create goal_strategies table for the latest successful personalized strategy per goal.
--
-- Only the latest successful strategy is stored. A successful rebuild atomically
-- replaces the previous saved strategy for the same goal (unique on goal_id).
-- Goal deletion cascades to the saved strategy (ON DELETE CASCADE).
-- Application code writes only server-generated, validated JSON; strategy JSON
-- is never generated or trusted from client input.

begin;

-- Create goal_strategies table
create table public.goal_strategies (
  id uuid primary key default gen_random_uuid(),
  goal_id uuid not null references public.goals (id) on delete cascade,
  user_id uuid not null references auth.users (id),
  strategy_json jsonb not null,
  schema_version integer not null default 1,
  generated_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Add checks for goal_strategies
alter table public.goal_strategies
  add constraint goal_strategies_strategy_json_object_check check (jsonb_typeof(strategy_json) = 'object'),
  add constraint goal_strategies_schema_version_check check (schema_version = 1);

-- Enforce exactly one saved strategy per goal
alter table public.goal_strategies
  add constraint goal_strategies_goal_id_unique unique (goal_id);

-- Add index supporting user-owned strategy reads
create index goal_strategies_user_id_idx on public.goal_strategies (user_id);

-- Enable RLS on goal_strategies
alter table public.goal_strategies enable row level security;

-- Create user-owned policies for goal_strategies.
-- Every policy requires the strategy's user_id to match the authenticated user
-- AND an owned goal to exist (goals.id = goal_strategies.goal_id AND
-- goals.user_id = auth.uid()). No user may create or overwrite a strategy for
-- another user's goal even if they know its UUID.
create policy "goal_strategies_select_own" on public.goal_strategies
  for select using (
    user_id = auth.uid()
    and exists (
      select 1 from public.goals
      where goals.id = goal_strategies.goal_id
        and goals.user_id = auth.uid()
    )
  );

create policy "goal_strategies_insert_own" on public.goal_strategies
  for insert with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.goals
      where goals.id = goal_strategies.goal_id
        and goals.user_id = auth.uid()
    )
  );

create policy "goal_strategies_update_own" on public.goal_strategies
  for update using (
    user_id = auth.uid()
    and exists (
      select 1 from public.goals
      where goals.id = goal_strategies.goal_id
        and goals.user_id = auth.uid()
    )
  ) with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.goals
      where goals.id = goal_strategies.goal_id
        and goals.user_id = auth.uid()
    )
  );

create policy "goal_strategies_delete_own" on public.goal_strategies
  for delete using (
    user_id = auth.uid()
    and exists (
      select 1 from public.goals
      where goals.id = goal_strategies.goal_id
        and goals.user_id = auth.uid()
    )
  );

commit;