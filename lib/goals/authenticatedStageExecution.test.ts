import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import type { SupabaseClient } from "@supabase/supabase-js";

import { startVerifiedResearchStageExecution } from "./authenticatedStageExecution";
import { executeVerifiedStageQueries } from "./providerExecutionGateway";
import type { ResearchProvider, ResearchQuery } from "./researchTypes";
import { signStrategyRunPayload } from "./strategyRunSigning";
import type { StrategyResearchStage } from "./strategyRunRepository";
import { buildSavedGoalWebTravelDiscoveryPlan } from "./webTravelDiscoveryPlanner";

const SYNTHETIC_SECRET = "action-stage-test-secret-0123456789ab";
let priorSecret: string | undefined;

before(() => {
  priorSecret = process.env.STRATEGY_RUN_SIGNING_SECRET;
  process.env.STRATEGY_RUN_SIGNING_SECRET = SYNTHETIC_SECRET;
});

after(() => {
  if (priorSecret === undefined) delete process.env.STRATEGY_RUN_SIGNING_SECRET;
  else process.env.STRATEGY_RUN_SIGNING_SECRET = priorSecret;
});

function row(stage: StrategyResearchStage, overrides: Record<string, unknown> = {}) {
  const runId = "owned-run";
  const goalId = "owned-goal";
  const userId = "authenticated-user";
  const expiresAt = (overrides.expires_at as string) ?? new Date(Date.now() + 60_000).toISOString();
  return {
    id: runId,
    goal_id: goalId,
    user_id: userId,
    signature_version: 1,
    expires_at: expiresAt,
    run_signature: signStrategyRunPayload({ version: 1, runId, goalId, userId, expiresAt, stage: "run", payload: "" }),
    flight_status: stage === "hotel" ? "succeeded" : "pending",
    flight_payload: stage === "hotel" ? "{}" : null,
    flight_signature: stage === "hotel"
      ? signStrategyRunPayload({ version: 1, runId, goalId, userId, expiresAt, stage: "flight", payload: "{}" })
      : null,
    hotel_status: "pending",
    hotel_payload: null,
    hotel_signature: null,
    final_status: "pending",
    created_at: "2026-08-27T00:00:00.000Z",
    updated_at: "2026-08-27T00:00:00.000Z",
    ...overrides,
  };
}

function stageClient(
  persistedRow: Record<string, unknown>,
  events: string[],
  failTransition = false,
): SupabaseClient {
  return {
    from: () => {
      let updatePayload: Record<string, unknown> | null = null;
      return {
        select() { return this; },
        eq() { return this; },
        update(value: Record<string, unknown>) { updatePayload = value; return this; },
        maybeSingle() { events.push("owned-run-loaded"); return { data: persistedRow, error: null }; },
        single() {
          events.push("stage-transition-attempted");
          if (failTransition) return { data: null, error: { message: "synthetic" } };
          return { data: { ...persistedRow, ...updatePayload }, error: null };
        },
      };
    },
  } as unknown as SupabaseClient;
}

function provider(events: string[]) {
  const calls: ResearchQuery[] = [];
  const value: ResearchProvider = {
    async search(request) {
      events.push("provider-called");
      calls.push(request);
      return { query: request.query, searchedAt: new Date().toISOString(), results: [] };
    },
  };
  return { calls, value };
}

function discoveryPlan() {
  return buildSavedGoalWebTravelDiscoveryPlan({
    goal: {
      origin: ["DEN"], destinations: ["Paris"], earliestDeparture: "2027-04-03",
      latestReturn: "2027-04-30", minimumNights: 8, maximumNights: 8,
      travelerCount: 2, cabinPreference: "economy", optimizationPriority: "balanced",
    },
    customerRewardPrograms: [{ name: "Chase Ultimate Rewards" }],
    transferPartners: [],
  });
}

for (const stage of ["flight", "hotel"] as const) {
  test(`${stage} action composition starts the verified owned stage before provider execution`, async () => {
    const events: string[] = [];
    const mockProvider = provider(events);
    const persisted = row(stage);
    const execute = await startVerifiedResearchStageExecution(
      persisted.id as string,
      persisted.goal_id as string,
      persisted.user_id as string,
      stage,
      mockProvider.value,
      stageClient(persisted, events),
    );
    assert.deepEqual(events, ["owned-run-loaded", "stage-transition-attempted"]);

    const plan = discoveryPlan();
    const queries = plan.queries.filter((query) => query.category === stage);
    await executeVerifiedStageQueries(execute, plan, queries);
    assert.equal(mockProvider.calls.length, queries.length);
    assert.equal(events.at(-1), "provider-called");
  });
}

test("ownership, integrity, expiry, stage order, and transition failures make zero provider calls", async () => {
  const cases: Array<{
    name: string;
    stage: StrategyResearchStage;
    runId?: string;
    goalId?: string;
    userId?: string;
    overrides?: Record<string, unknown>;
    failTransition?: boolean;
  }> = [
    { name: "wrong run", stage: "flight", runId: "wrong-run" },
    { name: "wrong goal", stage: "flight", goalId: "wrong-goal" },
    { name: "wrong user", stage: "flight", userId: "wrong-user" },
    { name: "expired", stage: "flight", overrides: { expires_at: new Date(Date.now() - 60_000).toISOString() } },
    { name: "invalid signature", stage: "flight", overrides: { run_signature: "0".repeat(64) } },
    { name: "wrong hotel order", stage: "hotel", overrides: { flight_status: "pending", flight_payload: null, flight_signature: null } },
    { name: "failed transition", stage: "flight", failTransition: true },
  ];

  for (const item of cases) {
    const events: string[] = [];
    const mockProvider = provider(events);
    const persisted = row(item.stage, item.overrides);
    await assert.rejects(
      startVerifiedResearchStageExecution(
        item.runId ?? persisted.id as string,
        item.goalId ?? persisted.goal_id as string,
        item.userId ?? persisted.user_id as string,
        item.stage,
        mockProvider.value,
        stageClient(persisted, events, item.failTransition),
      ),
      /Failed to update strategy-run stage\./,
      item.name,
    );
    assert.equal(mockProvider.calls.length, 0, item.name);
  }
});
