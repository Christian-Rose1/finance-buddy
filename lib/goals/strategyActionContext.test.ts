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
    getEarningRulesForProducts: async () => [],
    getAwardPriceBenchmarks: async () => [],
    getAirportRegionEntries: async () => [],
    getVerifiedTransferPartners: async () => [],
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

const ownedGoal = {
  id: "owned-goal",
  userId: "authenticated-user",
  type: "travel" as const,
  title: "Paris Summer",
  status: "active" as const,
  origin: ["JFK"],
  destinations: ["CDG"],
  earliestDeparture: "2027-06-01",
  latestReturn: "2027-06-15",
  minimumNights: 10,
  maximumNights: 14,
  travelerCount: 2,
  cabinPreference: "economy" as const,
  optimizationPriority: "balanced" as const,
  maximumCashBudget: 2500,
  currency: "USD",
  allowNewCards: false,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

function fullDeps(
  overrides: Partial<StrategyActionContextDependencies> = {},
): StrategyActionContextDependencies {
  return {
    ...dependencies(
      { data: { user: { id: "authenticated-user" } }, error: null },
      async (goalId, userId) =>
        goalId === "owned-goal" && userId === "authenticated-user" ? ownedGoal : null,
    ),
    ...overrides,
  };
}

test("award-benchmark catalog load failures degrade to empty arrays instead of failing preparation", async () => {
  const deps = fullDeps({
    getAwardPriceBenchmarks: async () => {
      throw new Error("relation \"award_price_benchmarks\" does not exist");
    },
    getAirportRegionEntries: async () => {
      throw new Error("relation \"airport_region_map\" does not exist");
    },
    getVerifiedTransferPartners: async () => {
      throw new Error("relation \"transfer_partners\" does not exist");
    },
  });
  const result = await withStrategyActionContextDependenciesForTest(
    deps,
    () => prepareGoalStrategyContext("owned-goal"),
  );
  assert.equal(result.success, true);
  if (!result.success) return;
  assert.deepEqual(result.prepared.context.awardPriceBenchmarks, []);
  assert.deepEqual(result.prepared.context.airportRegionEntries, []);
  assert.deepEqual(result.prepared.context.verifiedTransferPartners, []);
});

test("successful catalog loads are attached to the context unchanged", async () => {
  const benchmark = {
    id: "benchmark-1",
    rewardProgramId: "program-aeroplan",
    redemptionType: "flight" as const,
    originRegion: "us_domestic" as const,
    destinationRegion: "transatlantic_europe" as const,
    cabin: "economy",
    pricingBasis: "one_way" as const,
    pointsRequired: 30000,
    cashFees: 80,
    currency: "USD",
    travelerCountCovered: 1,
    nightCountCovered: null,
    validFrom: null,
    validUntil: null,
    source: "Sourced fixture",
    lastVerifiedAt: "2026-09-01",
    active: true,
  };
  const deps = fullDeps({
    getAwardPriceBenchmarks: async () => [benchmark],
    getAirportRegionEntries: async () => [],
    getVerifiedTransferPartners: async () => [],
  });
  const result = await withStrategyActionContextDependenciesForTest(
    deps,
    () => prepareGoalStrategyContext("owned-goal"),
  );
  assert.equal(result.success, true);
  if (!result.success) return;
  assert.deepEqual(result.prepared.context.awardPriceBenchmarks, [benchmark]);
});

test("earning-rule load failures still fail preparation (strict, unchanged)", async () => {
  const deps = fullDeps({
    getEarningRulesForProducts: async () => {
      throw new Error("Failed to load earning rules.");
    },
  });
  await assert.rejects(
    withStrategyActionContextDependenciesForTest(
      deps,
      () => prepareGoalStrategyContext("owned-goal"),
    ),
  );
});
