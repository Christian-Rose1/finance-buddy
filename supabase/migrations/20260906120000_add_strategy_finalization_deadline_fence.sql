-- Add a database-authoritative attempt/deadline fence for final strategy
-- generation and atomically persist a successful strategy with its run status.
-- Every function is service-role-only and also requires the explicit user ID
-- derived by the authenticated server action.

begin;

alter table public.goal_strategy_runs
  add column final_attempt_id uuid null,
  add column final_deadline_at timestamptz null,
  add column final_start_recovery_token uuid null,
  add column strategy_authority_generation bigint not null default 0;

alter table public.goals
  add column strategy_authority_generation bigint not null default 0;

-- Runs inherit the current goal generation inside the same goal-row lock used
-- by deletion. Callers cannot choose which deletion generation a run belongs
-- to, and a run inserted after deletion is intentionally rebuildable.
create function public.set_goal_strategy_run_authority_generation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_generation bigint;
begin
  select goals.strategy_authority_generation into v_generation
  from public.goals as goals
  where goals.id = new.goal_id and goals.user_id = new.user_id
  for share;

  if v_generation is null then
    raise exception 'strategy run ownership mismatch';
  end if;
  new.strategy_authority_generation := v_generation;
  return new;
end;
$$;

create trigger goal_strategy_runs_set_authority_generation
before insert on public.goal_strategy_runs
for each row execute function public.set_goal_strategy_run_authority_generation();

revoke all on function public.set_goal_strategy_run_authority_generation() from public, anon, authenticated;

-- A pre-migration running finalization has no durable attempt authority and
-- must become retryable rather than remaining permanently stranded.
update public.goal_strategy_runs
set final_status = 'failed',
    updated_at = clock_timestamp()
where final_status = 'running';

alter table public.goal_strategy_runs
  add constraint goal_strategy_runs_final_attempt_pairing_check
    check ((final_attempt_id is null) = (final_deadline_at is null)),
  add constraint goal_strategy_runs_final_running_attempt_check
    check (
      final_status <> 'running'
      or (final_attempt_id is not null and final_start_recovery_token is not null)
    );

create function public.prepare_goal_strategy_run_finalization_start(
  p_user_id uuid,
  p_run_id uuid,
  p_goal_id uuid,
  p_start_recovery_token uuid
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_updated_count integer;
  v_generation bigint;
begin
  if auth.role() is distinct from 'service_role' or p_user_id is null
    or p_start_recovery_token is null then
    return 'rejected';
  end if;

  select goals.strategy_authority_generation into v_generation
  from public.goals as goals
  where goals.id = p_goal_id and goals.user_id = p_user_id
  for share;
  if v_generation is null then return 'rejected'; end if;

  update public.goal_strategy_runs as runs
  set final_start_recovery_token = p_start_recovery_token
  where runs.id = p_run_id and runs.goal_id = p_goal_id
    and runs.user_id = p_user_id and runs.expires_at > clock_timestamp()
    and runs.flight_status in ('succeeded', 'failed')
    and runs.hotel_status in ('succeeded', 'failed')
    and runs.final_status in ('pending', 'failed')
    and runs.strategy_authority_generation = v_generation
    and exists (
      select 1 from public.goals as goals
      where goals.id = runs.goal_id and goals.user_id = p_user_id
    );

  get diagnostics v_updated_count = row_count;
  return case when v_updated_count = 1 then 'prepared' else 'rejected' end;
end;
$$;

create function public.start_goal_strategy_run_finalization(
  p_user_id uuid,
  p_run_id uuid,
  p_goal_id uuid,
  p_start_recovery_token uuid
)
returns table (attempt_id uuid, deadline_at timestamptz, revision timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attempt_id uuid := gen_random_uuid();
  v_now timestamptz := clock_timestamp();
  v_generation bigint;
begin
  if auth.role() is distinct from 'service_role' or p_user_id is null
    or p_start_recovery_token is null then
    return;
  end if;

  select goals.strategy_authority_generation into v_generation
  from public.goals as goals
  where goals.id = p_goal_id and goals.user_id = p_user_id
  for share;
  if v_generation is null then return; end if;

  return query
    update public.goal_strategy_runs as runs
    set final_status = 'running',
        final_attempt_id = v_attempt_id,
        final_deadline_at = least(runs.expires_at, v_now + interval '245 seconds'),
        updated_at = v_now
    where runs.id = p_run_id and runs.goal_id = p_goal_id
      and runs.user_id = p_user_id and runs.expires_at > v_now
      and runs.flight_status in ('succeeded', 'failed')
      and runs.hotel_status in ('succeeded', 'failed')
      and runs.final_status in ('pending', 'failed')
      and runs.final_start_recovery_token = p_start_recovery_token
      and runs.strategy_authority_generation = v_generation
      and exists (
        select 1 from public.goals as goals
        where goals.id = runs.goal_id and goals.user_id = p_user_id
      )
    returning runs.final_attempt_id, runs.final_deadline_at, runs.updated_at;
end;
$$;

create function public.commit_goal_strategy_run_finalization(
  p_user_id uuid,
  p_run_id uuid,
  p_goal_id uuid,
  p_attempt_id uuid,
  p_strategy_json jsonb,
  p_schema_version integer,
  p_generated_at timestamptz
)
returns table (outcome text, strategy_json jsonb, generated_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz;
  v_deadline_at timestamptz;
  v_final_status text;
  v_saved_strategy jsonb;
  v_saved_generated_at timestamptz;
  v_generation bigint;
begin
  if auth.role() is distinct from 'service_role' or p_user_id is null
    or p_attempt_id is null or p_schema_version <> 1
    or p_strategy_json is null or jsonb_typeof(p_strategy_json) <> 'object'
    or p_generated_at is null then
    return query select 'rejected'::text, null::jsonb, null::timestamptz;
    return;
  end if;

  -- Every finalization function takes the owned goal lock before its run lock.
  -- Deletion takes the same locks in the same order, avoiding deadlocks while
  -- making either the complete commit or the complete deletion win atomically.
  select goals.strategy_authority_generation into v_generation
  from public.goals as goals
  where goals.id = p_goal_id and goals.user_id = p_user_id
  for share;
  if v_generation is null then
    return query select 'rejected'::text, null::jsonb, null::timestamptz;
    return;
  end if;

  -- Lock the exact owned run before checking the database clock. A cleanup or
  -- newer attempt serializes on the same row; only one authority can win.
  select runs.final_status, runs.final_deadline_at
    into v_final_status, v_deadline_at
  from public.goal_strategy_runs as runs
  where runs.id = p_run_id and runs.goal_id = p_goal_id
    and runs.user_id = p_user_id and runs.final_attempt_id = p_attempt_id
    and runs.strategy_authority_generation = v_generation
    and exists (
      select 1 from public.goals as goals
      where goals.id = runs.goal_id and goals.user_id = p_user_id
    )
  for update;

  -- Read the database clock only after acquiring the run-row lock so time
  -- spent behind cleanup or another attempt can never use a stale timestamp.
  v_now := clock_timestamp();

  if v_final_status is distinct from 'running' then
    return query select 'rejected'::text, null::jsonb, null::timestamptz;
    return;
  end if;
  if v_now > v_deadline_at then
    return query select 'deadline_expired'::text, null::jsonb, null::timestamptz;
    return;
  end if;

  insert into public.goal_strategies as strategies (
    goal_id, user_id, strategy_json, schema_version, generated_at, updated_at
  ) values (
    p_goal_id, p_user_id, p_strategy_json, p_schema_version, p_generated_at, v_now
  )
  on conflict (goal_id) do update
    set user_id = excluded.user_id,
        strategy_json = excluded.strategy_json,
        schema_version = excluded.schema_version,
        generated_at = excluded.generated_at,
        updated_at = v_now
  where strategies.user_id = p_user_id
  returning strategies.strategy_json, strategies.generated_at
    into v_saved_strategy, v_saved_generated_at;

  if v_saved_strategy is null then
    raise exception 'final strategy ownership mismatch';
  end if;

  update public.goal_strategy_runs as runs
  set final_status = 'succeeded', updated_at = v_now
  where runs.id = p_run_id and runs.goal_id = p_goal_id
    and runs.user_id = p_user_id and runs.final_status = 'running'
    and runs.final_attempt_id = p_attempt_id;

  if not found then
    raise exception 'final strategy attempt changed';
  end if;

  return query select 'succeeded'::text, v_saved_strategy, v_saved_generated_at;
end;
$$;

create function public.fail_goal_strategy_run_finalization(
  p_user_id uuid,
  p_run_id uuid,
  p_goal_id uuid,
  p_attempt_id uuid
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_updated_count integer;
  v_status text;
  v_generation bigint;
begin
  if auth.role() is distinct from 'service_role' or p_user_id is null
    or p_attempt_id is null then
    return 'rejected';
  end if;

  select goals.strategy_authority_generation into v_generation
  from public.goals as goals
  where goals.id = p_goal_id and goals.user_id = p_user_id
  for share;
  if v_generation is null then return 'rejected'; end if;

  update public.goal_strategy_runs as runs
  set final_status = 'failed', updated_at = clock_timestamp()
  where runs.id = p_run_id and runs.goal_id = p_goal_id
    and runs.user_id = p_user_id and runs.final_status = 'running'
    and runs.final_attempt_id = p_attempt_id
    and runs.strategy_authority_generation = v_generation
    and exists (
      select 1 from public.goals as goals
      where goals.id = runs.goal_id and goals.user_id = p_user_id
    );
  get diagnostics v_updated_count = row_count;
  if v_updated_count = 1 then return 'failed'; end if;

  select runs.final_status into v_status
  from public.goal_strategy_runs as runs
  where runs.id = p_run_id and runs.goal_id = p_goal_id
    and runs.user_id = p_user_id and runs.final_attempt_id = p_attempt_id
    and exists (
      select 1 from public.goals as goals
      where goals.id = runs.goal_id and goals.user_id = p_user_id
    );
  return case when v_status = 'succeeded' then 'succeeded' else 'rejected' end;
end;
$$;

create function public.recover_goal_strategy_run_finalization_start(
  p_user_id uuid,
  p_run_id uuid,
  p_goal_id uuid,
  p_start_recovery_token uuid
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_updated_count integer;
  v_status text;
  v_generation bigint;
begin
  if auth.role() is distinct from 'service_role' or p_user_id is null
    or p_start_recovery_token is null then
    return 'rejected';
  end if;

  select goals.strategy_authority_generation into v_generation
  from public.goals as goals
  where goals.id = p_goal_id and goals.user_id = p_user_id
  for share;
  if v_generation is null then return 'rejected'; end if;

  update public.goal_strategy_runs as runs
  set final_status = 'failed', final_start_recovery_token = null,
      updated_at = clock_timestamp()
  where runs.id = p_run_id and runs.goal_id = p_goal_id
    and runs.user_id = p_user_id and runs.final_status in ('pending', 'running', 'failed')
    and runs.final_start_recovery_token = p_start_recovery_token
    and runs.strategy_authority_generation = v_generation
    and exists (
      select 1 from public.goals as goals
      where goals.id = runs.goal_id and goals.user_id = p_user_id
    );
  get diagnostics v_updated_count = row_count;
  if v_updated_count = 1 then return 'failed'; end if;

  select runs.final_status into v_status
  from public.goal_strategy_runs as runs
  where runs.id = p_run_id and runs.goal_id = p_goal_id
    and runs.user_id = p_user_id
    and runs.final_start_recovery_token = p_start_recovery_token
    and exists (
      select 1 from public.goals as goals
      where goals.id = runs.goal_id and goals.user_id = p_user_id
    );
  return case when v_status = 'succeeded' then 'succeeded' else 'rejected' end;
end;
$$;

create function public.delete_owned_goal_strategy(
  p_user_id uuid,
  p_goal_id uuid
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_generation bigint;
  v_deleted_count integer;
begin
  if auth.role() is distinct from 'service_role' or p_user_id is null then
    return 'rejected';
  end if;

  -- Serialize before any run-row lock. A final commit that acquired this lock
  -- first completes and is then deleted; if deletion acquired it first, every
  -- old commit/start/recovery authority becomes stale before success returns.
  select goals.strategy_authority_generation into v_generation
  from public.goals as goals
  where goals.id = p_goal_id and goals.user_id = p_user_id
  for update;
  if v_generation is null then return 'rejected'; end if;

  -- Lock every owned run in deterministic order before changing authority.
  perform runs.id
  from public.goal_strategy_runs as runs
  where runs.goal_id = p_goal_id and runs.user_id = p_user_id
  order by runs.id
  for update;

  -- A strategy must still exist and be owned by the same user. Preserve it if
  -- any ownership or persistence step rejects or rolls back.
  if not exists (
    select 1 from public.goal_strategies as strategies
    where strategies.goal_id = p_goal_id and strategies.user_id = p_user_id
  ) then
    return 'rejected';
  end if;

  update public.goals as goals
  set strategy_authority_generation = v_generation + 1
  where goals.id = p_goal_id and goals.user_id = p_user_id
    and goals.strategy_authority_generation = v_generation;
  if not found then raise exception 'strategy authority changed'; end if;

  update public.goal_strategy_runs as runs
  set final_status = case when runs.final_status = 'running' then 'failed' else runs.final_status end,
      final_attempt_id = null,
      final_deadline_at = null,
      final_start_recovery_token = null,
      updated_at = clock_timestamp()
  where runs.goal_id = p_goal_id and runs.user_id = p_user_id
    and runs.strategy_authority_generation = v_generation
    and (runs.final_status = 'running' or runs.final_attempt_id is not null
      or runs.final_deadline_at is not null or runs.final_start_recovery_token is not null);

  delete from public.goal_strategies as strategies
  where strategies.goal_id = p_goal_id and strategies.user_id = p_user_id;
  get diagnostics v_deleted_count = row_count;
  if v_deleted_count <> 1 then raise exception 'strategy delete failed'; end if;
  return 'deleted';
end;
$$;

revoke all on function public.prepare_goal_strategy_run_finalization_start(uuid, uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.start_goal_strategy_run_finalization(uuid, uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.commit_goal_strategy_run_finalization(uuid, uuid, uuid, uuid, jsonb, integer, timestamptz) from public, anon, authenticated;
revoke all on function public.fail_goal_strategy_run_finalization(uuid, uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.recover_goal_strategy_run_finalization_start(uuid, uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.delete_owned_goal_strategy(uuid, uuid) from public, anon, authenticated;
grant execute on function public.prepare_goal_strategy_run_finalization_start(uuid, uuid, uuid, uuid) to service_role;
grant execute on function public.start_goal_strategy_run_finalization(uuid, uuid, uuid, uuid) to service_role;
grant execute on function public.commit_goal_strategy_run_finalization(uuid, uuid, uuid, uuid, jsonb, integer, timestamptz) to service_role;
grant execute on function public.fail_goal_strategy_run_finalization(uuid, uuid, uuid, uuid) to service_role;
grant execute on function public.recover_goal_strategy_run_finalization_start(uuid, uuid, uuid, uuid) to service_role;
grant execute on function public.delete_owned_goal_strategy(uuid, uuid) to service_role;

-- Final status and all attempt fields are server-owned. Authenticated users
-- retain the exact ordinary read/insert/update columns needed by the application.
-- Revoke any inherited table-wide UPDATE privilege, then regrant only the exact
-- columns used by updateGoalStrategyRunFinalStatus. strategy_authority_generation
-- remains unavailable through ordinary table access.
revoke update on public.goal_strategy_runs from anon, authenticated;
grant update (final_status, updated_at) on public.goal_strategy_runs to authenticated;
-- Keep the server-owned goal generation unavailable through ordinary table
-- access. Table-wide privileges include columns added later, so revoke them
-- before restoring only the original customer-facing projection and payload
-- columns used by the authenticated goal repository. Goal DELETE privileges
-- and every existing ownership RLS policy remain unchanged.
revoke select, insert, update on public.goals from anon, authenticated;
grant select (
  id, user_id, type, title, status, origin, destinations, earliest_departure,
  latest_return, minimum_nights, maximum_nights, traveler_count,
  cabin_preference, optimization_priority, maximum_cash_budget, currency,
  allow_new_cards, created_at, updated_at
) on public.goals to authenticated;
grant insert (
  user_id, title, status, origin, destinations, earliest_departure,
  latest_return, minimum_nights, maximum_nights, traveler_count,
  cabin_preference, optimization_priority, maximum_cash_budget, currency,
  allow_new_cards
) on public.goals to authenticated;
grant update (
  title, status, origin, destinations, earliest_departure, latest_return,
  minimum_nights, maximum_nights, traveler_count, cabin_preference,
  optimization_priority, maximum_cash_budget, currency, allow_new_cards,
  updated_at
) on public.goals to authenticated;
revoke insert on public.goal_strategies from anon, authenticated;
revoke update on public.goal_strategies from anon, authenticated;
revoke delete on public.goal_strategies from anon, authenticated;

commit;
