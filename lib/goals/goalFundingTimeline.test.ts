import assert from "node:assert/strict";
import { test } from "node:test";
import {
  GOAL_FUNDING_TIMELINE_LABEL,
  GOAL_FUNDING_TIMELINE_DISCLOSURE,
  GOAL_FUNDING_TIMELINE_WARNING_HORIZON_CAPPED,
  GOAL_FUNDING_TIMELINE_WARNING_MIXED_CURRENCY,
  GOAL_FUNDING_TIMELINE_WARNING_NO_EARN,
  GOAL_FUNDING_TIMELINE_WARNING_NO_FUNDING,
  buildGoalFundingTimeline,
  projectGoalFundingTimeline,
} from "./goalFundingTimeline";
import { buildTripRealityCard } from "./tripRealityCard";
import type { PersonalizedStrategyContext, StrategyAwardOption, StrategyPointsInventoryItem } from "./strategyTypes";
import type { Goal } from "./types";
import type { EarningRule } from "@/lib/rewards/catalogTypes";
import type { VerifiedTransferPartner } from "@/lib/rewards/awardBenchmarks";

const goal: Goal = {
  id: "goal-1",
  userId: "user-1",
  type: "travel",
  title: "Paris",
  status: "active",
  origin: ["DEN"],
  destinations: ["Paris"],
  earliestDeparture: "2027-04-03",
  latestReturn: "2027-04-30",
  minimumNights: null,
  maximumNights: null,
  travelerCount: 2,
  cabinPreference: "economy",
  optimizationPriority: "balanced",
  maximumCashBudget: 2000,
  currency: "USD",
  allowNewCards: false,
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-01T00:00:00.000Z",
};

function flightOption(overrides: Partial<StrategyAwardOption> = {}): StrategyAwardOption {
  return {
    id: "flight-1",
    sourceId: "source-benchmark",
    programName: "Air Canada Aeroplan",
    redemptionType: "flight",
    pricingBasis: "round_trip",
    itineraryLabel: "DEN → CDG",
    pointsRequired: 60_000,
    cashFees: 80,
    seats: null,
    cabin: "economy",
    transferFromProgramId: null,
    transferRatio: null,
    centsPerPoint: null,
    availabilityStatus: "unknown",
    evidenceLevel: "planning_benchmark",
    travelerCountCovered: 1,
    nightCountCovered: null,
    coverageStatus: "standard_assumption",
    goalMatch: "exact",
    goalMismatchReasons: [],
    ...overrides,
  };
}

function inventoryItem(overrides: Partial<StrategyPointsInventoryItem> = {}): StrategyPointsInventoryItem {
  return {
    accountId: "account-a",
    rewardProgramId: "program-chase",
    programName: "Chase Ultimate Rewards",
    ownerLabel: "You",
    ownerType: "self",
    balance: 85_000,
    balanceAsOf: "2026-09-01",
    origin: "manual",
    verificationStatus: "verified",
    ...overrides,
  };
}

function earningRule(overrides: Partial<EarningRule> = {}): EarningRule {
  return {
    id: "rule-1",
    cardProductId: "product-csp",
    type: "earning_rate",
    eligibleCategory: "travel",
    eligibleMerchant: null,
    excludedMerchants: [],
    rewardCurrency: "points",
    rewardValue: 2,
    percentage: null,
    fixedValue: null,
    explanation: "2x on travel",
    source: "development_fixture",
    lastVerifiedAt: "2026-09-01T00:00:00.000Z",
    active: true,
    metadata: null,
    ...overrides,
  };
}

function context(overrides: Partial<PersonalizedStrategyContext> = {}): PersonalizedStrategyContext {
  return {
    goal,
    rewardAccounts: [],
    walletCards: [
      { id: "card-csp", name: "Sapphire Preferred", issuer: "Chase", rewardCurrency: "points", cardProductId: "product-csp" },
    ],
    monthlySpendingByCategory: [],
    awardOptions: [],
    cardOffers: [],
    sources: [],
    generatedAt: "2026-09-12T00:00:00.000Z",
    earningRules: [earningRule()],
    walletCardProgramIds: { "card-csp": "program-chase" },
    monthlySpendingByCategoryCard: [
      { cardId: "card-csp", category: "travel", monthlyAverage: 500 },
      { cardId: "card-csp", category: "dining", monthlyAverage: 300 },
    ],
    ...overrides,
  };
}

function inputs(overrides: Partial<Parameters<typeof buildGoalFundingTimeline>[1]> = {}) {
  return {
    flightOptions: [flightOption({ catalogRewardProgramId: "program-aeroplan" })],
    pointsInventory: [inventoryItem()],
    ...overrides,
  };
}

const chaseToAeroplan: VerifiedTransferPartner = {
  id: "partner-1",
  fromProgramId: "program-chase",
  toProgramId: "program-aeroplan",
  destinationPointsPerSourcePoint: 1,
  source: "https://issuer.example/partners",
  lastVerifiedAt: "2026-09-01T00:00:00.000Z",
};

// ---------------------------------------------------------------------------
// Core behaviors
// ---------------------------------------------------------------------------

test("on-track timeline: months-to-goal from the funding source program's verified earn", () => {
  // Debit 120,000 via verified 1:1 Chase→Aeroplan transfer; balance 85,000
  // → gap 35,000. Attributed spend: 500 travel × 2 + 300 dining × 1 (base
  // rate via `other`)… use exact rule set: travel 2x → 1,000; dining has no
  // rule on this card → base rate applies. Add a base rule below.
  const rules = [
    earningRule({ id: "rule-travel", rewardValue: 2 }),
    earningRule({
      id: "rule-base",
      eligibleCategory: "other",
      rewardValue: 1,
    }),
  ];
  const timeline = buildGoalFundingTimeline(
    context({ earningRules: rules, verifiedTransferPartners: [chaseToAeroplan] }),
    inputs(),
  );
  assert.ok(timeline);
  assert.equal(timeline.status, "on_track");
  assert.equal(timeline.label, GOAL_FUNDING_TIMELINE_LABEL);
  assert.equal(timeline.disclosure, GOAL_FUNDING_TIMELINE_DISCLOSURE);
  // 500 × 2 (travel) + 300 × 1 (base) = 1,300/month.
  assert.equal(timeline.monthlyEarn, 1300);
  assert.equal(timeline.currencyLabel, "points");
  assert.equal(timeline.sourceProgramName, "Chase Ultimate Rewards");
  // ceil(35,000 / 1,300) = 27.
  assert.equal(timeline.monthsToGoal, 27);
  assert.deepEqual(timeline.warnings, []);
});

test("covered timeline: balance at or above the debit needs no months projection", () => {
  const timeline = buildGoalFundingTimeline(
    context({ verifiedTransferPartners: [chaseToAeroplan] }),
    inputs({
      pointsInventory: [inventoryItem({ balance: 120_000 })],
    }),
  );
  assert.ok(timeline);
  assert.equal(timeline.status, "covered");
  assert.equal(timeline.monthsToGoal, null);
  // Earn still reported (honest context), from the source program's cards.
  assert.equal(timeline.monthlyEarn, 1000);
});

test("transfer ceil division: the debit never under-quotes the requirement", () => {
  const timeline = buildGoalFundingTimeline(
    context({
      verifiedTransferPartners: [
        { ...chaseToAeroplan, destinationPointsPerSourcePoint: 0.7 },
      ],
    }),
    inputs({
      pointsInventory: [inventoryItem({ balance: 0 })],
    }),
  );
  assert.ok(timeline);
  // 120,000 ÷ 0.7 = 171,428.57 → debit ceil 171,429 (never 171,428); gap
  // 171,429 at 1,000/month → ceil(171.429) = 172 months — beyond the 36-month
  // horizon, so the timeline refuses to project rather than show a bogus date.
  assert.equal(timeline.monthlyEarn, 1000);
  assert.equal(timeline.status, "no_path");
  assert.equal(timeline.monthsToGoal, null);
  assert.deepEqual(timeline.warnings, [GOAL_FUNDING_TIMELINE_WARNING_HORIZON_CAPPED]);

  // A sub-horizon example with the same ratio: 0.7 debit for a 35,000
  // requirement → ceil(50,000) = 50,000; with a 20,000 balance the gap is
  // 30,000 → 30 months at 1,000/month — on track, and exactly divisible here.
  const sub = buildGoalFundingTimeline(
    context({
      verifiedTransferPartners: [
        { ...chaseToAeroplan, destinationPointsPerSourcePoint: 0.7 },
      ],
    }),
    inputs({
      flightOptions: [flightOption({ catalogRewardProgramId: "program-aeroplan", pointsRequired: 17_500, travelerCountCovered: 1 })],
      pointsInventory: [inventoryItem({ balance: 20_000 })],
    }),
  );
  assert.ok(sub);
  // 35,000 ÷ 0.7 = 50,000 exactly; gap 30,000 at 1,000/month → 30 months.
  assert.equal(sub.status, "on_track");
  assert.equal(sub.monthsToGoal, 30);
});

test("no verified funding path → no_path with the fixed warning", () => {
  const timeline = buildGoalFundingTimeline(context(), inputs());
  assert.ok(timeline);
  assert.equal(timeline.status, "no_path");
  assert.equal(timeline.sourceProgramName, null);
  assert.equal(timeline.monthsToGoal, null);
  assert.deepEqual(timeline.warnings, [GOAL_FUNDING_TIMELINE_WARNING_NO_FUNDING]);
});

test("funding path exists but no verifiable monthly earn → no_path, told why", () => {
  // No card-attributed spending at all.
  const noAttribution = buildGoalFundingTimeline(
    context({ verifiedTransferPartners: [chaseToAeroplan], monthlySpendingByCategoryCard: [] }),
    inputs(),
  );
  assert.ok(noAttribution);
  assert.equal(noAttribution.status, "no_path");
  assert.equal(noAttribution.sourceProgramName, "Chase Ultimate Rewards");
  assert.deepEqual(noAttribution.warnings, [GOAL_FUNDING_TIMELINE_WARNING_NO_EARN]);

  // Attribution exists but the card's rate is unverified → also no earn.
  const unverifiedRate = buildGoalFundingTimeline(
    context({
      verifiedTransferPartners: [chaseToAeroplan],
      earningRules: [earningRule({ lastVerifiedAt: null })],
    }),
    inputs(),
  );
  assert.ok(unverifiedRate);
  assert.equal(unverifiedRate.status, "no_path");
  assert.equal(unverifiedRate.monthlyEarn, null);
  assert.deepEqual(unverifiedRate.warnings, [GOAL_FUNDING_TIMELINE_WARNING_NO_EARN]);
});

test("mixed currencies never merge: the program contributes nothing and says why", () => {
  const rules = [
    earningRule({ id: "rule-points", rewardCurrency: "points", rewardValue: 2 }),
    earningRule({
      id: "rule-miles",
      cardProductId: "product-csp",
      rewardCurrency: "miles",
      rewardValue: 1,
    }),
  ];
  const timeline = buildGoalFundingTimeline(
    context({
      earningRules: rules,
      verifiedTransferPartners: [chaseToAeroplan],
    }),
    inputs(),
  );
  assert.ok(timeline);
  assert.equal(timeline.status, "no_path");
  assert.equal(timeline.monthlyEarn, null);
  assert.deepEqual(timeline.warnings, [GOAL_FUNDING_TIMELINE_WARNING_MIXED_CURRENCY]);
});

test("horizon cap: beyond 36 months the timeline refuses to project", () => {
  const timeline = buildGoalFundingTimeline(
    context({ verifiedTransferPartners: [chaseToAeroplan] }),
    inputs({ pointsInventory: [inventoryItem({ balance: 119_500 })] }),
  );
  assert.ok(timeline);
  // Gap 500 at 1,000/month is 1 month — that's on-track, so instead force the
  // cap: gap of 35,000 at 1/month.
  const capped = buildGoalFundingTimeline(
    context({
      earningRules: [earningRule({ eligibleCategory: "other", rewardValue: 1 })],
      monthlySpendingByCategoryCard: [
        { cardId: "card-csp", category: "other", monthlyAverage: 1 },
      ],
      verifiedTransferPartners: [chaseToAeroplan],
    }),
    inputs(),
  );
  assert.ok(capped);
  assert.equal(capped.status, "no_path");
  assert.equal(capped.monthsToGoal, null);
  assert.deepEqual(capped.warnings, [GOAL_FUNDING_TIMELINE_WARNING_HORIZON_CAPPED]);
});

test("zero flight options yield no timeline at all", () => {
  assert.equal(buildGoalFundingTimeline(context(), inputs({ flightOptions: [] })), null);
});

test("requirement math rejected on every option → no_path with the funding warning", () => {
  // No traveler coverage on the option → shared calculator rejects it.
  const timeline = buildGoalFundingTimeline(
    context({ verifiedTransferPartners: [chaseToAeroplan] }),
    inputs({ flightOptions: [flightOption({ travelerCountCovered: null })] }),
  );
  assert.ok(timeline);
  assert.equal(timeline.status, "no_path");
  assert.deepEqual(timeline.warnings, [GOAL_FUNDING_TIMELINE_WARNING_NO_FUNDING]);
});

test("unverified or companion balances never enter the timeline", () => {
  const unverified = buildGoalFundingTimeline(
    context({ verifiedTransferPartners: [chaseToAeroplan] }),
    inputs({ pointsInventory: [inventoryItem({ verificationStatus: "unverified" })] }),
  );
  assert.ok(unverified);
  assert.equal(unverified.status, "no_path");

  const companion = buildGoalFundingTimeline(
    context({ verifiedTransferPartners: [chaseToAeroplan] }),
    inputs({ pointsInventory: [inventoryItem({ ownerType: "companion" })] }),
  );
  assert.ok(companion);
  assert.equal(companion.status, "no_path");
});

test("inputs are never mutated", () => {
  const ctx = context({ verifiedTransferPartners: [chaseToAeroplan] });
  const timelineInputs = inputs();
  const optionsBefore = JSON.stringify(timelineInputs.flightOptions);
  const inventoryBefore = JSON.stringify(timelineInputs.pointsInventory);
  buildGoalFundingTimeline(ctx, timelineInputs);
  assert.equal(JSON.stringify(timelineInputs.flightOptions), optionsBefore);
  assert.equal(JSON.stringify(timelineInputs.pointsInventory), inventoryBefore);
});

test("deterministic: identical inputs produce identical output", () => {
  const ctx = context({ verifiedTransferPartners: [chaseToAeroplan] });
  const timelineInputs = inputs();
  const a = buildGoalFundingTimeline(ctx, timelineInputs);
  const b = buildGoalFundingTimeline(ctx, timelineInputs);
  assert.deepEqual(a, b);
});

// ---------------------------------------------------------------------------
// Cross-check: the timeline cannot disagree with the Trip Reality Card
// ---------------------------------------------------------------------------

test("timeline funding matches the Trip Reality Card funding exactly", () => {
  const ctx = context({ verifiedTransferPartners: [chaseToAeroplan] });
  const timelineInputs = inputs();
  const timeline = buildGoalFundingTimeline(ctx, timelineInputs);
  const card = buildTripRealityCard(ctx, {
    flightOptions: timelineInputs.flightOptions,
    allocationScenarios: [],
    pointsInventory: timelineInputs.pointsInventory,
  }, null);
  assert.ok(timeline);
  assert.ok(card);
  // Same winner: gap funding via the same verified source account.
  assert.equal(card.funding!.status, "gap");
  assert.equal(timeline.status, "on_track");
  // Card surplus −35,000 → timeline gap 35,000 at 1,000/month → 35 months.
  assert.equal(card.funding!.verifiedSurplus, -35_000);
  assert.equal(timeline.monthsToGoal, 35);
});

// ---------------------------------------------------------------------------
// Strict persisted-shape re-projection
// ---------------------------------------------------------------------------

const persistedFixture = {
  schemaVersion: 1 as const,
  label: GOAL_FUNDING_TIMELINE_LABEL,
  status: "on_track" as const,
  monthlyEarn: 1300,
  currencyLabel: "points" as const,
  sourceProgramName: "Chase Ultimate Rewards",
  monthsToGoal: 27,
  warnings: [] as string[],
  disclosure: GOAL_FUNDING_TIMELINE_DISCLOSURE,
};

test("projector round-trips a valid persisted timeline", () => {
  const projected = projectGoalFundingTimeline(persistedFixture);
  assert.ok(projected);
  assert.deepEqual(projected, persistedFixture);
});

test("projector rejects hostile shapes and malformed values", () => {
  const hostile: Array<Record<string, unknown>> = [
    { ...persistedFixture, schemaVersion: 2 },
    { ...persistedFixture, hostile: true },
    { ...persistedFixture, label: "Trip reality" },
    { ...persistedFixture, status: "fabricated" },
    { ...persistedFixture, monthlyEarn: -1 },
    { ...persistedFixture, currencyLabel: "dollars" },
    { ...persistedFixture, sourceProgramName: "https://evil.example" },
    { ...persistedFixture, monthsToGoal: 0 },
    { ...persistedFixture, monthsToGoal: 1.5 },
    { ...persistedFixture, monthsToGoal: 37 },
    { ...persistedFixture, status: "covered", monthsToGoal: 5 },
    { ...persistedFixture, status: "no_path", monthsToGoal: 5 },
    { ...persistedFixture, warnings: ["Buy now from our partner site"] },
    { ...persistedFixture, disclosure: "Free points, act fast" },
    null as unknown as Record<string, unknown>,
    "string" as unknown as Record<string, unknown>,
  ];
  for (const candidate of hostile) {
    assert.equal(
      projectGoalFundingTimeline(candidate),
      null,
      `expected rejection for ${JSON.stringify(candidate).slice(0, 60)}`,
    );
  }
});

test("projector accepts covered and no_path statuses with null months", () => {
  const covered = projectGoalFundingTimeline({
    ...persistedFixture,
    status: "covered",
    monthsToGoal: null,
  });
  assert.ok(covered);
  assert.equal(covered.status, "covered");

  const noPath = projectGoalFundingTimeline({
    ...persistedFixture,
    status: "no_path",
    monthsToGoal: null,
    sourceProgramName: null,
  });
  assert.ok(noPath);
  assert.equal(noPath.status, "no_path");
});

test("projector rejects forged on_track timelines with zero or unknown-currency earn", () => {
  // The builder can never emit on_track without a positive verified earn and
  // its currency label; a tampered persisted row must not survive projection.
  const hostile: Array<Record<string, unknown>> = [
    { ...persistedFixture, monthlyEarn: 0 },
    { ...persistedFixture, currencyLabel: null },
    { ...persistedFixture, monthlyEarn: null, currencyLabel: null },
  ];
  for (const candidate of hostile) {
    assert.equal(
      projectGoalFundingTimeline(candidate),
      null,
      `expected rejection for ${JSON.stringify(candidate).slice(0, 60)}`,
    );
  }
  // monthlyEarn and currencyLabel are always set together in every status.
  assert.equal(
    projectGoalFundingTimeline({ ...persistedFixture, status: "no_path", monthsToGoal: null, monthlyEarn: null }),
    null,
  );
  assert.equal(
    projectGoalFundingTimeline({ ...persistedFixture, status: "no_path", monthsToGoal: null, currencyLabel: null }),
    null,
  );
});
