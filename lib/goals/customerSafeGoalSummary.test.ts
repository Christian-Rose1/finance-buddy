import assert from "node:assert/strict";
import { test } from "node:test";
import { buildCustomerSafeGoalSummary, buildCustomerSafePlanningPreview } from "./customerSafeGoalSummary";
import type { Goal } from "./types";
import type { StrategyAwardOption } from "./strategyTypes";

const baseGoal: Goal = {
  id: "goal-raw",
  userId: "user-raw",
  type: "travel",
  title: "Trip",
  status: "active",
  origin: ["  New   York (JFK)  "],
  destinations: ["Paris, France"],
  earliestDeparture: "2027-04-03",
  latestReturn: "2027-04-30",
  minimumNights: 8,
  maximumNights: 16,
  travelerCount: 2,
  cabinPreference: "economy",
  optimizationPriority: "balanced",
  maximumCashBudget: 2000,
  currency: "usd",
  allowNewCards: false,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const option = (overrides: Partial<StrategyAwardOption> = {}): StrategyAwardOption => ({
  id: "option-raw",
  sourceId: "source-raw",
  programName: "  Program   A ",
  redemptionType: "flight",
  pricingBasis: "round_trip",
  itineraryLabel: "  Paris itinerary  ",
  pointsRequired: 25_000,
  cashFees: null,
  seats: null,
  cabin: "economy",
  transferFromProgramId: null,
  transferRatio: null,
  centsPerPoint: null,
  availabilityStatus: "unknown",
  evidenceLevel: "planning_benchmark",
  coverageStatus: "source_explicit",
  ...overrides,
});

test("maps all goal status, priority, and cabin values", () => {
  for (const [status, label] of [["draft", "Draft goal"], ["active", "Active goal"], ["completed", "Completed goal"], ["paused", "Paused goal"]] as const) assert.equal(buildCustomerSafeGoalSummary({ ...baseGoal, status }).status, label);
  for (const [priority, label] of [["lowest_cash", "Lowest cash cost"], ["best_experience", "Best experience"], ["simplest", "Simplest path"], ["balanced", "Balanced"]] as const) assert.equal(buildCustomerSafeGoalSummary({ ...baseGoal, optimizationPriority: priority }).priority, label);
  for (const [cabinPreference, label] of [["economy", "Economy"], ["premium_economy", "Premium economy"], ["business", "Business"], ["first", "First class"], ["flexible", "Flexible"]] as const) assert.equal(buildCustomerSafeGoalSummary({ ...baseGoal, cabinPreference }).cabin, label);
});

test("uses neutral labels for unknown goal enums", () => {
  const result = buildCustomerSafeGoalSummary({ ...baseGoal, status: "future" as Goal["status"], optimizationPriority: "future" as Goal["optimizationPriority"], cabinPreference: "future" as Goal["cabinPreference"] });
  assert.deepEqual([result.status, result.priority, result.cabin], ["Goal saved", "Planning preferences saved", "Cabin preference saved"]);
});

test("sanitizes goal route, currency, dates, and numeric facts", () => {
  const result = buildCustomerSafeGoalSummary({ ...baseGoal, origin: ["Denver\u0000", "https://bad.example", "account-123", "Denver, CO"], destinations: ["Paris", "program-123"], earliestDeparture: "bad", latestReturn: "2027-04-30", currency: "US$", travelerCount: -1, minimumNights: Number.NaN, maximumNights: "8" as unknown as number, maximumCashBudget: Number.POSITIVE_INFINITY });
  assert.equal(result.route, "Denver, CO → Paris");
  assert.equal(result.dateWindow, null);
  assert.equal(result.dateWindowIsFlexible, false);
  assert.equal(result.travelerCount, null);
  assert.equal(result.nights, null);
  assert.equal(result.nightsLabel, null);
  assert.equal(result.budget, null);
  assert.equal(result.budgetLabel, null);
  const output = JSON.stringify(result);
  for (const value of ["https://bad.example", "account-123", "program-123", "US$", "NaN", "Infinity"]) assert.equal(output.includes(value), false);
});

test("projects safe expanded stay and budget labels without deriving values", () => {
  const result = buildCustomerSafeGoalSummary(baseGoal);
  assert.equal(result.nightsLabel, "8–16 nights");
  assert.equal(result.budgetLabel, "Budget: USD 2,000");
  assert.equal(buildCustomerSafeGoalSummary({ ...baseGoal, minimumNights: 1, maximumNights: 1 }).nightsLabel, "1 night");
  assert.equal(buildCustomerSafeGoalSummary({ ...baseGoal, maximumCashBudget: -1, currency: "US$" }).budgetLabel, null);
});

test("uses a complete fallback when no valid route labels remain", () => {
  const result = buildCustomerSafeGoalSummary({ ...baseGoal, origin: ["https://bad.example"], destinations: ["\u0000"] });
  assert.equal(result.route, "Travel destination saved");
});

test("builds a safe staged preview with fixed labels, keys, caps-compatible output, and invalid amounts omitted", () => {
  const preview = buildCustomerSafePlanningPreview(option(), "flight-preview-1");
  assert.deepEqual(preview, { key: "flight-preview-1", programName: "Program A", itineraryLabel: "Paris itinerary", pointsRequired: 25_000, pricingLabel: "Round trip", coverageLabel: "Coverage stated by the research source", evidenceLabel: "Planning estimate", availabilityLabel: "Check current availability before acting" });
  for (const pricingBasis of ["one_way", "round_trip", "per_night", "total_stay", "unknown"] as const) assert.equal(typeof buildCustomerSafePlanningPreview(option({ pricingBasis }), "k").pricingLabel, "string");
  for (const coverageStatus of ["source_explicit", "standard_assumption", "unknown"] as const) assert.equal(typeof buildCustomerSafePlanningPreview(option({ coverageStatus }), "k").coverageLabel, "string");
  for (const pointsRequired of [Number.NaN, Number.POSITIVE_INFINITY, -1, "25000"] as unknown[]) assert.equal(buildCustomerSafePlanningPreview(option({ pointsRequired: pointsRequired as number }), "k").pointsRequired, null);
});

test("preview rejects hostile labels and raw fields", () => {
  const preview = buildCustomerSafePlanningPreview(option({ programName: "https://provider.example/source-1", itineraryLabel: "payload signature stage option-raw" }), "preview-local-1");
  const output = JSON.stringify(preview);
  assert.equal(preview.programName, "Reward program");
  assert.equal(preview.itineraryLabel, null);
  for (const forbidden of ["https://", "provider", "source-raw", "option-raw", "payload", "signature", "stage"]) assert.equal(output.toLowerCase().includes(forbidden), false);
});

test("research and goal labels reject opaque internal references including award/card/cash", () => {
  const preview = buildCustomerSafePlanningPreview(
    option({ programName: "award-1 Program", itineraryLabel: "card-2 flight details" }),
    "k",
  );
  assert.equal(preview.programName, "Reward program");
  assert.equal(preview.itineraryLabel, null);

  const summary = buildCustomerSafeGoalSummary({
    ...baseGoal,
    origin: ["award-5", "Denver"],
    destinations: ["cash-7", "Paris"],
  });
  assert.equal(summary.route, "Denver → Paris");
  const output = JSON.stringify(summary);
  for (const forbidden of ["award-5", "cash-7"]) assert.equal(output.includes(forbidden), false, forbidden);
});
