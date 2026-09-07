-- Add database-authoritative attempt and deadline fences to flight/hotel
-- strategy-run persistence. The functions require the service-role database
-- identity plus an explicit server-authenticated user and dual ownership checks.

begin;

alter table public.goal_strategy_runs
  add column flight_attempt_id uuid null,
  add column flight_deadline_at timestamptz null,
  add column flight_start_recovery_token uuid null,
  add column hotel_attempt_id uuid null,
  add column hotel_deadline_at timestamptz null,
  add column hotel_start_recovery_token uuid null;

-- Pre-migration running rows have no database attempt capability and cannot
-- safely accept a later save. Make those abandoned lanes retryable.
update public.goal_strategy_runs
set flight_status = 'failed',
    flight_payload = null,
    flight_signature = null,
    updated_at = clock_timestamp()
where flight_status = 'running';

update public.goal_strategy_runs
set hotel_status = 'failed',
    hotel_payload = null,
    hotel_signature = null,
    updated_at = clock_timestamp()
where hotel_status = 'running';

alter table public.goal_strategy_runs
  add constraint goal_strategy_runs_flight_attempt_pairing_check
    check ((flight_attempt_id is null) = (flight_deadline_at is null)),
  add constraint goal_strategy_runs_hotel_attempt_pairing_check
    check ((hotel_attempt_id is null) = (hotel_deadline_at is null)),
  add constraint goal_strategy_runs_flight_running_attempt_check
    check (
      flight_status <> 'running'
      or (flight_attempt_id is not null and flight_start_recovery_token is not null)
    ),
  add constraint goal_strategy_runs_hotel_running_attempt_check
    check (
      hotel_status <> 'running'
      or (hotel_attempt_id is not null and hotel_start_recovery_token is not null)
    );

create function public.prepare_goal_strategy_run_research_stage_start(
  p_user_id uuid,
  p_run_id uuid,
  p_goal_id uuid,
  p_stage text,
  p_start_recovery_token uuid
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_updated_count integer;
begin
  if auth.role() is distinct from 'service_role' or p_user_id is null
    or p_stage not in ('flight', 'hotel') or p_start_recovery_token is null then
    return 'rejected';
  end if;

  if p_stage = 'flight' then
    update public.goal_strategy_runs as runs
    set flight_start_recovery_token = p_start_recovery_token
    where runs.id = p_run_id and runs.goal_id = p_goal_id
      and runs.user_id = p_user_id and runs.expires_at > clock_timestamp()
      and runs.flight_status in ('pending', 'failed') and runs.hotel_status = 'pending'
      and exists (
        select 1 from public.goals as goals
        where goals.id = runs.goal_id and goals.user_id = p_user_id
      );
  else
    update public.goal_strategy_runs as runs
    set hotel_start_recovery_token = p_start_recovery_token
    where runs.id = p_run_id and runs.goal_id = p_goal_id
      and runs.user_id = p_user_id and runs.expires_at > clock_timestamp()
      and runs.flight_status in ('succeeded', 'failed')
      and runs.hotel_status in ('pending', 'failed')
      and exists (
        select 1 from public.goals as goals
        where goals.id = runs.goal_id and goals.user_id = p_user_id
      );
  end if;

  get diagnostics v_updated_count = row_count;
  return case when v_updated_count = 1 then 'prepared' else 'rejected' end;
end;
$$;

create function public.start_goal_strategy_run_research_stage(
  p_user_id uuid,
  p_run_id uuid,
  p_goal_id uuid,
  p_stage text,
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
begin
  if auth.role() is distinct from 'service_role' or p_user_id is null
    or p_stage not in ('flight', 'hotel') or p_start_recovery_token is null then
    return;
  end if;

  if p_stage = 'flight' then
    return query
      update public.goal_strategy_runs as runs
      set flight_status = 'running',
          flight_payload = null,
          flight_signature = null,
          flight_attempt_id = v_attempt_id,
          flight_deadline_at = least(runs.expires_at, v_now + interval '120 seconds'),
          updated_at = v_now
      where runs.id = p_run_id
        and runs.goal_id = p_goal_id
        and runs.user_id = p_user_id
        and runs.expires_at > v_now
        and runs.flight_status in ('pending', 'failed')
        and runs.flight_start_recovery_token = p_start_recovery_token
        and runs.hotel_status = 'pending'
        and exists (
          select 1 from public.goals as goals
          where goals.id = runs.goal_id and goals.user_id = p_user_id
        )
      returning runs.flight_attempt_id, runs.flight_deadline_at, runs.updated_at;
  else
    return query
      update public.goal_strategy_runs as runs
      set hotel_status = 'running',
          hotel_payload = null,
          hotel_signature = null,
          hotel_attempt_id = v_attempt_id,
          hotel_deadline_at = least(runs.expires_at, v_now + interval '120 seconds'),
          updated_at = v_now
      where runs.id = p_run_id
        and runs.goal_id = p_goal_id
        and runs.user_id = p_user_id
        and runs.expires_at > v_now
        and runs.flight_status in ('succeeded', 'failed')
        and runs.hotel_status in ('pending', 'failed')
        and runs.hotel_start_recovery_token = p_start_recovery_token
        and exists (
          select 1 from public.goals as goals
          where goals.id = runs.goal_id and goals.user_id = p_user_id
        )
      returning runs.hotel_attempt_id, runs.hotel_deadline_at, runs.updated_at;
  end if;
end;
$$;

create function public.save_goal_strategy_run_research_stage(
  p_user_id uuid,
  p_run_id uuid,
  p_goal_id uuid,
  p_stage text,
  p_attempt_id uuid,
  p_payload text,
  p_signature text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_updated_count integer;
  v_status text;
  v_deadline_at timestamptz;
begin
  if auth.role() is distinct from 'service_role' or p_user_id is null
    or p_stage not in ('flight', 'hotel') then
    return 'rejected';
  end if;

  if p_stage = 'flight' then
    update public.goal_strategy_runs as runs
    set flight_status = 'succeeded',
        flight_payload = p_payload,
        flight_signature = p_signature,
        updated_at = clock_timestamp()
    where runs.id = p_run_id
      and runs.goal_id = p_goal_id
      and runs.user_id = p_user_id
      and runs.flight_status = 'running'
      and runs.flight_attempt_id = p_attempt_id
      and clock_timestamp() <= runs.flight_deadline_at
      and exists (
        select 1 from public.goals as goals
        where goals.id = runs.goal_id and goals.user_id = p_user_id
      );
  else
    update public.goal_strategy_runs as runs
    set hotel_status = 'succeeded',
        hotel_payload = p_payload,
        hotel_signature = p_signature,
        updated_at = clock_timestamp()
    where runs.id = p_run_id
      and runs.goal_id = p_goal_id
      and runs.user_id = p_user_id
      and runs.hotel_status = 'running'
      and runs.hotel_attempt_id = p_attempt_id
      and clock_timestamp() <= runs.hotel_deadline_at
      and exists (
        select 1 from public.goals as goals
        where goals.id = runs.goal_id and goals.user_id = p_user_id
      );
  end if;

  get diagnostics v_updated_count = row_count;
  if v_updated_count = 1 then
    return 'succeeded';
  end if;

  if p_stage = 'flight' then
    select runs.flight_status, runs.flight_deadline_at
      into v_status, v_deadline_at
    from public.goal_strategy_runs as runs
    where runs.id = p_run_id and runs.goal_id = p_goal_id
      and runs.user_id = p_user_id and runs.flight_attempt_id = p_attempt_id
      and exists (
        select 1 from public.goals as goals
        where goals.id = runs.goal_id and goals.user_id = p_user_id
      );
  else
    select runs.hotel_status, runs.hotel_deadline_at
      into v_status, v_deadline_at
    from public.goal_strategy_runs as runs
    where runs.id = p_run_id and runs.goal_id = p_goal_id
      and runs.user_id = p_user_id and runs.hotel_attempt_id = p_attempt_id
      and exists (
        select 1 from public.goals as goals
        where goals.id = runs.goal_id and goals.user_id = p_user_id
      );
  end if;

  return case
    when v_status = 'running' and clock_timestamp() > v_deadline_at then 'deadline_expired'
    else 'rejected'
  end;
end;
$$;

create function public.recover_goal_strategy_run_research_stage_start(
  p_user_id uuid,
  p_run_id uuid,
  p_goal_id uuid,
  p_stage text,
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
begin
  if auth.role() is distinct from 'service_role' or p_user_id is null
    or p_stage not in ('flight', 'hotel') or p_start_recovery_token is null then
    return 'rejected';
  end if;

  if p_stage = 'flight' then
    update public.goal_strategy_runs as runs
    set flight_status = 'failed',
        flight_payload = null,
        flight_signature = null,
        flight_start_recovery_token = null,
        updated_at = clock_timestamp()
    where runs.id = p_run_id and runs.goal_id = p_goal_id
      and runs.user_id = p_user_id and runs.flight_status in ('pending', 'running', 'failed')
      and runs.flight_start_recovery_token = p_start_recovery_token
      and exists (
        select 1 from public.goals as goals
        where goals.id = runs.goal_id and goals.user_id = p_user_id
      );
  else
    update public.goal_strategy_runs as runs
    set hotel_status = 'failed',
        hotel_payload = null,
        hotel_signature = null,
        hotel_start_recovery_token = null,
        updated_at = clock_timestamp()
    where runs.id = p_run_id and runs.goal_id = p_goal_id
      and runs.user_id = p_user_id and runs.hotel_status in ('pending', 'running', 'failed')
      and runs.hotel_start_recovery_token = p_start_recovery_token
      and exists (
        select 1 from public.goals as goals
        where goals.id = runs.goal_id and goals.user_id = p_user_id
      );
  end if;

  get diagnostics v_updated_count = row_count;
  if v_updated_count = 1 then
    return 'failed';
  end if;

  if p_stage = 'flight' then
    select runs.flight_status into v_status
    from public.goal_strategy_runs as runs
    where runs.id = p_run_id and runs.goal_id = p_goal_id
      and runs.user_id = p_user_id
      and runs.flight_start_recovery_token = p_start_recovery_token
      and exists (
        select 1 from public.goals as goals
        where goals.id = runs.goal_id and goals.user_id = p_user_id
      );
  else
    select runs.hotel_status into v_status
    from public.goal_strategy_runs as runs
    where runs.id = p_run_id and runs.goal_id = p_goal_id
      and runs.user_id = p_user_id
      and runs.hotel_start_recovery_token = p_start_recovery_token
      and exists (
        select 1 from public.goals as goals
        where goals.id = runs.goal_id and goals.user_id = p_user_id
      );
  end if;

  return case when v_status = 'succeeded' then 'succeeded' else 'rejected' end;
end;
$$;

create function public.fail_goal_strategy_run_research_stage(
  p_user_id uuid,
  p_run_id uuid,
  p_goal_id uuid,
  p_stage text,
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
begin
  if auth.role() is distinct from 'service_role' or p_user_id is null
    or p_stage not in ('flight', 'hotel') then
    return 'rejected';
  end if;

  if p_stage = 'flight' then
    update public.goal_strategy_runs as runs
    set flight_status = 'failed',
        flight_payload = null,
        flight_signature = null,
        updated_at = clock_timestamp()
    where runs.id = p_run_id
      and runs.goal_id = p_goal_id
      and runs.user_id = p_user_id
      and runs.flight_status = 'running'
      and runs.flight_attempt_id = p_attempt_id
      and exists (
        select 1 from public.goals as goals
        where goals.id = runs.goal_id and goals.user_id = p_user_id
      );
  else
    update public.goal_strategy_runs as runs
    set hotel_status = 'failed',
        hotel_payload = null,
        hotel_signature = null,
        updated_at = clock_timestamp()
    where runs.id = p_run_id
      and runs.goal_id = p_goal_id
      and runs.user_id = p_user_id
      and runs.hotel_status = 'running'
      and runs.hotel_attempt_id = p_attempt_id
      and exists (
        select 1 from public.goals as goals
        where goals.id = runs.goal_id and goals.user_id = p_user_id
      );
  end if;

  get diagnostics v_updated_count = row_count;
  if v_updated_count = 1 then
    return 'failed';
  end if;

  if p_stage = 'flight' then
    select runs.flight_status into v_status
    from public.goal_strategy_runs as runs
    where runs.id = p_run_id and runs.goal_id = p_goal_id
      and runs.user_id = p_user_id and runs.flight_attempt_id = p_attempt_id
      and exists (
        select 1 from public.goals as goals
        where goals.id = runs.goal_id and goals.user_id = p_user_id
      );
  else
    select runs.hotel_status into v_status
    from public.goal_strategy_runs as runs
    where runs.id = p_run_id and runs.goal_id = p_goal_id
      and runs.user_id = p_user_id and runs.hotel_attempt_id = p_attempt_id
      and exists (
        select 1 from public.goals as goals
        where goals.id = runs.goal_id and goals.user_id = p_user_id
      );
  end if;

  return case when v_status = 'succeeded' then 'succeeded' else 'rejected' end;
end;
$$;

revoke all on function public.prepare_goal_strategy_run_research_stage_start(uuid, uuid, uuid, text, uuid) from public, anon, authenticated;
revoke all on function public.start_goal_strategy_run_research_stage(uuid, uuid, uuid, text, uuid) from public, anon, authenticated;
revoke all on function public.save_goal_strategy_run_research_stage(uuid, uuid, uuid, text, uuid, text, text) from public, anon, authenticated;
revoke all on function public.fail_goal_strategy_run_research_stage(uuid, uuid, uuid, text, uuid) from public, anon, authenticated;
revoke all on function public.recover_goal_strategy_run_research_stage_start(uuid, uuid, uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.prepare_goal_strategy_run_research_stage_start(uuid, uuid, uuid, text, uuid) to service_role;
grant execute on function public.start_goal_strategy_run_research_stage(uuid, uuid, uuid, text, uuid) to service_role;
grant execute on function public.save_goal_strategy_run_research_stage(uuid, uuid, uuid, text, uuid, text, text) to service_role;
grant execute on function public.fail_goal_strategy_run_research_stage(uuid, uuid, uuid, text, uuid) to service_role;
grant execute on function public.recover_goal_strategy_run_research_stage_start(uuid, uuid, uuid, text, uuid) to service_role;

-- Keep the new server-owned fields unavailable through ordinary PostgREST
-- table reads and writes. Existing application columns retain their grants.
revoke select, insert, update on public.goal_strategy_runs from anon, authenticated;
grant select (
  id, goal_id, user_id, signature_version, expires_at, run_signature,
  flight_status, flight_payload, flight_signature,
  hotel_status, hotel_payload, hotel_signature,
  final_status, created_at, updated_at
) on public.goal_strategy_runs to authenticated;
grant update (
  final_status, updated_at
) on public.goal_strategy_runs to authenticated;
grant insert (
  id, goal_id, user_id, signature_version, expires_at, run_signature,
  flight_status, hotel_status, final_status, updated_at
) on public.goal_strategy_runs to authenticated;

commit;
