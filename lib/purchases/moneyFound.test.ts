/**
 * Focused tests for per-purchase Money Found aggregation.
 *
 * Run: npx tsx --test lib/purchases/moneyFound.test.ts
 *
 * These tests pin the TRUST BOUNDARY: only confirmed, trusted dollar value
 * counts. Likely / unknown / not_eligible / insufficient_information are never
 * counted; points/miles never become dollars; remaining benefit balances are
 * never aggregated (only the per-purchase usableValue).
 *
 * Card-awareness (F1): confirmed cashback counts ONLY when the rule's card is
 * the card actually used on the Purchase (match.cardId === purchase.cardId).
 * When purchase.cardId is null or differs, cashback is a recommendation, not
 * an actual reward, and never counts.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { computeMoneyFound } from "./moneyFound";
import type { Purchase } from "@/lib/purchases/types";
import type {
  PurchaseOptimizationMatch,
  PurchaseOptimizationResult,
} from "@/lib/purchases/optimizePurchase";
import type { BenefitOpportunity } from "@/lib/wallet/benefitOpportunity";

// -----------------------------------------------------------------------------
// Fixtures
// -----------------------------------------------------------------------------

function makePurchase(overrides: Partial<Purchase> = {}): Purchase {
  return {
    id: "purchase-1",
    merchant: "Some Merchant",
    date: "2026-08-01",
    amount: 200,
    currency: "USD",
    category: "food:dining",
    source: "statement",
    sourceConfidence: 0.9,
    cardId: null,
    items: [],
    discount: null,
    tax: null,
    tip: null,
    fees: null,
    evidence: [],
    metadata: null,
    ...overrides,
  };
}

function makeMatch(
  overrides: Partial<PurchaseOptimizationMatch> = {}
): PurchaseOptimizationMatch {
  return {
    ruleId: "rule-1",
    benefitId: "rule-1",
    cardId: "card-1",
    cardName: "Chase Sapphire",
    benefitTitle: "2% Dining",
    status: "confirmed_eligible",
    estimatedValue: 4,
    reason: "merchant match",
    ...overrides,
  };
}

function makeOptimization(
  matches: PurchaseOptimizationMatch[]
): PurchaseOptimizationResult {
  return {
    usedCardId: "card-1",
    bestCardId: "card-1",
    bestCardName: "Chase Sapphire",
    bestEstimatedValue: matches.reduce((s, m) => s + m.estimatedValue, 0),
    bestEstimatedRewardUnits: null,
    bestRewardCurrency: null,
    matches,
    recommendation: null,
    mode: "personalized",
  };
}

function makeOpportunity(
  overrides: Partial<BenefitOpportunity> = {}
): BenefitOpportunity {
  return {
    productBenefitId: "csp-hotel-credit",
    walletBenefitId: "wallet-benefit-1",
    title: "$100 Annual Chase Travel Hotel Credit",
    status: "confirmed_eligible",
    usableValue: 100,
    potentialValue: null,
    remainingValue: 100,
    missingConditions: [],
    reason: "merchant match",
    ...overrides,
  };
}

// -----------------------------------------------------------------------------
// Tests
// -----------------------------------------------------------------------------

describe("computeMoneyFound", () => {
  it("1. confirmed cashback counts ONLY on the used card", () => {
    const result = computeMoneyFound(
      makePurchase({ cardId: "card-1" }),
      makeOptimization([makeMatch({ status: "confirmed_eligible", estimatedValue: 4 })])
    );

    assert.equal(result.total, 4);
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0].source, "cashback");
    assert.equal(result.items[0].value, 4);
    assert.equal(result.items[0].currency, "USD");
  });

  it("2. likely cashback does not count", () => {
    const result = computeMoneyFound(
      makePurchase({ cardId: "card-1" }),
      makeOptimization([makeMatch({ status: "likely_eligible", estimatedValue: 4 })])
    );

    assert.equal(result.total, 0);
    assert.equal(result.items.length, 0);
  });

  it("3. confirmed benefit counts", () => {
    const result = computeMoneyFound(
      makePurchase(),
      undefined,
      [makeOpportunity({ status: "confirmed_eligible", usableValue: 100 })]
    );

    assert.equal(result.total, 100);
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0].source, "benefit");
    assert.equal(result.items[0].value, 100);
  });

  it("4. insufficient_information does not count", () => {
    const result = computeMoneyFound(
      makePurchase(),
      undefined,
      [
        makeOpportunity({
          status: "insufficient_information",
          usableValue: null,
          potentialValue: 100,
          remainingValue: 100,
        }),
      ]
    );

    // usableValue is null and potentialValue is never counted.
    assert.equal(result.total, 0);
    assert.equal(result.items.length, 0);
  });

  it("5. points (estimatedValue 0) do not become dollars", () => {
    // A confirmed eligible points rule has estimatedValue === 0 because the
    // optimizer never converts points/miles to dollars.
    const result = computeMoneyFound(
      makePurchase({ cardId: "card-1" }),
      makeOptimization([
        makeMatch({ status: "confirmed_eligible", estimatedValue: 0, benefitTitle: "3X points" }),
      ])
    );

    assert.equal(result.total, 0);
    assert.equal(result.items.length, 0);
  });

  it("6. remaining benefit balance is not counted (only usableValue)", () => {
    // usableValue is capped at the purchase amount even though remaining balance
    // is larger. The remainder of the balance must NOT be added.
    const result = computeMoneyFound(
      makePurchase(),
      undefined,
      [
        makeOpportunity({
          status: "confirmed_eligible",
          usableValue: 50, // capped at purchase amount
          remainingValue: 100,
        }),
      ]
    );

    assert.equal(result.total, 50); // usableValue, NOT the remaining 100
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0].value, 50);
  });

  it("7. duplicate source/benefit is counted once", () => {
    // Same cashback rule reported twice (same benefitId + cardId) must dedupe.
    const same = makeMatch({ status: "confirmed_eligible", estimatedValue: 4 });
    const result = computeMoneyFound(
      makePurchase({ cardId: "card-1" }),
      makeOptimization([same, { ...same }])
    );

    assert.equal(result.total, 4);
    assert.equal(result.items.length, 1);
  });

  it("8. total rounds to cents and preserves currency", () => {
    const result = computeMoneyFound(
      makePurchase({ cardId: "card-1" }),
      makeOptimization([makeMatch({ status: "confirmed_eligible", estimatedValue: 4.005 })])
    );

    assert.equal(result.total, 4.01); // rounded to cents
    assert.equal(result.currency, "USD");
  });

  it("defaults currency to USD when purchase currency is absent", () => {
    const result = computeMoneyFound(
      makePurchase({ currency: null, cardId: "card-1" }),
      makeOptimization([makeMatch({ status: "confirmed_eligible", estimatedValue: 2 })])
    );

    assert.equal(result.currency, "USD");
    assert.equal(result.items[0].currency, "USD");
  });

  it("counts both confirmed cashback and confirmed benefit once each", () => {
    const result = computeMoneyFound(
      makePurchase({ cardId: "card-1" }),
      makeOptimization([makeMatch({ status: "confirmed_eligible", estimatedValue: 4 })]),
      [makeOpportunity({ status: "confirmed_eligible", usableValue: 50 })]
    );

    assert.equal(result.total, 54); // 4 + 50
    assert.equal(result.items.length, 2);
  });
});

// -----------------------------------------------------------------------------
// F1 card-awareness tests
// -----------------------------------------------------------------------------

describe("computeMoneyFound — card awareness", () => {
  it("ignores confirmed cashback when purchase.cardId is null", () => {
    // Rule is confirmed_eligible with value on card-1, but we don't know which
    // card was used. Cashback on an unknown card is a recommendation, not real.
    const result = computeMoneyFound(
      makePurchase({ cardId: null }),
      makeOptimization([makeMatch({ status: "confirmed_eligible", estimatedValue: 4 })])
    );

    assert.equal(result.total, 0);
    assert.equal(result.items.length, 0);
  });

  it("ignores confirmed cashback on an unused card", () => {
    // Purchase was made with card-2; the confirmed rule is on card-1.
    const result = computeMoneyFound(
      makePurchase({ cardId: "card-2" }),
      makeOptimization([makeMatch({ cardId: "card-1", estimatedValue: 4 })])
    );

    assert.equal(result.total, 0);
    assert.equal(result.items.length, 0);
  });

  it("counts confirmed cashback on the used card only", () => {
    // Two confirmed rules: one on the used card (card-1), one on an unused
    // card (card-2). Only the used card's rule counts.
    const result = computeMoneyFound(
      makePurchase({ cardId: "card-1" }),
      makeOptimization([
        makeMatch({ cardId: "card-1", estimatedValue: 4 }),
        makeMatch({ cardId: "card-2", estimatedValue: 10 }),
      ])
    );

    assert.equal(result.total, 4);
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0].cardId, "card-1");
  });

  it("benefits remain independently eligible without a used card", () => {
    // Benefit opportunities are not gated on purchase.cardId in this step;
    // that is intentionally unchanged. A confirmed usableValue still counts
    // even when the used card is unknown.
    const result = computeMoneyFound(
      makePurchase({ cardId: null }),
      undefined,
      [makeOpportunity({ status: "confirmed_eligible", usableValue: 100 })]
    );

    assert.equal(result.total, 100);
    assert.equal(result.items[0].source, "benefit");
  });
});