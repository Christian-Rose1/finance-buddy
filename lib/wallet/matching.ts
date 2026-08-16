/**
 * Deterministic wallet benefit matching engine.
 *
 * Matches an extracted receipt against the user's wallet to identify which
 * card benefits apply. This module only identifies opportunities — it does
 * NOT pick a "best card" and does NOT fetch live card data.
 *
 * IMPORTANT: benefits come from development fixtures only (source:
 * "development") and must never be treated as verified/current real-world
 * benefits.
 */

import type { CardBenefit, Wallet, WalletCard } from "./types";
import type { ReceiptExtraction, ReceiptItem } from "@/lib/receipts/types";
import { normalizeCategory, isLeafOf, type CanonicalCategoryKey } from "@/lib/rewards/categories";

/** A single card/benefit opportunity matched against a receipt. */
export interface BenefitMatch {
  /** Id of the matching wallet card. */
  cardId: string;

  /** Display name of the matching wallet card. */
  cardName: string;

  /** Id of the matching benefit. */
  benefitId: string;

  /** Title of the matching benefit. */
  benefitTitle: string;

  /** Names of the receipt line items that matched this benefit. */
  matchedItemNames: string[];

  /** Deterministic estimated value in dollars (rounded to cents). */
  estimatedValue: number;

  /** Human-readable explanation of why the benefit matched. */
  reason: string;
}

/** Lowercases a value for case-insensitive matching. */
function normalize(value: string | null | undefined): string {
  return (value ?? "").toLowerCase().trim();
}

/** Rounds a value to cents; never returns a negative value. */
function toCents(value: number): number {
  return Math.max(0, Math.round(value * 100) / 100);
}

/**
 * Normalize a receipt item category to a canonical category key.
 * Legacy flat strings (e.g. "Dining") and already-canonical keys are
 * accepted. Unknown values become null.
 */
function normalizeItemCategory(
  category: string | null
): CanonicalCategoryKey | null {
  return normalizeCategory(category);
}

/**
 * True when a receipt item's category matches the benefit's category.
 *
 * Matching supports both exact leaf matches and root-aware matching: a
 * benefit targeting "food" matches items categorized as "food:dining" or
 * legacy "Dining" (normalized to "food:dining").
 */
function itemMatchesCategory(
  item: ReceiptItem,
  category: string | null
): boolean {
  if (category === null) return false;

  const itemCategory = normalizeItemCategory(item.category);
  const benefitCategory = normalizeCategory(category);

  if (itemCategory === null || benefitCategory === null) return false;
  if (itemCategory === benefitCategory) return true;

  return isLeafOf(itemCategory, benefitCategory);
}

/**
 * True when the receipt merchant contains the benefit's merchant pattern
 * (case-insensitive substring).
 */
function receiptMatchesMerchant(
  receipt: ReceiptExtraction,
  merchant: string | null
): boolean {
  if (merchant === null) return false;
  if (receipt.merchant === null) return false;
  return normalize(receipt.merchant).includes(normalize(merchant));
}

/**
 * Check whether the receipt merchant is excluded by any pattern in the
 * benefit's exclusion list. Returns the matching exclusion pattern, or null
 * when not excluded.
 */
function merchantExcluded(
  receipt: ReceiptExtraction,
  excludedMerchants: string[] | undefined
): string | null {
  if (excludedMerchants === undefined || excludedMerchants.length === 0) {
    return null;
  }
  if (receipt.merchant === null) return null;

  const pattern = excludedMerchants.find((exclusion) =>
    normalize(receipt.merchant).includes(normalize(exclusion))
  );

  return pattern ?? null;
}

/**
 * Matches an `earning_rate` benefit.
 *
 * Evaluation precedence:
 * 1. Merchant exclusion wins → no match.
 * 2. Specific merchant match uses the whole receipt as matched spend.
 * 3. Canonical category match uses only items in that category (root-aware).
 *
 * Value: when `percentage` is available,
 *   estimatedValue = matchedSpend × (percentage / 100)
 * Points/miles are NOT converted to dollars unless the benefit explicitly
 * provides a dollar value, so estimatedValue is 0 in that case.
 */
function matchEarningRate(
  receipt: ReceiptExtraction,
  benefit: CardBenefit,
  card: WalletCard
): BenefitMatch | null {
  const excluded = merchantExcluded(receipt, benefit.excludedMerchants);
  if (excluded !== null) {
    return null;
  }

  const merchantMatch = receiptMatchesMerchant(receipt, benefit.merchant);

  let matched: ReceiptItem[] = [];

  if (merchantMatch) {
    matched = receipt.items;
  } else if (benefit.category !== null) {
    matched = receipt.items.filter((item) =>
      itemMatchesCategory(item, benefit.category)
    );
  }

  if (matched.length === 0) {
    return null;
  }

  const categoryLabel = benefit.category ?? "merchant";

  const matchedItemNames = matched.map((item) => item.name ?? "Unknown item");
  const matchedSpend = matched.reduce((sum, item) => sum + (item.total ?? 0), 0);

  let estimatedValue: number;
  let reason: string;

  if (benefit.percentage !== null) {
    estimatedValue = toCents(matchedSpend * (benefit.percentage / 100));
    reason = `Matches ${matched.length} ${categoryLabel} item(s): $${matchedSpend.toFixed(
      2
    )} spend × ${benefit.percentage}% = $${estimatedValue.toFixed(
      2
    )} (${benefit.rewardCurrency}).`;
  } else {
    estimatedValue = 0;
    const pointsEarned = matchedSpend * benefit.rewardValue;
    reason = `Matches ${matched.length} ${categoryLabel} item(s): $${matchedSpend.toFixed(
      2
    )} spend earns ${pointsEarned.toFixed(0)} ${benefit.rewardCurrency} (at ${
      benefit.rewardValue
    } ${benefit.rewardCurrency}/$1). No explicit dollar conversion is defined, so estimated value is not converted to dollars.`;
  }

  return {
    cardId: card.id,
    cardName: card.name,
    benefitId: benefit.id,
    benefitTitle: benefit.title,
    matchedItemNames,
    estimatedValue,
    reason,
  };
}

/**
 * Matches `statement_credit` and `offer` benefits.
 *
 * Evaluation precedence:
 * 1. Merchant exclusion wins → no match.
 * 2. Specific merchant match qualifies.
 * 3. Canonical category match qualifies (root-aware).
 *
 * Value uses `fixedValue`, capped by `remainingLimit` when provided. Never
 * negative.
 */
function matchFixedValueBenefit(
  receipt: ReceiptExtraction,
  benefit: CardBenefit,
  card: WalletCard
): BenefitMatch | null {
  const excluded = merchantExcluded(receipt, benefit.excludedMerchants);
  if (excluded !== null) {
    return null;
  }

  const merchantMatch = receiptMatchesMerchant(receipt, benefit.merchant);

  const categoryMatchedItems =
    benefit.category !== null
      ? receipt.items.filter((item) => itemMatchesCategory(item, benefit.category))
      : [];

  if (!merchantMatch && categoryMatchedItems.length === 0) {
    // Do not assume the benefit applies unless its criteria match.
    return null;
  }

  const matchedItemNames = categoryMatchedItems.map(
    (item) => item.name ?? "Unknown item"
  );

  const fixedValue = benefit.fixedValue ?? 0;

  let estimatedValue = fixedValue;
  if (benefit.remainingLimit !== null) {
    estimatedValue = Math.min(estimatedValue, benefit.remainingLimit);
  }
  estimatedValue = toCents(estimatedValue);

  if (estimatedValue <= 0) {
    return null;
  }

  const criteriaParts: string[] = [];
  if (merchantMatch) {
    criteriaParts.push(`merchant "${benefit.merchant}"`);
  }
  if (categoryMatchedItems.length > 0) {
    criteriaParts.push(`category "${benefit.category}"`);
  }

  const criteriaText = criteriaParts.join(" and ");
  const benefitLabel =
    benefit.type === "statement_credit" ? "Statement credit" : "Offer";

  const remainingText =
    benefit.remainingLimit !== null
      ? ` Remaining limit of $${benefit.remainingLimit.toFixed(2)} respected.`
      : "";

  return {
    cardId: card.id,
    cardName: card.name,
    benefitId: benefit.id,
    benefitTitle: benefit.title,
    matchedItemNames,
    estimatedValue,
    reason: `Matched (${criteriaText}). ${benefitLabel} value $${estimatedValue.toFixed(
      2
    )}.${remainingText}`,
  };
}

/**
 * Identifies every wallet benefit opportunity that applies to a receipt.
 *
 * Only active benefits belonging to active cards are considered. One
 * `BenefitMatch` is returned per meaningful benefit opportunity. This
 * function does NOT determine the "best card".
 */
export function matchReceiptToWalletBenefits(
  receipt: ReceiptExtraction,
  wallet: Wallet
): BenefitMatch[] {
  const activeCardIds = new Set(
    wallet.cards.filter((card) => card.active).map((card) => card.id)
  );

  const cardById = new Map<string, WalletCard>(
    wallet.cards.map((card) => [card.id, card])
  );

  const matches: BenefitMatch[] = [];

  for (const benefit of wallet.benefits) {
    if (!benefit.active) continue;
    if (!activeCardIds.has(benefit.cardId)) continue;

    const card = cardById.get(benefit.cardId);
    if (!card) continue;

    let match: BenefitMatch | null = null;

    switch (benefit.type) {
      case "earning_rate":
        match = matchEarningRate(receipt, benefit, card);
        break;
      case "statement_credit":
      case "offer":
        match = matchFixedValueBenefit(receipt, benefit, card);
        break;
      default:
        // purchase_protection, travel, and other have no deterministic
        // spend-value calculation in this version.
        match = null;
        break;
    }

    if (match !== null) {
      matches.push(match);
    }
  }

  return matches;
}