import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const executorUrl = new URL("./strategyStageFenceRpcExecutor.ts", import.meta.url);

test("stage fence executor is server-only, service-role configured, and RPC allowlisted", async () => {
  const source = await readFile(executorUrl, "utf8");
  assert.match(source, /import "server-only"/);
  assert.match(source, /process\.env\.SUPABASE_SERVICE_ROLE_KEY/);
  assert.doesNotMatch(source, /NEXT_PUBLIC_[A-Z_]*SERVICE_ROLE/);
  assert.equal((source.match(/"(?:prepare|start|save|recover|fail)_goal_strategy_run_research_stage(?:_start)?"/g) ?? []).length, 10);
  for (const rpc of [
    "prepare_goal_strategy_run_finalization_start",
    "start_goal_strategy_run_finalization",
    "commit_goal_strategy_run_finalization",
    "fail_goal_strategy_run_finalization",
    "recover_goal_strategy_run_finalization_start",
    "delete_owned_goal_strategy",
  ]) assert.equal(source.split(`"${rpc}"`).length - 1, 2, rpc);
  assert.match(source, /ALLOWED_STAGE_FENCE_RPCS\.has\(name\)/);
  assert.match(source, /persistSession: false/);
});
