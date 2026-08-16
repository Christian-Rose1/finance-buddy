/**
 * Focused tests for the rewards eligibility evaluator.
 *
 * Run with: npx tsx --test lib/rewards/eligibility.test.ts
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Purchase } from "@/lib/purchases/types";
import {
  evaluateEligibility,
  evaluateEligibilityForRules,
  type RewardEligibilityRule,
} from "./eligibility";

function makePurchase(
  merchant: string | null,
  category: string | null
): Pick<Purchase, "merchant" | "category"> {
  return { merchant, category };
}

function makeRule(
  overrides: Partial<RewardEligibilityRule>
): RewardEligibilityRule {
  return {
    id: "rule-1",
    cardId: "card-1",
    type: "earning_rate",
    eligibleCategory: null,
    eligibleMerchant: null,
    excludedMerchants: [],
    rewardCurrency: "cashback",
    rewardValue: 0,
    percentage: null,
    fixedValue: null,
    explanation: "Test rule.",
    source: "development",
    ...overrides,
  };
}

describe("evaluateEligibility", () => {
  it("returns confirmed_eligible for a specific merchant match", () => {
    const purchase = makePurchase("Dev Cafe", "food:dining");
    const rule = makeRule({
      id: "dev-cafe-offer",
      eligibleMerchant: "Dev Cafe",
      explanation: "Earns $10 back at Dev Cafe.",
    });

    const result = evaluateEligibility(purchase, rule);

    assert.equal(result.ruleId, "dev-cafe-offer");
    assert.equal(result.status, "confirmed_eligible");
    assert.equal(result.reason, "Earns $10 back at Dev Cafe.");
  });

  it("returns likely_eligible for a canonical category match", () => {
    const purchase = makePurchase("Local Bistro", "food:dining");
    const rule = makeRule({
      id: "dining-3x",
      eligibleCategory: "food:dining",
      explanation: "Earns 3x on dining.",
    });

    const result = evaluateEligibility(purchase, rule);

    assert.equal(result.status, "likely_eligible");
    assert.equal(result.reason, "Earns 3x on dining.");
  });

  it("matches a whole root category against any leaf in that root", () => {
    const purchase = makePurchase("Whole Foods", "food:groceries");
    const rule = makeRule({
      id: "food-2x",
      eligibleCategory: "food",
      explanation: "Earns 2x on all food.",
    });

    const result = evaluateEligibility(purchase, rule);

    assert.equal(result.status, "likely_eligible");
    assert.equal(result.reason, "Earns 2x on all food.");
  });

  it("does not match a leaf rule against a different leaf in the same root", () => {
    const purchase = makePurchase("Whole Foods", "food:groceries");
    const rule = makeRule({
      id: "dining-only",
      eligibleCategory: "food:dining",
    });

    const result = evaluateEligibility(purchase, rule);

    assert.equal(result.status, "not_eligible");
    assert.match(result.reason, /do not match this rule/);
  });

  it("returns not_eligible when nothing matches", () => {
    const purchase = makePurchase("Gas Station", "transportation:gas");
    const rule = makeRule({
      id: "dining-only",
      eligibleCategory: "food:dining",
    });

    const result = evaluateEligibility(purchase, rule);

    assert.equal(result.status, "not_eligible");
    assert.match(result.reason, /do not match this rule/);
  });

  it("returns not_eligible for unknown/null category", () => {
    const purchase = makePurchase("Some Merchant", null);
    const rule = makeRule({
      id: "dining-only",
      eligibleCategory: "food:dining",
    });

    const result = evaluateEligibility(purchase, rule);

    assert.equal(result.status, "not_eligible");
  });

  it("exclusion overrides a category match", () => {
    const purchase = makePurchase("Walmart", "food:groceries");
    const rule = makeRule({
      id: "grocery-4x",
      eligibleCategory: "food:groceries",
      excludedMerchants: ["walmart"],
      explanation: "Earns 4x on groceries, excluding superstores.",
    });

    const result = evaluateEligibility(purchase, rule);

    assert.equal(result.status, "not_eligible");
    assert.match(result.reason, /excluded/i);
    assert.match(result.reason, /walmart/i);
  });

  it("exclusion overrides a merchant match when both would match", () => {
    const purchase = makePurchase("Walmart Supercenter", null);
    const rule = makeRule({
      id: "walmart-offer",
      eligibleMerchant: "walmart",
      excludedMerchants: ["walmart supercenter"],
    });

    const result = evaluateEligibility(purchase, rule);

    assert.equal(result.status, "not_eligible");
    assert.match(result.reason, /excluded/i);
  });

  it("merchant matching is case-insensitive and substring-based", () => {
    const purchase = makePurchase("DEV CAFE - Downtown", "food:dining");
    const rule = makeRule({
      id: "dev-cafe",
      eligibleMerchant: "dev cafe",
    });

    const result = evaluateEligibility(purchase, rule);

    assert.equal(result.status, "confirmed_eligible");
  });
});

describe("evaluateEligibilityForRules", () => {
  it("evaluates every rule and preserves order", () => {
    const purchase = makePurchase("Dev Cafe", "food:dining");
    const rules: RewardEligibilityRule[] = [
      makeRule({ id: "dining-3x", eligibleCategory: "food:dining" }),
      makeRule({ id: "dev-cafe", eligibleMerchant: "Dev Cafe" }),
      makeRule({ id: "gas-5x", eligibleCategory: "transportation:gas" }),
    ];

    const results = evaluateEligibilityForRules(purchase, rules);

    assert.equal(results.length, 3);
    assert.equal(results[0].ruleId, "dining-3x");
    assert.equal(results[0].status, "likely_eligible");
    assert.equal(results[1].ruleId, "dev-cafe");
    assert.equal(results[1].status, "confirmed_eligible");
    assert.equal(results[2].ruleId, "gas-5x");
    assert.equal(results[2].status, "not_eligible");
  });
});
