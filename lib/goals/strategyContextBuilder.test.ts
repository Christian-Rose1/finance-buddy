import assert from "node:assert/strict";
import { test } from "node:test";

import type { Purchase } from "../purchases/types";
import type { CardProduct } from "../rewards/catalogTypes";
import type { WalletCard } from "../wallet/types";
import type { Goal } from "./types";
import { buildPersonalizedStrategyContext } from "./strategyContextBuilder";

function goal(overrides: Partial<Goal> = {}): Goal {
  return {
    id: "goal-1",
    userId: "user-1",
    type: "travel",
    title: "Trip",
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

function walletCard(overrides: Partial<WalletCard> = {}): WalletCard {
  return {
    id: "card-a",
    name: "Card A",
    issuer: "Bank",
    network: "visa",
    rewardCurrency: "points",
    lastFour: null,
    active: true,
    source: "user",
    cardProductId: null,
    ...overrides,
  };
}

function cardProduct(overrides: Partial<CardProduct> = {}): CardProduct {
  return {
    id: "product-a",
    rewardProgramId: "program-a",
    issuer: "Bank",
    name: "Product A",
    network: "visa",
    active: true,
    annualFee: null,
    source: "development_fixture",
    lastVerifiedAt: "2026-08-16T10:50:00Z",
    metadata: null,
    ...overrides,
  };
}

function purchase(overrides: Partial<Purchase> = {}): Purchase {
  return {
    id: "purchase-1",
    merchant: "Store",
    date: "2026-08-15",
    amount: 100,
    currency: "USD",
    category: "food:dining",
    source: "manual",
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

function build(purchases: Purchase[], cards: WalletCard[] = [walletCard()]) {
  return buildPersonalizedStrategyContext(
    goal(),
    [],
    cards,
    purchases,
    [cardProduct()],
  );
}

test("attributed spending is aggregated per card with per-card month normalization", () => {
  const context = build([
    purchase({ id: "p1", cardId: "card-a", amount: 60, date: "2026-07-10" }),
    purchase({ id: "p2", cardId: "card-a", amount: 140, date: "2026-08-02" }),
  ]);
  // Card A: $200 dining across two represented months → 100/month.
  assert.deepEqual(context.monthlySpendingByCategoryCard, [
    { cardId: "card-a", category: "food:dining", monthlyAverage: 100 },
  ]);
});

test("purchases without a wallet-card cardId never enter the attributed lane", () => {
  const context = build([
    purchase({ id: "p1", cardId: null }),
    purchase({ id: "p2", cardId: "card-unknown" }),
  ]);
  assert.equal(context.monthlySpendingByCategoryCard, null);
});

test("invalid amounts are excluded from both lanes", () => {
  const context = build([
    purchase({ id: "p1", cardId: "card-a", amount: -5 }),
    purchase({ id: "p2", cardId: "card-a", amount: Number.NaN }),
    purchase({ id: "p3", cardId: "card-a", amount: 80 }),
  ]);
  assert.deepEqual(context.monthlySpendingByCategoryCard, [
    { cardId: "card-a", category: "food:dining", monthlyAverage: 80 },
  ]);
  assert.deepEqual(context.monthlySpendingByCategory, [
    { category: "food:dining", monthlyAverage: 80 },
  ]);
});

test("the card lane is a per-card subset of the unchanged wallet-wide aggregates", () => {
  const context = build([
    purchase({ id: "p1", cardId: "card-a", amount: 100, category: "food:dining" }),
    purchase({ id: "p2", cardId: null, amount: 50, category: "travel" }),
  ]);
  // The wallet-wide lane keeps its existing semantics: every valid purchase,
  // attributed or not.
  assert.deepEqual(context.monthlySpendingByCategory, [
    { category: "food:dining", monthlyAverage: 100 },
    { category: "travel", monthlyAverage: 50 },
  ]);
  // The card lane carries only the attributed subset.
  assert.deepEqual(context.monthlySpendingByCategoryCard, [
    { cardId: "card-a", category: "food:dining", monthlyAverage: 100 },
  ]);
});

test("per-card month counts use only that card's own accepted purchases", () => {
  const context = build(
    [
      purchase({ id: "p1", cardId: "card-a", amount: 100, date: "2026-07-01" }),
      purchase({ id: "p2", cardId: "card-b", amount: 300, date: "2026-08-01" }),
    ],
    [walletCard({ id: "card-a" }), walletCard({ id: "card-b", name: "Card B" })],
  );
  // Card A has one represented month; card B's month must not dilute it.
  // Entries follow card wallet order.
  assert.deepEqual(context.monthlySpendingByCategoryCard, [
    { cardId: "card-a", category: "food:dining", monthlyAverage: 100 },
    { cardId: "card-b", category: "food:dining", monthlyAverage: 300 },
  ]);
});

test("entries are deterministic: card wallet order, then amount descending, then category", () => {
  const context = build(
    [
      purchase({ id: "p1", cardId: "card-b", amount: 100, category: "travel" }),
      purchase({ id: "p2", cardId: "card-b", amount: 200, category: "food:dining" }),
      purchase({ id: "p3", cardId: "card-a", amount: 50, category: "bills" }),
    ],
    [walletCard({ id: "card-a" }), walletCard({ id: "card-b", name: "Card B" })],
  );
  assert.deepEqual(
    context.monthlySpendingByCategoryCard?.map((entry) => [entry.cardId, entry.category]),
    [
      ["card-a", "bills"],
      ["card-b", "food:dining"],
      ["card-b", "travel"],
    ],
  );
});

test("purchases without a category group under uncategorized", () => {
  const context = build([purchase({ id: "p1", cardId: "card-a", category: null })]);
  assert.deepEqual(context.monthlySpendingByCategoryCard, [
    { cardId: "card-a", category: "uncategorized", monthlyAverage: 100 },
  ]);
});

test("purchases without valid dates still aggregate spend but produce no month normalization", () => {
  const context = build([purchase({ id: "p1", cardId: "card-a", date: null })]);
  // No valid represented months → the card lane stays null rather than
  // labeling an unnormalized total as monthly data.
  assert.equal(context.monthlySpendingByCategoryCard, null);
});

test("the builder does not mutate its inputs", () => {
  const purchases = [
    purchase({ id: "p1", cardId: "card-a", amount: 100 }),
  ];
  const cards = [walletCard()];
  const snapshotPurchases = structuredClone(purchases);
  const snapshotCards = structuredClone(cards);
  build(purchases, cards);
  assert.deepEqual(purchases, snapshotPurchases);
  assert.deepEqual(cards, snapshotCards);
});
