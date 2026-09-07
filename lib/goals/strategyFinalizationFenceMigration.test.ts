import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const migrationUrl = new URL(
  "../../supabase/migrations/20260906120000_add_strategy_finalization_deadline_fence.sql",
  import.meta.url,
);
const appliedStageMigrationUrl = new URL(
  "../../supabase/migrations/20260905120000_add_strategy_stage_deadline_fence.sql",
  import.meta.url,
);

test("finalization fence is a separate forward-only transactional migration", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  const prior = await readFile(appliedStageMigrationUrl, "utf8");
  assert.match(sql, /^begin;/m);
  assert.match(sql, /^commit;/m);
  assert.match(prior, /flight_attempt_id/);
  assert.doesNotMatch(sql, /alter table public\.goal_strategy_runs[\s\S]*flight_attempt_id/);
  assert.match(sql, /add column final_attempt_id uuid null/);
  assert.match(sql, /add column final_deadline_at timestamptz null/);
  assert.match(sql, /add column final_start_recovery_token uuid null/);
  assert.match(sql, /where final_status = 'running'/);
});

test("all finalization RPCs are service-role-only with explicit dual ownership", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  assert.equal((sql.match(/auth\.role\(\) is distinct from 'service_role'/g) ?? []).length, 6);
  assert.equal((sql.match(/grant execute on function/g) ?? []).length, 6);
  assert.equal((sql.match(/revoke all on function public\.(?:prepare|start|commit|fail|recover|delete)/g) ?? []).length, 6);
  assert.equal((sql.match(/p_user_id uuid/g) ?? []).length, 6);
  assert.match(sql, /runs\.user_id = p_user_id/g);
  assert.match(sql, /goals\.user_id = p_user_id/g);
  assert.doesNotMatch(sql, /auth\.uid\(\)/);
  assert.doesNotMatch(sql, /grant execute[^\n]+to authenticated/);
});

test("atomic final commit fences strategy persistence by attempt and database clock", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  assert.match(sql, /commit_goal_strategy_run_finalization[\s\S]*for update/);
  assert.match(sql, /for update;[\s\S]*v_now := clock_timestamp\(\)/);
  assert.match(sql, /final_attempt_id = p_attempt_id/);
  assert.match(sql, /if v_now > v_deadline_at then[\s\S]*deadline_expired/);
  assert.match(sql, /insert into public\.goal_strategies[\s\S]*on conflict \(goal_id\) do update/);
  assert.match(sql, /set final_status = 'succeeded'/);
  assert.match(sql, /interval '245 seconds'/);
  assert.match(sql, /fail_goal_strategy_run_finalization[\s\S]*final_status = 'running'[\s\S]*final_attempt_id = p_attempt_id/);
  assert.match(sql, /recover_goal_strategy_run_finalization_start[\s\S]*final_start_recovery_token = p_start_recovery_token/);
});

test("browser roles cannot mutate final state or saved strategies through ordinary tables", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  assert.match(sql, /revoke update on public\.goal_strategy_runs from anon, authenticated/);
  assert.match(sql, /grant update \(final_status, updated_at\) on public\.goal_strategy_runs to authenticated/);
  assert.match(sql, /revoke insert on public\.goal_strategies from anon, authenticated/);
  assert.match(sql, /revoke update on public\.goal_strategies from anon, authenticated/);
  assert.match(sql, /revoke delete on public\.goal_strategies from anon, authenticated/);
  assert.match(sql, /revoke all on function public\.delete_owned_goal_strategy\(uuid, uuid\) from public, anon, authenticated/);
  assert.match(sql, /grant execute on function public\.delete_owned_goal_strategy\(uuid, uuid\) to service_role/);
  assert.doesNotMatch(sql, /grant select[\s\S]*final_attempt_id/);
  assert.doesNotMatch(sql, /grant insert[\s\S]*final_start_recovery_token/);
  assert.doesNotMatch(sql, /drop policy|disable row level security/);
});

test("delete serializes with commit, invalidates old authority, and preserves deliberate rebuilds", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  assert.match(sql, /create function public\.delete_owned_goal_strategy[\s\S]*auth\.role\(\) is distinct from 'service_role'/);
  assert.match(sql, /delete_owned_goal_strategy[\s\S]*from public\.goals[\s\S]*goals\.user_id = p_user_id[\s\S]*for update/);
  assert.match(sql, /delete_owned_goal_strategy[\s\S]*from public\.goal_strategy_runs[\s\S]*runs\.user_id = p_user_id[\s\S]*for update/);
  assert.match(sql, /strategy_authority_generation = v_generation \+ 1/);
  assert.match(sql, /final_status = case when runs\.final_status = 'running' then 'failed'/);
  assert.match(sql, /final_attempt_id = null[\s\S]*final_deadline_at = null[\s\S]*final_start_recovery_token = null/);
  assert.match(sql, /delete from public\.goal_strategies[\s\S]*strategies\.user_id = p_user_id/);
  assert.match(sql, /set_goal_strategy_run_authority_generation[\s\S]*before insert on public\.goal_strategy_runs/);
  assert.match(sql, /prepare_goal_strategy_run_finalization_start[\s\S]*runs\.strategy_authority_generation = v_generation/);
  assert.match(sql, /start_goal_strategy_run_finalization[\s\S]*runs\.strategy_authority_generation = v_generation/);
  assert.match(sql, /commit_goal_strategy_run_finalization[\s\S]*for share[\s\S]*runs\.strategy_authority_generation = v_generation/);
  assert.match(sql, /revoke select, insert, update on public\.goals from anon, authenticated/);
  assert.match(sql, /grant update \([\s\S]*?updated_at[\s\S]*?\) on public\.goals to authenticated/);
  assert.match(sql, /revoke update on public\.goal_strategy_runs from anon, authenticated/);
  assert.match(sql, /grant update \(final_status, updated_at\) on public\.goal_strategy_runs to authenticated/);
});

test("authenticated users cannot access goals.strategy_authority_generation through ordinary table grants", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  // SELECT grant must exclude strategy_authority_generation
  const selectGrant = sql.match(/grant select \(([\s\S]*?)\) on public\.goals to authenticated;/)?.[1];
  assert.ok(selectGrant, "SELECT grant on goals must exist");
  assert.equal(selectGrant.includes("strategy_authority_generation"), false,
    "SELECT grant must not include strategy_authority_generation");
  // INSERT grant must exclude strategy_authority_generation
  const insertGrant = sql.match(/grant insert \(([\s\S]*?)\) on public\.goals to authenticated;/)?.[1];
  assert.ok(insertGrant, "INSERT grant on goals must exist");
  assert.equal(insertGrant.includes("strategy_authority_generation"), false,
    "INSERT grant must not include strategy_authority_generation");
  // UPDATE grant must exclude strategy_authority_generation
  const updateGrant = sql.match(/grant update \(([\s\S]*?)\) on public\.goals to authenticated;/)?.[1];
  assert.ok(updateGrant, "UPDATE grant on goals must exist");
  assert.equal(updateGrant.includes("strategy_authority_generation"), false,
    "UPDATE grant must not include strategy_authority_generation");
  // Required customer-facing columns must remain in SELECT grant
  for (const column of [
    "id", "user_id", "type", "title", "status", "origin", "destinations",
    "earliest_departure", "latest_return", "minimum_nights", "maximum_nights",
    "traveler_count", "cabin_preference", "optimization_priority",
    "maximum_cash_budget", "currency", "allow_new_cards", "created_at", "updated_at",
  ]) {
    assert.equal(selectGrant.includes(column), true, `SELECT grant must include ${column}`);
  }
  // Required customer-facing columns must remain in INSERT grant
  for (const column of [
    "user_id", "title", "status", "origin", "destinations",
    "earliest_departure", "latest_return", "minimum_nights", "maximum_nights",
    "traveler_count", "cabin_preference", "optimization_priority",
    "maximum_cash_budget", "currency", "allow_new_cards",
  ]) {
    assert.equal(insertGrant.includes(column), true, `INSERT grant must include ${column}`);
  }
  // Required customer-facing columns must remain in UPDATE grant
  for (const column of [
    "title", "status", "origin", "destinations",
    "earliest_departure", "latest_return", "minimum_nights", "maximum_nights",
    "traveler_count", "cabin_preference", "optimization_priority",
    "maximum_cash_budget", "currency", "allow_new_cards", "updated_at",
  ]) {
    assert.equal(updateGrant.includes(column), true, `UPDATE grant must include ${column}`);
  }
});

test("authenticated users retain only final_status and updated_at UPDATE access on goal_strategy_runs", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  // UPDATE grant must exist and include only final_status and updated_at
  const updateGrant = sql.match(/grant update \(([\s\S]*?)\) on public\.goal_strategy_runs to authenticated;/)?.[1];
  assert.ok(updateGrant, "UPDATE grant on goal_strategy_runs must exist");
  assert.equal(updateGrant.includes("final_status"), true, "UPDATE grant must include final_status");
  assert.equal(updateGrant.includes("updated_at"), true, "UPDATE grant must include updated_at");
  // strategy_authority_generation must be excluded from UPDATE grant
  assert.equal(updateGrant.includes("strategy_authority_generation"), false,
    "UPDATE grant must not include strategy_authority_generation");
  // Other server-owned columns must also be excluded
  for (const column of [
    "final_attempt_id", "final_deadline_at", "final_start_recovery_token",
    "flight_attempt_id", "flight_deadline_at", "flight_start_recovery_token",
    "hotel_attempt_id", "hotel_deadline_at", "hotel_start_recovery_token",
    "flight_payload", "flight_signature", "hotel_payload", "hotel_signature",
    "run_signature",
  ]) {
    assert.equal(updateGrant.includes(column), false, `UPDATE grant must not include ${column}`);
  }
});

test("strategy_authority_generation remains absent from goal_strategy_runs ordinary grants", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  // The September 6 migration does not re-grant SELECT/INSERT on goal_strategy_runs;
  // those come from the September 5 migration. Verify the September 6 migration does
  // not accidentally expose strategy_authority_generation.
  // Check that the migration does not grant SELECT including strategy_authority_generation
  assert.doesNotMatch(sql, /grant select \([\s\S]*strategy_authority_generation[\s\S]*\) on public\.goal_strategy_runs/);
  // Check that the migration does not grant INSERT including strategy_authority_generation
  assert.doesNotMatch(sql, /grant insert \([\s\S]*strategy_authority_generation[\s\S]*\) on public\.goal_strategy_runs/);
  // Check that the migration does not grant UPDATE including strategy_authority_generation
  assert.doesNotMatch(sql, /grant update \([\s\S]*strategy_authority_generation[\s\S]*\) on public\.goal_strategy_runs/);
  // Verify the September 5 migration's SELECT grant excludes strategy_authority_generation
  const stageMigrationUrl = new URL(
    "../../supabase/migrations/20260905120000_add_strategy_stage_deadline_fence.sql",
    import.meta.url,
  );
  const stageSql = await readFile(stageMigrationUrl, "utf8");
  const selectGrant = stageSql.match(/grant select \(([\s\S]*?)\) on public\.goal_strategy_runs to authenticated;/)?.[1];
  assert.ok(selectGrant, "September 5 SELECT grant on goal_strategy_runs must exist");
  assert.equal(selectGrant.includes("strategy_authority_generation"), false,
    "September 5 SELECT grant must not include strategy_authority_generation");
  // Verify the September 5 migration's INSERT grant excludes strategy_authority_generation
  const insertGrant = stageSql.match(/grant insert \(([\s\S]*?)\) on public\.goal_strategy_runs to authenticated;/)?.[1];
  assert.ok(insertGrant, "September 5 INSERT grant on goal_strategy_runs must exist");
  assert.equal(insertGrant.includes("strategy_authority_generation"), false,
    "September 5 INSERT grant must not include strategy_authority_generation");
});
