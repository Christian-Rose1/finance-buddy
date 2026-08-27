import assert from "node:assert/strict";
import { test } from "node:test";

import {
  unavailableFollowUpTopics,
  validateStrategyOutput,
} from "./strategyProviderCore";

const goal = {
  origin: ["DEN"],
  destinations: ["Paris"],
  earliestDeparture: "2027-04-03",
  latestReturn: "2027-04-30",
  minimumNights: 8,
  maximumNights: 16,
  travelerCount: 2,
  cabinPreference: "economy",
};

function narrative(followUpTopics: unknown) {
  return {
    headline: "Grounded plan",
    summary: "Use only the cited planning benchmarks and verify before booking.",
    feasibility: "insufficient_information",
    pointsGap: null,
    recommendedAwardOptionId: null,
    recommendedCardOfferId: null,
    actions: [],
    alternatives: [],
    assumptions: [],
    warnings: ["Verify availability, transfer terms, and cash amounts before booking."],
    followUpTopics,
  };
}

test("server materializes allowlisted decision topics instead of model prose", () => {
  const result = validateStrategyOutput(narrative(["layover_tolerance", "room_preference"]), {
    awardOptions: [], cardOffers: [], sources: [], goal: { allowNewCards: false },
  }, "test", "test-model");
  assert.deepEqual(result.followUpQuestions, [
    "What is the longest layover you would accept?",
    "Do you need a specific room type or bedding arrangement?",
  ]);
});

test("legacy question prose cannot invalidate a complete plan", () => {
  const result = validateStrategyOutput({
    ...narrative([]),
    followUpQuestions: ["When should I book?", "Is there a direct route?", "Is economy available?", "Can we split into 2 reservations?"],
  }, {
    awardOptions: [],
    cardOffers: [],
    sources: [],
    goal: { allowNewCards: false },
  }, "test", "test-model");
  assert.deepEqual(result.followUpQuestions, []);
  assert.deepEqual(result.warnings, ["Verify availability, transfer terms, and cash amounts before booking."]);
});

test("an empty legacy followUpQuestions field does not alter an otherwise valid narrative", () => {
  const result = validateStrategyOutput({
    ...narrative([]),
    followUpQuestions: [],
  }, {
    awardOptions: [], cardOffers: [], sources: [], goal: { allowNewCards: false },
  }, "test", "test-model");
  assert.deepEqual(result.followUpQuestions, []);
  assert.deepEqual(result.warnings, ["Verify availability, transfer terms, and cash amounts before booking."]);
});

test("unknown, duplicate, and already-known topics are dropped without customer warnings", () => {
  const result = validateStrategyOutput(narrative([
    "layover_tolerance", "layover_tolerance", "not_a_topic", "cash_vs_points_preference",
  ]), {
    awardOptions: [], cardOffers: [], sources: [], goal: { allowNewCards: false },
    unavailableFollowUpTopics: new Set(["cash_vs_points_preference"]),
  }, "test", "test-model");
  assert.deepEqual(result.followUpQuestions, ["What is the longest layover you would accept?"]);
  assert.deepEqual(result.warnings, ["Verify availability, transfer terms, and cash amounts before booking."]);
});

test("customer-visible model prose with internal references is discarded whole at validation", () => {
  const result = validateStrategyOutput({
    ...narrative([]),
    headline: "Book award-1 now. Keep the saved plan.",
    summary: "Redeem card-2 and cash-3 for the trip. Safe summary line.",
    actions: [{
      priority: 1,
      title: "Check award-8",
      explanation: "See source-4 details.",
      deadline: null,
      sourceIds: [],
    }],
    alternatives: [{
      title: "scenario-5 path",
      tradeoff: "A safe tradeoff.",
      sourceIds: [],
    }],
    assumptions: ["Plan around award-9.", "Balances are current as of the as-of date."],
    warnings: ["Verify before acting."],
  }, {
    awardOptions: [], cardOffers: [], sources: [], goal: { allowNewCards: false },
  }, "test", "test-model");

  // Complete unsafe sentences are dropped, never fragmented.
  assert.equal(result.headline, "Keep the saved plan.");
  assert.equal(result.summary, "Safe summary line.");
  // Actions/alternatives whose titles are entirely unsafe are removed whole.
  assert.deepEqual(result.actions, []);
  assert.deepEqual(result.alternatives, []);
  assert.deepEqual(result.assumptions, ["Balances are current as of the as-of date."]);
  assert.deepEqual(result.warnings, ["Verify before acting."]);
});

test("fully unsafe headline and summary receive fixed neutral fallbacks", () => {
  const result = validateStrategyOutput({
    ...narrative([]),
    headline: "See source-1 for details.",
    summary: "Redeem award-2 for the trip.",
  }, {
    awardOptions: [], cardOffers: [], sources: [], goal: { allowNewCards: false },
  }, "test", "test-model");

  assert.equal(result.headline, "Your planning strategy");
  assert.equal(result.summary, "Planning guidance based on your saved goal.");
});

test("cautionary sentences containing live, bookable, guaranteed, or exact survive syntactic filtering", () => {
  const result = validateStrategyOutput({
    ...narrative([]),
    headline: "No live availability was verified. Exact dates were not confirmed.",
    summary: "This planning estimate is not bookable. See the estimates below.",
    assumptions: ["No refund is guaranteed until booking is verified."],
    warnings: ["Exact trip fit was not confirmed."],
  }, {
    awardOptions: [], cardOffers: [], sources: [], goal: { allowNewCards: false },
  }, "test", "test-model");

  assert.equal(result.headline, "No live availability was verified. Exact dates were not confirmed.");
  assert.equal(result.summary, "This planning estimate is not bookable. See the estimates below.");
  assert.deepEqual(result.assumptions, ["No refund is guaranteed until booking is verified."]);
  assert.deepEqual(result.warnings, ["Exact trip fit was not confirmed."]);
});

test("actions lose their complete form when title or explanation is emptied", () => {
  const result = validateStrategyOutput({
    ...narrative([]),
    headline: "Safe headline.",
    summary: "Safe summary.",
    actions: [
      { priority: 1, title: "Check award-8", explanation: "A safe explanation.", deadline: null, sourceIds: [] },
      { priority: 2, title: "A safe title", explanation: "See source-4 details.", deadline: null, sourceIds: [] },
      { priority: 3, title: "Keep this action", explanation: "Keep this explanation.", deadline: null, sourceIds: [] },
    ],
  }, {
    awardOptions: [], cardOffers: [], sources: [], goal: { allowNewCards: false },
  }, "test", "test-model");

  assert.deepEqual(result.actions, [{ priority: 3, title: "Keep this action", explanation: "Keep this explanation.", deadline: null, sourceIds: [] }]);
});

test("alternatives lose their complete form when title or tradeoff is emptied", () => {
  const result = validateStrategyOutput({
    ...narrative([]),
    headline: "Safe headline.",
    summary: "Safe summary.",
    alternatives: [
      { title: "scenario-5 path", tradeoff: "A safe tradeoff.", sourceIds: [] },
      { title: "A safe title", tradeoff: "card-2 tradeoff details.", sourceIds: [] },
      { title: "Keep this alternative", tradeoff: "Keep this tradeoff.", sourceIds: [] },
    ],
  }, {
    awardOptions: [], cardOffers: [], sources: [], goal: { allowNewCards: false },
  }, "test", "test-model");

  assert.deepEqual(result.alternatives, [{ title: "Keep this alternative", tradeoff: "Keep this tradeoff.", sourceIds: [] }]);
});

test("server-generated finalization warnings are not treated as model prose", () => {
  const result = validateStrategyOutput({
    ...narrative([]),
    recommendedAwardOptionId: "fabricated-award-id",
    headline: "Safe headline.",
    summary: "Safe summary.",
  }, {
    awardOptions: [], cardOffers: [], sources: [], goal: { allowNewCards: false },
  }, "test", "test-model");

  assert.equal(result.recommendedAwardOptionId, null);
  assert.ok(result.warnings.some((warning) => warning.includes("fabricated-award-id")));
  assert.equal(result.headline, "Safe headline.");
});

test("cash-versus-points topic is retained unless lowest cash is already the saved priority", () => {
  const retained = validateStrategyOutput(narrative(["cash_vs_points_preference"]), {
    awardOptions: [],
    cardOffers: [],
    sources: [],
    goal: { allowNewCards: false },
    unavailableFollowUpTopics: unavailableFollowUpTopics({ goal: { optimizationPriority: "balanced" } }),
  }, "test", "test-model");
  assert.deepEqual(retained.followUpQuestions, ["Would you rather minimize cash cost or preserve points?"]);

  const suppressed = validateStrategyOutput(narrative(["cash_vs_points_preference"]), {
    awardOptions: [],
    cardOffers: [],
    sources: [],
    goal: { allowNewCards: false },
    unavailableFollowUpTopics: unavailableFollowUpTopics({ goal: { optimizationPriority: "lowest_cash" } }),
  }, "test", "test-model");
  assert.deepEqual(suppressed.followUpQuestions, []);
  assert.deepEqual(suppressed.warnings, ["Verify availability, transfer terms, and cash amounts before booking."]);
});
