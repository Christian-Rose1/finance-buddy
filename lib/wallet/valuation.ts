/**
 * Reward valuation module — deterministic development assumptions for
 * converting reward units into dollar values.
 *
 * IMPORTANT: These are DEVELOPMENT ASSUMPTIONS ONLY. They are not claimed
 * to be current real-world valuations. They exist solely to enable
 * deterministic calculation within the Finance Buddy prototype.
 */

import type { RewardCurrency } from "./types";

/** Reward valuation for a given currency type. */
export type RewardValuation = {
  /** The reward currency type. */
  currency: RewardCurrency;

  /** How many dollars one unit represents. */
  dollarValuePerUnit: number;

  /** Provenance. Always "development" for dev fixtures. */
  source: "development";
};

/** Development valuation catalog. Every entry is clearly labeled as a
 * test/dev assumption and is never presented as a real-market rate. */
export const DEVELOPMENT_VALUATIONS: Record<RewardCurrency, RewardValuation> = {
  /** $0.01 per point — development/test assumption. */
  points: {
    currency: "points" as RewardCurrency,
    dollarValuePerUnit: 0.01,
    source: "development",
  },
  /** $0.02 per mile — development/test assumption. */
  miles: {
    currency: "miles" as RewardCurrency,
    dollarValuePerUnit: 0.02,
    source: "development",
  },
  /** 1 point = $1.00 — development/test assumption. */
  cashback: {
    currency: "cashback" as RewardCurrency,
    dollarValuePerUnit: 1,
    source: "development",
  },
  /** No reward. */
  none: {
    currency: "none" as RewardCurrency,
    dollarValuePerUnit: 0,
    source: "development",
  },
};

/**
 * Converts a number of reward units into dollars using the
 * development valuation catalog.
 *
 * Rules:
 * - cashback:   1 unit → $1.00
 * - points:     1 unit → $0.01 (development assumption)
 * - miles:      1 unit → $0.02 (development assumption)
 * - none:       returns 0
 * - never negative; round to cents.
 */
export function valueReward(
  currency: RewardCurrency,
  units: number
): number {
  const valuation = DEVELOPMENT_VALUATIONS[currency];
  if (!valuation) return 0;

  const raw = valuation.dollarValuePerUnit * units;
  // Round to cents; never negative.
  return Math.max(0, Math.round(raw * 100) / 100);
}