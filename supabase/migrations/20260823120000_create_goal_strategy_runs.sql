-- Create goal_strategy_runs table for temporary signed server-generated
-- research-stage payloads.
--
-- This table stores intermediate staged-strategy results (flight, hotel)
-- before they are finalized into a complete saved strategy. Each run is
-- signed with an HMAC that application code verifies before finalization.
--
-- Payload columns are text so the exact signed bytes are preserved.
-- HMAC verification is enforced by application code before finalization.
-- Ownership RLS alone does not establish payload integrity.
--
-- Complete saved strategies remain in public.goal_strategies.
-- Expired/abandoned runs are eligible for application cleanup.

begin;

create table public.goal_strategy_runs (
  id uuid primary key default gen_random_uuid(),
  goal_id uuid not null references public.goals (id) on delete cascade,
  user_id uuid not null references auth.users (id),
  signature_version integer not null default 1,
  expires_at timestamptz not null,
  run_signature text not null,

  flight_status text not null default 'pending',
  flight_payload text null,
  flight_signature text null,

  hotel_status text not null default 'pending',
  hotel_payload text null,
  hotel_signature text null,

  final_status text not null default 'pending',

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Constraint 1: signature_version must equal 1
alter table public.goal_strategy_runs
  add constraint goal_strategy_runs_signature_version_check
    check (signature_version = 1);

-- Constraint 2: run_signature must be exactly 64 lowercase hex characters
alter table public.goal_strategy_runs
  add constraint goal_strategy_runs_run_signature_hex_check
    check (run_signature ~ '^[0-9a-f]{64}$');

-- Constraint 3: status values must be one of pending, running, succeeded, failed
alter table public.goal_strategy_runs
  add constraint goal_strategy_runs_flight_status_check
    check (flight_status in ('pending', 'running', 'succeeded', 'failed'));

alter table public.goal_strategy_runs
  add constraint goal_strategy_runs_hotel_status_check
    check (hotel_status in ('pending', 'running', 'succeeded', 'failed'));

alter table public.goal_strategy_runs
  add constraint goal_strategy_runs_final_status_check
    check (final_status in ('pending', 'running', 'succeeded', 'failed'));

-- Constraint 4: flight payload/signature pairing
--   succeeded -> both non-null; every other status -> both null
alter table public.goal_strategy_runs
  add constraint goal_strategy_runs_flight_payload_pairing_check
    check (
      (flight_status = 'succeeded' and flight_payload is not null and flight_signature is not null)
      or
      (flight_status <> 'succeeded' and flight_payload is null and flight_signature is null)
    );

-- Constraint 5: hotel payload/signature pairing
--   succeeded -> both non-null; every other status -> both null
alter table public.goal_strategy_runs
  add constraint goal_strategy_runs_hotel_payload_pairing_check
    check (
      (hotel_status = 'succeeded' and hotel_payload is not null and hotel_signature is not null)
      or
      (hotel_status <> 'succeeded' and hotel_payload is null and hotel_signature is null)
    );

-- Constraint 6: non-null flight/hotel payloads must not be empty and
--   octet_length must be <= 1000000
alter table public.goal_strategy_runs
  add constraint goal_strategy_runs_flight_payload_length_check
    check (
      flight_payload is null
      or (
        length(flight_payload) > 0
        and octet_length(flight_payload) <= 1000000
      )
    );

alter table public.goal_strategy_runs
  add constraint goal_strategy_runs_hotel_payload_length_check
    check (
      hotel_payload is null
      or (
        length(hotel_payload) > 0
        and octet_length(hotel_payload) <= 1000000
      )
    );

-- Constraint 7: non-null flight/hotel signatures must be exactly 64 lowercase
--   hexadecimal characters
alter table public.goal_strategy_runs
  add constraint goal_strategy_runs_flight_signature_hex_check
    check (
      flight_signature is null
      or flight_signature ~ '^[0-9a-f]{64}$'
    );

alter table public.goal_strategy_runs
  add constraint goal_strategy_runs_hotel_signature_hex_check
    check (
      hotel_signature is null
      or hotel_signature ~ '^[0-9a-f]{64}$'
    );

-- Constraint 8: expires_at must be later than created_at
alter table public.goal_strategy_runs
  add constraint goal_strategy_runs_expires_after_created_check
    check (expires_at > created_at);

-- Indexes
create index goal_strategy_runs_user_goal_created_idx
  on public.goal_strategy_runs (user_id, goal_id, created_at desc);

create index goal_strategy_runs_expires_at_idx
  on public.goal_strategy_runs (expires_at);

-- Enable RLS
alter table public.goal_strategy_runs enable row level security;

-- RLS policies: dual ownership pattern matching goal_strategies.
-- Row user_id must equal auth.uid() AND an owned public.goals row must exist
-- where goals.id = goal_strategy_runs.goal_id and goals.user_id = auth.uid().

create policy "goal_strategy_runs_select_own" on public.goal_strategy_runs
  for select using (
    user_id = auth.uid()
    and exists (
      select 1 from public.goals
      where goals.id = goal_strategy_runs.goal_id
        and goals.user_id = auth.uid()
    )
  );

create policy "goal_strategy_runs_insert_own" on public.goal_strategy_runs
  for insert with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.goals
      where goals.id = goal_strategy_runs.goal_id
        and goals.user_id = auth.uid()
    )
  );

create policy "goal_strategy_runs_update_own" on public.goal_strategy_runs
  for update using (
    user_id = auth.uid()
    and exists (
      select 1 from public.goals
      where goals.id = goal_strategy_runs.goal_id
        and goals.user_id = auth.uid()
    )
  ) with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.goals
      where goals.id = goal_strategy_runs.goal_id
        and goals.user_id = auth.uid()
    )
  );

create policy "goal_strategy_runs_delete_own" on public.goal_strategy_runs
  for delete using (
    user_id = auth.uid()
    and exists (
      select 1 from public.goals
      where goals.id = goal_strategy_runs.goal_id
        and goals.user_id = auth.uid()
    )
  );

commit;
