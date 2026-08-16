/**
 * Focused tests for reward-unit display semantics in the Purchase optimizer.
 *
 * Covers the fix: points/miles recommendations expose deterministic reward
 * units (e.g. 351 points) and do NOT display a misleading "$0.00" dollar
 * estimate, while cashback recommendations keep a dollar estimate.
 *
 * Run with: npx tsx --test lib/purchases/rewardUnits.test.ts
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Purchase } from "@/lib/purchases/types";
import type { WalletCard } from "@/lib/wallet/types";
import type { EarningRule, CardProduct } from "@/lib/rewards/catalogTypes";
import { optimizePurchaseWithLinkedCards } from "./optimizePurchase";

function makePurchase(overrides: Partial<Purchase> = {}): Purchase {
  return {
    id: "purchase-1",
    merchant: "Merchant",
    date: "2026-01-01",
    amount: 100,
    currency: "USD",
    category: null,
    source: "receipt",
    sourceConfidence: 1,
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

function makeCard(overrides: Partial<WalletCard> = {}): WalletCard {
  return {
    id: "card-1",
    name: "Dev Card",
    issuer: "Dev Bank",
    network: "visa",
    rewardCurrency: "cashback",
    lastFour: "1234",
    active: true,
    source: "development",
    cardProductId: null,
    ...overrides,
  };
}

function makeProduct(overrides: Partial<CardProduct> = {}): CardProduct {
  return {
    id: "product-1",
    rewardProgramId: null,
    issuer: "Dev Bank",
    name: "Dev Product",
    network: "visa",
    active: true,
    annualFee: null,
    source: "development_fixture",
    lastVerifiedAt: null,
    metadata: null,
    ...overrides,
  };
}

function makeEarningRule(overrides: Partial<EarningRule> = {}): EarningRule {
  return {
    id: "rule-1",
    cardProductId: "product-1",
    type: "earning_rate",
    eligibleCategory: null,
    eligibleMerchant: null,
    excludedMerchants: [],
    rewardCurrency: "cashback",
    rewardValue: 0,
    percentage: null,
    fixedValue: null,
    explanation: "Test rule.",
    source: "development_fixture",
    lastVerifiedAt: null,
    active: true,
    metadata: null,
    ...overrides,
  };
}

const cspProduct = makeProduct({
  id: "csp-product",
  name: "Chase Sapphire Preferred",
  issuer: "Chase",
});

const diningPointsRule = makeEarningRule({
  id: "csp-dining-points",
  cardProductId: "csp-product",
  eligibleCategory: "food:dining",
  rewardCurrency: "points",
  rewardValue: 3,
  explanation: "Earn 3 points per $1 on dining at restaurants.",
});

const otherPointsRule = makeEarningRule({
  id: "csp-other-points",
  cardProductId: "csp-product",
  eligibleCategory: "other",
  rewardCurrency: "points",
  rewardValue: 1,
  explanation: "Earn 1 point per $1 on all other purchases.",
});

function makeCspCard(overrides: Partial<WalletCard> = {}): WalletCard {
  return makeCard({
    id: "csp-card",
    name: "My Chase Sapphire Preferred",
    cardProductId: "csp-product",
    source: "user",
    ...overrides,
  });
}

describe("reward-unit display semantics", () => {
  it("computes 3 points/$1 x $117 = 351 points with no dollar value", () => {
    const purchase = makePurchase({
      merchant: "Clementines LOHI Denver CO",
      category: "food:dining",
      amount: 117,
    });

    const result = optimizePurchaseWithLinkedCards(
      purchase,
      [makeCspCard()],
      new Map([["csp-product", cspProduct]]),
      new Map([["csp-product", [diningPointsRule, otherPointsRule]]])
    );

    assert.equal(result.bestCardId, "csp-card");
    assert.equal(result.bestEstimatedRewardUnits, 351);
    assert.equal(result.bestRewardCurrency, "points");
    // Points are NEVER converted to a dollar value.
    assert.equal(result.bestEstimatedValue, 0);
  });

  it("does not expose $0.00 for a personalized points recommendation", () => {
    const purchase = makePurchase({
      merchant: "Clementines LOHI Denver CO",
      category: "food:dining",
      amount: 117,
    });

    const result = optimizePurchaseWithLinkedCards(
      purchase,
      [makeCspCard()],
      new Map([["csp-product", cspProduct]]),
      new Map([["csp-product", [diningPointsRule, otherPointsRule]]])
    );

    // Reward units are present, so the UI can show "351 points" rather than $0.00.
    assert.equal(result.bestEstimatedRewardUnits !== null, true);
    assert.equal(result.bestRewardCurrency, "points");
  });

  it("still produces a dollar estimate for a cashback recommendation", () => {
    const cashbackProduct = makeProduct({
      id: "cashback-product",
      name: "Cashback Product",
      issuer: "Dev Bank",
    });

    const cashbackRule = makeEarningRule({
      id: "cashback-dining",
      cardProductId: "cashback-product",
      eligibleCategory: "food:dining",
      rewardCurrency: "cashback",
      rewardValue: 0,
      percentage: 3,
    });

    const purchase = makePurchase({
      merchant: "Restaurant",
      category: "food:dining",
      amount: 100,
    });

    const result = optimizePurchaseWithLinkedCards(
      purchase,
      [makeCard({ id: "cashback-card", cardProductId: "cashback-product", name: "Cashback Card" })],
      new Map([["cashback-product", cashbackProduct]]),
      new Map([["cashback-product", [cashbackRule]]])
    );

    assert.equal(result.bestEstimatedValue, 3); // 3% of $100
    assert.equal(result.bestEstimatedRewardUnits, null);
    assert.equal(result.bestRewardCurrency, null);
  });

  it("never assigns an arbitrary dollar value to points", () => {
    const purchase = makePurchase({
      merchant: "Restaurant",
      category: "food:dining",
      amount: 117,
    });

    const result = optimizePurchaseWithLinkedCards(
      purchase,
      [makeCspCard()],
      new Map([["csp-product", cspProduct]]),
      new Map([["csp-product", [diningPointsRule]]])
    );

    // bestEstimatedValue stays 0: points are never converted to dollars.
    assert.equal(result.bestEstimatedValue, 0);
    assert.equal(result.bestEstimatedRewardUnits, 351);
  });
});