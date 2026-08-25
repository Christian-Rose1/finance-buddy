import { test } from "node:test";
import assert from "node:assert/strict";

import { buildResearchPlannerInput } from "./researchPlannerInputBuilder";
import type { PersonalizedStrategyContext } from "./strategyTypes";

function makeContext(): PersonalizedStrategyContext {
  return {
    goal: {
      id: "goal-1",
      userId: "user-secret-id",
      type: "travel",
      title: "Euro Trip",
      status: "active",
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
      createdAt: "2026-08-01T00:00:00.000Z",
      updatedAt: "2026-08-01T00:00:00.000Z",
    },
    rewardAccounts: [
      {
        id: "acc-1",
        userId: "user-secret-id",
        rewardProgramId: "prog-1",
        ownerKey: "owner-key-secret",
        ownerLabel: "Christian",
        ownerType: "self",
        balance: 80000,
        balanceAsOf: "2026-08-20T00:00:00.000Z",
        origin: "manual",
        verificationStatus: "verified",
        createdAt: "2026-08-01T00:00:00.000Z",
        updatedAt: "2026-08-01T00:00:00.000Z",
      },
    ],
    walletCards: [
      {
        id: "card-1",
        name: "Chase Sapphire Preferred",
        issuer: "Chase",
        rewardCurrency: "Chase Ultimate Rewards",
        cardProductId: "product-1",
      },
    ],
    monthlySpendingByCategory: [
      { category: "dining", monthlyAverage: 800 },
    ],
    awardOptions: [],
    cardOffers: [],
    sources: [],
    generatedAt: "2026-08-24T00:00:00.000Z",
  };
}

const CATALOG = [
  { id: "prog-1", name: "Chase Ultimate Rewards", family: "flexible_points" },
  { id: "prog-2", name: "United MileagePlus", family: "airline_miles" },
  { id: "prog-3", name: "World of Hyatt", family: "hotel_points" },
];

test("planner input excludes userId, ownerKey, ownerLabel, and balanceAsOf", () => {
  const input = buildResearchPlannerInput(makeContext(), CATALOG);
  const serialized = JSON.stringify(input);

  assert.ok(!serialized.includes("user-secret-id"));
  assert.ok(!serialized.includes("owner-key-secret"));
  assert.ok(!serialized.includes("Christian"));
  assert.ok(!serialized.includes("balanceAsOf"));
  assert.ok(!serialized.includes("goal-1"));
});

test("planner input includes balances and program names", () => {
  const input = buildResearchPlannerInput(makeContext(), CATALOG);

  assert.equal(input.rewardAccounts.length, 1);
  assert.equal(input.rewardAccounts[0].balance, 80000);
  assert.equal(input.rewardAccounts[0].programName, "Chase Ultimate Rewards");
});

test("planner input resolves program name from catalog", () => {
  const input = buildResearchPlannerInput(makeContext(), [
    { id: "prog-1", name: "Resolved From Catalog", family: "flexible_points" },
  ]);

  assert.equal(
    input.customerRewardPrograms.some((p) => p.name === "Resolved From Catalog"),
    true
  );
});

test("planner input includes spending categories from context", () => {
  const input = buildResearchPlannerInput(makeContext(), CATALOG);

  assert.equal(input.monthlySpendingByCategory.length, 1);
  assert.equal(input.monthlySpendingByCategory[0].category, "dining");
  assert.equal(input.monthlySpendingByCategory[0].monthlyAverage, 800);
});

test("planner system prompt mentions spending categories and earning runway", async () => {
  const { RESEARCH_PLANNER_SYSTEM_PROMPT } = await import(
    "./researchPlannerCore"
  );

  assert.ok(RESEARCH_PLANNER_SYSTEM_PROMPT.includes("monthlySpendingByCategory"));
  assert.ok(RESEARCH_PLANNER_SYSTEM_PROMPT.includes("spending categories"));
  assert.ok(RESEARCH_PLANNER_SYSTEM_PROMPT.includes("daysUntilDeparture"));
});

test("planner input computes daysUntilDeparture", () => {
  const now = new Date("2026-08-24T00:00:00.000Z");
  const input = buildResearchPlannerInput(makeContext(), CATALOG, now);

  assert.ok(typeof input.daysUntilDeparture === "number");
  assert.ok((input.daysUntilDeparture as number) > 200);
});

test("planner input returns null daysUntilDeparture when no departure date", () => {
  const ctx = makeContext();
  ctx.goal.earliestDeparture = null;

  const input = buildResearchPlannerInput(ctx, CATALOG);
  assert.equal(input.daysUntilDeparture, null);
});