import assert from "node:assert/strict";
import { test } from "node:test";
import type { SavedGoalStrategy } from "./strategyRepository";
import type { PersonalizedStrategy } from "./strategyTypes";
import { persistFinalizedStrategy } from "./finalizedStrategyPersistence";

function strategy(): PersonalizedStrategy {
  return {
    headline: "Planning strategy",
    summary: "Planning guidance.",
    feasibility: "on_track",
    pointsGap: null,
    recommendedAwardOptionId: null,
    recommendedCardOfferId: null,
    flightOptions: [],
    hotelOptions: [],
    actions: [],
    alternatives: [],
    assumptions: [],
    warnings: [],
    followUpQuestions: [],
    pointsInventory: [],
    allocationScenarios: [],
  };
}

function savedEnvelope(): SavedGoalStrategy {
  return {
    goalId: "goal-persisted-result",
    userId: "user-persisted-result",
    strategy: strategy(),
    schemaVersion: 1,
    generatedAt: "2027-02-03T04:05:06.000Z",
    createdAt: "2027-02-03T04:05:06.000Z",
    updatedAt: "2027-02-03T04:05:06.000Z",
  };
}

test("returns the saved strategy and persisted timestamp exactly once", async () => {
  const inputStrategy = strategy();
  const saved = savedEnvelope();
  const inputTimestamp = "2027-01-01T00:00:00.000Z";
  let calls = 0;

  const result = await persistFinalizedStrategy(
    "goal-persisted-result",
    "user-persisted-result",
    inputStrategy,
    inputTimestamp,
    async (goalId, userId, receivedStrategy, receivedTimestamp) => {
      calls += 1;
      assert.equal(goalId, saved.goalId);
      assert.equal(userId, saved.userId);
      assert.equal(receivedStrategy, inputStrategy);
      assert.equal(receivedTimestamp, inputTimestamp);
      return saved;
    },
  );

  assert.equal(calls, 1);
  assert.equal(result.strategy, saved.strategy);
  assert.equal(result.generatedAt, saved.generatedAt);
  assert.notEqual(result.generatedAt, inputTimestamp);
});

test("propagates save failures without substituting the input timestamp", async () => {
  const inputTimestamp = "2027-01-01T00:00:00.000Z";
  await assert.rejects(
    () => persistFinalizedStrategy(
      "goal-persisted-result",
      "user-persisted-result",
      strategy(),
      inputTimestamp,
      async () => { throw new Error("save failed"); },
    ),
    /save failed/,
  );
});
