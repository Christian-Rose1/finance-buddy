import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildSavedGoalWebTravelDiscoveryPlan,
  deduplicateWebTravelDiscoveryQueries,
  deriveSavedGoalTripShapes,
  resolveSavedGoalPriorityProfile,
  SAVED_GOAL_PRIORITY_PROFILES,
  toSavedGoalWebDiscoveryInput,
} from "./webTravelDiscoveryPlanner";
import type { ResearchPlannerInput } from "./researchPlannerTypes";
import { buildResearchPlannerInput } from "./researchPlannerInputBuilder";
import type { PersonalizedStrategyContext } from "./strategyTypes";

function input(overrides: Partial<ResearchPlannerInput> = {}): ResearchPlannerInput {
  return {
    goal: {
      type: "travel",
      title: "Euro Trip",
      origin: ["DEN"],
      destinations: ["Paris"],
      earliestDeparture: "2027-04-03",
      latestReturn: "2027-04-30",
      minimumNights: 8,
      maximumNights: 16,
      travelerCount: 2,
      cabinPreference: "economy",
      optimizationPriority: "lowest_cash",
      maximumCashBudget: 2000,
      currency: "USD",
      allowNewCards: true,
    },
    rewardAccounts: [{ programName: "Chase Ultimate Rewards", balance: 80000, ownerType: "self", verificationStatus: "verified" }],
    walletCards: [],
    monthlySpendingByCategory: [],
    customerRewardPrograms: [{ id: "", name: "Chase Ultimate Rewards" }],
    transferPartners: [],
    currentDate: "2026-08-26T00:00:00.000Z",
    daysUntilDeparture: 220,
    ...overrides,
  };
}

function stablePlan(value: ReturnType<typeof buildSavedGoalWebTravelDiscoveryPlan>) {
  return { tripShapes: value.tripShapes, queries: value.queries, reasoning: value.reasoning };
}

function webInput(overrides: Partial<ResearchPlannerInput> = {}) {
  return toSavedGoalWebDiscoveryInput(input(overrides));
}

test("same saved goal produces identical trip shapes and query plan", () => {
  const first = buildSavedGoalWebTravelDiscoveryPlan(webInput());
  const second = buildSavedGoalWebTravelDiscoveryPlan(webInput());

  assert.deepEqual(stablePlan(first), stablePlan(second));
  assert.ok(first.queries.length >= 2 && first.queries.length <= 4);
  assert.ok(first.queries.length <= 8);
});

test("broad saved date window produces at most three labeled flexible planning alternatives", () => {
  const shapes = deriveSavedGoalTripShapes(webInput());

  assert.equal(shapes.length, 3);
  assert.deepEqual(shapes.map((shape) => shape.id), ["trip-shape-1", "trip-shape-2", "trip-shape-3"]);
  assert.ok(shapes.every((shape) => shape.mode === "flexible_planning"));
  assert.ok(shapes.every((shape) => shape.label.includes("planning alternative")));
  assert.ok(shapes.every((shape) => shape.exactSuppressionReasons.length > 0));
});

test("saved goals alone continue discovery when optional travel details are absent", () => {
  const plan = buildSavedGoalWebTravelDiscoveryPlan(webInput({
    goal: {
      ...input().goal,
      earliestDeparture: null,
      latestReturn: null,
      minimumNights: null,
      maximumNights: null,
      cabinPreference: "flexible",
    },
    customerRewardPrograms: [],
  }));

  assert.ok(plan.queries.length >= 2, "route and destination discovery remains available");
  assert.ok(plan.queries.every((query) => query.mode === "flexible_planning"));
  assert.ok(plan.tripShapes[0].unknownDimensions.includes("room_breakdown"));
  assert.ok(plan.tripShapes[0].unknownDimensions.includes("airport_flexibility"));
  assert.ok(plan.tripShapes[0].unknownDimensions.includes("baggage"));
  assert.ok(plan.tripShapes[0].unknownDimensions.includes("layover_tolerance"));
  assert.ok(plan.tripShapes[0].unknownDimensions.includes("neighborhood_or_property_preference"));
  assert.ok(plan.tripShapes[0].unknownDimensions.includes("travel_dates"));
  assert.ok(!JSON.stringify(plan).match(/question|required|missing-input failure/i));
});

test("query families are targeted, stable, deduplicated, and exclude generic candidate queries", () => {
  const plan = buildSavedGoalWebTravelDiscoveryPlan(webInput());
  const queries = plan.queries.map((query) => query.query);

  assert.equal(new Set(queries).size, queries.length);
  assert.deepEqual(plan.queries.map((query) => query.kind), [
    "cash_flight_discovery",
    "cash_hotel_discovery",
    "award_flight_discovery",
    "award_hotel_discovery",
  ]);
  assert.ok(queries.every((query) => !/best flights to europe|paris hotel points per night/i.test(query)));
  assert.ok(plan.queries.filter((query) => query.kind.includes("flight")).every((query) => query.query.includes("DEN to Paris")));
  assert.ok(plan.queries.filter((query) => query.kind.includes("hotel")).every((query) => query.query.includes("Paris")));
});

test("every supported saved optimization priority has a deterministic documented profile", () => {
  const expected: Record<ResearchPlannerInput["goal"]["optimizationPriority"], string[]> = {
    lowest_cash: ["cash_flight_discovery", "cash_hotel_discovery", "award_flight_discovery", "award_hotel_discovery"],
    best_experience: ["award_flight_discovery", "award_hotel_discovery", "cash_flight_discovery", "cash_hotel_discovery"],
    simplest: ["cash_flight_discovery", "cash_hotel_discovery"],
    balanced: ["cash_flight_discovery", "award_flight_discovery", "cash_hotel_discovery", "award_hotel_discovery"],
  };

  for (const [priority, expectedKinds] of Object.entries(expected) as Array<[ResearchPlannerInput["goal"]["optimizationPriority"], string[]]>) {
    const first = buildSavedGoalWebTravelDiscoveryPlan(webInput({
      goal: { ...input().goal, optimizationPriority: priority },
    }));
    const second = buildSavedGoalWebTravelDiscoveryPlan(webInput({
      goal: { ...input().goal, optimizationPriority: priority },
    }));

    assert.deepEqual(stablePlan(first), stablePlan(second), `${priority} must be deterministic`);
    assert.deepEqual(first.queries.map((query) => query.kind), expectedKinds);
    assert.deepEqual(SAVED_GOAL_PRIORITY_PROFILES[priority], expectedKinds);
    assert.ok(first.queries.length >= 2 && first.queries.length <= 4);
  }
});

test("priority profiles materially change bounded query selection or ordering", () => {
  const kindsFor = (priority: ResearchPlannerInput["goal"]["optimizationPriority"]) =>
    buildSavedGoalWebTravelDiscoveryPlan(webInput({ goal: { ...input().goal, optimizationPriority: priority } }))
      .queries.map((query) => query.kind);

  assert.notDeepEqual(kindsFor("lowest_cash"), kindsFor("best_experience"));
  assert.notDeepEqual(kindsFor("balanced"), kindsFor("simplest"));
});

test("malformed or absent persisted priority safely falls back to the balanced profile", () => {
  const balanced = buildSavedGoalWebTravelDiscoveryPlan(webInput({
    goal: { ...input().goal, optimizationPriority: "balanced" },
  }));

  for (const malformedPriority of ["legacy_priority", undefined, "toString"]) {
    const runtimeInput = webInput({
      rewardAccounts: [{ programName: "Chase Ultimate Rewards", balance: 987654, ownerType: "companion", verificationStatus: "unverified" }],
    });
    (runtimeInput.goal as unknown as { optimizationPriority: unknown }).optimizationPriority = malformedPriority;

    assert.doesNotThrow(() => buildSavedGoalWebTravelDiscoveryPlan(runtimeInput));
    const fallback = buildSavedGoalWebTravelDiscoveryPlan(runtimeInput);
    assert.deepEqual(fallback.queries.map((query) => query.kind), balanced.queries.map((query) => query.kind));
    const serialized = JSON.stringify(fallback);
    assert.ok(!serialized.includes("987654"));
    assert.ok(!serialized.includes("companion"));
    assert.ok(!serialized.includes("unverified"));
  }

  assert.equal(resolveSavedGoalPriorityProfile("legacy_priority"), SAVED_GOAL_PRIORITY_PROFILES.balanced);
  assert.equal(resolveSavedGoalPriorityProfile(undefined), SAVED_GOAL_PRIORITY_PROFILES.balanced);
});

test("validated transfer relationships add one separate bounded policy query", () => {
  const plan = buildSavedGoalWebTravelDiscoveryPlan(webInput({
    transferPartners: [{
      sourceProgramName: "Chase Ultimate Rewards",
      partnerProgramName: "World of Hyatt",
      partnerFamily: "hotel_points",
    }],
  }));

  assert.equal(plan.queries.length, 5, "policy research is an adaptive exception to the two-to-four default");
  assert.equal(plan.queries.at(-1)?.kind, "program_policy_research");
  assert.ok(plan.queries.length <= 8);
});

test("planner output excludes sensitive and unsafe values", () => {
  const plan = buildSavedGoalWebTravelDiscoveryPlan(webInput({
    rewardAccounts: [{ programName: "Chase Ultimate Rewards", balance: 987654, ownerType: "companion", verificationStatus: "unverified" }],
    customerRewardPrograms: [{ id: "internal-program-id", name: "Chase Ultimate Rewards" }],
  }));
  const serialized = JSON.stringify(plan);

  for (const forbidden of ["987654", "companion", "unverified", "internal-program-id", "http", "www.", "signature", "raw-content", "provider payload"]) {
    assert.ok(!serialized.includes(forbidden), `must not expose ${forbidden}`);
  }
  assert.ok(plan.queries.every((query) => query.tripShapeIds.every((id) => /^trip-shape-\d+$/.test(id))));
});

test("deduplication handles a real repeated planned query while preserving first order", () => {
  const plan = buildSavedGoalWebTravelDiscoveryPlan(webInput());
  const repeated = { ...plan.queries[0], kind: plan.queries[0].kind };
  const deduplicated = deduplicateWebTravelDiscoveryQueries([
    plan.queries[0],
    repeated,
    ...plan.queries.slice(1),
  ]);

  assert.equal(deduplicated.length, plan.queries.length);
  assert.equal(deduplicated[0], plan.queries[0]);
});

function sanitizedInputFromRealBuilder(): ResearchPlannerInput {
  const context: PersonalizedStrategyContext = {
    goal: {
      id: "goal-internal-id",
      userId: "user-internal-id",
      type: "travel",
      title: "Builder Trip",
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
      maximumCashBudget: null,
      currency: "USD",
      allowNewCards: false,
      createdAt: "2026-08-01T00:00:00.000Z",
      updatedAt: "2026-08-01T00:00:00.000Z",
    },
    rewardAccounts: [{
      id: "account-internal-id",
      userId: "user-internal-id",
      rewardProgramId: "program-internal-id",
      ownerKey: "owner-internal-key",
      ownerLabel: "Customer",
      ownerType: "self",
      balance: 80000,
      balanceAsOf: "2026-08-01T00:00:00.000Z",
      origin: "manual",
      verificationStatus: "verified",
      createdAt: "2026-08-01T00:00:00.000Z",
      updatedAt: "2026-08-01T00:00:00.000Z",
    }],
    walletCards: [],
    monthlySpendingByCategory: [],
    awardOptions: [],
    cardOffers: [],
    sources: [],
    generatedAt: "2026-08-01T00:00:00.000Z",
  };
  return buildResearchPlannerInput(context, [{ id: "program-internal-id", name: "Chase Ultimate Rewards" }]);
}

test("catalog and owned program names alone cannot create transfer-policy research", () => {
  const sanitized = sanitizedInputFromRealBuilder();
  const plan = buildSavedGoalWebTravelDiscoveryPlan(toSavedGoalWebDiscoveryInput(sanitized));

  assert.deepEqual(sanitized.transferPartners, []);
  assert.ok(plan.queries.some((query) => query.kind === "award_flight_discovery"));
  assert.ok(!plan.queries.some((query) => query.kind === "program_policy_research"));
});

test("legacy minimal saved goals with absent optional fields plan safely without blocking", () => {
  const plan = buildSavedGoalWebTravelDiscoveryPlan(webInput({
    goal: {
      ...input().goal,
      earliestDeparture: null,
      latestReturn: null,
      minimumNights: null,
      maximumNights: null,
      maximumCashBudget: null,
      cabinPreference: "flexible",
      optimizationPriority: "simplest",
    },
    customerRewardPrograms: [],
  }));

  assert.deepEqual(plan.queries.map((query) => query.kind), ["cash_flight_discovery", "cash_hotel_discovery"]);
  assert.ok(plan.tripShapes[0].unknownDimensions.includes("stay_length"));
  assert.ok(plan.queries.every((query) => query.mode === "flexible_planning"));
});

test("unsafe saved location text is suppressed rather than becoming a web query", () => {
  const plan = buildSavedGoalWebTravelDiscoveryPlan(webInput({
    goal: { ...input().goal, origin: ["https://unsafe.example"], destinations: ["Paris"] },
  }));

  assert.ok(plan.queries.every((query) => !query.query.includes("unsafe.example")));
  assert.ok(plan.queries.every((query) => query.kind.includes("hotel")));
});
