import type { ReceiptExtraction } from "./types";
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
  alreadySaved: number | null;

  /** Total estimated value of the opportunities returned. */
  moneyFound: number;

  /** Every savings opportunity identified for the receipt. */
  opportunities: SavingsOpportunity[];

  /** Card optimization result when supported by customer-owned card data. */
  cardOptimization: CardOptimizationResult | null;
}

/**
 * Calculates the savings summary for a receipt.
 *
 * - `alreadySaved` comes directly from `receipt.discount`, including `null`
 *   when the receipt does not provide that information. This represents
 *   discounts/coupons already applied to the receipt.
 * - No offer or reward opportunity is inferred without customer-specific,
 *   verified inputs. Receipt extraction does not currently load those inputs,
 *   so `moneyFound` is 0 and optimization fields remain empty.
 * - Development fixtures stay available to explicit tests and demos, but are
 *   never consulted by this production calculation.
 */
export function calculateSavingsOpportunities(
  receipt: ReceiptExtraction
): ReceiptSavingsResult {
  return {
    alreadySaved: receipt.discount,
    moneyFound: 0,
    opportunities: [],
    cardOptimization: null,
  };
}
