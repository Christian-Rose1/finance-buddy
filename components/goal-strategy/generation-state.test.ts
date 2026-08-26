import assert from "node:assert/strict";
import { test } from "node:test";
import type {
  PersonalizedStrategy,
  StrategyAwardOption,
} from "../../lib/goals/strategyTypes";
import {
  createGoalStrategyGenerationState,
  goalStrategyGenerationReducer,
  type GoalStrategyGenerationAction,
  type GoalStrategyGenerationState,
} from "./generation-state";

const savedStrategy = {
  headline: "Existing plan",
  summary: "Keep this plan during a rebuild.",
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
} satisfies PersonalizedStrategy;

const flightOption = {
  id: "flight-1",
  sourceId: "https://example.com/flight",
  programName: "Example Miles",
  redemptionType: "flight",
  pricingBasis: "one_way",
  itineraryLabel: "Example route",
  pointsRequired: 25_000,
  cashFees: null,
  seats: null,
  cabin: "economy",
  transferFromProgramId: null,
  transferRatio: null,
  centsPerPoint: null,
  availabilityStatus: "unknown",
} satisfies StrategyAwardOption;

function reduce(
  actions: GoalStrategyGenerationAction[]
): GoalStrategyGenerationState {
  return actions.reduce(
    goalStrategyGenerationReducer,
    createGoalStrategyGenerationState(savedStrategy)
  );
}

test("starting a rebuild clears transient state but preserves the saved strategy", () => {
  const state = reduce([{ type: "generation-started" }]);

  assert.equal(state.strategy, savedStrategy);
  assert.equal(state.isSaved, true);
  assert.equal(state.isGenerating, true);
  assert.equal(state.currentStage, "flight");
  assert.equal(state.flightStatus, "loading");
  assert.equal(state.runId, null);
});

test("soft research failures retain the signed run and continue through later stages", () => {
  const state = reduce([
    { type: "generation-started" },
    {
      type: "flight-soft-failed",
      runId: "run-1",
      message: "Flight research unavailable.",
    },
    { type: "hotel-started" },
    { type: "hotel-soft-failed", message: "Hotel research unavailable." },
    { type: "final-started" },
  ]);

  assert.equal(state.runId, "run-1");
  assert.equal(state.flightStatus, "failed");
  assert.equal(state.hotelStatus, "failed");
  assert.equal(state.finalStatus, "loading");
  assert.equal(state.strategy, savedStrategy);
});

test("retryable final failure preserves previews, strategy, and run ID", () => {
  const state = reduce([
    { type: "generation-started" },
    {
      type: "flight-succeeded",
      runId: "run-1",
      options: [flightOption],
    },
    { type: "hotel-started" },
    { type: "hotel-succeeded", options: [] },
    { type: "final-started" },
    {
      type: "final-failed",
      message: "Provider unavailable.",
      retryable: true,
    },
    { type: "generation-finished" },
  ]);

  assert.equal(state.isGenerating, false);
  assert.equal(state.finalStatus, "failed");
  assert.equal(state.canRetryFinalization, true);
  assert.equal(state.runId, "run-1");
  assert.deepEqual(state.flightOptions, [flightOption]);
  assert.equal(state.strategy, savedStrategy);
});

test("finalization-only retry preserves completed research and the prior strategy", () => {
  const state = reduce([
    { type: "generation-started" },
    {
      type: "flight-succeeded",
      runId: "run-1",
      options: [flightOption],
    },
    { type: "hotel-started" },
    { type: "hotel-succeeded", options: [] },
    { type: "final-started" },
    {
      type: "final-failed",
      message: "Provider unavailable.",
      retryable: true,
    },
    { type: "generation-finished" },
    { type: "final-retry-started" },
  ]);

  assert.equal(state.isGenerating, true);
  assert.equal(state.currentStage, "final");
  assert.equal(state.finalStatus, "loading");
  assert.equal(state.flightStatus, "succeeded");
  assert.equal(state.hotelStatus, "succeeded");
  assert.equal(state.runId, "run-1");
  assert.deepEqual(state.flightOptions, [flightOption]);
  assert.deepEqual(state.hotelOptions, []);
  assert.equal(state.strategy, savedStrategy);
  assert.equal(state.error, null);
});

test("non-retryable final failure discards only the unusable run ID", () => {
  const state = reduce([
    { type: "generation-started" },
    {
      type: "flight-succeeded",
      runId: "run-1",
      options: [flightOption],
    },
    { type: "final-started" },
    {
      type: "final-failed",
      message: "Run expired.",
      retryable: false,
    },
  ]);

  assert.equal(state.runId, null);
  assert.equal(state.canRetryFinalization, false);
  assert.deepEqual(state.flightOptions, [flightOption]);
  assert.equal(state.strategy, savedStrategy);
});

test("successful finalization replaces the strategy and clears stage previews", () => {
  const nextStrategy = { ...savedStrategy, headline: "Fresh plan" };
  const state = reduce([
    { type: "generation-started" },
    {
      type: "flight-succeeded",
      runId: "run-1",
      options: [flightOption],
    },
    { type: "hotel-started" },
    { type: "hotel-succeeded", options: [] },
    { type: "final-started" },
    {
      type: "final-succeeded",
      strategy: nextStrategy,
      saved: true,
      saveMessage: null,
    },
    { type: "generation-finished" },
  ]);

  assert.equal(state.strategy, nextStrategy);
  assert.equal(state.finalStatus, "succeeded");
  assert.equal(state.runId, null);
  assert.equal(state.flightStatus, "idle");
  assert.equal(state.hotelStatus, "idle");
  assert.deepEqual(state.flightOptions, []);
  assert.deepEqual(state.hotelOptions, []);
  assert.equal(state.isGenerating, false);
});
