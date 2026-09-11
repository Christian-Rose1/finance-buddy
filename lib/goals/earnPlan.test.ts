import assert from "node:assert/strict";
import { test } from "node:test";

import type { EarningRule } from "@/lib/rewards/catalogTypes";
import type {
  FlightPlanningEstimate,
} from "./flightPlanningEstimate";
import type {
  Goal,
  RewardAccount,
} from "./types";
import type {
  PersonalizedStrategyContext,
} from "./strategyTypes";
import {
  EARN_PLAN_DISCLOSURE,
  EARN_PLAN_LABEL,
  EARN_PLAN_TRIP_CASH_SOURCE,
  EARN_PLAN_WARNING_ACCOUNTS_TRUNCATED,
  EARN_PLAN_WARNING_CURRENCY_MISMATCH,
  EARN_PLAN_WARNING_HORIZON_CAPPED,
  EARN_PLAN_WARNING_MIXED_CURRENCY,
  EARN_PLAN_WARNING_UNVERIFIED_BALANCE,
  buildEarnPlan,
  monthsUntilDeparture,
  monthlyPointsForCard,
  projectEarnPlan,
  ruleCategoryMatchesSpending,
  selectVerifiedPointEarnRates,
} from "./earnPlan";

const NOW = new Date("2026-09-09T00:00:00Z");

function earningRule(
  overrides: Partial<EarningRule> & Pick<EarningRule, "id" | "cardProductId">,
): EarningRule {
  return {
    type: "earning_rate",
    eligibleCategory: null,
    eligibleMerchant: null,
    excludedMerchants: [],
    rewardCurrency: "points",
    rewardValue: 1,
    percentage: null,
    fixedValue: null,
    explanation: "",
    source: "development_fixture",
    lastVerifiedAt: "2026-08-16T10:50:00Z",
    active: true,
    metadata: null,
    ...overrides,
  };
}

function goal(overrides: Partial<Goal> = {}): Goal {
  return {
    id: "goal-1",
    userId: "user-1",
    type: "travel",
    title: "Copenhagen trip",
    status: "active",
    origin: ["Denver"],
    destinations: ["Copenhagen, Denmark"],
    earliestDeparture: "2027-07-01",
    latestReturn: "2027-07-15",
    minimumNights: null,
    maximumNights: null,
    travelerCount: 2,
    cabinPreference: "economy",
    optimizationPriority: "balanced",
    maximumCashBudget: 5000,
    currency: "USD",
    allowNewCards: false,
    createdAt: "2026-09-01T00:00:00Z",
    updatedAt: "2026-09-01T00:00:00Z",
    ...overrides,
  };
}

function rewardAccount(
  overrides: Partial<RewardAccount> = {},
): RewardAccount {
  return {
    id: "account-1",
    userId: "user-1",
    rewardProgramId: "chase-ur",
    ownerKey: "self",
    ownerLabel: "You",
    ownerType: "self",
    balance: 80000,
    balanceAsOf: "2026-09-01T00:00:00Z",
    origin: "manual",
    verificationStatus: "verified",
    createdAt: "2026-09-01T00:00:00Z",
    updatedAt: "2026-09-01T00:00:00Z",
    ...overrides,
  };
}

function flightEstimate(
  overrides: Partial<FlightPlanningEstimate> = {},
): FlightPlanningEstimate {
  return {
    label: "Flight planning estimate",
    origin: "DEN",
    destination: "CPH",
    outboundDate: "2027-07-01",
    returnDate: "2027-07-15",
    travelers: 2,
    cabin: "economy",
    currency: "USD",
    total: 1200,
    priceCoverage: "searched_party_total",
    retrievedAt: "2026-09-09T00:00:00Z",
    outboundSegments: [],
    returnSegments: [],
    unknowns: [],
    evidenceLabel: "Planning estimate",
    verificationLabel: "Not customer-verified",
    availabilityLabel: "Not live or bookable; verify before booking",
    ...overrides,
  };
}

function context(
  overrides: Partial<PersonalizedStrategyContext> = {},
): PersonalizedStrategyContext {
  return {
    goal: goal(),
    rewardAccounts: [],
    walletCards: [],
    monthlySpendingByCategory: [],
    awardOptions: [],
    cardOffers: [],
    sources: [],
    generatedAt: "2026-09-09T00:00:00Z",
    earningRules: [],
    walletCardProgramIds: {},
    ...overrides,
  };
}

/** The fixture user from the R1 acceptance scenario. */
function fixtureContext(): PersonalizedStrategyContext {
  return context({
    goal: goal(),
    rewardAccounts: [rewardAccount()],
    walletCards: [
      {
        id: "card-sapphire",
        name: "Sapphire Preferred",
        issuer: "Chase",
        rewardCurrency: "points",
        cardProductId: "sapphire-product",
      },
      {
        id: "card-gold",
        name: "Gold Card",
        issuer: "American Express",
        rewardCurrency: "points",
        cardProductId: "gold-product",
      },
    ],
    monthlySpendingByCategory: [
      { category: "food:dining", monthlyAverage: 400 },
      { category: "Groceries", monthlyAverage: 300 },
      { category: "travel:airfare", monthlyAverage: 250 },
    ],
    monthlySpendingByCategoryCard: [
      { cardId: "card-sapphire", category: "food:dining", monthlyAverage: 400 },
      { cardId: "card-sapphire", category: "Groceries", monthlyAverage: 300 },
      { cardId: "card-gold", category: "travel:airfare", monthlyAverage: 250 },
    ],
    earningRules: [
      earningRule({
        id: "rule-sapphire-dining",
        cardProductId: "sapphire-product",
        eligibleCategory: "food:dining",
        rewardValue: 3,
      }),
      earningRule({
        id: "rule-sapphire-base",
        cardProductId: "sapphire-product",
        eligibleCategory: "other",
        rewardValue: 1,
      }),
      earningRule({
        id: "rule-gold-dining",
        cardProductId: "gold-product",
        eligibleCategory: "food:dining",
        rewardValue: 4,
      }),
      earningRule({
        id: "rule-gold-airfare",
        cardProductId: "gold-product",
        eligibleCategory: "travel:airfare",
        rewardValue: 3,
      }),
    ],
    walletCardProgramIds: {
      "card-sapphire": "chase-ur",
      "card-gold": "amex-mr",
    },
  });
}

const PROGRAM_NAMES = new Map([
  ["chase-ur", "Chase Ultimate Rewards"],
  ["amex-mr", "Membership Rewards"],
]);

// ---------------------------------------------------------------------------
// selectVerifiedPointEarnRates
// ---------------------------------------------------------------------------

test("selectVerifiedPointEarnRates keeps verified active points rules", () => {
  const rates = selectVerifiedPointEarnRates([
    earningRule({ id: "r1", cardProductId: "p1", rewardValue: 3 }),
  ]);
  assert.equal(rates.size, 1);
  const list = rates.get("p1");
  assert.ok(list);
  assert.equal(list.length, 1);
  assert.equal(list[0].pointsPerDollar, 3);
  assert.equal(list[0].currency, "points");
});

test("selectVerifiedPointEarnRates drops unverified, inactive, cashback, non-earning, and merchant-scoped rules", () => {
  const rates = selectVerifiedPointEarnRates([
    earningRule({ id: "unverified", cardProductId: "p1", lastVerifiedAt: null }),
    earningRule({ id: "inactive", cardProductId: "p2", active: false }),
    earningRule({ id: "cashback", cardProductId: "p3", rewardCurrency: "cashback", rewardValue: 0, percentage: 3 }),
    earningRule({ id: "miles-ok", cardProductId: "p4", rewardCurrency: "miles", rewardValue: 2 }),
    earningRule({ id: "statement", cardProductId: "p5", type: "statement_credit", rewardValue: 5 }),
    earningRule({ id: "offer", cardProductId: "p6", type: "offer", rewardValue: 5 }),
    earningRule({ id: "merchant", cardProductId: "p7", eligibleMerchant: "Target" }),
    earningRule({ id: "excluded", cardProductId: "p8", excludedMerchants: ["Walmart"] }),
    earningRule({ id: "zero", cardProductId: "p9", rewardValue: 0 }),
    earningRule({ id: "negative", cardProductId: "p10", rewardValue: -2 }),
  ]);
  // Only p4 (miles) survives; cashback/zero/negative never contribute.
  assert.equal(rates.size, 1);
  assert.ok(rates.get("p4"));
});

test("selectVerifiedPointEarnRates returns an empty map for null or hostile input", () => {
  assert.equal(selectVerifiedPointEarnRates(null).size, 0);
  assert.equal(selectVerifiedPointEarnRates(undefined).size, 0);
  assert.equal(
    selectVerifiedPointEarnRates([null, "hostile", 42] as unknown as EarningRule[]).size,
    0,
  );
});

// ---------------------------------------------------------------------------
// ruleCategoryMatchesSpending
// ---------------------------------------------------------------------------

test("rule matching: exact leaf, root wildcard over leaves, no leaf-to-root or cross-root coverage", () => {
  assert.equal(ruleCategoryMatchesSpending("food:dining", "food:dining"), true);
  assert.equal(ruleCategoryMatchesSpending("food", "food:dining"), true);
  assert.equal(ruleCategoryMatchesSpending("food:dining", "food:dining:takeout") === true, false);
  // A leaf rule never covers its root-level spending.
  assert.equal(ruleCategoryMatchesSpending("food:dining", "food"), false);
  // A root rule never covers a different root.
  assert.equal(ruleCategoryMatchesSpending("food", "travel:airfare"), false);
  // Root-level rule matches root-level spending exactly.
  assert.equal(ruleCategoryMatchesSpending("other", "other"), true);
});

// ---------------------------------------------------------------------------
// monthlyPointsForCard
// ---------------------------------------------------------------------------

test("category rate wins over base rate per spending category", () => {
  const rates = selectVerifiedPointEarnRates([
    earningRule({ id: "dining", cardProductId: "p1", eligibleCategory: "food:dining", rewardValue: 3 }),
    earningRule({ id: "base", cardProductId: "p1", eligibleCategory: "other", rewardValue: 1 }),
  ]);
  const monthly = monthlyPointsForCard(rates.get("p1") ?? [], [
    { category: "food:dining", monthlyAverage: 400 },
    { category: "other", monthlyAverage: 200 },
  ]);
  // 400 × 3 (category rule) + 200 × 1 (other rule) = 1400.
  assert.equal(monthly, 1400);
});

test("legacy spending categories are normalized before matching", () => {
  const rates = selectVerifiedPointEarnRates([
    earningRule({ id: "food-root", cardProductId: "p1", eligibleCategory: "food", rewardValue: 2 }),
  ]);
  // "Groceries" normalizes to food:groceries, covered by the food root rule.
  const monthly = monthlyPointsForCard(rates.get("p1") ?? [], [
    { category: "Groceries", monthlyAverage: 100 },
  ]);
  assert.equal(monthly, 200);
});

test("unrecognized spending categories earn nothing without a null-category base rule", () => {
  const rates = selectVerifiedPointEarnRates([
    earningRule({ id: "dining", cardProductId: "p1", eligibleCategory: "food:dining", rewardValue: 3 }),
  ]);
  const monthly = monthlyPointsForCard(rates.get("p1") ?? [], [
    { category: "uncategorized", monthlyAverage: 100 },
  ]);
  assert.equal(monthly, 0);
});

test("the highest verified null-category base rate applies to unmatched spending", () => {
  const rates = selectVerifiedPointEarnRates([
    earningRule({ id: "base-low", cardProductId: "p1", rewardValue: 1 }),
    earningRule({ id: "base-high", cardProductId: "p1", rewardValue: 1.5 }),
  ]);
  const monthly = monthlyPointsForCard(rates.get("p1") ?? [], [
    { category: "uncategorized", monthlyAverage: 100 },
  ]);
  assert.equal(monthly, 150);
});

test("empty rates or spending produce zero", () => {
  assert.equal(monthlyPointsForCard([], [{ category: "food", monthlyAverage: 100 }]), 0);
  assert.equal(monthlyPointsForCard(selectVerifiedPointEarnRates([
    earningRule({ id: "r", cardProductId: "p1" }),
  ]).get("p1") ?? [], []), 0);
});

// ---------------------------------------------------------------------------
// monthsUntilDeparture
// ---------------------------------------------------------------------------

test("whole calendar months are computed in UTC with no time or DST effects", () => {
  assert.deepEqual(monthsUntilDeparture("2027-07-01", NOW), { months: 10, capped: false });
  assert.deepEqual(monthsUntilDeparture("2026-09-20", NOW), { months: 0, capped: false });
  assert.deepEqual(monthsUntilDeparture("2026-08-01", NOW), { months: 0, capped: false });
});

test("malformed or impossible dates return null without guessing", () => {
  assert.deepEqual(monthsUntilDeparture(null, NOW), { months: null, capped: false });
  assert.deepEqual(monthsUntilDeparture("not-a-date", NOW), { months: null, capped: false });
  assert.deepEqual(monthsUntilDeparture("2027-13-01", NOW), { months: null, capped: false });
  assert.deepEqual(monthsUntilDeparture("2027-02-30", NOW), { months: null, capped: false });
});

test("horizons beyond 36 months are capped, not projected", () => {
  assert.deepEqual(monthsUntilDeparture("2029-10-01", NOW), { months: null, capped: true });
  assert.deepEqual(monthsUntilDeparture("2029-09-01", NOW), { months: 36, capped: false });
});

// ---------------------------------------------------------------------------
// buildEarnPlan — the fixture-user acceptance scenario
// ---------------------------------------------------------------------------

test("fixture user: verified rates, spending, and balances produce the exact plan", () => {
  const plan = buildEarnPlan(fixtureContext(), PROGRAM_NAMES, flightEstimate(), NOW);
  assert.ok(plan);
  assert.equal(plan.schemaVersion, 1);
  assert.equal(plan.label, EARN_PLAN_LABEL);
  assert.equal(plan.disclosure, EARN_PLAN_DISCLOSURE);

  assert.equal(plan.accounts.length, 2);

  // Sapphire: attributed dining 400×3 + groceries 300×1 (other base) = 1500/mo.
  // The airfare is on the Gold card and does NOT earn here.
  const chase = plan.accounts[0];
  assert.equal(chase.key, "earn-1");
  assert.equal(chase.programName, "Chase Ultimate Rewards");
  assert.equal(chase.rewardCurrencyLabel, "points");
  assert.equal(chase.currentBalance, 80000);
  assert.equal(chase.balanceVerification, "verified");
  assert.equal(chase.monthlyPoints, 1500);
  assert.equal(chase.monthsProjected, 10);
  assert.equal(chase.projectedBalance, 95000);
  assert.deepEqual(chase.cardNames, ["Sapphire Preferred"]);

  // Gold: attributed airfare 250×3 = 750/mo; the wallet-wide dining total is
  // NOT credited here because those purchases used the Sapphire card.
  const amex = plan.accounts[1];
  assert.equal(amex.key, "earn-2");
  assert.equal(amex.programName, "Membership Rewards");
  assert.equal(amex.currentBalance, 0);
  assert.equal(amex.balanceVerification, "no_account");
  assert.equal(amex.monthlyPoints, 750);
  assert.equal(amex.projectedBalance, 7500);
  assert.deepEqual(amex.cardNames, ["Gold Card"]);

  // Missing-account projections surface the fixed provisional warning.
  assert.ok(plan.warnings.includes(EARN_PLAN_WARNING_UNVERIFIED_BALANCE));

  // Searched party-total cash carried through unchanged; budget gap computed.
  assert.deepEqual(plan.tripCash, {
    amount: 1200,
    currency: "USD",
    sources: [EARN_PLAN_TRIP_CASH_SOURCE],
  });
  assert.deepEqual(plan.cashGap, {
    currency: "USD",
    tripTotal: 1200,
    cashBudget: 5000,
    remaining: 3800,
  });
});

test("companion accounts are never combined with self earnings", () => {
  // Both a self and a companion account exist for the same program; the
  // projection must attach to the self account only.
  const plan = buildEarnPlan(
    {
      ...fixtureContext(),
      rewardAccounts: [
        rewardAccount(),
        rewardAccount({
          id: "account-companion",
          ownerKey: "companion",
          ownerLabel: "Sam",
          ownerType: "companion",
          balance: 50000,
        }),
      ],
    },
    PROGRAM_NAMES,
    null,
    NOW,
  );
  assert.ok(plan);
  const chase = plan.accounts.find((a) => a.programName === "Chase Ultimate Rewards");
  assert.ok(chase);
  assert.equal(chase.currentBalance, 80000);
  assert.equal(chase.balanceVerification, "verified");
});

test("a companion-only account does not create a projection for that owner", () => {
  const plan = buildEarnPlan(
    context({
      walletCards: [
        {
          id: "card-companion",
          name: "Companion Card",
          issuer: "Chase",
          rewardCurrency: "points",
          cardProductId: "sapphire-product",
        },
      ],
      earningRules: [
        earningRule({ id: "r", cardProductId: "sapphire-product", rewardValue: 2 }),
      ],
      walletCardProgramIds: { "card-companion": "chase-ur" },
      monthlySpendingByCategoryCard: [
        { cardId: "card-companion", category: "other", monthlyAverage: 100 },
      ],
      rewardAccounts: [
        rewardAccount({ ownerType: "companion", ownerKey: "companion", ownerLabel: "Sam", balance: 50000 }),
      ],
    }),
    PROGRAM_NAMES,
    null,
    NOW,
  );
  assert.ok(plan);
  assert.equal(plan.accounts.length, 1);
  assert.equal(plan.accounts[0].balanceVerification, "no_account");
  assert.equal(plan.accounts[0].currentBalance, 0);
});

test("undated goals produce balance-only projections", () => {
  const plan = buildEarnPlan(
    {
      ...fixtureContext(),
      goal: goal({ earliestDeparture: null }),
    },
    PROGRAM_NAMES,
    flightEstimate(),
    NOW,
  );
  assert.ok(plan);
  for (const account of plan.accounts) {
    assert.equal(account.monthsProjected, null);
    assert.equal(account.projectedBalance, null);
  }
  // Trip cash and the budget gap are date-independent: the searched total
  // and the goal's budget still compare directly.
  assert.ok(plan.tripCash);
  assert.deepEqual(plan.cashGap, {
    currency: "USD",
    tripTotal: 1200,
    cashBudget: 5000,
    remaining: 3800,
  });
});

test("capped horizons warn and omit projections beyond 36 months", () => {
  const plan = buildEarnPlan(
    {
      ...fixtureContext(),
      goal: goal({ earliestDeparture: "2030-01-01" }),
    },
    PROGRAM_NAMES,
    null,
    NOW,
  );
  assert.ok(plan);
  assert.ok(plan.warnings.includes(EARN_PLAN_WARNING_HORIZON_CAPPED));
  for (const account of plan.accounts) {
    assert.equal(account.monthsProjected, null);
    assert.equal(account.projectedBalance, null);
    assert.equal(account.horizonCapped, true);
  }
});

test("currency mismatch omits the cash comparison with a fixed warning", () => {
  const plan = buildEarnPlan(
    fixtureContext(),
    PROGRAM_NAMES,
    flightEstimate({ currency: "EUR" }),
    NOW,
  );
  assert.ok(plan);
  assert.equal(plan.tripCash, null);
  assert.equal(plan.cashGap, null);
  assert.ok(plan.warnings.includes(EARN_PLAN_WARNING_CURRENCY_MISMATCH));
});

test("a goal without a cash budget yields trip cash but no gap", () => {
  const plan = buildEarnPlan(
    {
      ...fixtureContext(),
      goal: goal({ maximumCashBudget: null }),
    },
    PROGRAM_NAMES,
    flightEstimate(),
    NOW,
  );
  assert.ok(plan);
  assert.ok(plan.tripCash);
  assert.equal(plan.cashGap, null);
});

test("cash-back-only verified rules produce no plan", () => {
  const plan = buildEarnPlan(
    context({
      walletCards: [
        {
          id: "card-cash",
          name: "Freedom Unlimited",
          issuer: "Chase",
          rewardCurrency: "cashback",
          cardProductId: "cash-product",
        },
      ],
      earningRules: [
        earningRule({
          id: "cash-dining",
          cardProductId: "cash-product",
          rewardCurrency: "cashback",
          rewardValue: 0,
          percentage: 3,
        }),
      ],
      walletCardProgramIds: { "card-cash": "chase-cash" },
    }),
    PROGRAM_NAMES,
    null,
    NOW,
  );
  assert.equal(plan, null);
});

test("cards whose verified rates mix currencies are omitted with a fixed warning", () => {
  const plan = buildEarnPlan(
    context({
      walletCards: [
        {
          id: "card-mixed",
          name: "Mixed Card",
          issuer: "Odd Bank",
          rewardCurrency: "points",
          cardProductId: "mixed-product",
        },
      ],
      earningRules: [
        earningRule({ id: "r-points", cardProductId: "mixed-product", rewardCurrency: "points", rewardValue: 2 }),
        earningRule({ id: "r-miles", cardProductId: "mixed-product", rewardCurrency: "miles", rewardValue: 1 }),
      ],
      walletCardProgramIds: { "card-mixed": "odd-program" },
    }),
    PROGRAM_NAMES,
    null,
    NOW,
  );
  assert.equal(plan, null);
});

test("points and miles programs stay separate with their own labels", () => {
  const plan = buildEarnPlan(
    context({
      walletCards: [
        {
          id: "card-points",
          name: "Points Card",
          issuer: "Bank A",
          rewardCurrency: "points",
          cardProductId: "points-product",
        },
        {
          id: "card-miles",
          name: "Miles Card",
          issuer: "Airline B",
          rewardCurrency: "miles",
          cardProductId: "miles-product",
        },
      ],
      earningRules: [
        earningRule({ id: "rp", cardProductId: "points-product", rewardValue: 2 }),
        earningRule({ id: "rm", cardProductId: "miles-product", rewardCurrency: "miles", rewardValue: 3 }),
      ],
      walletCardProgramIds: {
        "card-points": "bank-points",
        "card-miles": "airline-miles",
      },
      monthlySpendingByCategoryCard: [
        { cardId: "card-points", category: "other", monthlyAverage: 100 },
        { cardId: "card-miles", category: "other", monthlyAverage: 100 },
      ],
    }),
    PROGRAM_NAMES,
    null,
    NOW,
  );
  assert.ok(plan);
  assert.equal(plan.accounts.length, 2);
  assert.equal(plan.accounts[0].rewardCurrencyLabel, "points");
  assert.equal(plan.accounts[0].monthlyPoints, 200);
  assert.equal(plan.accounts[1].rewardCurrencyLabel, "miles");
  assert.equal(plan.accounts[1].monthlyPoints, 300);
});

test("unverified catalog rates contribute nothing even when spending exists", () => {
  const plan = buildEarnPlan(
    {
      ...fixtureContext(),
      earningRules: fixtureContext().earningRules?.map((rule) => ({
        ...rule,
        lastVerifiedAt: null,
      })) ?? null,
    },
    PROGRAM_NAMES,
    null,
    NOW,
  );
  assert.equal(plan, null);
});

test("buildEarnPlan does not mutate its inputs", () => {
  const input = fixtureContext();
  const snapshot = structuredClone(input);
  buildEarnPlan(input, PROGRAM_NAMES, flightEstimate(), NOW);
  assert.deepEqual(input, snapshot);
});

// ---------------------------------------------------------------------------
// Real card attribution (I2): earning follows the card actually used
// ---------------------------------------------------------------------------

test("no card attribution means no plan — never a fallback to wallet-wide crediting", () => {
  const withoutAttribution = fixtureContext();
  delete withoutAttribution.monthlySpendingByCategoryCard;
  assert.equal(buildEarnPlan(withoutAttribution, PROGRAM_NAMES, null, NOW), null);

  const emptyAttribution = {
    ...fixtureContext(),
    monthlySpendingByCategoryCard: [],
  };
  assert.equal(buildEarnPlan(emptyAttribution, PROGRAM_NAMES, null, NOW), null);

  const nullAttribution = {
    ...fixtureContext(),
    monthlySpendingByCategoryCard: null,
  };
  assert.equal(buildEarnPlan(nullAttribution, PROGRAM_NAMES, null, NOW), null);
});

test("each purchase earns only on the card used — the wallet-wide total is not credited to every card", () => {
  // Both cards have dining rules; $400 of dining exists but every dining
  // purchase used the Sapphire card, so the Gold card earns nothing.
  const plan = buildEarnPlan(
    context({
      walletCards: [
        {
          id: "card-sapphire",
          name: "Sapphire Preferred",
          issuer: "Chase",
          rewardCurrency: "points",
          cardProductId: "sapphire-product",
        },
        {
          id: "card-gold",
          name: "Gold Card",
          issuer: "American Express",
          rewardCurrency: "points",
          cardProductId: "gold-product",
        },
      ],
      earningRules: [
        earningRule({ id: "r-sapphire", cardProductId: "sapphire-product", eligibleCategory: "food:dining", rewardValue: 3 }),
        earningRule({ id: "r-gold", cardProductId: "gold-product", eligibleCategory: "food:dining", rewardValue: 4 }),
      ],
      walletCardProgramIds: {
        "card-sapphire": "chase-ur",
        "card-gold": "amex-mr",
      },
      monthlySpendingByCategoryCard: [
        { cardId: "card-sapphire", category: "food:dining", monthlyAverage: 400 },
      ],
    }),
    PROGRAM_NAMES,
    null,
    NOW,
  );
  assert.ok(plan);
  assert.equal(plan.accounts.length, 2);
  const chase = plan.accounts.find((a) => a.programName === "Chase Ultimate Rewards");
  const amex = plan.accounts.find((a) => a.programName === "Membership Rewards");
  assert.ok(chase);
  assert.ok(amex);
  assert.equal(chase.monthlyPoints, 1200);
  assert.equal(amex.monthlyPoints, 0);
  assert.deepEqual(chase.cardNames, ["Sapphire Preferred"]);
  assert.deepEqual(amex.cardNames, []);
});

test("attributed spend earns at the card's own rate, not the best available rate", () => {
  // Same dining rules as above; the dining purchases used the GOLD card, so
  // earn is 400×4 on Amex and nothing on Chase — attribution beats rate.
  const plan = buildEarnPlan(
    context({
      walletCards: [
        {
          id: "card-sapphire",
          name: "Sapphire Preferred",
          issuer: "Chase",
          rewardCurrency: "points",
          cardProductId: "sapphire-product",
        },
        {
          id: "card-gold",
          name: "Gold Card",
          issuer: "American Express",
          rewardCurrency: "points",
          cardProductId: "gold-product",
        },
      ],
      earningRules: [
        earningRule({ id: "r-sapphire", cardProductId: "sapphire-product", eligibleCategory: "food:dining", rewardValue: 3 }),
        earningRule({ id: "r-gold", cardProductId: "gold-product", eligibleCategory: "food:dining", rewardValue: 4 }),
      ],
      walletCardProgramIds: {
        "card-sapphire": "chase-ur",
        "card-gold": "amex-mr",
      },
      monthlySpendingByCategoryCard: [
        { cardId: "card-gold", category: "food:dining", monthlyAverage: 400 },
      ],
    }),
    PROGRAM_NAMES,
    null,
    NOW,
  );
  assert.ok(plan);
  const chase = plan.accounts.find((a) => a.programName === "Chase Ultimate Rewards");
  const amex = plan.accounts.find((a) => a.programName === "Membership Rewards");
  assert.ok(chase);
  assert.ok(amex);
  assert.equal(chase.monthlyPoints, 0);
  assert.equal(amex.monthlyPoints, 1600);
});

test("points-card spend is excluded from the miles program and vice versa — no cross-currency crediting", () => {
  const plan = buildEarnPlan(
    context({
      walletCards: [
        {
          id: "card-points",
          name: "Points Card",
          issuer: "Bank A",
          rewardCurrency: "points",
          cardProductId: "points-product",
        },
        {
          id: "card-miles",
          name: "Miles Card",
          issuer: "Airline B",
          rewardCurrency: "miles",
          cardProductId: "miles-product",
        },
      ],
      earningRules: [
        earningRule({ id: "rp", cardProductId: "points-product", rewardValue: 2 }),
        earningRule({ id: "rm", cardProductId: "miles-product", rewardCurrency: "miles", rewardValue: 3 }),
      ],
      walletCardProgramIds: {
        "card-points": "bank-points",
        "card-miles": "airline-miles",
      },
      monthlySpendingByCategoryCard: [
        { cardId: "card-points", category: "other", monthlyAverage: 100 },
        { cardId: "card-miles", category: "other", monthlyAverage: 100 },
      ],
    }),
    PROGRAM_NAMES,
    null,
    NOW,
  );
  assert.ok(plan);
  assert.equal(plan.accounts.length, 2);
  const pointsAccount = plan.accounts[0];
  const milesAccount = plan.accounts[1];
  assert.equal(pointsAccount.rewardCurrencyLabel, "points");
  assert.equal(milesAccount.rewardCurrencyLabel, "miles");
  assert.equal(pointsAccount.monthlyPoints, 200);
  assert.equal(milesAccount.monthlyPoints, 300);
});

test("a card whose verified rates mix currencies is dropped before attribution", () => {
  const plan = buildEarnPlan(
    context({
      walletCards: [
        {
          id: "card-good",
          name: "Good Card",
          issuer: "Bank A",
          rewardCurrency: "points",
          cardProductId: "good-product",
        },
        {
          id: "card-mixed",
          name: "Mixed Card",
          issuer: "Odd Bank",
          rewardCurrency: "points",
          cardProductId: "mixed-product",
        },
      ],
      earningRules: [
        earningRule({ id: "rg", cardProductId: "good-product", rewardValue: 2 }),
        earningRule({ id: "rmp", cardProductId: "mixed-product", rewardCurrency: "points", rewardValue: 2 }),
        earningRule({ id: "rmm", cardProductId: "mixed-product", rewardCurrency: "miles", rewardValue: 1 }),
      ],
      walletCardProgramIds: {
        "card-good": "bank-a",
        "card-mixed": "odd-program",
      },
      monthlySpendingByCategoryCard: [
        { cardId: "card-good", category: "other", monthlyAverage: 100 },
        { cardId: "card-mixed", category: "other", monthlyAverage: 100 },
      ],
    }),
    PROGRAM_NAMES,
    null,
    NOW,
  );
  assert.ok(plan);
  // Only the clean program appears; the mixed card's spend earns nothing
  // anywhere and the fixed mixed-currency warning is present.
  assert.equal(plan.accounts.length, 1);
  assert.equal(plan.accounts[0].monthlyPoints, 200);
  assert.ok(plan.warnings.includes(EARN_PLAN_WARNING_MIXED_CURRENCY));
});

test("the same dollars never earn twice across lanes or programs", () => {
  // One card, one program, one spending entry: total earn across the whole
  // plan must equal amount × rate exactly once.
  const plan = buildEarnPlan(
    context({
      walletCards: [
        {
          id: "card-one",
          name: "Only Card",
          issuer: "Bank",
          rewardCurrency: "points",
          cardProductId: "one-product",
        },
      ],
      earningRules: [
        earningRule({ id: "r1", cardProductId: "one-product", rewardValue: 2 }),
      ],
      walletCardProgramIds: { "card-one": "program-one" },
      monthlySpendingByCategoryCard: [
        { cardId: "card-one", category: "other", monthlyAverage: 100 },
      ],
    }),
    PROGRAM_NAMES,
    null,
    NOW,
  );
  assert.ok(plan);
  const total = plan.accounts.reduce((sum, account) => sum + account.monthlyPoints, 0);
  assert.equal(total, 200);
});

test("cards without a linked program never create projections", () => {
  const plan = buildEarnPlan(
    context({
      walletCards: [
        {
          id: "card-unlinked",
          name: "Unlinked Card",
          issuer: "Bank",
          rewardCurrency: "points",
          cardProductId: "unlinked-product",
        },
      ],
      earningRules: [
        earningRule({ id: "r", cardProductId: "unlinked-product", rewardValue: 5 }),
      ],
      walletCardProgramIds: { "card-unlinked": null },
    }),
    PROGRAM_NAMES,
    null,
    NOW,
  );
  assert.equal(plan, null);
});

// ---------------------------------------------------------------------------
// projectEarnPlan — strict persisted-shape re-projection
// ---------------------------------------------------------------------------

test("projectEarnPlan round-trips a freshly built plan and returns a fresh object", () => {
  const plan = buildEarnPlan(fixtureContext(), PROGRAM_NAMES, flightEstimate(), NOW);
  assert.ok(plan);
  const projected = projectEarnPlan(plan);
  assert.ok(projected);
  assert.deepEqual(projected, plan);
  assert.notEqual(projected, plan);
  assert.notEqual(projected.accounts, plan.accounts);
});

test("projectEarnPlan rejects unknown top-level and account-level keys", () => {
  const plan = buildEarnPlan(fixtureContext(), PROGRAM_NAMES, flightEstimate(), NOW);
  assert.ok(plan);

  const withExtra = { ...plan, providerHint: "hostile" } as unknown;
  assert.equal(projectEarnPlan(withExtra), null);

  const withAccountExtra = {
    ...plan,
    accounts: plan.accounts.map((account, index) =>
      index === 0 ? { ...account, sourceUrl: "https://hostile.example" } : account,
    ),
  } as unknown;
  assert.equal(projectEarnPlan(withAccountExtra), null);
});

test("projectEarnPlan rejects unfixed warning strings and hostile disclosures", () => {
  const plan = buildEarnPlan(fixtureContext(), PROGRAM_NAMES, flightEstimate(), NOW);
  assert.ok(plan);

  const withFabricatedWarning = {
    ...plan,
    warnings: [...plan.warnings, "Book now! 100k bonus points."],
  } as unknown;
  assert.equal(projectEarnPlan(withFabricatedWarning), null);

  const withAlteredDisclosure = {
    ...plan,
    disclosure: "Guaranteed availability!",
  } as unknown;
  assert.equal(projectEarnPlan(withAlteredDisclosure), null);
});

test("projectEarnPlan rejects broken account invariants", () => {
  const plan = buildEarnPlan(fixtureContext(), PROGRAM_NAMES, flightEstimate(), NOW);
  assert.ok(plan);

  const nullMismatch = {
    ...plan,
    accounts: plan.accounts.map((account, index) =>
      index === 0
        ? { ...account, monthsProjected: null, projectedBalance: 97500 }
        : account,
    ),
  } as unknown;
  assert.equal(projectEarnPlan(nullMismatch), null);

  const negativeBalance = {
    ...plan,
    accounts: plan.accounts.map((account, index) =>
      index === 0 ? { ...account, currentBalance: -5 } : account,
    ),
  } as unknown;
  assert.equal(projectEarnPlan(negativeBalance), null);

  const outOfRangeMonths = {
    ...plan,
    accounts: plan.accounts.map((account, index) =>
      index === 0 ? { ...account, monthsProjected: 99 } : account,
    ),
  } as unknown;
  assert.equal(projectEarnPlan(outOfRangeMonths), null);

  const emptyAccounts = { ...plan, accounts: [] } as unknown;
  assert.equal(projectEarnPlan(emptyAccounts), null);

  const mixedOwner = {
    ...plan,
    accounts: plan.accounts.map((account, index) =>
      index === 0 ? { ...account, ownerType: "companion" } : account,
    ),
  } as unknown;
  assert.equal(projectEarnPlan(mixedOwner), null);
});

test("projectEarnPlan rejects an inconsistent cash gap", () => {
  const plan = buildEarnPlan(fixtureContext(), PROGRAM_NAMES, flightEstimate(), NOW);
  assert.ok(plan);
  assert.ok(plan.cashGap);

  const brokenGap = {
    ...plan,
    cashGap: { ...plan.cashGap, remaining: 99999 },
  } as unknown;
  assert.equal(projectEarnPlan(brokenGap), null);
});

test("projectEarnPlan rejects hostile trip-cash source labels", () => {
  const plan = buildEarnPlan(fixtureContext(), PROGRAM_NAMES, flightEstimate(), NOW);
  assert.ok(plan);
  assert.ok(plan.tripCash);

  const hostileSource = {
    ...plan,
    tripCash: { ...plan.tripCash, sources: ["https://hostile.example/book"] },
  } as unknown;
  assert.equal(projectEarnPlan(hostileSource), null);
});

test("projectEarnPlan does not mutate its input", () => {
  const plan = buildEarnPlan(fixtureContext(), PROGRAM_NAMES, flightEstimate(), NOW);
  assert.ok(plan);
  const snapshot = structuredClone(plan);
  projectEarnPlan(plan);
  assert.deepEqual(plan, snapshot);
});

test("projectEarnPlan rejects non-object and wrong-schema inputs", () => {
  assert.equal(projectEarnPlan(null), null);
  assert.equal(projectEarnPlan("plan"), null);
  assert.equal(projectEarnPlan([]), null);
  assert.equal(projectEarnPlan({ schemaVersion: 2 }), null);
});

// ---------------------------------------------------------------------------
// Adversarial-review corrections: order-independent matching, account cap
// ---------------------------------------------------------------------------

test("category selection is order-independent: exact leaf beats root wildcard regardless of catalog order", () => {
  const ratesFor = (order: EarningRule[]) =>
    selectVerifiedPointEarnRates(order).get("p1") ?? [];
  const root = earningRule({ id: "root", cardProductId: "p1", eligibleCategory: "food", rewardValue: 2 });
  const leaf = earningRule({ id: "leaf", cardProductId: "p1", eligibleCategory: "food:dining", rewardValue: 3 });
  const spending = [{ category: "food:dining", monthlyAverage: 100 }];

  // Root listed first (created_at DESC can produce this) must not shadow the leaf.
  assert.equal(monthlyPointsForCard(ratesFor([root, leaf]), spending), 300);
  assert.equal(monthlyPointsForCard(ratesFor([leaf, root]), spending), 300);
});

test("a higher root rate does not shadow a more specific lower rate", () => {
  const rates = selectVerifiedPointEarnRates([
    earningRule({ id: "root", cardProductId: "p1", eligibleCategory: "food", rewardValue: 5 }),
    earningRule({ id: "leaf", cardProductId: "p1", eligibleCategory: "food:dining", rewardValue: 3 }),
  ]).get("p1") ?? [];
  assert.equal(
    monthlyPointsForCard(rates, [{ category: "food:dining", monthlyAverage: 100 }]),
    300,
  );
});

test("duplicate same-category rules resolve to the highest verified rate regardless of order", () => {
  const ratesFor = (order: EarningRule[]) =>
    selectVerifiedPointEarnRates(order).get("p1") ?? [];
  const low = earningRule({ id: "low", cardProductId: "p1", eligibleCategory: "food:dining", rewardValue: 2 });
  const high = earningRule({ id: "high", cardProductId: "p1", eligibleCategory: "food:dining", rewardValue: 4 });
  const spending = [{ category: "food:dining", monthlyAverage: 100 }];
  assert.equal(monthlyPointsForCard(ratesFor([low, high]), spending), 400);
  assert.equal(monthlyPointsForCard(ratesFor([high, low]), spending), 400);
});

test("a trip departing this month projects with zero additional months", () => {
  const plan = buildEarnPlan(
    { ...fixtureContext(), goal: goal({ earliestDeparture: "2026-09-20" }) },
    PROGRAM_NAMES,
    null,
    NOW,
  );
  assert.ok(plan);
  for (const account of plan.accounts) {
    assert.equal(account.monthsProjected, 0);
    assert.equal(account.projectedBalance, account.currentBalance);
  }
});

test("plans with more than 12 program groups are truncated with a fixed warning and still round-trip", () => {
  const cards = Array.from({ length: 13 }, (_, index) => ({
    id: `card-${index}`,
    name: `Card ${index}`,
    issuer: "Bank",
    rewardCurrency: "points" as const,
    cardProductId: `product-${index}`,
  }));
  const plan = buildEarnPlan(
    context({
      walletCards: cards,
      earningRules: cards.map((card) =>
        earningRule({ id: `rule-${card.id}`, cardProductId: card.cardProductId, rewardValue: 1 }),
      ),
      walletCardProgramIds: Object.fromEntries(
        cards.map((card) => [card.id, `program-${card.id}`]),
      ),
      monthlySpendingByCategoryCard: cards.map((card) => ({
        cardId: card.id,
        category: "other",
        monthlyAverage: 100,
      })),
    }),
    new Map(),
    null,
    NOW,
  );
  assert.ok(plan);
  assert.equal(plan.accounts.length, 12);
  // The first 12 wallet-order programs survive; the 13th is omitted.
  assert.deepEqual(plan.accounts.map((account) => account.key),
    Array.from({ length: 12 }, (_, index) => `earn-${index + 1}`));
  assert.ok(plan.warnings.includes(EARN_PLAN_WARNING_ACCOUNTS_TRUNCATED));

  // A freshly built plan always passes its own strict projector.
  const projected = projectEarnPlan(plan);
  assert.ok(projected);
  assert.deepEqual(projected, plan);
});
