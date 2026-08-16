/**
 * Focused tests for the updated wallet matching layer.
 *
 * Run with: npx tsx --test lib/wallet/matching.test.ts
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { ReceiptExtraction } from "@/lib/receipts/types";
import { matchReceiptToWalletBenefits, type BenefitMatch } from "./matching";
import type { CardBenefit, Wallet, WalletCard } from "./types";

function makeReceipt(
  merchant: string | null,
  items: { name: string | null; category: string | null; total: number }[]
): ReceiptExtraction {
  return {
    merchant,
    transaction_date: "2026-01-01",
    currency: "USD",
    items: items.map((item) => ({
      name: item.name,
      quantity: null,
      unit_price: null,
      total: item.total,
      discount: null,
      category: item.category,
      confidence: 1,
    })),
    subtotal: items.reduce((sum, item) => sum + item.total, 0),
    tax: null,
    tip: null,
    discount: null,
    total: items.reduce((sum, item) => sum + item.total, 0),
    confidence: 1,
    source: "receipt",
  };
}

function makeCard(overrides: Partial<WalletCard> = {}): WalletCard {
  return {
    id: "card-1",
    name: "Dev Card",
    issuer: "Dev Bank",
    network: "visa",
    rewardCurrency: "points",
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
    rewardCurrency: "points",
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

describe("matchReceiptToWalletBenefits", () => {
  it("matches legacy receipt categories to canonical benefit categories", () => {
    const receipt = makeReceipt("Local Bistro", [
      { name: "Burger", category: "Dining", total: 20 },
    ]);
    const benefit = makeBenefit({
      id: "dining-3x",
      category: "food:dining",
      rewardValue: 3,
    });

    const matches = matchReceiptToWalletBenefits(receipt, makeWallet([makeCard()], [benefit]));

    assert.equal(matches.length, 1);
    assert.equal(matches[0].benefitId, "dining-3x");
    assert.equal(matches[0].estimatedValue, 0); // points, no dollar conversion
    assert.match(matches[0].reason, /food:dining/);
  });

  it("matches canonical receipt categories to canonical benefit categories", () => {
    const receipt = makeReceipt("Whole Foods", [
      { name: "Organic Milk", category: "food:groceries", total: 50 },
    ]);
    const benefit = makeBenefit({
      id: "grocery-4x",
      category: "food:groceries",
      rewardValue: 4,
    });

    const matches = matchReceiptToWalletBenefits(receipt, makeWallet([makeCard()], [benefit]));

    assert.equal(matches.length, 1);
    assert.equal(matches[0].benefitId, "grocery-4x");
  });

  it("supports root-aware category matching", () => {
    const receipt = makeReceipt("Coffee Shop", [
      { name: "Latte", category: "food:coffee", total: 6 },
    ]);
    const benefit = makeBenefit({
      id: "food-2x",
      category: "food",
      rewardValue: 2,
    });

    const matches = matchReceiptToWalletBenefits(receipt, makeWallet([makeCard()], [benefit]));

    assert.equal(matches.length, 1);
    assert.equal(matches[0].benefitId, "food-2x");
  });

  it("matches a specific merchant for offers", () => {
    const receipt = makeReceipt("Dev Cafe Downtown", [
      { name: "Coffee", category: "food:coffee", total: 60 },
    ]);
    const benefit = makeBenefit({
      id: "dev-cafe-offer",
      type: "offer",
      category: null,
      merchant: "Dev Cafe",
      rewardCurrency: "cashback",
      fixedValue: 10,
    });

    const matches = matchReceiptToWalletBenefits(receipt, makeWallet([makeCard()], [benefit]));

    assert.equal(matches.length, 1);
    assert.equal(matches[0].benefitId, "dev-cafe-offer");
    assert.equal(matches[0].estimatedValue, 10);
    assert.match(matches[0].reason, /Dev Cafe/);
  });

  it("excludes merchant even when category matches", () => {
    const receipt = makeReceipt("Walmart", [
      { name: "Apples", category: "food:groceries", total: 50 },
    ]);
    const benefit = makeBenefit({
      id: "grocery-4x",
      category: "food:groceries",
      rewardValue: 4,
      excludedMerchants: ["walmart"],
    });

    const matches = matchReceiptToWalletBenefits(receipt, makeWallet([makeCard()], [benefit]));

    assert.equal(matches.length, 0);
  });

  it("excludes merchant even when specific merchant would match", () => {
    const receipt = makeReceipt("Walmart Supercenter", [
      { name: "Apples", category: "food:groceries", total: 50 },
    ]);
    const benefit = makeBenefit({
      id: "walmart-offer",
      type: "offer",
      category: null,
      merchant: "Walmart",
      rewardCurrency: "cashback",
      fixedValue: 10,
      excludedMerchants: ["Walmart Supercenter"],
    });

    const matches = matchReceiptToWalletBenefits(receipt, makeWallet([makeCard()], [benefit]));

    assert.equal(matches.length, 0);
  });

  it("does not match unknown receipt categories", () => {
    const receipt = makeReceipt("Some Store", [
      { name: "Thing", category: "UnknownCategory", total: 100 },
    ]);
    const benefit = makeBenefit({
      id: "dining-3x",
      category: "food:dining",
      rewardValue: 3,
    });

    const matches = matchReceiptToWalletBenefits(receipt, makeWallet([makeCard()], [benefit]));

    assert.equal(matches.length, 0);
  });

  it("preserves active-card and active-benefit filtering", () => {
    const receipt = makeReceipt("Local Bistro", [
      { name: "Burger", category: "Dining", total: 20 },
    ]);
    const inactiveBenefit = makeBenefit({
      id: "inactive-dining",
      category: "food:dining",
      active: false,
    });

    const matches = matchReceiptToWalletBenefits(receipt, makeWallet([makeCard()], [inactiveBenefit]));

    assert.equal(matches.length, 0);
  });

  it("matches earning_rate by specific merchant when provided", () => {
    const receipt = makeReceipt("Dev Cafe", [
      { name: "Coffee", category: "food:coffee", total: 30 },
      { name: "Bagel", category: "food:dining", total: 10 },
    ]);
    const benefit = makeBenefit({
      id: "dev-cafe-5x",
      category: "food:dining",
      merchant: "Dev Cafe",
      rewardValue: 5,
    });

    const matches = matchReceiptToWalletBenefits(receipt, makeWallet([makeCard()], [benefit]));

    assert.equal(matches.length, 1);
    assert.equal(matches[0].benefitId, "dev-cafe-5x");
    // Merchant match uses whole receipt spend, not just dining items.
    assert.match(matches[0].reason, /\$40\.00/);
  });
});
