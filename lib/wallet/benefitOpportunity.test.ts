/**
 * Focused tests for the Purchase → Wallet Benefit opportunity evaluator.
 *
 * Pure function tests; no database or Supabase client required.
 *
 * Run with: npx tsx --test lib/wallet/benefitOpportunity.test.ts
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  evaluateBenefitOpportunity,
  type BenefitOpportunity,
} from "./benefitOpportunity";
import type { Purchase } from "@/lib/purchases/types";
import type { WalletBenefit } from "./types";
import type { ProductBenefit } from "@/lib/rewards/catalogTypes";

// =============================================================================
// Fixtures
// =============================================================================

const CSP_HOTEL_CREDIT_ID = "5e19b3d1-8a7c-4b2e-9d3a-4f5c6d7e8f90";

function makePurchase(overrides: Partial<Purchase> = {}): Purchase {
  return {
    id: "purchase-1",
    merchant: "Some Hotel",
    date: "2026-08-01",
    amount: 150,
    currency: "USD",
    category: "travel:hotels",
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

function makeProduct(overrides: Partial<ProductBenefit> = {}): ProductBenefit {
  return {
    id: CSP_HOTEL_CREDIT_ID,
    cardProductId: "product-csp",
    type: "statement_credit",
    title: "$100 Annual Chase Travel Hotel Credit",
    description: "Hotel stays purchased through Chase Travel.",
    eligibleCategory: "travel:hotels",
    eligibleMerchant: null,
    fixedValue: 100,
    annualLimit: 100,
    requiresActivation: false,
    source: "issuer_website",
    lastVerifiedAt: "2026-08-17T14:00:00Z",
    active: true,
    ...overrides,
  };
}

function makeState(overrides: Partial<WalletBenefit> = {}): WalletBenefit {
  return {
    id: "wallet-benefit-1",
    walletCardId: "card-1",
    productBenefitId: CSP_HOTEL_CREDIT_ID,
    active: true,
    activatedAt: null,
    expiresAt: null,
    remainingValue: 100,
    usedValue: 0,
    metadata: null,
    ...overrides,
  };
}

// =============================================================================
// Tests
// =============================================================================

describe("evaluateBenefitOpportunity", () => {
  it("CSP hotel category + unknown channel → insufficient_information, no usableValue", () => {
    const result = evaluateBenefitOpportunity(
      makePurchase({ category: "travel:hotels", amount: 150 }),
      makeProduct(),
      makeState({ remainingValue: 100 })
    );

    assert.equal(result.status, "insufficient_information");
    assert.equal(result.usableValue, null);
    assert.equal(result.potentialValue, 100); // informational ceiling: min(150, 100)
    assert.deepEqual(result.missingConditions, ["booking_channel"]);
    assert.equal(result.remainingValue, 100);
    assert.equal(result.productBenefitId, CSP_HOTEL_CREDIT_ID);
    assert.equal(result.walletBenefitId, "wallet-benefit-1");
    assert.equal(result.title, "$100 Annual Chase Travel Hotel Credit");
  });

  it("likely_eligible value = min(purchase.amount, remainingValue)", () => {
    // A benefit with no channel requirement.
    const product = makeProduct({
      id: "generic-dining-benefit",
      eligibleCategory: "food:dining",
    });
    const result = evaluateBenefitOpportunity(
      makePurchase({ category: "food:dining", amount: 80 }),
      product,
      makeState({ productBenefitId: "generic-dining-benefit", remainingValue: 100 })
    );

    assert.equal(result.status, "likely_eligible");
    assert.equal(result.usableValue, 80); // min(80, 100)
    assert.equal(result.potentialValue, null);
  });

  it("confirmed_eligible on specific merchant match, value = min(amount, remaining)", () => {
    const product = makeProduct({
      id: "merchant-benefit",
      eligibleCategory: null,
      eligibleMerchant: "Chase Travel",
    });
    const result = evaluateBenefitOpportunity(
      makePurchase({ merchant: "Chase Travel", category: null, amount: 120 }),
      product,
      makeState({ productBenefitId: "merchant-benefit", remainingValue: 100 })
    );

    assert.equal(result.status, "confirmed_eligible");
    assert.equal(result.usableValue, 100); // min(120, 100)
    assert.equal(result.potentialValue, null);
  });

  it("inactive benefit → not_eligible", () => {
    const result = evaluateBenefitOpportunity(
      makePurchase({ category: "travel:hotels", amount: 150 }),
      makeProduct(),
      makeState({ active: false })
    );

    assert.equal(result.status, "not_eligible");
    assert.equal(result.usableValue, null);
    assert.equal(result.potentialValue, null);
  });

  it("category mismatch → not_eligible", () => {
    const result = evaluateBenefitOpportunity(
      makePurchase({ category: "food:dining", amount: 150 }),
      makeProduct(), // eligibleCategory = travel:hotels
      makeState()
    );

    assert.equal(result.status, "not_eligible");
    assert.equal(result.usableValue, null);
    assert.equal(result.potentialValue, null);
  });

  it("usableValue never exceeds remainingValue (cap)", () => {
    const product = makeProduct({
      id: "generic-dining-benefit",
      eligibleCategory: "food:dining",
    });
    const result = evaluateBenefitOpportunity(
      makePurchase({ category: "food:dining", amount: 200 }),
      product,
      makeState({ productBenefitId: "generic-dining-benefit", remainingValue: 50 })
    );

    assert.equal(result.status, "likely_eligible");
    assert.equal(result.usableValue, 50); // capped at remainingValue, not 200
  });

  it("insufficient_information never contributes usableValue", () => {
    const result: BenefitOpportunity = evaluateBenefitOpportunity(
      makePurchase({ category: "travel:hotels", amount: 250 }),
      makeProduct(),
      makeState({ remainingValue: 100 })
    );

    assert.equal(result.status, "insufficient_information");
    assert.equal(result.usableValue, null); // explicitly null, never a dollar claim
    assert.equal(result.potentialValue, 100); // ceiling only: min(250, 100)
  });

  it("uncapped benefit (remainingValue null) uses full amount for likely_eligible", () => {
    const product = makeProduct({
      id: "generic-dining-benefit",
      eligibleCategory: "food:dining",
    });
    const result = evaluateBenefitOpportunity(
      makePurchase({ category: "food:dining", amount: 75 }),
      product,
      makeState({ productBenefitId: "generic-dining-benefit", remainingValue: null })
    );

    assert.equal(result.status, "likely_eligible");
    assert.equal(result.usableValue, 75);
  });

  it("null purchase amount yields null usableValue", () => {
    const product = makeProduct({
      id: "generic-dining-benefit",
      eligibleCategory: "food:dining",
    });
    const result = evaluateBenefitOpportunity(
      makePurchase({ category: "food:dining", amount: null }),
      product,
      makeState({ productBenefitId: "generic-dining-benefit", remainingValue: 100 })
    );

    assert.equal(result.status, "likely_eligible");
    assert.equal(result.usableValue, null);
  });
});