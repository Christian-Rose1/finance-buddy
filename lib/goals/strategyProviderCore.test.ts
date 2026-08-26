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
