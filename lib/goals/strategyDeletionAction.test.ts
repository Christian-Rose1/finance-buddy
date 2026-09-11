import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";

import { deleteGoalStrategyAction } from "./strategyActions";
import {
  withStrategyDeletionDependenciesForTest,
  type StrategyDeletionDependencies,
} from "./strategyDeletionDependencies";
import type { StrategyStageFenceRpcExecutor } from "./strategyStageFenceRpcExecutor";

const GENERIC_ERROR = "We couldn't delete your strategy right now. Your saved plan is unchanged.";

function dependencies(options: {
  userId?: string | null;
  authError?: boolean;
  deleteResult?: "success" | "failure";
  calls?: string[];
  observed?: Array<{ goalId: string; userId: string }>;
} = {}): StrategyDeletionDependencies {
  const calls = options.calls ?? [];
  const executor = Object.freeze({ execute: async () => ({ data: "deleted", error: null }) }) as StrategyStageFenceRpcExecutor;
  return {
    createServerClient: async () => ({
      auth: { getUser: async () => {
        calls.push("authenticated");
        return {
          data: { user: options.userId === null ? null : { id: options.userId ?? "session-user" } },
          error: options.authError ? new Error("private auth detail") : null,
        };
      } },
    }) as unknown as SupabaseClient,
    createFenceExecutor: async () => {
      calls.push("executor-created");
      return executor;
    },
    deleteStrategy: async (goalId, userId) => {
      calls.push("delete-called");
      options.observed?.push({ goalId, userId });
      if (options.deleteResult === "failure") throw new Error("private SQL detail");
    },
  };
}

test("deletion authenticates first and derives ownership only from the session", async () => {
  const calls: string[] = [];
  const observed: Array<{ goalId: string; userId: string }> = [];
  const result = await withStrategyDeletionDependenciesForTest(
    dependencies({ userId: "session-owner", calls, observed }),
    () => deleteGoalStrategyAction("owned-goal"),
  );
  assert.deepEqual(result, { success: true });
  assert.deepEqual(calls, ["authenticated", "executor-created", "delete-called"]);
  assert.deepEqual(observed, [{ goalId: "owned-goal", userId: "session-owner" }]);
});

test("unauthenticated and ownership-rejected deletion remain generic", async () => {
  const unauthenticatedCalls: string[] = [];
  const unauthenticated = await withStrategyDeletionDependenciesForTest(
    dependencies({ userId: null, calls: unauthenticatedCalls }),
    () => deleteGoalStrategyAction("owned-goal"),
  );
  assert.deepEqual(unauthenticated, { success: false, message: GENERIC_ERROR });
  assert.deepEqual(unauthenticatedCalls, ["authenticated"]);

  const rejected = await withStrategyDeletionDependenciesForTest(
    dependencies({ deleteResult: "failure" }),
    () => deleteGoalStrategyAction("other-user-goal"),
  );
  assert.deepEqual(rejected, { success: false, message: GENERIC_ERROR });
  assert.equal(JSON.stringify(rejected).includes("SQL"), false);
});

test("failed deletion preserves the displayed strategy and UI uses confirmation with generic errors", async () => {
  const component = await readFile(new URL("../../components/goal-strategy-panel.tsx", import.meta.url), "utf8");
  // Match the complete conditional section on its own line; do not allow the
  // assertion to span unrelated controls elsewhere in the component.
  assert.match(
    component,
    /^[ \t]*\{strategy \? <div className="[^"\r\n]*"><button type="button" onClick=\{handleDelete\} disabled=\{runState\.isGenerating \|\| isDeleting\} className=\{`[^`\r\n]*`\}>\{isDeleting \? <><Loader2 [^<>\r\n]*\/>Deleting…<\/> : <><Trash2 [^<>\r\n]*\/>Delete strategy<\/>\}<\/button><\/div> : null\}[ \t]*$/m,
  );
  assert.match(component, /window\.confirm\([\s\S]*removes the saved plan[\s\S]*build a new plan later/);
  assert.match(component, /if \(!result\.success\) \{[\s\S]*setDeleteError\("We couldn’t delete your strategy right now\. Your saved plan is unchanged\."\)[\s\S]*return;/);
  assert.match(component, /if \(!result\.success\)[\s\S]*return;[\s\S]*setStrategy\(null\)/);
  assert.match(component, /setGeneratedAt\(null\)/);
  assert.match(component, /setRunState\(createInitialStrategyPanelRunState\(\)\)/);
  assert.doesNotMatch(component, /\.from\("goal_strategies"\)|\.rpc\(/);
});
