import type { ReceiptExtraction } from "./types";
import { matchReceiptItemsToOffers } from "./offers";
import { optimizeReceiptCard } from "../wallet/optimizer";
import { DEVELOPMENT_WALLET } from "../wallet/cards";
import type { CardOptimizationResult } from "../wallet/optimizer";

/** The type of savings a given opportunity represents. */
export type SavingsOpportunityType = "discount" | "reward" | "offer";

/** A single, actionable savings opportunity discovered for a receipt. */
export interface SavingsOpportunity {
  /** Short human-readable title, e.g. "5% off with store card". */
  title: string;

  /** Longer explanation of the opportunity. */
  description: string;

  /** Estimated dollar value of the opportunity. */
  amount: number;

  /** Classification of the opportunity. */
  type: SavingsOpportunityType;
}

/** The result of running the savings engine over a receipt. */
export interface ReceiptSavingsResult {
  /** Total already saved on the receipt (from discounts/coupons applied). */
  alreadySaved: number;

  /** Total estimated value of the opportunities returned. */
  moneyFound: number;

  /** Every savings opportunity identified for the receipt. */
  opportunities: SavingsOpportunity[];

  /** Card optimization result from the development wallet. */
  cardOptimization: CardOptimizationResult | null;
}

/**
 * Calculates the savings summary for a receipt.
 *
 * - `alreadySaved` comes directly from `receipt.discount` (defaults to 0).
 *   This represents discounts/coupons already applied to the receipt.
 * - `opportunities` are derived from the development offer catalog via
 *   `matchReceiptItemsToOffers`. Each match becomes a `SavingsOpportunity`
 *   of type "offer".
 * - `moneyFound` is the sum of all opportunity amounts (rounded to cents,
 *   never negative) plus the best-card optimization value when positive.
 *   It does NOT include `alreadySaved`.
 * - `cardOptimization` contains the best-card optimization result when
 *   applicable, or null when no card has positive value.
 */
export function calculateSavingsOpportunities(
  receipt: ReceiptExtraction
): ReceiptSavingsResult {
  const alreadySaved = receipt.discount ?? 0;

  // Development offer matches.
  const offerMatches = matchReceiptItemsToOffers(receipt.items);

  const opportunities: SavingsOpportunity[] = offerMatches.map((match) => ({
    title: match.offer.title,
    description: `DEVELOPMENT TEST DATA — matched product(s): ${match.matchedItemNames.join(
      ", "
    )}. This is not a real Chase offer or currently available promotion.`,
    amount: match.estimatedSavings,
    type: "offer",
  }));

  // Best-card optimization against the development wallet.
  const cardOptimization = optimizeReceiptCard(receipt, DEVELOPMENT_WALLET);

  // Build the moneyFound total:
  // - Sum of all offer opportunity amounts
  // - Plus the best-card optimization value when bestEstimatedValue > 0
  const offerTotal = opportunities.reduce((sum, opportunity) => sum + opportunity.amount, 0);
  const optimizationValue = cardOptimization?.bestEstimatedValue ?? 0;
  const moneyFound = Math.max(
    0,
    Math.round((offerTotal + optimizationValue) * 100) / 100
  );

  // Add a reward-type opportunity when the best card has positive estimated value.
  const rewardOpportunity =
    cardOptimization?.bestEstimatedValue > 0
      ? {
          title: "Better card was available (development test)",
          description: cardOptimization.recommendation ?? "Development test card optimization.",
          amount: cardOptimization.bestEstimatedValue,
          type: "reward" as SavingsOpportunityType,
        }
      : null;

  // Include the reward opportunity in the opportunities array when present,
  // but do not double-count its amount in moneyFound (already included above).
  const allOpportunities = rewardOpportunity
    ? [...opportunities, rewardOpportunity]
    : opportunities;

  return {
    alreadySaved,
    moneyFound,
    opportunities: allOpportunities,
    cardOptimization,
  };
}