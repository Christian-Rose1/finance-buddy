import assert from "node:assert/strict";
import { test } from "node:test";

import type { SupabaseClient } from "@supabase/supabase-js";

import { prepareGoalStrategyContext } from "./strategyActionContext";
import { generateGoalFlightStageAction, generateGoalHotelStageAction } from "./strategyActions";
import {
  type StrategyActionContextDependencies,
  withStrategyActionContextDependenciesForTest,
} from "./strategyActionContextDependencies";
import { getStrategyStageActionDependencies } from "./strategyStageActionDependencies";

function dependencies(
  authResult: { data: { user: { id: string } | null }; error: unknown },
  getGoal: StrategyActionContextDependencies["getGoalForUser"],
): StrategyActionContextDependencies {
  const client = { auth: { getUser: async () => authResult } } as unknown as SupabaseClient;
  return {
    createServerClient: async () => client,
    getGoalForUser: getGoal,
    getRewardAccountsForUser: async () => [],
    getWalletCardsForUser: async () => [],
    getPurchasesForUser: async () => [],
    getRewardPrograms: async () => [],
    getCardProducts: async () => [],
  };
}

test("real preparation rejects unauthenticated requests before goal lookup", async () => {
  let goalLoads = 0;
  const deps = dependencies(
    { data: { user: null }, error: { message: "unauthenticated" } },
    async () => { goalLoads += 1; return null; },
  );
  const result = await withStrategyActionContextDependenciesForTest(
    deps,
    () => prepareGoalStrategyContext("owned-goal"),
  );
  assert.equal(result.success, false);
  assert.equal(goalLoads, 0);
});

test("real preparation binds owned-goal lookup to the authenticated user", async () => {
  const loads: Array<[string, string]> = [];
  const deps = dependencies(
    { data: { user: { id: "authenticated-user" } }, error: null },
    async (goalId, userId) => { loads.push([goalId, userId]); return null; },
  );
  const result = await withStrategyActionContextDependenciesForTest(
    deps,
    () => prepareGoalStrategyContext("requested-goal"),
  );
  assert.equal(result.success, false);
  assert.deepEqual(loads, [["requested-goal", "authenticated-user"]]);
});

test("production stage-action defaults use real preparation and accept no browser dependency argument", () => {
  assert.equal(getStrategyStageActionDependencies().prepareContext, prepareGoalStrategyContext);
  assert.equal(generateGoalFlightStageAction.length, 1);
  assert.equal(generateGoalHotelStageAction.length, 2);
});
