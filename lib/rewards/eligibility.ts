/**
 * Minimal rewards eligibility evaluation layer.
 *
 * A `RewardEligibilityRule` describes what a card/benefit offers. Eligibility
 * is computed by evaluating a rule against a specific Purchase, producing a
 * `RewardEligibilityResult`.
 *
 * This module intentionally does not implement MCC, caps, activation,
 * geography, channel, effective dates, or issuer verification. Those are
 * future extensions.
 */

import type { Purchase } from "@/lib/purchases/types";
import type { CanonicalCategoryKey } from "./categories";

/** Supported reward rule types. */
export type RewardRuleType = "earning_rate" | "statement_credit" | "offer";

/** Reward currency for a rule. */
export type RewardCurrency = "cashback" | "points" | "miles" | "none";

/** A rule describing how a card/benefit may reward a transaction. */
export interface RewardEligibilityRule {
  /** Stable rule identifier. */
  id: string;

  /** Card this rule belongs to. */
  cardId: string;

  /** Rule structure. */
  type: RewardRuleType;

  /** Canonical category this rule applies to, if category-based. */
  eligibleCategory: CanonicalCategoryKey | null;

  /** Specific merchant this rule applies to, if merchant-specific. */
  eligibleMerchant: string | null;

  /** Merchants explicitly excluded from this rule, even if category matches. */
  excludedMerchants: string[];

  /** Currency in which the reward is earned. */
  rewardCurrency: RewardCurrency;

  /** Base reward value (e.g. points per dollar). */
  rewardValue: number;

  /** Percentage rate, when applicable (e.g. 3 for 3%). */
  percentage: number | null;

  /** Fixed credit/offer value, when applicable. */
  fixedValue: number | null;

  /** Human-readable explanation template or positive-match description. */
  explanation: string;

  /** Provenance/source of the rule (e.g. "development", "issuer"). */
  source: string;
}

/** Eligibility status from evaluating a rule against a Purchase. */
export type EligibilityStatus =
  | "confirmed_eligible"
  | "likely_eligible"
  | "unknown"
  | "not_eligible";

/** Result of evaluating one rule against one Purchase. */
export interface RewardEligibilityResult {
  /** The evaluated rule's id. */
  ruleId: string;

  /** Eligibility status for this Purchase. */
  status: EligibilityStatus;

  /** Human-readable reason explaining the status. */
  reason: string;
}

// =============================================================================
// Helpers
// =============================================================================

/** Normalizes a string for case-insensitive matching. */
function normalize(value: string | null | undefined): string {
  return (value ?? "").toLowerCase().trim();
}

/** True when merchant contains the pattern (case-insensitive substring). */
function merchantMatches(
  merchant: string | null,
  pattern: string | null
): boolean {
  if (merchant === null || pattern === null) return false;
  return normalize(merchant).includes(normalize(pattern));
}

/** True when the purchase category matches the rule's eligible category. */
function categoryMatches(
  purchaseCategory: CanonicalCategoryKey | string | null,
  ruleCategory: CanonicalCategoryKey | null
): boolean {
  if (ruleCategory === null || purchaseCategory === null) return false;
  // Exact leaf key match, or the purchase is a leaf under the rule's root.
  if (purchaseCategory === ruleCategory) return true;

  const ruleRoot = ruleCategory.split(":")[0];
  const purchaseRoot = purchaseCategory.split(":")[0];

  // Rule targets a whole root (e.g. "food") and purchase is in that root.
  return ruleRoot === purchaseRoot && ruleCategory === ruleRoot;
}

// =============================================================================
// Evaluation
// =============================================================================

/**
 * Evaluate a single rewards eligibility rule against a Purchase.
 *
 * Precedence:
 * 1. Merchant exclusion wins → not_eligible
 * 2. Specific merchant match → confirmed_eligible
 * 3. Canonical category match → likely_eligible
 * 4. No match → not_eligible
 *
 * The result includes a human-readable reason so the optimizer/UI can explain
 * why a rule did or did not match.
 */
export function evaluateEligibility(
  purchase: Pick<Purchase, "merchant" | "category">,
  rule: RewardEligibilityRule
): RewardEligibilityResult {
  const merchant = purchase.merchant;
  const category = purchase.category;

  const excludedMatch = rule.excludedMerchants.find((pattern) =>
    merchantMatches(merchant, pattern)
  );

  if (excludedMatch !== undefined) {
    return {
      ruleId: rule.id,
      status: "not_eligible",
      reason: `Merchant "${merchant ?? "unknown"}" is excluded by pattern "${excludedMatch}".`,
    };
  }

  if (merchantMatches(merchant, rule.eligibleMerchant)) {
    return {
      ruleId: rule.id,
      status: "confirmed_eligible",
      reason: rule.explanation || `Merchant "${merchant}" matches eligible merchant "${rule.eligibleMerchant}".`,
    };
  }

  if (categoryMatches(category, rule.eligibleCategory)) {
    return {
      ruleId: rule.id,
      status: "likely_eligible",
      reason: rule.explanation || `Category "${category}" matches eligible category "${rule.eligibleCategory}".`,
    };
  }

  return {
    ruleId: rule.id,
    status: "not_eligible",
    reason: `Purchase merchant "${merchant ?? "unknown"}" and category "${category ?? "unknown"}" do not match this rule.`,
  };
}

/**
 * Evaluate multiple rules against a Purchase.
 *
 * Returns one result per rule, preserving rule order.
 */
export function evaluateEligibilityForRules(
  purchase: Pick<Purchase, "merchant" | "category">,
  rules: RewardEligibilityRule[]
): RewardEligibilityResult[] {
  return rules.map((rule) => evaluateEligibility(purchase, rule));
}
