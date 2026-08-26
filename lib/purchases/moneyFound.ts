/**
 * Per-purchase Money Found aggregation.
 *
 * Money Found = the **confirmed, trusted dollar value** Finance Buddy has
 * identified that the user gains on a specific Purchase. It is purely a view
 * over existing, trusted signals — it performs NO database writes and is a pure
 * deterministic function of its inputs.
 *
 * TRUST BOUNDARY (Money Found is intentionally conservative):
 *   Counted:
 *     - optimization match status === "confirmed_eligible" with estimatedValue > 0
 *       AND match.cardId === purchase.cardId (the card actually used)
 *     - benefit opportunity status === "confirmed_eligible" with usableValue > 0
 *   Not counted:
 *     - likely_eligible / likely_eligible matches/opportunities
 *     - unknown, not_eligible, insufficient_information
 *     - potentialValue (informational ceiling only)
 *     - points/miles without an explicit dollar valuation (estimatedValue === 0)
 *     - discount/tax/tip/fees (Already Saved — already paid, not Money Found)
 *     - remaining benefit balance (shown on /wallet, never aggregated here)
 *     - cashback on a card OTHER than the used card (a recommendation, not an
 *       actual reward), and ALL card-based cashback when purchase.cardId is
 *       unknown (null)
 *
 * Money Found is "calculated" provenance: it is derived, not stored.
 */

import type { Purchase } from "@/lib/purchases/types";
import type { PurchaseOptimizationResult } from "@/lib/purchases/optimizePurchase";
import type { BenefitOpportunity } from "@/lib/wallet/benefitOpportunity";

export type MoneyFoundSource = "cashback" | "benefit";

export interface MoneyFoundItem {
  /** What produced the value (card earning rule or a card benefit). */
  source: MoneyFoundSource;

  /**
   * Wallet card that owns the rule/benefit. Null for development fixtures
   * (mode === "development"), which are not real Money Found.
   */
  cardId: string | null;

  /**
   * Stable identifier of the underlying rule or benefit, used for deduplication.
   * - cashback -> the matching rule's `benefitId` (rule id)
   * - benefit  -> the wallet benefit's `walletBenefitId`
   */
  benefitId: string;

  /** Human-readable label for display. */
  description: string;

  /** Trusted dollar value for THIS purchase. */
  value: number;

  /** Currency of the value, when the purchase currency is known. */
  currency: string | null;
}

export interface MoneyFoundResult {
  /** Sum of all trusted dollar values for this purchase, rounded to cents. */
  total: number;
  currency: string | null;
  items: MoneyFoundItem[];
}

/** Round a dollar value to cents, never negative. */
function toCents(value: number): number {
  return Math.max(0, Math.round(value * 100) / 100);
}

/**
 * Deduper key. The same card+beneﬁt can appear both as an optimization match
 * (catalog earning rule) and as a benefit opportunity (wallet benefit state).
 * We count it once, keyed by source + card + underlying identifier.
 */
function dedupeKey(item: MoneyFoundItem): string {
  return `${item.source}|${item.cardId ?? ""}|${item.benefitId}`;
}

/**
 * Compute the per-purchase Money Found value from existing, trusted signals.
 *
 * @param purchase      The canonical Purchase.
 * @param optimization  Optional optimization result (linked-card or dev fixture).
 * @param opportunities Optional Wallet benefit opportunities evaluated for
 *                      this Purchase.
 */
export function computeMoneyFound(
  purchase: Purchase,
  optimization?: PurchaseOptimizationResult | null,
  opportunities?: BenefitOpportunity[]
): MoneyFoundResult {
  const currency = purchase.currency?.trim().toUpperCase() || null;
  if (currency === null) return { total: 0, currency: null, items: [] };

  const items: MoneyFoundItem[] = [];

  // 1. Confirmed cashback value from optimization matches.
  //
  // Card-based cashback counts ONLY when the rule's card is the card actually
  // used on this Purchase. When `purchase.cardId` is null or differs, the
  // confirmed match is a recommendation for a hypothetical card, not an
  // actual reward — it never counts as Money Found.
  if (optimization) {
    const usedCardId = purchase.cardId;
    for (const match of optimization.matches) {
      if (
        match.status === "confirmed_eligible" &&
        match.estimatedValue > 0 &&
        usedCardId !== null &&
        match.cardId === usedCardId
      ) {
        items.push({
          source: "cashback",
          cardId: match.cardId ?? null,
          benefitId: match.benefitId,
          description: match.benefitTitle,
          value: toCents(match.estimatedValue),
          currency,
        });
      }
    }
  }

  // 2. Confirmed benefit usable value from benefit opportunities.
  if (opportunities) {
    for (const opportunity of opportunities) {
      if (
        opportunity.status === "confirmed_eligible" &&
        opportunity.cardId === purchase.cardId &&
        (opportunity.usableValue ?? 0) > 0
      ) {
        items.push({
          source: "benefit",
          // Opportunities do not carry the owning card id; use the wallet
          // benefit id's backing card only if it can be resolved later. For now
          // cardId is null at this layer (no Purchase.card association here).
          cardId: null,
          benefitId: opportunity.walletBenefitId,
          description: opportunity.title,
          value: toCents(opportunity.usableValue!),
          currency,
        });
      }
    }
  }

  // 3. Deduplicate by source + card + underlying identifier (count once).
  const seen = new Set<string>();
  const deduped: MoneyFoundItem[] = [];
  for (const item of items) {
    const key = dedupeKey(item);
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(item);
  }

  const total = toCents(
    deduped.reduce((sum, item) => sum + item.value, 0)
  );

  return { total, currency, items: deduped };
}
