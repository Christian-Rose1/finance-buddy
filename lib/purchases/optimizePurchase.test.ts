/**
 * Focused tests for the canonical Purchase optimizer.
 *
 * Run with: npx tsx --test lib/purchases/optimizePurchase.test.ts
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Purchase } from "@/lib/purchases/types";
import type { Wallet, WalletCard, CardBenefit } from "@/lib/wallet/types";
import type { EarningRule, CardProduct } from "@/lib/rewards/catalogTypes";
import {
  optimizePurchase,
  optimizePurchaseWithDevelopmentWallet,
  optimizePurchaseWithLinkedCards,
} from "./optimizePurchase";

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

function makeBenefit(overrides: Partial<CardBenefit> = {}): CardBenefit {
  return {
    id: "benefit-1",
    cardId: "card-1",
    type: "earning_rate",
    title: "Dev benefit",
    description: "DEVELOPMENT FIXTURE — test benefit.",
    category: null,
    merchant: null,
    excludedMerchants: [],
    rewardCurrency: "cashback",
    rewardValue: 1,
    percentage: null,
    fixedValue: null,
    annualLimit: null,
    remainingLimit: null,
    active: true,
    source: "development",
    ...overrides,
  };
}

function makeWallet(
  cards: WalletCard[] = [makeCard()],
  benefits: CardBenefit[] = [makeBenefit()]
): Wallet {
  return { cards, benefits };
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

// =============================================================================
// Development wallet tests
// =============================================================================

describe("optimizePurchaseWithDevelopmentWallet", () => {
  it("matches a canonical category rule", () => {
    const purchase = makePurchase({
      merchant: "Local Bistro",
      category: "food:dining",
    });
    const wallet = makeWallet([makeCard()], [
      makeBenefit({
        id: "dining-3pct",
        category: "food:dining",
        percentage: 3,
      }),
    ]);

    const result = optimizePurchaseWithDevelopmentWallet(purchase, wallet);

    assert.equal(result.mode, "development");
    assert.equal(result.bestCardId, "card-1");
    assert.equal(result.bestEstimatedValue, 3); // 3% of $100
    assert.equal(result.matches[0].status, "likely_eligible");
    assert.match(result.matches[0].reason, /food:dining/);
    assert.match(result.recommendation ?? "", /dev fixture/i);
  });

  it("supports root-aware category matching", () => {
    const purchase = makePurchase({
      merchant: "Coffee Shop",
      category: "food:coffee",
    });
    const wallet = makeWallet([makeCard()], [
      makeBenefit({
        id: "food-2pct",
        category: "food",
        percentage: 2,
      }),
    ]);

    const result = optimizePurchaseWithDevelopmentWallet(purchase, wallet);

    assert.equal(result.bestEstimatedValue, 2); // 2% of $100
    assert.equal(result.matches[0].status, "likely_eligible");
  });

  it("merchant exclusion overrides a category match", () => {
    const purchase = makePurchase({
      merchant: "Walmart",
      category: "food:groceries",
    });
    const wallet = makeWallet([makeCard()], [
      makeBenefit({
        id: "grocery-4pct",
        category: "food:groceries",
        percentage: 4,
        excludedMerchants: ["walmart"],
      }),
    ]);

    const result = optimizePurchaseWithDevelopmentWallet(purchase, wallet);

    assert.equal(result.bestCardId, null);
    assert.equal(result.bestEstimatedValue, 0);
    assert.equal(result.matches[0].status, "not_eligible");
    assert.match(result.matches[0].reason, /excluded/i);
  });

  it("applies merchant-specific eligibility", () => {
    const purchase = makePurchase({
      merchant: "Dev Cafe Downtown",
      category: "food:coffee",
    });
    const wallet = makeWallet([makeCard()], [
      makeBenefit({
        id: "dev-cafe-offer",
        type: "offer",
        category: null,
        merchant: "Dev Cafe",
        rewardCurrency: "cashback",
        fixedValue: 10,
      }),
    ]);

    const result = optimizePurchaseWithDevelopmentWallet(purchase, wallet);

    assert.equal(result.bestEstimatedValue, 10);
    assert.equal(result.matches[0].status, "confirmed_eligible");
    assert.match(result.matches[0].reason, /Dev Cafe/);
  });

  it("does not match an unknown category", () => {
    const purchase = makePurchase({
      merchant: "Some Store",
      category: "UnknownCategory",
    });
    const wallet = makeWallet([makeCard()], [
      makeBenefit({
        id: "dining-3pct",
        category: "food:dining",
        percentage: 3,
      }),
    ]);

    const result = optimizePurchaseWithDevelopmentWallet(purchase, wallet);

    assert.equal(result.bestCardId, null);
    assert.equal(result.bestEstimatedValue, 0);
  });

  it("uses Purchase.category for statement Purchases with no items", () => {
    const purchase = makePurchase({
      source: "statement",
      merchant: "United Airlines",
      category: "travel",
      items: [],
    });
    const wallet = makeWallet([makeCard()], [
      makeBenefit({
        id: "travel-credit",
        type: "statement_credit",
        category: "travel",
        rewardCurrency: "none",
        fixedValue: 50,
      }),
    ]);

    const result = optimizePurchaseWithDevelopmentWallet(purchase, wallet);

    assert.equal(result.bestCardId, "card-1");
    assert.equal(result.bestEstimatedValue, 50);
    assert.equal(result.matches[0].status, "likely_eligible");
  });

  it("returns no eligible benefit when nothing matches", () => {
    const purchase = makePurchase({
      merchant: "Gas Station",
      category: "transportation:gas",
    });
    const wallet = makeWallet([makeCard()], [
      makeBenefit({
        id: "dining-3pct",
        category: "food:dining",
        percentage: 3,
      }),
    ]);

    const result = optimizePurchaseWithDevelopmentWallet(purchase, wallet);

    assert.equal(result.bestCardId, null);
    assert.equal(result.bestEstimatedValue, 0);
    assert.equal(result.recommendation, null);
  });

  it("selects the best eligible card across multiple cards", () => {
    const cardA = makeCard({ id: "card-a", name: "Card A" });
    const cardB = makeCard({ id: "card-b", name: "Card B" });
    const benefitA = makeBenefit({
      id: "a-dining",
      cardId: "card-a",
      category: "food:dining",
      percentage: 2,
    });
    const benefitB = makeBenefit({
      id: "b-dining",
      cardId: "card-b",
      category: "food:dining",
      percentage: 5,
    });

    const purchase = makePurchase({
      merchant: "Restaurant",
      category: "food:dining",
    });
    const wallet = makeWallet([cardA, cardB], [benefitA, benefitB]);

    const result = optimizePurchaseWithDevelopmentWallet(purchase, wallet);

    assert.equal(result.bestCardId, "card-b");
    assert.equal(result.bestCardName, "Card B");
    assert.equal(result.bestEstimatedValue, 5); // 5% of $100
  });

  it("preserves the development fixture source on rules", () => {
    const purchase = makePurchase({
      merchant: "Local Bistro",
      category: "food:dining",
    });
    const wallet = makeWallet([makeCard()], [
      makeBenefit({
        id: "dining-3pct",
        category: "food:dining",
        percentage: 3,
        source: "development",
      }),
    ]);

    const result = optimizePurchaseWithDevelopmentWallet(purchase, wallet);

    assert.equal(result.matches[0].status, "likely_eligible");
    assert.match(result.recommendation ?? "", /dev fixture/i);
  });
});

// =============================================================================
// Personalized linked-card tests
// =============================================================================

describe("optimizePurchaseWithLinkedCards", () => {
  const product = makeProduct({
    id: "product-csp",
    name: "Chase Sapphire Preferred",
    issuer: "Chase",
  });

  const diningRule = makeEarningRule({
    id: "csp-dining",
    cardProductId: "product-csp",
    eligibleCategory: "food:dining",
    rewardCurrency: "points",
    rewardValue: 3,
    explanation: "3 points per $1 on dining.",
  });

  const otherRule = makeEarningRule({
    id: "csp-other",
    cardProductId: "product-csp",
    eligibleCategory: "other",
    rewardCurrency: "points",
    rewardValue: 1,
    explanation: "1 point per $1 on other purchases.",
  });

  function makeLinkedCard(overrides: Partial<WalletCard> = {}): WalletCard {
    return makeCard({
      id: "user-card-csp",
      name: "My Chase Sapphire Preferred",
      cardProductId: "product-csp",
      source: "user",
      ...overrides,
    });
  }

  it("recommends one linked card with an eligible rule", () => {
    const purchase = makePurchase({
      merchant: "Restaurant",
      category: "food:dining",
    });

    const result = optimizePurchaseWithLinkedCards(
      purchase,
      [makeLinkedCard()],
      new Map([["product-csp", product]]),
      new Map([["product-csp", [diningRule, otherRule]]])
    );

    assert.equal(result.mode, "personalized");
    assert.equal(result.bestCardId, "user-card-csp");
    assert.equal(result.bestCardName, "My Chase Sapphire Preferred");
    // Points rule has no percentage, so dollar value is 0.
    assert.equal(result.bestEstimatedValue, 0);
    assert.equal(result.matches.length, 2);
    assert.equal(result.matches[0].status, "likely_eligible");
  });

  it("exposes the used card id from purchase.cardId (F1)", () => {
    // When the Purchase knows the card actually used, the optimization result
    // surfaces it so downstream Money Found can restrict rewards to that card.
    const purchase = makePurchase({
      merchant: "Restaurant",
      category: "food:dining",
      cardId: "user-card-csp",
    });

    const result = optimizePurchaseWithLinkedCards(
      purchase,
      [makeLinkedCard()],
      new Map([["product-csp", product]]),
      new Map([["product-csp", [diningRule]]])
    );

    assert.equal(result.mode, "personalized");
    assert.equal(result.usedCardId, "user-card-csp");
    // Best-card recommendation is unaffected by the used-card knowledge.
    assert.equal(result.bestCardId, "user-card-csp");
  });

  it("keeps usedCardId null when purchase.cardId is unknown", () => {
    const purchase = makePurchase({
      merchant: "Restaurant",
      category: "food:dining",
      cardId: null,
    });

    const result = optimizePurchaseWithLinkedCards(
      purchase,
      [makeLinkedCard()],
      new Map([["product-csp", product]]),
      new Map([["product-csp", [diningRule]]])
    );

    assert.equal(result.usedCardId, null);
  });

  it("returns no recommendation when the linked card has no matching rule", () => {
    const purchase = makePurchase({
      merchant: "Gas Station",
      category: "transportation:gas",
    });

    const result = optimizePurchaseWithLinkedCards(
      purchase,
      [makeLinkedCard()],
      new Map([["product-csp", product]]),
      new Map([["product-csp", [diningRule]]])
    );

    assert.equal(result.mode, "personalized");
    assert.equal(result.bestCardId, null);
    assert.equal(result.bestEstimatedValue, 0);
  });

  it("selects the higher-value card across two linked cards", () => {
    const cardA = makeLinkedCard({
      id: "user-card-a",
      name: "Card A",
      cardProductId: "product-a",
    });
    const cardB = makeLinkedCard({
      id: "user-card-b",
      name: "Card B",
      cardProductId: "product-b",
    });

    const productA = makeProduct({ id: "product-a", name: "Product A" });
    const productB = makeProduct({ id: "product-b", name: "Product B" });

    const ruleA = makeEarningRule({
      id: "rule-a",
      cardProductId: "product-a",
      eligibleCategory: "food:dining",
      rewardCurrency: "cashback",
      rewardValue: 0,
      percentage: 2,
    });
    const ruleB = makeEarningRule({
      id: "rule-b",
      cardProductId: "product-b",
      eligibleCategory: "food:dining",
      rewardCurrency: "cashback",
      rewardValue: 0,
      percentage: 5,
    });

    const purchase = makePurchase({
      merchant: "Restaurant",
      category: "food:dining",
    });

    const result = optimizePurchaseWithLinkedCards(
      purchase,
      [cardA, cardB],
      new Map([
        ["product-a", productA],
        ["product-b", productB],
      ]),
      new Map([
        ["product-a", [ruleA]],
        ["product-b", [ruleB]],
      ])
    );

    assert.equal(result.bestCardId, "user-card-b");
    assert.equal(result.bestCardName, "Card B");
    assert.equal(result.bestEstimatedValue, 5); // 5% of $100
  });

  it("keeps identical catalog rule IDs distinct across linked cards", () => {
    const cardA = makeLinkedCard({ id: "card-a", cardProductId: "product-a" });
    const cardB = makeLinkedCard({ id: "card-b", cardProductId: "product-b" });
    const sameRule = makeEarningRule({ id: "same-rule", eligibleCategory: "food:dining", percentage: 2 });
    const purchase = makePurchase({ category: "food:dining" });
    const result = optimizePurchaseWithLinkedCards(
      purchase,
      [cardA, cardB],
      new Map([["product-a", makeProduct({ id: "product-a" })], ["product-b", makeProduct({ id: "product-b" })]]),
      new Map([["product-a", [sameRule]], ["product-b", [{ ...sameRule, cardProductId: "product-b" }]]])
    );
    assert.equal(result.matches.length, 2);
    assert.notEqual(result.matches[0].ruleId, result.matches[1].ruleId);
  });

  it("ignores an inactive linked card", () => {
    const activeCard = makeLinkedCard({
      id: "active",
      name: "Active Card",
    });
    const inactiveCard = makeLinkedCard({
      id: "inactive",
      name: "Inactive Card",
      active: false,
    });

    const purchase = makePurchase({
      merchant: "Restaurant",
      category: "food:dining",
    });

    const result = optimizePurchaseWithLinkedCards(
      purchase,
      [activeCard, inactiveCard],
      new Map([["product-csp", product]]),
      new Map([["product-csp", [diningRule]]])
    );

    assert.equal(result.bestCardId, "active");
    assert.equal(result.matches.length, 1);
    assert.equal(result.matches[0].cardId, "active");
  });

  it("ignores unlinked wallet cards", () => {
    const linkedCard = makeLinkedCard({
      id: "linked",
      name: "Linked Card",
    });
    const unlinkedCard = makeCard({
      id: "unlinked",
      name: "Unlinked Card",
      source: "user",
    });

    const purchase = makePurchase({
      merchant: "Restaurant",
      category: "food:dining",
    });

    const result = optimizePurchaseWithLinkedCards(
      purchase,
      [linkedCard, unlinkedCard],
      new Map([["product-csp", product]]),
      new Map([["product-csp", [diningRule]]])
    );

    assert.equal(result.bestCardId, "linked");
    assert.equal(result.matches.length, 1);
  });

  it("does not use an unlinked card's development benefits", () => {
    const unlinkedCard = makeCard({
      id: "unlinked",
      name: "Unlinked Card",
      source: "user",
    });

    const purchase = makePurchase({
      merchant: "Restaurant",
      category: "food:dining",
    });

    const result = optimizePurchaseWithLinkedCards(
      purchase,
      [unlinkedCard],
      new Map(),
      new Map()
    );

    assert.equal(result.mode, "personalized");
    assert.equal(result.bestCardId, null);
    assert.equal(result.matches.length, 0);
  });

  it("ignores an inactive earning rule", () => {
    const inactiveRule = makeEarningRule({
      id: "csp-inactive",
      cardProductId: "product-csp",
      eligibleCategory: "food:dining",
      active: false,
    });

    const purchase = makePurchase({
      merchant: "Restaurant",
      category: "food:dining",
    });

    const result = optimizePurchaseWithLinkedCards(
      purchase,
      [makeLinkedCard()],
      new Map([["product-csp", product]]),
      new Map([["product-csp", [inactiveRule]]])
    );

    assert.equal(result.bestCardId, null);
    assert.equal(result.matches.length, 0);
  });

  it("applies merchant exclusions from catalog rules", () => {
    const excludedDiningRule = makeEarningRule({
      id: "csp-dining-excl",
      cardProductId: "product-csp",
      eligibleCategory: "food:dining",
      excludedMerchants: ["dev cafe"],
      rewardCurrency: "points",
      rewardValue: 3,
      explanation: "3 points per $1 on dining, excluding Dev Cafe.",
    });

    const purchase = makePurchase({
      merchant: "Dev Cafe Downtown",
      category: "food:dining",
    });

    const result = optimizePurchaseWithLinkedCards(
      purchase,
      [makeLinkedCard()],
      new Map([["product-csp", product]]),
      new Map([["product-csp", [excludedDiningRule]]])
    );

    assert.equal(result.bestCardId, null);
    assert.equal(result.matches.length, 1);
    assert.equal(result.matches[0].status, "not_eligible");
    assert.match(result.matches[0].reason, /excluded/i);
  });
});

// =============================================================================
// Backward compatibility
// =============================================================================

describe("optimizePurchase", () => {
  it("remains the development-wallet optimizer for backward compatibility", () => {
    const purchase = makePurchase({
      merchant: "Local Bistro",
      category: "food:dining",
    });
    const wallet = makeWallet([makeCard()], [
      makeBenefit({
        id: "dining-3pct",
        category: "food:dining",
        percentage: 3,
      }),
    ]);

    const result = optimizePurchase(purchase, wallet);

    assert.equal(result.mode, "development");
    assert.equal(result.bestCardId, "card-1");
  });
});
