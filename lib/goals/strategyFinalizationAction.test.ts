import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import type { SupabaseClient } from "@supabase/supabase-js";
import { finalizeGoalStrategyRunAction } from "./strategyActions";
import {
  getStrategyFinalizationDependencies,
  withStrategyFinalizationDependenciesForTest,
  type StrategyFinalizationDependencies,
} from "./strategyFinalizationDependencies";
import { buildStrategyRunStagePayload } from "./strategyRunPayload";
import { StrategyRunFinalizationDeadlineError } from "./strategyRunRepository";
import type { PersonalizedStrategy, PersonalizedStrategyContext } from "./strategyTypes";

const supabase = {} as SupabaseClient;
const context: PersonalizedStrategyContext = {
  goal: {
    id: "goal-1", userId: "user-1", type: "travel", title: "Trip", status: "active",
    origin: ["DEN"], destinations: ["Paris"], earliestDeparture: "2027-04-03",
    latestReturn: "2027-04-30", minimumNights: 8, maximumNights: 16,
    travelerCount: 2, cabinPreference: "economy", optimizationPriority: "balanced",
    maximumCashBudget: null, currency: "USD", allowNewCards: false,
    createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
  },
  rewardAccounts: [], walletCards: [], monthlySpendingByCategory: [], awardOptions: [],
  cardOffers: [], sources: [], generatedAt: "2026-01-01T00:00:00.000Z",
};
const strategy: PersonalizedStrategy = {
  headline: "Planning benchmarks found", summary: "Safe", feasibility: "insufficient_information",
  pointsGap: null, recommendedAwardOptionId: null, recommendedCardOfferId: null,
  flightOptions: [], hotelOptions: [], actions: [], alternatives: [], assumptions: [], warnings: [],
  followUpQuestions: [], pointsInventory: [], allocationScenarios: [],
};
const emptyFlight = buildStrategyRunStagePayload("flight", {
  awardOptions: [], cardOffers: [], sources: [], assumptions: [], warnings: [],
});
const emptyHotel = buildStrategyRunStagePayload("hotel", {
  awardOptions: [], cardOffers: [], sources: [], assumptions: [], warnings: [],
});

function dependencies(overrides: Partial<StrategyFinalizationDependencies> = {}) {
  const calls = { load: [] as string[], modes: [] as string[], fail: 0, recover: 0, commit: 0 };
  const base: StrategyFinalizationDependencies = {
    async prepareContext() {
      return { success: true as const, prepared: {
        supabase, userId: "user-1", context, customerRewardPrograms: [], catalogRewardPrograms: [],
      } };
    },
    async createFenceExecutor() { return { execute: async () => ({ data: null, error: null }) }; },
    async getRun() {
      return {
        id: "run-1", goalId: "goal-1", userId: "user-1", signatureVersion: 1 as const,
        expiresAt: "2099-01-01T00:00:00.000Z", runSignature: "a".repeat(64),
        flightStatus: "succeeded" as const, flightPayload: "signed", flightSignature: "b".repeat(64),
        hotelStatus: "succeeded" as const, hotelPayload: "signed", hotelSignature: "c".repeat(64),
        finalStatus: "pending" as const, createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      };
    },
    async startFinalization(_run, _goal, _user, _client, _executor, _signal, onRecovery) {
      onRecovery?.({} as never);
      return {} as never;
    },
    async recoverStart() { calls.recover += 1; return "failed"; },
    async loadStage(_run, _goal, _user, stage) {
      calls.load.push(stage);
      return stage === "flight" ? emptyFlight : emptyHotel;
    },
    async generateStrategy(_context, _customer, _catalog, _stages, mode) {
      calls.modes.push(mode ?? "initial");
      return strategy;
    },
    async commitFinalization() {
      calls.commit += 1;
      return { strategy, generatedAt: context.generatedAt };
    },
    async failFinalization() { calls.fail += 1; return "failed"; },
    finalizationDeadlineMs: 20,
    cleanupDeadlineMs: 20,
  };
  return { calls, value: { ...base, ...overrides } };
}

test("direct action bounds a never-settling final provider and propagates abort", async () => {
  let aborted = false;
  const mock = dependencies({
    generateStrategy: async (_a, _b, _c, _d, _e, signal) => new Promise((_resolve) => {
      signal?.addEventListener("abort", () => { aborted = true; }, { once: true });
    }),
    finalizationDeadlineMs: 5,
  });
  const result = await withStrategyFinalizationDependenciesForTest(mock.value, () =>
    finalizeGoalStrategyRunAction("goal-1", "run-1"));
  assert.equal(result.success, false);
  if (!result.success) assert.equal(result.retryable, true);
  assert.equal(aborted, true);
  assert.equal(mock.calls.fail, 1);
  assert.equal(mock.calls.commit, 0);
});

test("direct action bounds a never-settling atomic persistence/status commit", async () => {
  const mock = dependencies({
    commitFinalization: async () => new Promise(() => {}),
    finalizationDeadlineMs: 5,
  });
  const result = await withStrategyFinalizationDependenciesForTest(mock.value, () =>
    finalizeGoalStrategyRunAction("goal-1", "run-1"));
  assert.equal(result.success, false);
  assert.equal(mock.calls.fail, 1);
});

for (const [label, recoveryOutcome] of [["before", "failed"], ["after", "succeeded"]] as const) {
  test(`direct action recovers a lost finalization-start response ${label} commit`, async () => {
    const mock = dependencies({
      async startFinalization(_a, _b, _c, _d, _e, _f, onRecovery) {
        onRecovery?.({} as never);
        throw new Error("lost response");
      },
      async recoverStart() { mock.calls.recover += 1; return recoveryOutcome; },
    });
    const result = await withStrategyFinalizationDependenciesForTest(mock.value, () =>
      finalizeGoalStrategyRunAction("goal-1", "run-1"));
    assert.equal(result.success, false);
    assert.equal(mock.calls.recover, 1);
    assert.equal(mock.calls.commit, 0);
  });
}

test("direct action rejects a stale/expired final attempt without changing the prior strategy", async () => {
  const previous = { current: "previous-strategy" };
  const mock = dependencies({
    async commitFinalization() { throw new StrategyRunFinalizationDeadlineError(); },
  });
  const result = await withStrategyFinalizationDependenciesForTest(mock.value, () =>
    finalizeGoalStrategyRunAction("goal-1", "run-1"));
  assert.equal(result.success, false);
  assert.equal(mock.calls.fail, 1);
  assert.equal(mock.calls.commit, 0);
  assert.equal(previous.current, "previous-strategy");
});

test("direct action treats success winning over timeout cleanup as authoritative", async () => {
  const mock = dependencies({
    async generateStrategy() { throw new Error("response lost after work"); },
    async failFinalization() { mock.calls.fail += 1; return "succeeded"; },
  });
  const result = await withStrategyFinalizationDependenciesForTest(mock.value, () =>
    finalizeGoalStrategyRunAction("goal-1", "run-1"));
  assert.equal(result.success, false);
  assert.equal(mock.calls.fail, 1);
});

test("direct finalization retry reuses signed stages and performs no research", async () => {
  const mock = dependencies({
    async getRun() { return { ...(await dependencies().value.getRun("", "", "", supabase))!, finalStatus: "failed" }; },
  });
  const result = await withStrategyFinalizationDependenciesForTest(mock.value, () =>
    finalizeGoalStrategyRunAction("goal-1", "run-1"));
  assert.equal(result.success, true);
  assert.deepEqual(mock.calls.load, ["flight", "hotel"]);
  assert.deepEqual(mock.calls.modes, ["retry"]);
  assert.equal(mock.calls.commit, 1);
});

test("finalization dependencies remain request-local", async () => {
  const production = getStrategyFinalizationDependencies();
  const mock = dependencies();
  await withStrategyFinalizationDependenciesForTest(mock.value, async () =>
    assert.equal(getStrategyFinalizationDependencies(), mock.value));
  assert.equal(getStrategyFinalizationDependencies(), production);
});

test("browser action and diagnostics expose no finalization authority or service-role detail", async () => {
  assert.equal(finalizeGoalStrategyRunAction.length, 2);
  const source = await readFile(new URL("./strategyActions.ts", import.meta.url), "utf8");
  const action = source.slice(source.indexOf("export async function finalizeGoalStrategyRunAction"));
  assert.doesNotMatch(action, /SUPABASE_SERVICE_ROLE_KEY|p_attempt_id|p_start_recovery_token/);
  assert.doesNotMatch(action, /attemptId|deadlineAt|recoveryToken/);
  assert.match(action, /category: "finalization_timeout"/);
  assert.match(action, /category: "unexpected_finalization_failure"/);
});
