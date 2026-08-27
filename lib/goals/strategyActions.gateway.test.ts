import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import type { SupabaseClient } from "@supabase/supabase-js";

import { generateGoalFlightStageAction, generateGoalHotelStageAction } from "./strategyActions";
import type { PreparedGoalStrategyContext } from "./strategyActionContext";
import type { ResearchInterpreter } from "./researchInterpreter";
import type { ResearchProvider, ResearchQuery, ResearchResponse } from "./researchTypes";
import { signStrategyRunPayload } from "./strategyRunSigning";
import { withStrategyStageActionDependenciesForTest } from "./strategyStageActionDependencies";
import { withStrategyFinalizationDependenciesForTest } from "./strategyFinalizationDependencies";
import type { PersonalizedStrategyContext } from "./strategyTypes";

const SECRET = "actual-action-gateway-test-secret-012345";
let priorSecret: string | undefined;

before(() => {
  priorSecret = process.env.STRATEGY_RUN_SIGNING_SECRET;
  process.env.STRATEGY_RUN_SIGNING_SECRET = SECRET;
});
after(() => {
  if (priorSecret === undefined) delete process.env.STRATEGY_RUN_SIGNING_SECRET;
  else process.env.STRATEGY_RUN_SIGNING_SECRET = priorSecret;
});

function context(): PersonalizedStrategyContext {
  return {
    goal: {
      id: "owned-goal", userId: "auth-user", type: "travel", title: "Paris", status: "active",
      origin: ["DEN"], destinations: ["Paris"], earliestDeparture: "2027-04-03",
      latestReturn: "2027-04-30", minimumNights: 8, maximumNights: 8,
      travelerCount: 2, cabinPreference: "economy", optimizationPriority: "balanced",
      maximumCashBudget: null, currency: "USD", allowNewCards: false,
      createdAt: "2026-08-01T00:00:00.000Z", updatedAt: "2026-08-01T00:00:00.000Z",
    },
    rewardAccounts: [{
      id: "account", userId: "auth-user", rewardProgramId: "program", ownerKey: "self",
      ownerLabel: "Self", ownerType: "self", balance: 0, balanceAsOf: "2026-08-01",
      origin: "manual", verificationStatus: "unverified",
      createdAt: "2026-08-01T00:00:00.000Z", updatedAt: "2026-08-01T00:00:00.000Z",
    }], walletCards: [], monthlySpendingByCategory: [], awardOptions: [],
    cardOffers: [], sources: [], generatedAt: "2026-08-01T00:00:00.000Z",
  };
}

class RunDatabase {
  row: Record<string, unknown> | null = null;
  events: string[] = [];
  failNextRunningTransition = false;

  client = {
    from: () => {
      let operation: "read" | "insert" | "update" = "read";
      let payload: Record<string, unknown> = {};
      const filters: Array<[string, unknown]> = [];
      const builder = {
        insert: (value: Record<string, unknown>) => { operation = "insert"; payload = value; return builder; },
        update: (value: Record<string, unknown>) => { operation = "update"; payload = value; return builder; },
        select: () => builder,
        eq: (field: string, value: unknown) => { filters.push([field, value]); return builder; },
        maybeSingle: () => {
          this.events.push("run-loaded");
          return { data: this.matches(filters) ? { ...this.row } : null, error: null };
        },
        single: () => {
          if (operation === "insert") {
            this.events.push("run-created");
            this.row = {
              ...payload, flight_payload: null, flight_signature: null,
              hotel_payload: null, hotel_signature: null,
              created_at: payload.updated_at,
            };
            return { data: { ...this.row }, error: null };
          }
          if (!this.matches(filters)) return { data: null, error: { message: "no match" } };
          if (this.failNextRunningTransition && Object.values(payload).includes("running")) {
            this.failNextRunningTransition = false;
            this.events.push("transition-rejected");
            return { data: null, error: { message: "conflict" } };
          }
          const status = Object.values(payload).find((value) =>
            value === "running" || value === "succeeded" || value === "failed"
          );
          this.events.push(status === "running" ? "stage-running" : status === "succeeded" ? "stage-saved" : "stage-failed");
          this.row = { ...this.row, ...payload };
          return { data: { ...this.row }, error: null };
        },
      };
      return builder;
    },
  } as unknown as SupabaseClient;

  private matches(filters: Array<[string, unknown]>): boolean {
    if (!this.row) return false;
    return filters.every(([field, value]) => this.row?.[field] === value);
  }
}

function prepared(db: RunDatabase): PreparedGoalStrategyContext {
  return {
    supabase: db.client, userId: "auth-user", context: context(), customerRewardPrograms: [],
    catalogRewardPrograms: [{ id: "program", name: "Chase Ultimate Rewards" }],
  };
}

function mocks(db: RunDatabase, fail: (index: number) => boolean = () => false) {
  const calls: ResearchQuery[] = [];
  const interpreted: ResearchResponse[][] = [];
  const provider: ResearchProvider = {
    async search(query) {
      const index = calls.length;
      calls.push(query);
      db.events.push("provider-called");
      if (fail(index)) throw new Error("synthetic provider failure");
      return { query: query.query, searchedAt: new Date().toISOString(), results: [] };
    },
  };
  const interpreter: ResearchInterpreter = {
    async interpret(input) {
      interpreted.push(input.research);
      return { awardOptions: [], cardOffers: [], sources: [], assumptions: [], warnings: [] };
    },
  };
  return {
    calls, interpreted,
    dependencies: {
      prepareContext: async () => {
        db.events.push("authenticated-goal-loaded");
        return { success: true as const, prepared: prepared(db) };
      },
      createProvider: () => provider,
      createInterpreter: () => interpreter,
    },
  };
}

test("actual flight then hotel actions create, transition, execute, and save in order", async () => {
  const db = new RunDatabase();
  const mock = mocks(db);
  await withStrategyStageActionDependenciesForTest(mock.dependencies, async () => {
    const flight = await generateGoalFlightStageAction("owned-goal");
    assert.equal(flight.success && flight.stageStatus, "succeeded");
    assert.deepEqual(db.events.slice(0, 5), [
      "authenticated-goal-loaded", "run-created", "run-loaded", "stage-running", "provider-called",
    ]);
    assert.equal(db.events.filter((event) => event === "stage-saved").length, 1);
    assert.equal(new Set(mock.calls.map((call) => call.query)).size, mock.calls.length);

    const runId = flight.success ? flight.runId : "";
    const beforeHotel = db.events.length;
    const hotel = await generateGoalHotelStageAction("owned-goal", runId);
    assert.equal(hotel.success && hotel.stageStatus, "succeeded");
    assert.deepEqual(db.events.slice(beforeHotel, beforeHotel + 4), [
      "authenticated-goal-loaded", "run-loaded", "run-loaded", "stage-running",
    ]);
    assert.equal(db.events.filter((event) => event === "stage-saved").length, 2);
  });
});

test("actual action partial failures retain siblings; all failures mark once without retry", async () => {
  const partialDb = new RunDatabase();
  const partial = mocks(partialDb, (index) => index === 1);
  await withStrategyStageActionDependenciesForTest(partial.dependencies, async () => {
    const result = await generateGoalFlightStageAction("owned-goal");
    assert.equal(result.success && result.stageStatus, "succeeded");
  });
  assert.equal(partial.calls.length, 2);
  assert.equal(partial.interpreted[0]?.length, 1);
  assert.equal(partialDb.events.includes("stage-failed"), false);

  const failedDb = new RunDatabase();
  const failed = mocks(failedDb, () => true);
  await withStrategyStageActionDependenciesForTest(failed.dependencies, async () => {
    const result = await generateGoalFlightStageAction("owned-goal");
    assert.equal(result.success && result.stageStatus, "failed");
  });
  assert.equal(failed.calls.length, 2);
  assert.equal(failedDb.events.filter((event) => event === "stage-failed").length, 1);
  assert.equal(failedDb.events.includes("stage-saved"), false);
});

test("actual hotel all-query failure marks failed once without retry", async () => {
  const db = new RunDatabase();
  let fail = false;
  const mock = mocks(db, () => fail);
  await withStrategyStageActionDependenciesForTest(mock.dependencies, async () => {
    const flight = await generateGoalFlightStageAction("owned-goal");
    assert.equal(flight.success && flight.stageStatus, "succeeded");
    const runId = flight.success ? flight.runId : "";
    const callsBeforeHotel = mock.calls.length;
    const failuresBeforeHotel = db.events.filter((event) => event === "stage-failed").length;
    fail = true;
    const hotel = await generateGoalHotelStageAction("owned-goal", runId);
    assert.equal(hotel.success && hotel.stageStatus, "failed");
    assert.equal(mock.calls.length - callsBeforeHotel, 2);
    assert.equal(db.events.filter((event) => event === "stage-failed").length - failuresBeforeHotel, 1);
  });
});

test("actual actions make zero provider calls across authentication and run-boundary failures", async () => {
  for (const reason of ["wrong user", "wrong goal"] as const) {
    const db = new RunDatabase();
    const mock = mocks(db);
    const deps = { ...mock.dependencies, prepareContext: async () => ({ success: false as const, message: reason }) };
    await withStrategyStageActionDependenciesForTest(deps, () => generateGoalFlightStageAction("owned-goal"));
    assert.equal(mock.calls.length, 0, reason);
  }

  for (const reason of ["missing", "invalid-signature", "expired", "wrong-order", "transition"] as const) {
    const db = new RunDatabase();
    const mock = mocks(db);
    const expiresAt = reason === "expired" ? new Date(Date.now() - 60_000).toISOString() : new Date(Date.now() + 60_000).toISOString();
    db.row = {
      id: "existing-run", goal_id: "owned-goal", user_id: "auth-user", signature_version: 1,
      expires_at: expiresAt,
      run_signature: reason === "invalid-signature" ? "0".repeat(64) : signStrategyRunPayload({ version: 1, runId: "existing-run", goalId: "owned-goal", userId: "auth-user", expiresAt, stage: "run", payload: "" }),
      flight_status: reason === "wrong-order" ? "pending" : "failed", flight_payload: null, flight_signature: null,
      hotel_status: "pending", hotel_payload: null, hotel_signature: null, final_status: "pending",
      created_at: "2026-08-01T00:00:00.000Z", updated_at: "2026-08-01T00:00:00.000Z",
    };
    if (reason === "missing") db.row = null;
    if (reason === "transition") db.failNextRunningTransition = true;
    await withStrategyStageActionDependenciesForTest(mock.dependencies, () =>
      generateGoalHotelStageAction("owned-goal", "existing-run")
    );
    assert.equal(mock.calls.length, 0, reason);
  }
});
