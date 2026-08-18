/**
 * Purchase → Wallet Benefit opportunity evaluator.
 *
 * Evaluates whether a single Purchase could use a single user WalletBenefit
 * (user-specific state) backed by a shared ProductBenefit (catalog definition).
 *
 * This is a pure, deterministic function. It does not touch the database, the
 * optimizer, or earning rules.
 *
 * Eligibility semantics:
 * - confirmed_eligible: a specific merchant match confirms eligibility.
 * - likely_eligible: category matches and there is no unverifiable condition.
 * - insufficient_information: category matches but a required condition (e.g.
 *   booking channel) cannot be verified from the Purchase.
 * - not_eligible: inactive benefit, category mismatch, or no match.
 *
 * Value semantics:
 * - usableValue is only set for confirmed_eligible / likely_eligible and is
 *   min(purchase.amount, remainingValue), never exceeding remainingValue.
 * - insufficient_information never contributes a usableValue (no dollar claim
 *   from uncertain eligibility). potentialValue is an informational ceiling
 *   only.
 */

import type { Purchase } from "@/lib/purchases/types";
import type { WalletBenefit } from "./types";
import type { ProductBenefit } from "@/lib/rewards/catalogTypes";
import { normalizeCategory } from "@/lib/rewards/categories";

export type BenefitOpportunityStatus =
  | "confirmed_eligible"
  | "likely_eligible"
  | "insufficient_information"
  | "not_eligible";

export interface BenefitOpportunity {
  /** Shared product-level benefit definition id. */
  productBenefitId: string;

  /** User-specific benefit state id. */
  walletBenefitId: string;

  /** Benefit title from the product definition. */
  title: string;

  /** Eligibility status for this Purchase. */
  status: BenefitOpportunityStatus;

  /**
   * Dollar value usable for this Purchase. Only set for confirmed_eligible /
   * likely_eligible. Null otherwise (never a dollar claim from uncertain
   * eligibility).
   */
  usableValue: number | null;

  /**
   * Informational ceiling of what could be saved if unverifiable conditions
   * were confirmed. Only set for insufficient_information. Never a confirmed
   * dollar claim.
   */
  potentialValue: number | null;

  /** The user's remaining benefit value (null when uncapped). */
  remainingValue: number | null;

  /** Required conditions that could not be verified from the Purchase. */
  missingConditions: string[];

  /** Human-readable explanation of the status. */
  reason: string;
}

/**
 * Temporary explicit rule: product benefits that require a booking channel
 * which cannot be verified from a Purchase (Purchase has no channel field).
 *
 * This is intentionally a small, explicit, hardcoded set for the MVP. It is
 * NOT a general channel-matching system. When Purchase gains a booking-channel
 * signal, this rule should be replaced by real channel evaluation.
 */
const BENEFITS_REQUIRING_BOOKING_CHANNEL: ReadonlySet<string> = new Set([
  // Chase Sapphire Preferred — $100 Annual Chase Travel Hotel Credit
  // Requires hotel accommodation purchased through Chase Travel.
  "5e19b3d1-8a7c-4b2e-9d3a-4f5c6d7e8f90",
]);

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

/**
 * True when the purchase category matches the benefit's eligible category.
 * Exact leaf match, or the purchase is a leaf under the benefit's root.
 */
function categoryMatches(
  purchaseCategory: string | null,
  benefitCategory: string | null
): boolean {
  if (benefitCategory === null || purchaseCategory === null) return false;

  const normalizedPurchase = normalizeCategory(purchaseCategory);
  const normalizedBenefit = normalizeCategory(benefitCategory);
  if (normalizedPurchase === null || normalizedBenefit === null) return false;

  if (normalizedPurchase === normalizedBenefit) return true;

  const benefitRoot = normalizedBenefit.split(":")[0];
  const purchaseRoot = normalizedPurchase.split(":")[0];

  // Benefit targets a whole root (e.g. "travel") and purchase is in that root.
  return benefitRoot === purchaseRoot && normalizedBenefit === benefitRoot;
}

/**
 * Cap a value at the remaining benefit value. Returns null when the purchase
 * amount is unknown. When remainingValue is null (uncapped), the amount is
 * used as-is. Never exceeds remainingValue.
 */
function capValue(
  amount: number | null,
  remainingValue: number | null
): number | null {
  if (amount === null || Number.isNaN(amount)) return null;
  if (remainingValue === null) return amount;
  return Math.min(amount, remainingValue);
}

/**
 * Evaluate whether a Purchase could use a WalletBenefit.
 *
 * @param purchase The canonical Purchase.
 * @param product  The shared ProductBenefit definition.
 * @param state    The user-specific WalletBenefit state.
 */
export function evaluateBenefitOpportunity(
  purchase: Purchase,
  product: ProductBenefit,
  state: WalletBenefit
): BenefitOpportunity {
  const base = {
    productBenefitId: product.id,
    walletBenefitId: state.id,
    title: product.title,
    remainingValue: state.remainingValue,
  };

  // Inactive benefit → not eligible.
  if (!state.active) {
    return {
      ...base,
      status: "not_eligible",
      usableValue: null,
      potentialValue: null,
      missingConditions: [],
      reason: "This benefit is not active.",
    };
  }

  // Specific merchant match → confirmed eligible.
  if (merchantMatches(purchase.merchant, product.eligibleMerchant)) {
    return {
      ...base,
      status: "confirmed_eligible",
      usableValue: capValue(purchase.amount, state.remainingValue),
      potentialValue: null,
      missingConditions: [],
      reason: `Merchant "${purchase.merchant}" matches this benefit.`,
    };
  }

  // Category match.
  if (categoryMatches(purchase.category, product.eligibleCategory)) {
    // Required but unverifiable booking channel → insufficient information.
    if (BENEFITS_REQUIRING_BOOKING_CHANNEL.has(product.id)) {
      return {
        ...base,
        status: "insufficient_information",
        usableValue: null,
        potentialValue: capValue(purchase.amount, state.remainingValue),
        missingConditions: ["booking_channel"],
        reason:
          "This looks like a qualifying purchase, but we can't confirm it was booked through the required channel.",
      };
    }

    return {
      ...base,
      status: "likely_eligible",
      usableValue: capValue(purchase.amount, state.remainingValue),
      potentialValue: null,
      missingConditions: [],
      reason: `Category "${purchase.category}" matches this benefit.`,
    };
  }

  // No match → not eligible.
  return {
    ...base,
    status: "not_eligible",
    usableValue: null,
    potentialValue: null,
    missingConditions: [],
    reason: `This purchase does not match "${product.title}".`,
  };
}