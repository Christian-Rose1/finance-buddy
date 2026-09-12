import assert from "node:assert/strict";
import { test } from "node:test";
import { buildTripRealityCard } from "./tripRealityCard";
import type { PersonalizedStrategyContext, StrategyAllocationScenario, StrategyAwardOption, StrategyPointsInventoryItem } from "./strategyTypes";
import type { Goal } from "./types";
import type { EarningRule } from "@/lib/rewards/catalogTypes";
import type { FlightPlanningEstimate } from "./flightPlanningEstimate";

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
    rewardProgramId: "program-a",
    programName: "Air Canada Aeroplan",
    ownerLabel: "You",
    ownerType: "self",
    balance: 85_000,
    balanceAsOf: "2026-09-01",
    origin: "manual",
    verificationStatus: "verified",
    ...overrides,
  };
}

function scenario(overrides: Partial<StrategyAllocationScenario> = {}): StrategyAllocationScenario {
  return {
    id: "scenario-a",
    kind: "flight_first",
    title: "Flight-first",
    status: "feasible",
    flightOptionId: "flight-1",
    hotelOptionId: null,
    flightPointsRequired: 120_000,
    hotelPointsRequired: null,
    travelerCount: 2,
    tripNights: 8,
    allocations: [],
    assumptions: [],
    warnings: [],
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
      { id: "card-freedom", name: "Freedom", issuer: "Chase", rewardCurrency: "points", cardProductId: "product-freedom" },
    ],
    monthlySpendingByCategory: [],
    awardOptions: [],
    cardOffers: [],
    sources: [],
    generatedAt: "2026-09-12T00:00:00.000Z",
    earningRules: [earningRule()],
    walletCardProgramIds: { "card-csp": "program-chase", "card-freedom": "program-chase" },
    ...overrides,
  };
}

function estimate(overrides: Partial<FlightPlanningEstimate> = {}): FlightPlanningEstimate {
  return {
    label: "Flight planning estimate",
    origin: "DEN",
    destination: "CDG",
    outboundDate: "2027-04-03",
    returnDate: "2027-04-30",
    travelers: 2,
    cabin: "economy",
    currency: "USD",
    total: 2400,
    priceCoverage: "searched_party_total",
    retrievedAt: "2026-09-12T00:00:00.000Z",
    outboundSegments: [],
    returnSegments: [],
    unknowns: [],
    evidenceLabel: "Planning estimate",
    verificationLabel: "Not customer-verified",
    availabilityLabel: "Not live or bookable; verify before booking",
    ...overrides,
  };
}

function inputs(overrides: Partial<Parameters<typeof buildTripRealityCard>[1]> = {}) {
  return {
    flightOptions: [flightOption()],
    allocationScenarios: [scenario()],
    pointsInventory: [inventoryItem()],
    ...overrides,
  };
}

const RULE_KEYS = Object.keys(earningRule());
const RATE_KEYS = new Set(["id", "cardProductId", "type", "eligibleCategory", "eligibleMerchant", "excludedMerchants", "rewardCurrency", "rewardValue", "percentage", "fixedValue", "explanation", "source", "lastVerifiedAt", "active", "metadata"]);
assert.deepEqual(new Set(RULE_KEYS), RATE_KEYS);

test("builds a full card: cash party-total, goal-scaled points, transfer funding, best card", () => {
  // 2 travelers, 1 covered per 60K round-trip option → 120,000 required.
  const card = buildTripRealityCard(
    context({ monthlySpendingByCategoryCard: [{ cardId: "card-csp", category: "travel", monthlyAverage: 250 }] }),
    inputs(),
    estimate(),
  );
  assert.ok(card);
  assert.equal(card.schemaVersion, 1);
  assert.equal(card.label, "Trip reality");
  assert.ok(card.cash);
  assert.equal(card.cash!.amount, 2400);
  assert.equal(card.cash!.currency, "USD");
  assert.equal(card.cash!.travelers, 2);
  assert.ok(card.points);
  assert.equal(card.points!.pointsRequired, 120_000);
  assert.equal(card.points!.programName, "Air Canada Aeroplan");
  assert.equal(card.points!.pricingBasis, "round_trip");
  assert.equal(card.points!.fees, 80);
  assert.equal(card.points!.programCount, 1);
  // Verified 85K balance < 120K debit → gap, surplus −35,000.
  assert.ok(card.funding);
  assert.equal(card.funding!.status, "gap");
  assert.equal(card.funding!.verifiedSurplus, -35_000);
  assert.equal(card.funding!.programName, "Air Canada Aeroplan");
  assert.ok(card.bestCard);
  assert.equal(card.bestCard!.cardName, "Sapphire Preferred");
  assert.equal(card.bestCard!.monthlyPoints, 500);
  assert.equal(card.bestCard!.currencyLabel, "points");
});

test("cash is null when the estimate is absent; points still present from options", () => {
  const card = buildTripRealityCard(context(), inputs(), null);
  assert.ok(card);
  assert.equal(card.cash, null);
  assert.ok(card.points);
  assert.equal(card.points!.pointsRequired, 120_000);
});

test("points are null with no options; funding and best-card follow honestly", () => {
  const card = buildTripRealityCard(
    context({ monthlySpendingByCategoryCard: [{ cardId: "card-csp", category: "travel", monthlyAverage: 250 }] }),
    inputs({ flightOptions: [] }),
    estimate(),
  );
  assert.ok(card);
  assert.equal(card.points, null);
  assert.ok(card.funding);
  assert.equal(card.funding!.status, "unknown");
  assert.ok(card.bestCard);
});

test("returns null with no flight evidence at all", () => {
  const card = buildTripRealityCard(context(), inputs({ flightOptions: [] }), null);
  assert.equal(card, null);
});

test("verified balances at or above the debit are 'covered'; transfer debit uses ceil division", () => {
  // Transfer path: 120,000 ÷ 1 (1:1) = 120,000 debit; balance exactly covers.
  const exact = buildTripRealityCard(
    context({
      verifiedTransferPartners: [
        { id: "partner-1", fromProgramId: "program-chase", toProgramId: "program-aeroplan", destinationPointsPerSourcePoint: 1, source: "https://issuer.example", lastVerifiedAt: "2026-09-01T00:00:00.000Z" },
      ],
    }),
    inputs({
      flightOptions: [flightOption({ catalogRewardProgramId: "program-aeroplan" })],
      pointsInventory: [inventoryItem({ rewardProgramId: "program-chase", programName: "Chase Ultimate Rewards", balance: 120_000 })],
    }),
    estimate(),
  );
  assert.ok(exact?.funding);
  assert.equal(exact.funding.status, "covered");
  assert.equal(exact.funding.verifiedSurplus, 0);

  // Non-integer ratio: 120,000 ÷ 0.7 = 171,428.57 → ceil 171,429 (never under-quotes the debit).
  const ratio = buildTripRealityCard(
    context({
      verifiedTransferPartners: [
        { id: "partner-2", fromProgramId: "program-chase", toProgramId: "program-aeroplan", destinationPointsPerSourcePoint: 0.7, source: "https://issuer.example", lastVerifiedAt: "2026-09-01T00:00:00.000Z" },
      ],
    }),
    inputs({
      flightOptions: [flightOption({ catalogRewardProgramId: "program-aeroplan" })],
      pointsInventory: [inventoryItem({ rewardProgramId: "program-chase", programName: "Chase Ultimate Rewards", balance: 171_429 })],
    }),
    estimate(),
  );
  assert.ok(ratio?.funding);
  assert.equal(ratio.funding.status, "covered");
  assert.equal(ratio.funding.verifiedSurplus, 0);
});

test("unverified balances never claim coverage; companion accounts are ignored", () => {
  const card = buildTripRealityCard(
    context(),
    inputs({
      pointsInventory: [
        inventoryItem({ verificationStatus: "unverified" }),
        inventoryItem({ accountId: "account-b", ownerType: "companion", ownerLabel: "Companion", balance: 500_000 }),
      ],
    }),
    estimate(),
  );
  assert.ok(card?.funding);
  assert.equal(card.funding.status, "unknown");
  assert.equal(card.funding.verifiedSurplus, null);
});

test("cheapest fundable option wins when several programs have funding paths", () => {
  const card = buildTripRealityCard(
    context(),
    inputs({
      flightOptions: [
        flightOption({ id: "flight-1", programName: "Air Canada Aeroplan", pointsRequired: 60_000 }),
        flightOption({ id: "flight-2", programName: "United MileagePlus", pointsRequired: 80_000, catalogRewardProgramId: undefined }),
      ],
      pointsInventory: [inventoryItem({ programName: "Air Canada Aeroplan", balance: 130_000 })],
    }),
    estimate(),
  );
  assert.ok(card?.funding);
  // 2 travelers: Aeroplan 120,000 (balance 130,000 → covered, surplus 10,000).
  assert.equal(card.funding.status, "covered");
  assert.equal(card.funding.verifiedSurplus, 10_000);
});

test("best card picks the higher-earning attributed card and computes the comparison", () => {
  const rules = [
    earningRule({ id: "rule-csp", cardProductId: "product-csp", rewardValue: 2 }),
    earningRule({ id: "rule-freedom", cardProductId: "product-freedom", rewardValue: 3 }),
  ];
  const card = buildTripRealityCard(
    context({
      earningRules: rules,
      monthlySpendingByCategoryCard: [
        { cardId: "card-csp", category: "travel", monthlyAverage: 300 },
        { cardId: "card-freedom", category: "travel", monthlyAverage: 200 },
      ],
    }),
    inputs(),
    estimate(),
  );
  assert.ok(card?.bestCard);
  // CSP: 300 × 2 = 600; Freedom: 200 × 3 = 600 → tie, first wins; the equal
  // runner-up is reported but suppresses the comparison sentence.
  assert.equal(card.bestCard.cardName, "Sapphire Preferred");
  assert.equal(card.bestCard.monthlyPoints, 600);
  assert.equal(card.bestCard.nextBestMonthlyPoints, 600);
});

test("best card respects attribution: spend on a lower-rate card earns that card's rate", () => {
  const rules = [
    earningRule({ id: "rule-csp", cardProductId: "product-csp", rewardValue: 2 }),
    earningRule({ id: "rule-freedom", cardProductId: "product-freedom", rewardValue: 3 }),
  ];
  const card = buildTripRealityCard(
    context({
      earningRules: rules,
      monthlySpendingByCategoryCard: [
        { cardId: "card-csp", category: "travel", monthlyAverage: 400 },
        { cardId: "card-freedom", category: "travel", monthlyAverage: 100 },
      ],
    }),
    inputs(),
    estimate(),
  );
  assert.ok(card?.bestCard);
  assert.equal(card.bestCard.cardName, "Sapphire Preferred");
  assert.equal(card.bestCard.monthlyPoints, 800);
  assert.equal(card.bestCard.nextBestMonthlyPoints, 300);
});

test("best card fails closed: unverified rates, cash-back, merchant rules, inactive rules, missing attribution", () => {
  const warn: string[] = [];
  const base = context({
    monthlySpendingByCategoryCard: [{ cardId: "card-csp", category: "travel", monthlyAverage: 300 }],
  });
  const cases: Array<Partial<EarningRule>> = [
    { lastVerifiedAt: null },
    { rewardCurrency: "cashback" },
    { eligibleMerchant: "Delta" },
    { excludedMerchants: ["United"] },
    { active: false },
    { rewardValue: 0 },
  ];
  for (const ruleOverride of cases) {
    const card = buildTripRealityCard({ ...base, earningRules: [earningRule(ruleOverride)] }, inputs(), estimate());
    assert.equal(card?.bestCard, null, `expected null for ${JSON.stringify(ruleOverride)}`);
  }
  // No attribution at all → null without the no-attribution warning.
  const noAttribution = buildTripRealityCard(context(), inputs(), estimate());
  assert.equal(noAttribution?.bestCard, null);
  // Attribution exists but no verified rates → null plus the fixed warning.
  const unrateable = buildTripRealityCard(
    context({ monthlySpendingByCategoryCard: [{ cardId: "card-csp", category: "travel", monthlyAverage: 300 }], earningRules: [] }),
    inputs(),
    estimate(),
  );
  assert.equal(unrateable?.bestCard, null);
  assert.ok(unrateable?.warnings.includes("Card earnings for this trip could not be projected from verified card rates."));
  void warn;
});

test("exact category beats base rate; base wins when no exact rule exists", () => {
  const rules = [
    earningRule({ id: "rule-base", cardProductId: "product-csp", eligibleCategory: null, rewardValue: 1 }),
    earningRule({ id: "rule-travel", cardProductId: "product-csp", eligibleCategory: "travel", rewardValue: 2 }),
    earningRule({ id: "rule-base-high", cardProductId: "product-csp", eligibleCategory: "other", rewardValue: 5 }),
  ];
  // Exact travel (2x) beats base rates (1x and 5x) — specificity first, like the earn plan.
  const exact = buildTripRealityCard(
    context({ earningRules: rules, monthlySpendingByCategoryCard: [{ cardId: "card-csp", category: "travel", monthlyAverage: 100 }] }),
    inputs(),
    estimate(),
  );
  assert.ok(exact?.bestCard);
  assert.equal(exact.bestCard.rate, 2);
  // No travel rule → base ("other"/null, highest verified) applies.
  const baseOnly = buildTripRealityCard(
    context({
      earningRules: [earningRule({ id: "rule-base", eligibleCategory: null, rewardValue: 1 }), earningRule({ id: "rule-other", eligibleCategory: "other", rewardValue: 1.5 })],
      monthlySpendingByCategoryCard: [{ cardId: "card-csp", category: "travel", monthlyAverage: 100 }],
    }),
    inputs(),
    estimate(),
  );
  assert.ok(baseOnly?.bestCard);
  assert.equal(baseOnly.bestCard.rate, 1.5);
  assert.equal(baseOnly.bestCard.monthlyPoints, 150);
});

test("one_way option with a goal return date is labeled round trip (2-direction math)", () => {
  const card = buildTripRealityCard(
    context(),
    inputs({
      flightOptions: [flightOption({ pricingBasis: "one_way", pointsRequired: 60_000, cashFees: 40 })],
    }),
    estimate(),
  );
  assert.ok(card?.points);
  // 60,000 × 2 directions × 2 travelers = 240,000, labeled round trip.
  assert.equal(card.points.pointsRequired, 240_000);
  assert.equal(card.points.pricingBasis, "round_trip");
  assert.equal(card.points.fees, 40);
});

test("one_way option without a goal return date stays one way", () => {
  const noReturnGoal = { ...goal, latestReturn: null };
  const card = buildTripRealityCard(
    context({ goal: noReturnGoal }),
    inputs({
      flightOptions: [flightOption({ pricingBasis: "one_way", pointsRequired: 60_000 })],
    }),
    estimate(),
  );
  assert.ok(card?.points);
  // 60,000 × 2 traveler groups (no direction multiplier without a return date).
  assert.equal(card.points.pointsRequired, 120_000);
  assert.equal(card.points.pricingBasis, "one_way");
});

test("malformed present estimate values reject the cash side to null, never a fabricated figure", () => {
  const cases: Array<Partial<FlightPlanningEstimate>> = [
    { total: 0 },
    { total: -100 },
    { total: Number.NaN },
    { currency: "US" },
    { currency: 5 as unknown as string },
    { travelers: 0 },
    { priceCoverage: "per_person_total" as never },
  ];
  for (const override of cases) {
    const card = buildTripRealityCard(context(), inputs(), estimate(override));
    assert.ok(card, `card should build for ${JSON.stringify(override)}`);
    assert.equal(card.cash, null, `cash should be null for ${JSON.stringify(override)}`);
    assert.ok(card.points, "points side unaffected by cash-side rejection");
  }
});

test("fee warning is added when the winning option carries no fees", () => {
  const card = buildTripRealityCard(
    context(),
    inputs({ flightOptions: [flightOption({ cashFees: null })] }),
    estimate(),
  );
  assert.ok(card?.points);
  assert.equal(card.points.fees, null);
  assert.ok(card.warnings.includes("Taxes and fees are not included in this figure"));
});

test("inputs are never mutated", () => {
  const ctx = context({
    monthlySpendingByCategoryCard: [{ cardId: "card-csp", category: "travel", monthlyAverage: 300 }],
  });
  const ctxSnapshot = JSON.stringify(ctx);
  const cardInputs = inputs({ flightOptions: [flightOption(), flightOption({ id: "flight-2", programName: "United MileagePlus" })] });
  const inputsSnapshot = JSON.stringify(cardInputs);
  const est = estimate();
  const estSnapshot = JSON.stringify(est);
  buildTripRealityCard(ctx, cardInputs, est);
  assert.equal(JSON.stringify(ctx), ctxSnapshot);
  assert.equal(JSON.stringify(cardInputs), inputsSnapshot);
  assert.equal(JSON.stringify(est), estSnapshot);
});

test("deterministic across repeated builds", () => {
  const a = buildTripRealityCard(context(), inputs(), estimate());
  const b = buildTripRealityCard(context(), inputs(), estimate());
  assert.deepEqual(a, b);
});

test("points side explains missing traveler coverage instead of a bare 'not confirmed'", () => {
  // Options exist but none states traveler coverage → the requirement math
  // rejects everything; the card must carry the fixed reason.
  const noCoverage = buildTripRealityCard(
    context(),
    inputs({ flightOptions: [flightOption({ travelerCountCovered: undefined as unknown as number })] }),
    estimate(),
  );
  assert.ok(noCoverage?.points);
  assert.equal(noCoverage.points.status, "unavailable");
  assert.equal(
    noCoverage.points.unavailableReason,
    "The found benchmarks don't state how many travelers each price covers, so a trip total can't be calculated",
  );
  // With usable options the reason is explicitly absent.
  const okCard = buildTripRealityCard(context(), inputs(), estimate());
  assert.ok(okCard?.points);
  assert.equal(okCard.points.unavailableReason, null);
});
