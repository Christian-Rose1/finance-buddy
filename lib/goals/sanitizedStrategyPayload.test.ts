import { test } from "node:test";
import assert from "node:assert/strict";

import type { Goal, RewardAccount } from "./types";
import type { PersonalizedStrategyContext } from "./strategyTypes";
import {
  buildSanitizedStrategyPayload,
  type SanitizedStrategyPrompt,
} from "./sanitizedStrategyPayload";
import { validateStrategyOutput } from "./strategyProviderCore";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const goal: Goal = {
  id: "goal-1",
  userId: "user-abc",
  type: "travel",
  title: "Europe Summer 2027",
  status: "active",
  origin: ["JFK"],
  destinations: ["CDG", "FCO"],
  earliestDeparture: "2027-06-01",
  latestReturn: "2027-06-20",
  minimumNights: 14,
  maximumNights: 21,
  travelerCount: 2,
  cabinPreference: "economy",
  optimizationPriority: "balanced",
  maximumCashBudget: 500,
  currency: "USD",
  allowNewCards: true,
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-15T00:00:00.000Z",
};

const rewardAccounts: RewardAccount[] = [
  {
    id: "ra-1",
    userId: "user-abc",
    rewardProgramId: "program-chase-ur",
    ownerKey: "self",
    ownerLabel: "Christian's Chase Sapphire",
    ownerType: "self",
    balance: 120000,
    balanceAsOf: "2026-08-01",
    origin: "manual",
    verificationStatus: "verified",
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
  },
  {
    id: "ra-2",
    userId: "user-abc",
    rewardProgramId: "program-unknown",
    ownerKey: "companion-1",
    ownerLabel: "Spouse",
    ownerType: "companion",
    balance: 50000,
    balanceAsOf: "2026-07-15",
    origin: "evidence",
    verificationStatus: "unverified",
    createdAt: "2026-07-15T00:00:00.000Z",
    updatedAt: "2026-07-15T00:00:00.000Z",
  },
];

const catalogRewardPrograms = [
  { id: "program-chase-ur", name: "Chase Ultimate Rewards" },
  { id: "program-amex-mr", name: "Amex Membership Rewards" },
];

function makeContext(
  overrides: Partial<PersonalizedStrategyContext> = {}
): PersonalizedStrategyContext {
  return {
    goal,
    rewardAccounts,
    walletCards: [
      {
        id: "wc-1",
        name: "Chase Sapphire Preferred",
        issuer: "Chase",
        rewardCurrency: "ultimate_rewards",
        cardProductId: "csp",
      },
      {
        id: "wc-2",
        name: "Amex Gold",
        issuer: "American Express",
        rewardCurrency: "membership_rewards",
        cardProductId: "amex-gold",
      },
    ],
    monthlySpendingByCategory: [
      { category: "dining", monthlyAverage: 450 },
      { category: "travel", monthlyAverage: 200 },
    ],
    awardOptions: [
      {
        id: "award-1",
        sourceId: "src-1",
        programName: "Air France Flying Blue",
        redemptionType: "flight",
        pricingBasis: "round_trip",
        itineraryLabel: "JFK-CDG round trip",
        pointsRequired: 120000,
        cashFees: 200,
        seats: 4,
        cabin: "economy",
        transferFromProgramId: null,
        transferRatio: null,
        centsPerPoint: 1.3,
        availabilityStatus: "available",
      },
    ],
    cardOffers: [
      {
        id: "offer-1",
        sourceId: "src-offer",
        cardName: "Chase Sapphire Preferred",
        issuer: "Chase",
        welcomeBonusPoints: 60000,
        spendingRequirement: 4000,
        spendingDeadlineMonths: 3,
        annualFee: 95,
        destinationProgramId: "program-chase-ur",
      },
    ],
    sources: [
      {
        id: "src-1",
        label: "Air France award search",
        status: "live",
        observedAt: "2026-08-20T00:00:00.000Z",
      },
      {
        id: "src-offer",
        label: "Chase card offer terms",
        status: "catalog",
        observedAt: null,
      },
    ],
    generatedAt: "2026-08-20T12:00:00.000Z",
    ...overrides,
  };
}

function collectAllStringValues(obj: unknown): string[] {
  const values: string[] = [];
  const seen = new WeakSet<object>();

  function walk(value: unknown): void {
    if (typeof value === "string") {
      values.push(value);
      return;
    }
    if (value === null || value === undefined) return;
    if (typeof value !== "object") return;
    if (seen.has(value as object)) return;
    seen.add(value as object);

    if (Array.isArray(value)) {
      for (const item of value) walk(item);
      return;
    }

    for (const v of Object.values(value as Record<string, unknown>)) {
      walk(v);
    }
  }

  walk(obj);
  return values;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test("no internal IDs leak into the sanitized payload", () => {
  const context = makeContext();
  const result = buildSanitizedStrategyPayload(context, catalogRewardPrograms);

  const allStrings = collectAllStringValues(result);

  // Goal internal IDs
  assert.ok(!allStrings.includes("goal-1"), "goal.id must not leak");
  assert.ok(!allStrings.includes("user-abc"), "goal.userId must not leak");

  // Reward account internal IDs
  assert.ok(!allStrings.includes("ra-1"), "rewardAccount.id must not leak");
  assert.ok(!allStrings.includes("ra-2"), "rewardAccount.id must not leak");

  // Wallet card internal IDs
  assert.ok(!allStrings.includes("wc-1"), "walletCard.id must not leak");
  assert.ok(!allStrings.includes("wc-2"), "walletCard.id must not leak");
  assert.ok(!allStrings.includes("csp"), "walletCard.cardProductId must not leak");
  assert.ok(!allStrings.includes("amex-gold"), "walletCard.cardProductId must not leak");
});

test("no userId leaks into the sanitized payload", () => {
  const context = makeContext();
  const result = buildSanitizedStrategyPayload(context, catalogRewardPrograms);

  const json = JSON.stringify(result);
  assert.ok(!json.includes("user-abc"), "userId must not appear anywhere");
  assert.ok(!json.includes('"userId"'), 'field name "userId" must not appear');
});

test("no ownerKey leaks into the sanitized payload", () => {
  const context = makeContext();
  const result = buildSanitizedStrategyPayload(context, catalogRewardPrograms);

  const json = JSON.stringify(result);
  // ownerKey field name must not appear anywhere.
  assert.ok(!json.includes('"ownerKey"'), 'field name "ownerKey" must not appear');
  // The specific ownerKey value "companion-1" must not leak.
  // ("self" is a valid ownerType value and is expected in the output.)
  assert.ok(!json.includes("companion-1"), "ownerKey value must not leak");
});

test("no ownerLabel leaks into the sanitized payload", () => {
  const context = makeContext();
  const result = buildSanitizedStrategyPayload(context, catalogRewardPrograms);

  const json = JSON.stringify(result);
  assert.ok(
    !json.includes("Christian's Chase Sapphire"),
    "ownerLabel must not leak"
  );
  assert.ok(!json.includes("Spouse"), "ownerLabel must not leak");
  assert.ok(!json.includes('"ownerLabel"'), 'field name "ownerLabel" must not appear');
});

test("no rewardProgramId leaks into the sanitized payload", () => {
  const context = makeContext();
  const result = buildSanitizedStrategyPayload(context, catalogRewardPrograms);

  // The field name "rewardProgramId" must not appear anywhere in the
  // sanitized payload (it is stripped from reward accounts). The value
  // "program-chase-ur" may legitimately appear in card-offer
  // destinationProgramId fields, so we only check the field name.
  const json = JSON.stringify(result);
  assert.ok(
    !json.includes('"rewardProgramId"'),
    'field name "rewardProgramId" must not appear'
  );
});

test("no balanceAsOf leaks into the sanitized payload", () => {
  const context = makeContext();
  const result = buildSanitizedStrategyPayload(context, catalogRewardPrograms);

  const json = JSON.stringify(result);
  assert.ok(!json.includes("2026-08-01"), "balanceAsOf must not leak");
  assert.ok(!json.includes("2026-07-15"), "balanceAsOf must not leak");
  assert.ok(
    !json.includes('"balanceAsOf"'),
    'field name "balanceAsOf" must not appear'
  );
});

test("no createdAt or updatedAt leak from goal or reward accounts", () => {
  const context = makeContext();
  const result = buildSanitizedStrategyPayload(context, catalogRewardPrograms);

  const json = JSON.stringify(result);
  assert.ok(!json.includes('"createdAt"'), "createdAt must not appear");
  assert.ok(!json.includes('"updatedAt"'), "updatedAt must not appear");
});

test("goal status does not leak", () => {
  const context = makeContext();
  const result = buildSanitizedStrategyPayload(context, catalogRewardPrograms);

  // Verify the sanitized goal object does not have a "status" property.
  // (Sources may have their own "status" field, which is legitimate.)
  assert.ok(!("status" in result.goal), "goal.status must not be present");
});

test("program names are resolved from the catalog", () => {
  const context = makeContext();
  const result = buildSanitizedStrategyPayload(context, catalogRewardPrograms);

  assert.equal(result.pointsInventory.length, 2);

  // First account: program-chase-ur → "Chase Ultimate Rewards"
  assert.equal(
    result.pointsInventory[0].programName,
    "Chase Ultimate Rewards"
  );

  // Second account: program-unknown → not in catalog → null
  assert.equal(result.pointsInventory[1].programName, null);
});

test("all required top-level fields are present", () => {
  const context = makeContext();
  const result = buildSanitizedStrategyPayload(context, catalogRewardPrograms);

  assert.ok("goal" in result, "goal must be present");
  assert.ok("pointsInventory" in result, "pointsInventory must be present");
  assert.ok("walletCards" in result, "walletCards must be present");
  assert.ok(
    "monthlySpendingByCategory" in result,
    "monthlySpendingByCategory must be present"
  );
  assert.ok("awardOptions" in result, "awardOptions must be present");
  assert.ok("cardOffers" in result, "cardOffers must be present");
  assert.ok("sources" in result, "sources must be present");
  assert.ok("generatedAt" in result, "generatedAt must be present");
});

test("goal required fields are present and correct", () => {
  const context = makeContext();
  const result = buildSanitizedStrategyPayload(context, catalogRewardPrograms);

  assert.equal(result.goal.type, "travel");
  assert.equal(result.goal.title, "Europe Summer 2027");
  assert.deepEqual(result.goal.origin, ["JFK"]);
  assert.deepEqual(result.goal.destinations, ["CDG", "FCO"]);
  assert.equal(result.goal.earliestDeparture, "2027-06-01");
  assert.equal(result.goal.latestReturn, "2027-06-20");
  assert.equal(result.goal.minimumNights, 14);
  assert.equal(result.goal.maximumNights, 21);
  assert.equal(result.goal.travelerCount, 2);
  assert.equal(result.goal.cabinPreference, "economy");
  assert.equal(result.goal.optimizationPriority, "balanced");
  assert.equal(result.goal.maximumCashBudget, 500);
  assert.equal(result.goal.currency, "USD");
  assert.equal(result.goal.allowNewCards, true);
});

test("points inventory preserves ownerType, balance, verificationStatus, origin", () => {
  const context = makeContext();
  const result = buildSanitizedStrategyPayload(context, catalogRewardPrograms);

  assert.equal(result.pointsInventory.length, 2);

  const selfItem = result.pointsInventory[0];
  assert.equal(selfItem.ownerType, "self");
  assert.equal(selfItem.balance, 120000);
  assert.equal(selfItem.verificationStatus, "verified");
  assert.equal(selfItem.origin, "manual");

  const companionItem = result.pointsInventory[1];
  assert.equal(companionItem.ownerType, "companion");
  assert.equal(companionItem.balance, 50000);
  assert.equal(companionItem.verificationStatus, "unverified");
  assert.equal(companionItem.origin, "evidence");
});

test("wallet cards preserve name, issuer, rewardCurrency but not id or cardProductId", () => {
  const context = makeContext();
  const result = buildSanitizedStrategyPayload(context, catalogRewardPrograms);

  assert.equal(result.walletCards.length, 2);

  const card1 = result.walletCards[0];
  assert.equal(card1.name, "Chase Sapphire Preferred");
  assert.equal(card1.issuer, "Chase");
  assert.equal(card1.rewardCurrency, "ultimate_rewards");
  assert.ok(!("id" in card1), "wallet card id must not be present");
  assert.ok(
    !("cardProductId" in card1),
    "wallet card cardProductId must not be present"
  );

  const card2 = result.walletCards[1];
  assert.equal(card2.name, "Amex Gold");
  assert.equal(card2.issuer, "American Express");
  assert.equal(card2.rewardCurrency, "membership_rewards");
});

test("model payload uses opaque references while server reference map retains validated facts", () => {
  const baseContext = makeContext();
  const context = makeContext({
    awardOptions: [{ ...baseContext.awardOptions[0], id: "award-server-record-42" }],
  });
  const result = buildSanitizedStrategyPayload(context, catalogRewardPrograms);

  assert.deepEqual(result.monthlySpendingByCategory, context.monthlySpendingByCategory);
  assert.equal(result.awardOptions[0]?.id, "award-1");
  assert.notEqual(result.awardOptions[0]?.id, context.awardOptions[0]?.id);
  assert.equal(result.cardOffers[0]?.id, "card-1");
  assert.equal(result.sources[0]?.id, "source-1");
  assert.deepEqual(result.referenceMap.awardOptions, context.awardOptions);
  assert.deepEqual(result.referenceMap.cardOffers, context.cardOffers);
  assert.deepEqual(result.referenceMap.sources, context.sources);
  const serialized = JSON.stringify(result);
  assert.ok(!serialized.includes('"id":"offer-1"'));
  assert.ok(!serialized.includes('"id":"src-1"'));
  assert.ok(!serialized.includes("program-chase-ur"));
});

test("grounded brief retains saved two-traveler goal facts and deterministic facts", () => {
  const context = makeContext({
    goal: { ...goal, minimumNights: 8, maximumNights: 16 },
  });
  const result = buildSanitizedStrategyPayload(context, catalogRewardPrograms);

  assert.equal(result.brief.goal.travelerCount, 2);
  assert.equal(result.brief.goal.resolvedTripNights, 8);
  assert.equal(result.brief.goal.minimumNights, 8);
  assert.equal(result.brief.goal.maximumNights, 16);
  assert.equal(result.brief.pointsSummary[0]?.verifiedPoints, 120000);
  assert.ok(Array.isArray(result.brief.allocationScenarios));
});

test("records with unresolved sources are excluded before opaque references are built", () => {
  const context = makeContext({
    awardOptions: [{ ...makeContext().awardOptions[0], sourceId: "missing-award-source" }],
    cardOffers: [{ ...makeContext().cardOffers[0], sourceId: "missing-card-source" }],
  });
  const result = buildSanitizedStrategyPayload(context, catalogRewardPrograms);

  assert.deepEqual(result.awardOptions, []);
  assert.deepEqual(result.cardOffers, []);
  assert.deepEqual(result.referenceMap.awardOptions, []);
  assert.deepEqual(result.referenceMap.cardOffers, []);
  assert.equal(result.referenceMap.excludedSourceBoundRecords, true);
  assert.ok(result.brief.sanitizationWarnings.length > 0);
  assert.ok(!JSON.stringify(result).includes("source-unknown"));
});

test("source-less research records are excluded while valid sibling records remain grounded", () => {
  const baseContext = makeContext();
  const sourceLessAward = {
    ...baseContext.awardOptions[0],
    id: "award-missing-source",
    sourceId: "missing-award-source",
    itineraryLabel: "Unmapped award option",
  };
  const sourceLessOffer = {
    ...baseContext.cardOffers[0],
    id: "offer-missing-source",
    sourceId: "missing-card-source",
    cardName: "Unmapped card offer",
  };
  const result = buildSanitizedStrategyPayload({
    ...baseContext,
    awardOptions: [...baseContext.awardOptions, sourceLessAward],
    cardOffers: [...baseContext.cardOffers, sourceLessOffer],
  }, catalogRewardPrograms);

  assert.equal(result.awardOptions.length, 1);
  assert.equal(result.cardOffers.length, 1);
  assert.equal(result.referenceMap.awardOptions.length, 1);
  assert.equal(result.referenceMap.cardOffers.length, 1);
  assert.equal(result.brief.optionRequirements.length, 1);
  assert.ok(result.brief.allocationScenarios.length > 0);
  const cloudPayload = JSON.stringify(result);
  assert.ok(!cloudPayload.includes("award-missing-source"));
  assert.ok(!cloudPayload.includes("offer-missing-source"));
  assert.ok(!cloudPayload.includes("Unmapped award option"));
  assert.ok(!cloudPayload.includes("Unmapped card offer"));
  assert.ok(!cloudPayload.includes("source-unknown"));

  const finalStrategy = validateStrategyOutput({
    headline: "Grounded plan",
    summary: "Use the validated option.",
    feasibility: "insufficient_information",
    pointsGap: null,
    recommendedAwardOptionId: null,
    recommendedCardOfferId: null,
    actions: [],
    alternatives: [],
    assumptions: [],
    warnings: [],
    followUpTopics: [],
  }, {
    awardOptions: result.awardOptions,
    cardOffers: result.cardOffers,
    sources: result.sources,
    goal: { allowNewCards: true },
    referenceMap: result.referenceMap,
  }, "test", "test-model");
  assert.deepEqual(finalStrategy.flightOptions, baseContext.awardOptions);
  assert.deepEqual(finalStrategy.hotelOptions, []);
  assert.ok(!JSON.stringify(finalStrategy).includes("award-missing-source"));
  assert.ok(!JSON.stringify(finalStrategy).includes("offer-missing-source"));
});

test("generatedAt is preserved", () => {
  const context = makeContext();
  const result = buildSanitizedStrategyPayload(context, catalogRewardPrograms);

  assert.equal(result.generatedAt, "2026-08-20T12:00:00.000Z");
});

test("input context is not mutated", () => {
  const context = makeContext();
  const before = JSON.stringify(context);

  buildSanitizedStrategyPayload(context, catalogRewardPrograms);

  const after = JSON.stringify(context);
  assert.equal(after, before, "input context must not be mutated");
});

test("empty reward accounts produce empty points inventory", () => {
  const context = makeContext({ rewardAccounts: [] });
  const result = buildSanitizedStrategyPayload(context, catalogRewardPrograms);

  assert.deepEqual(result.pointsInventory, []);
});

test("empty wallet cards produce empty wallet cards array", () => {
  const context = makeContext({ walletCards: [] });
  const result = buildSanitizedStrategyPayload(context, catalogRewardPrograms);

  assert.deepEqual(result.walletCards, []);
});

test("empty catalog produces null program names for all accounts", () => {
  const context = makeContext();
  const result = buildSanitizedStrategyPayload(context, []);

  assert.equal(result.pointsInventory.length, 2);
  assert.equal(result.pointsInventory[0].programName, null);
  assert.equal(result.pointsInventory[1].programName, null);
});
