import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const migrationUrl = new URL(
  "../../supabase/migrations/20260905120000_add_strategy_stage_deadline_fence.sql",
  import.meta.url,
);
const strategyRunsMigrationUrl = new URL(
  "../../supabase/migrations/20260823120000_create_goal_strategy_runs.sql",
  import.meta.url,
);

test("stage fence migration uses database-clock, ownership, attempt, status, and deadline predicates", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  assert.match(sql, /security definer/g);
  assert.match(sql, /set search_path = ''/g);
  assert.equal((sql.match(/p_user_id uuid/g) ?? []).length, 5);
  assert.equal((sql.match(/auth\.role\(\) is distinct from 'service_role'/g) ?? []).length, 5);
  assert.match(sql, /runs\.user_id = p_user_id/g);
  assert.match(sql, /goals\.user_id = p_user_id/g);
  assert.doesNotMatch(sql, /auth\.uid\(\)/);
  assert.match(sql, /flight_status = 'running'[\s\S]*flight_attempt_id = p_attempt_id[\s\S]*clock_timestamp\(\) <= runs\.flight_deadline_at/);
  assert.match(sql, /hotel_status = 'running'[\s\S]*hotel_attempt_id = p_attempt_id[\s\S]*clock_timestamp\(\) <= runs\.hotel_deadline_at/);
  assert.match(sql, /interval '120 seconds'/);
  assert.match(sql, /prepare_goal_strategy_run_research_stage_start[\s\S]*start_recovery_token = p_start_recovery_token/);
  assert.match(sql, /start_goal_strategy_run_research_stage[\s\S]*flight_start_recovery_token = p_start_recovery_token/);
  assert.match(sql, /recover_goal_strategy_run_research_stage_start[\s\S]*flight_status in \('pending', 'running', 'failed'\)/);
  assert.match(sql, /revoke select, insert, update on public\.goal_strategy_runs from anon, authenticated/);
  assert.doesNotMatch(sql, /grant select \([\s\S]*attempt_id/);
  assert.doesNotMatch(sql, /grant update \([\s\S]*deadline_at/);
});

test("stage fence functions are service-role-only and migration is transactional", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  assert.match(sql, /^begin;/m);
  assert.match(sql, /^commit;/m);
  assert.equal((sql.match(/grant execute on function/g) ?? []).length, 5);
  assert.equal((sql.match(/to service_role;/g) ?? []).length, 5);
  assert.equal((sql.match(/from public, anon, authenticated;/g) ?? []).length, 5);
  assert.equal((sql.match(/grant execute[^\n]+to authenticated;/g) ?? []).length, 0);
});

test("ordinary authenticated inserts exclude every private fence and recovery column", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  const originalSql = await readFile(strategyRunsMigrationUrl, "utf8");
  const insertGrant = sql.match(/grant insert \(([\s\S]*?)\) on public\.goal_strategy_runs to authenticated;/)?.[1];
  assert.ok(insertGrant);
  for (const privateColumn of [
    "flight_attempt_id",
    "flight_deadline_at",
    "flight_start_recovery_token",
    "hotel_attempt_id",
    "hotel_deadline_at",
    "hotel_start_recovery_token",
  ]) {
    assert.equal(insertGrant.includes(privateColumn), false, privateColumn);
  }
  assert.match(insertGrant, /id, goal_id, user_id, signature_version, expires_at, run_signature/);
  assert.match(insertGrant, /flight_status, hotel_status, final_status, updated_at/);
  assert.match(originalSql, /create policy "goal_strategy_runs_insert_own"[\s\S]*user_id = auth\.uid\(\)[\s\S]*goals\.user_id = auth\.uid\(\)/);
  assert.doesNotMatch(sql, /drop policy|disable row level security/);
});
