import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  generateFlightResearchStage,
  generateHotelResearchStage,
  shouldRunOptionalCardResearch,
  type StagedResearchDependencies,
} from "./automatedStrategyPlanner";
import { ResearchInterpreterError, type ResearchInterpreter } from "./researchInterpreter";
import { buildResearchPlannerInput } from "./researchPlannerInputBuilder";
import {
  buildSavedGoalWebTravelDiscoveryPlan,
  toSavedGoalWebDiscoveryInput,
} from "./webTravelDiscoveryPlanner";
import type { ResearchResponse } from "./researchTypes";
import type { ResearchProvider } from "./researchTypes";
import type { PersonalizedStrategyContext } from "./strategyTypes";
import { createProviderExecutionGateway, type VerifiedStageQueryExecutor } from "./providerExecutionGateway";
import { startGoalStrategyRunStage, type StrategyResearchStage } from "./strategyRunRepository";
import { signStrategyRunPayload } from "./strategyRunSigning";

const CATALOG = [{ id: "program-db-id", name: "Chase Ultimate Rewards" }];
const SECRET = "planner-gateway-test-secret-0123456789";
let priorSecret: string | undefined;
before(() => { priorSecret = process.env.STRATEGY_RUN_SIGNING_SECRET; process.env.STRATEGY_RUN_SIGNING_SECRET = SECRET; });
after(() => { if (priorSecret === undefined) delete process.env.STRATEGY_RUN_SIGNING_SECRET; else process.env.STRATEGY_RUN_SIGNING_SECRET = priorSecret; });

function context(): PersonalizedStrategyContext {
  return {
    goal: {
      id: "goal-db-id",
      userId: "user-db-id",
      type: "travel",
      title: "Paris Trip",
      status: "active",
      origin: ["DEN"],
      destinations: ["Paris"],
      earliestDeparture: "2027-04-03",
      latestReturn: "2027-04-30",
      minimumNights: 8,
      maximumNights: 16,
      travelerCount: 2,
      cabinPreference: "economy",
      optimizationPriority: "balanced",
      maximumCashBudget: 2000,
      currency: "USD",
      allowNewCards: false,
      createdAt: "2026-08-01T00:00:00.000Z",
      updatedAt: "2026-08-01T00:00:00.000Z",
    },
    rewardAccounts: [{
      id: "account-db-id",
      userId: "user-db-id",
      rewardProgramId: "program-db-id",
      ownerKey: "owner-key",
      ownerLabel: "Customer Name",
      ownerType: "self",
      balance: 80000,
      balanceAsOf: "2026-08-01T00:00:00.000Z",
      origin: "manual",
      verificationStatus: "verified",
      createdAt: "2026-08-01T00:00:00.000Z",
      updatedAt: "2026-08-01T00:00:00.000Z",
    }],
    walletCards: [],
    monthlySpendingByCategory: [{ category: "dining", monthlyAverage: 900 }],
    awardOptions: [],
    cardOffers: [],
    sources: [{ id: "source-db-id", label: "https://private.example/raw-content", status: "catalog", observedAt: null }],
    generatedAt: "2026-08-01T00:00:00.000Z",
  };
}

function response(query: string): ResearchResponse {
  return { query, results: [], searchedAt: "2026-08-01T00:00:00.000Z" };
}

async function dependencies(stage: StrategyResearchStage, fail: (query: string) => boolean = () => false) {
  const calls: string[] = [];
  const interpretedResearch: ResearchResponse[][] = [];
  const provider: ResearchProvider = {
    async search(query) {
      calls.push(query.query);
      if (fail(query.query)) throw new Error("synthetic failure");
      return response(query.query);
    },
  };
  const expiresAt = new Date(Date.now() + 60_000).toISOString();
  const row = {
    id: `run-${stage}`, goal_id: "goal-db-id", user_id: "user-db-id", signature_version: 1,
    expires_at: expiresAt,
    run_signature: signStrategyRunPayload({ version: 1, runId: `run-${stage}`, goalId: "goal-db-id", userId: "user-db-id", expiresAt, stage: "run", payload: "" }),
    flight_status: stage === "hotel" ? "failed" : "pending", flight_payload: null, flight_signature: null,
    hotel_status: "pending", hotel_payload: null, hotel_signature: null, final_status: "pending",
    created_at: "2026-08-01T00:00:00.000Z", updated_at: "2026-08-01T00:00:00.000Z",
  };
  const client = { from: () => { let update: Record<string, unknown> = {}; return {
    select() { return this; }, eq() { return this; }, update(value: Record<string, unknown>) { update = value; return this; },
    maybeSingle() { return { data: row, error: null }; }, single() { return { data: { ...row, ...update }, error: null }; },
  }; } } as unknown as SupabaseClient;
  const running = await startGoalStrategyRunStage(row.id, row.goal_id, row.user_id, stage, client);
  const executor = createProviderExecutionGateway(running, provider);
  const interpreter: ResearchInterpreter = {
    async interpret(input) {
      interpretedResearch.push(input.research);
      return { awardOptions: [], cardOffers: [], sources: [], assumptions: [], warnings: [] };
    },
  };
  return { calls, interpretedResearch, dependencies: { executor, interpreter } satisfies StagedResearchDependencies };
}

function selectedQueries(kind: "flight" | "hotel", value = context()): string[] {
  return buildSavedGoalWebTravelDiscoveryPlan(
    toSavedGoalWebDiscoveryInput(buildResearchPlannerInput(value, CATALOG)),
  ).queries.filter((query) => query.category === kind).map((query) => query.query);
}

test("initial finalization may perform optional card research", () => {
  assert.equal(shouldRunOptionalCardResearch("initial"), true);
});

test("finalization retry skips planning, searches, and card interpretation", () => {
  assert.equal(shouldRunOptionalCardResearch("retry"), false);
});

for (const [label, stage, kind] of [
  ["flight", generateFlightResearchStage, "flight"],
  ["hotel", generateHotelResearchStage, "hotel"],
] as const) {
  test(`${label} stage executes each selected saved-goal query once`, async () => {
    const mock = await dependencies(kind);
    const value = context();
    await stage(value, CATALOG, mock.dependencies);

    assert.deepEqual(mock.calls, selectedQueries(kind, value));
    assert.equal(new Set(mock.calls).size, mock.calls.length);
    assert.equal(mock.interpretedResearch[0].length, mock.calls.length);
  });

  test(`${label} stage retains successful siblings when one selected query fails without repeating it`, async () => {
    const planned = selectedQueries(kind);
    const mock = await dependencies(kind, (query) => query === planned[1]);
    await stage(context(), CATALOG, mock.dependencies);

    assert.deepEqual(mock.calls, planned);
    assert.equal(mock.calls.filter((query) => query === planned[1]).length, 1);
    assert.deepEqual(mock.interpretedResearch[0].map((item) => item.query), [planned[0]]);
  });

  test(`${label} stage uses the established safe research failure when every query fails`, async () => {
    const planned = selectedQueries(kind);
    const mock = await dependencies(kind, () => true);

    await assert.rejects(
      stage(context(), CATALOG, mock.dependencies),
      (error: unknown) => error instanceof ResearchInterpreterError,
    );
    assert.deepEqual(mock.calls, planned);
    assert.equal(mock.interpretedResearch.length, 0);
  });
}

test("runtime-corrupted priority uses the balanced saved-goal plan through the staged path", async () => {
  const value = context();
  (value.goal as unknown as { optimizationPriority: unknown }).optimizationPriority = "legacy-priority";
  const sanitized = buildResearchPlannerInput(value, CATALOG);
  const expected = buildSavedGoalWebTravelDiscoveryPlan(toSavedGoalWebDiscoveryInput(sanitized));
  const mock = await dependencies("flight");

  await generateFlightResearchStage(value, CATALOG, mock.dependencies);

  assert.deepEqual(
    mock.calls,
    expected.queries.filter((query) => query.category === "flight").map((query) => query.query),
  );
});

test("real sanitized planner input and resulting plan exclude sensitive research data", () => {
  const sanitized = buildResearchPlannerInput(context(), CATALOG);
  const webInput = toSavedGoalWebDiscoveryInput(sanitized);
  const plan = buildSavedGoalWebTravelDiscoveryPlan(webInput);
  const serializedInput = JSON.stringify(webInput);
  const serializedPlan = JSON.stringify(plan);

  for (const forbidden of [
    "goal-db-id", "user-db-id", "account-db-id", "program-db-id", "owner-key",
    "Customer Name", "80000", "dining", "900", "https://private.example/raw-content",
    "raw-content", "provider payload", "signature", "secret",
  ]) {
    assert.ok(!serializedInput.includes(forbidden), `planner input must not expose ${forbidden}`);
    assert.ok(!serializedPlan.includes(forbidden), `plan must not expose ${forbidden}`);
  }
});

test("staged flight and hotel planners have no capability-free execution path", async () => {
  for (const [stage, fake] of [
    [generateFlightResearchStage, {}],
    [generateHotelResearchStage, async () => []],
  ] as const) {
    let planningTouched = false;
    const untouchedContext = new Proxy(context(), {
      get() {
        planningTouched = true;
        throw new Error("planning must not begin");
      },
    });
    await assert.rejects(
      stage(untouchedContext, CATALOG, { executor: fake as unknown as VerifiedStageQueryExecutor }),
      (error: unknown) => error instanceof ResearchInterpreterError,
    );
    assert.equal(planningTouched, false);
  }
});
