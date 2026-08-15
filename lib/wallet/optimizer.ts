/**
 * Deterministic best-card optimizer.
 *
 * Given a receipt and a wallet, identifies the card that would have
 * provided the highest estimated dollar value on the receipt's line items.
 * Uses only the deterministic matching engine and the development
 * valuation catalog — no live data, no AI, no external calls.
 *
 * IMPORTANT: The optimizer only identifies the best card based on
 * development fixtures. It does not claim to produce real-world
 * recommendations and must not be presented as such.
 */

import type {
  ReceiptExtraction,
} from "@/lib/receipts/types";
import type { Wallet } from "@/lib/wallet/types";
import type { BenefitMatch } from "./matching";
import { matchReceiptToWalletBenefits } from "./matching";
import { valueReward } from "./valuation";

/** The result of optimizing a receipt against a wallet. */
export interface CardOptimizationResult {
  /** Id of the card that provides the highest estimated dollar value. */
  bestCardId: string | null;

  /** Display name of the best card. */
  bestCardName: string | null;

  /** Total estimated dollar value from that card's benefits. */
  bestEstimatedValue: number;

  /** Every benefit match identified for the receipt. */
  matches: BenefitMatch[];

  /** Human-readable explanation of the recommendation. */
  recommendation: string | null;
}

/**
 * Optimizes a receipt against a wallet to determine the best card.
 *
 * Rules:
 * 1. matchReceiptToWalletBenefits identifies all applicable benefit matches.
 * 2. For each match, use valueReward() where the benefit's rewardCurrency applies
 *    (cashback converts directly; points/miles use the dev valuation from valueReward).
 * 3. If multiple benefits belong to the SAME CARD, combine their estimated values
 *    for that card before comparing across cards.
 * 4. The card with the highest combined estimated value becomes bestCard.
 * 5. If no card has a positive combined value, bestCardId/bestCardName are null
 *    and bestEstimatedValue is 0.
 * 6. recommendation is a concise, deterministic string describing the best card
 *    and its approximate value, or null if no card has positive value.
 * 7. All dollar values are rounded to cents.
 */
export function optimizeReceiptCard(
  receipt: ReceiptExtraction,
  wallet: Wallet
): CardOptimizationResult {
  // 1. Identify all benefit matches.
  const matches = matchReceiptToWalletBenefits(receipt, wallet);

  // 2. Group matches by cardId and sum their estimated values.
  //    Also track the full match objects for the UI.
  const cardValues = new Map<string, { total: number; cardName: string; matches: BenefitMatch[] }>();

  for (const match of matches) {
    const cardId = match.cardId;
    const card = wallet.cards.find((c) => c.id === cardId);
    if (!card) continue;

    const cardValue = cardValues.get(cardId);
    if (cardValue) {
      // Same card: combine values.
      cardValues.get(cardId)!.total += match.estimatedValue;
      cardValues.get(cardId)!.matches.push(match);
    } else {
      // First match for this card.
      cardValues.set(cardId, {
        total: match.estimatedValue,
        cardName: card.name,
        matches: [match],
      });
    }
  }

  // 3. Determine the best card (highest positive total).
  let bestCardId: string | null = null;
  let bestCardName: string | null = null;
  let bestEstimatedValue = 0 as number;

  for (const [cardId, value] of cardValues) {
    if (value.total > bestEstimatedValue) {
      bestEstimatedValue = value.total;
      bestCardId = cardId;
      bestCardName = value.cardName;
    }
  }

  // 4. If no card has positive value, null out everything.
  if (bestEstimatedValue <= 0) {
    bestCardId = null;
    bestCardName = null;
    bestEstimatedValue = 0;
  }

  // 5. Build the recommendation string.
  let recommendation: string | null = null;
  if (bestCardId) {
    // Sum the matched item names for context in the recommendation.
    const allMatchedItems = bestCardName
      ? matches
        .filter((m) => m.cardId === bestCardId)
        .flatMap((m) => m.matchedItemNames)
        .filter(
          (name, index, self) => self.indexOf(name) === index
        )
        .slice(0, 3)
        .join(", ")
      : "";

    const dollarStr = bestEstimatedValue.toFixed(2);
    // Build a short reason snippet from the first matched benefit.
    const firstMatch = matches.find((m) => m.cardId === bestCardId);
    const reasonSnippet =
      firstMatch?.reason?.match(/[\$\.\d]+/) ? firstMatch.reason : "";

    recommendation = ` ${bestCardName} (dev fixture) would have provided approximately $${dollarStr} `;

    // If there's a concise reason from the match, add it.
    if (reasonSnippet) {
      recommendation += `in reward value on ${allMatchedItems ? allMatchedItems + " " : ""}${reasonSnippet}`;
    } else {
      recommendation += " on the matched purchases.";
    }
  }

  return {
    bestCardId,
    bestCardName,
    bestEstimatedValue,
    matches,
    recommendation,
  };
}