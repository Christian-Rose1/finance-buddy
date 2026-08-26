import { test } from "node:test";
import assert from "node:assert/strict";

import type { Goal, RewardAccount } from "./types";
import type { PersonalizedStrategyContext } from "./strategyTypes";
import {
  buildSanitizedStrategyPayload,
  type SanitizedStrategyPrompt,
} from "./sanitizedStrategyPayload";

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

test("monthly spending, award options, card offers, sources pass through unchanged", () => {
  const context = makeContext();
  const result = buildSanitizedStrategyPayload(context, catalogRewardPrograms);

  assert.deepEqual(result.monthlySpendingByCategory, context.monthlySpendingByCategory);
  assert.deepEqual(result.awardOptions, context.awardOptions);
  assert.deepEqual(result.cardOffers, context.cardOffers);
  assert.deepEqual(result.sources, context.sources);
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