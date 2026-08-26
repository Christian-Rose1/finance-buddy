/**
 * Purchase optimization adapter.
 *
 * Bridges the canonical Purchase model to the wallet optimizer using the
 * canonical rewards eligibility layer. Supports both:
 *
 * 1. Personalized optimization: user-owned WalletCards linked to verified
 *    CardProduct earning rules from the shared catalog.
 * 2. Development fallback: in-code fixture wallet for testing and demos.
 *
 * The adapter never mixes the two: if any active user-owned linked card
 * exists, the development wallet is not used for the recommendation.
 */

import type { Purchase, PurchaseItem } from "@/lib/purchases/types";
import type { ReceiptExtraction, ReceiptItem } from "@/lib/receipts/types";
import type { Wallet, WalletCard, CardBenefit } from "@/lib/wallet/types";
import type { EarningRule, CardProduct } from "@/lib/rewards/catalogTypes";
import { normalizeCategory } from "@/lib/rewards/categories";
import {
  evaluateEligibilityForRules,
  type EligibilityStatus,
  type RewardEligibilityRule,
  type RewardEligibilityResult,
} from "@/lib/rewards/eligibility";

// =============================================================================
// Receipt adapter (kept for compatibility)
// =============================================================================

/**
 * Converts a PurchaseItem into the ReceiptItem shape used by the legacy
 * receipt-oriented wallet optimizer.
 */
function purchaseItemToReceiptItem(item: PurchaseItem): ReceiptItem {
  return {
    name: item.name,
    quantity: item.quantity,
    unit_price: item.unitPrice,
    total: item.total,
    discount: item.discount,
    category: item.category,
    confidence: item.confidence,
  };
}

/**
 * Converts a canonical Purchase into the minimal ReceiptExtraction shape
 * expected by `optimizeReceiptCard()`.
 *
 * Mapping:
 * - merchant → merchant
 * - amount → total
 * - currency → currency
 * - date → transaction_date
 * - purchase.items → receipt items
 * - discount / tax / tip are passed through when present
 *
 * Fallback for statement-style Purchases:
 * When `purchase.items` is empty and `purchase.category` is present, a single
 * synthetic item is created using the purchase-level category as its category.
 * This gives the category-based matcher a signal without inventing item-level
 * product data. The item name is left null so it cannot be mistaken for a real
 * extracted product.
 */
export function purchaseToReceiptExtraction(
  purchase: Purchase
): ReceiptExtraction {
  const receiptItems: ReceiptItem[] =
    purchase.items.length > 0
      ? purchase.items.map(purchaseItemToReceiptItem)
      : purchase.category
      ? [
          {
            name: null,
            quantity: null,
            unit_price: null,
            total: purchase.amount,
            discount: purchase.discount,
            category: purchase.category,
            confidence: purchase.sourceConfidence,
          },
        ]
      : [];

  return {
    merchant: purchase.merchant,
    transaction_date: purchase.date,
    currency: purchase.currency,
    items: receiptItems,
    subtotal: purchase.amount,
    tax: purchase.tax,
    tip: purchase.tip,
    discount: purchase.discount,
    total: purchase.amount,
    confidence: purchase.sourceConfidence,
    source: purchase.source,
  };
}

// =============================================================================
// Canonical Purchase optimization
// =============================================================================

/** Indicates whether a recommendation is based on real user cards or fixtures. */
export type OptimizationMode = "personalized" | "development";

/** A single rule evaluation result attached to a wallet card. */
export interface PurchaseOptimizationMatch {
  /** Id of the evaluated rule. */
  ruleId: string;

  /** Id of the evaluated rule (alias for compatibility with existing UI). */
  benefitId: string;

  /** Id of the wallet card the rule belongs to. */
  cardId: string;

  /** Display name of the wallet card. */
  cardName: string;

  /** Title of the benefit/rule. */
  benefitTitle: string;

  /** Eligibility status for this Purchase. */
  status: EligibilityStatus;

  /** Estimated dollar value from this rule for the Purchase amount. */
  estimatedValue: number;

  /** Human-readable reason explaining the status. */
  reason: string;
}

/** Result of optimizing a Purchase against a wallet. */
export interface PurchaseOptimizationResult {
  /**
   * Id of the card the Purchase was actually made with, when known.
   *
   * Populated for personalized optimization from `purchase.cardId`. This is
   * distinct from `bestCardId` (the hypothetical best card): rules on cards
   * OTHER than the used card are recommendations, not actual rewards.
   */
  usedCardId: string | null;

  /** Id of the card that provides the highest estimated dollar value. */
  bestCardId: string | null;

  /** Display name of the best card. */
  bestCardName: string | null;

  /** Total estimated dollar value from the best card's eligible rules. */
  bestEstimatedValue: number;

  /**
   * Estimated reward units (e.g. points/miles) for the best card, when
   * deterministic. Points/miles are never converted to dollars, so this is
   * null when the best card's value is expressed in dollars (cashback).
   */
  bestEstimatedRewardUnits: number | null;

  /** Reward currency label for the estimated reward units (e.g. "points", "miles"). */
  bestRewardCurrency: string | null;

  /** Every rule evaluation for the Purchase, one per active benefit. */
  matches: PurchaseOptimizationMatch[];

  /** Human-readable explanation of the recommendation. */
  recommendation: string | null;

  /** Whether this recommendation used real user cards or development fixtures. */
  mode: OptimizationMode;
}

/** Rounds a value to cents; never returns a negative value. */
function toCents(value: number): number {
  return Math.max(0, Math.round(value * 100) / 100);
}

/**
 * Convert a wallet CardBenefit into a RewardEligibilityRule.
 *
 * Benefits whose type is not supported by the eligibility layer
 * (purchase_protection, travel, other) are skipped.
 */
function benefitToRule(benefit: CardBenefit): RewardEligibilityRule | null {
  const type = benefit.type;
  if (
    type !== "earning_rate" &&
    type !== "statement_credit" &&
    type !== "offer"
  ) {
    return null;
  }

  return {
    id: benefit.id,
    cardId: benefit.cardId,
    type,
    eligibleCategory: normalizeCategory(benefit.category),
    eligibleMerchant: benefit.merchant,
    excludedMerchants: benefit.excludedMerchants ?? [],
    rewardCurrency: benefit.rewardCurrency,
    rewardValue: benefit.rewardValue,
    percentage: benefit.percentage,
    fixedValue: benefit.fixedValue,
    explanation: "",
    source: benefit.source,
  };
}

/**
 * Convert a catalog EarningRule into a RewardEligibilityRule tied to a user's
 * wallet card.
 */
function earningRuleToRule(
  rule: EarningRule,
  walletCardId: string,
  identity = rule.id
): RewardEligibilityRule {
  return {
    id: identity,
    cardId: walletCardId,
    type: rule.type,
    eligibleCategory: rule.eligibleCategory,
    eligibleMerchant: rule.eligibleMerchant,
    excludedMerchants: rule.excludedMerchants,
    rewardCurrency: rule.rewardCurrency,
    rewardValue: rule.rewardValue,
    percentage: rule.percentage,
    fixedValue: rule.fixedValue,
    explanation: rule.explanation,
    source: rule.source,
  };
}

/**
 * Calculate the estimated dollar value for an eligible rule against a
 * Purchase.
 *
 * Preserves existing development-fixture valuation semantics:
 * - earning_rate with percentage: amount × (percentage / 100)
 * - earning_rate without percentage: 0 (points/miles are not silently
 *   converted to dollars)
 * - statement_credit / offer: fixedValue as dollars
 */
function calculateRuleValue(
  purchase: Purchase,
  rule: RewardEligibilityRule,
  result: RewardEligibilityResult
): number {
  if (result.status !== "confirmed_eligible" && result.status !== "likely_eligible") {
    return 0;
  }

  if (purchase.currency === null || purchase.currency.trim() === "") return 0;

  const amount = purchase.amount ?? 0;

  switch (rule.type) {
    case "earning_rate": {
      if (rule.percentage !== null) {
        return toCents(amount * (rule.percentage / 100));
      }
      // Points/miles per dollar are not converted to dollars unless an
      // explicit percentage is provided. This preserves the existing
      // optimizer behavior for development fixtures.
      return 0;
    }
    case "statement_credit":
    case "offer": {
      return toCents(rule.fixedValue ?? 0);
    }
    default:
      return 0;
  }
}

/**
 * Build a display title for a rule. For personalized catalog rules this falls
 * back to the rule explanation; for development fixtures it uses the benefit
 * title when available.
 */
function ruleTitle(
  rule: RewardEligibilityRule,
  titleByRuleId: Map<string, string>
): string {
  return titleByRuleId.get(rule.id) ?? rule.explanation ?? "Reward rule";
}

/**
 * Shared optimizer core: evaluate a set of eligibility rules and produce the
 * best-card recommendation.
 */
function runOptimization(
  purchase: Purchase,
  cards: WalletCard[],
  rules: RewardEligibilityRule[],
  titleByRuleId: Map<string, string>,
  mode: OptimizationMode
): PurchaseOptimizationResult {
  const normalizedCategory = normalizeCategory(purchase.category);

  const activeCardIds = new Set(
    cards.filter((card) => card.active).map((card) => card.id)
  );

  const cardById = new Map<string, WalletCard>(
    cards.map((card) => [card.id, card])
  );

  const eligibleRules = rules.filter((rule) => activeCardIds.has(rule.cardId));

  const purchaseSignal = {
    merchant: purchase.merchant,
    category: normalizedCategory,
  };

  const eligibilityResults = evaluateEligibilityForRules(purchaseSignal, eligibleRules);

  const matches: PurchaseOptimizationMatch[] = eligibilityResults.map(
    (result) => {
      const rule = eligibleRules.find((r) => r.id === result.ruleId)!;
      const card = cardById.get(rule.cardId)!;
      const estimatedValue = calculateRuleValue(purchase, rule, result);

      return {
        ruleId: rule.id,
        benefitId: rule.id,
        cardId: card.id,
        cardName: card.name,
        benefitTitle: ruleTitle(rule, titleByRuleId),
        status: result.status,
        estimatedValue,
        reason: result.reason,
      };
    }
  );

  // Group eligible matches by card. Dollar-valued rewards are summed for the
  // primary recommendation. Points/miles rules without a dollar conversion are
  // tracked separately so a card with the best eligible non-cash rule can still
  // be recommended when no cashback rule matches.
  const cardDollarValues = new Map<string, { total: number; cardName: string }>();
  const cardRewardScores = new Map<string, { score: number; cardName: string }>();
  const cardRewardUnits = new Map<
    string,
    { units: number; currency: string; cardName: string }
  >();
  const ruleById = new Map(eligibleRules.map((r) => [r.id, r]));

  for (const match of matches) {
    if (
      match.status !== "confirmed_eligible" &&
      match.status !== "likely_eligible"
    ) {
      continue;
    }

    if (!purchase.currency?.trim()) continue;

    if (match.estimatedValue > 0) {
      const existing = cardDollarValues.get(match.cardId);
      if (existing) {
        existing.total += match.estimatedValue;
      } else {
        cardDollarValues.set(match.cardId, {
          total: match.estimatedValue,
          cardName: match.cardName,
        });
      }
      continue;
    }

    // Non-dollar eligible match (e.g. points/miles earning_rate without a
    // percentage). Use rewardValue as a ranking score.
    const rule = ruleById.get(match.ruleId);
    if (rule && rule.rewardValue > 0) {
      const existing = cardRewardScores.get(match.cardId);
      if (existing) {
        existing.score += rule.rewardValue;
      } else {
        cardRewardScores.set(match.cardId, {
          score: rule.rewardValue,
          cardName: match.cardName,
        });
      }

      // Deterministic reward units (e.g. points/miles) for the eligible rule.
      // Points/miles are never converted to dollars; units are exposed for
      // display only.
      const units = toCents((purchase.amount ?? 0) * rule.rewardValue);
      const existingUnits = cardRewardUnits.get(match.cardId);
      if (existingUnits) {
        existingUnits.units += units;
      } else {
        cardRewardUnits.set(match.cardId, {
          units,
          currency: rule.rewardCurrency,
          cardName: match.cardName,
        });
      }
    }
  }

  // Determine the best card. Highest dollar value wins; if no dollar value,
  // the highest non-dollar reward score wins.
  let bestCardId: string | null = null;
  let bestCardName: string | null = null;
  let bestEstimatedValue = 0;
  let bestFromDollar = false;

  for (const [cardId, data] of cardDollarValues) {
    if (data.total > bestEstimatedValue) {
      bestEstimatedValue = data.total;
      bestCardId = cardId;
      bestCardName = data.cardName;
      bestFromDollar = true;
    }
  }

  if (bestCardId === null) {
    let bestScore = 0;
    for (const [cardId, data] of cardRewardScores) {
      if (data.score > bestScore) {
        bestScore = data.score;
        bestCardId = cardId;
        bestCardName = data.cardName;
      }
    }
    bestEstimatedValue = 0;
  }

  if (bestCardId === null) {
    bestCardName = null;
    bestEstimatedValue = 0;
  }

  // Expose deterministic reward units (points/miles) for the best card only
  // when its value is not expressed in dollars. Points/miles are never
  // converted to dollars.
  let bestEstimatedRewardUnits: number | null = null;
  let bestRewardCurrency: string | null = null;
  if (bestCardId !== null && !bestFromDollar) {
    const unitsData = cardRewardUnits.get(bestCardId);
    if (unitsData && unitsData.units > 0) {
      bestEstimatedRewardUnits = unitsData.units;
      bestRewardCurrency = unitsData.currency;
    }
  }

  // Build recommendation.
  let recommendation: string | null = null;
  if (bestCardId) {
    const dollarStr = bestEstimatedValue.toFixed(2);
    const label =
      mode === "personalized"
        ? `${bestCardName} is the best card for this purchase`
        : `${bestCardName} (dev fixture) would have provided approximately $${dollarStr} in reward value`;

    recommendation = label;

    const bestReasons = matches
      .filter((m) => m.cardId === bestCardId && m.estimatedValue > 0)
      .map((m) => m.reason);

    if (bestReasons.length > 0) {
      recommendation += mode === "personalized"
        ? `. Reasons: ${bestReasons.join("; ")}`
        : `. Reasons: ${bestReasons.join("; ")}`;
    }

    // Surface any merchant exclusions that blocked a stronger-looking rule,
    // so the UI can explain why a rule did not qualify.
    const excludedReasons = matches
      .filter(
        (m) =>
          m.status === "not_eligible" &&
          m.reason.toLowerCase().includes("excluded")
      )
      .map((m) => m.reason);

    if (excludedReasons.length > 0) {
      recommendation += ` Exclusions: ${excludedReasons.join("; ")}`;
    }
  }

  return {
    usedCardId: purchase.cardId,
    bestCardId,
    bestCardName,
    bestEstimatedValue,
    bestEstimatedRewardUnits,
    bestRewardCurrency,
    matches,
    recommendation,
    mode,
  };
}

/**
 * Optimize a Purchase against the user's real wallet using catalog earning
 * rules from linked card products.
 *
 * Only active wallet cards owned by the user and explicitly linked to a
 * card product participate. The development wallet is never consulted here.
 */
export function optimizePurchaseWithLinkedCards(
  purchase: Purchase,
  walletCards: WalletCard[],
  productsById: Map<string, CardProduct>,
  rulesByProductId: Map<string, EarningRule[]>
): PurchaseOptimizationResult {
  const linkedCards = walletCards.filter(
    (card) => card.active && card.cardProductId !== null
  );

  const rules: RewardEligibilityRule[] = [];
  const titleByRuleId = new Map<string, string>();

  for (const card of linkedCards) {
    const productId = card.cardProductId!;
    const productRules = rulesByProductId.get(productId) ?? [];
    const activeRules = productRules.filter((rule) => rule.active);

    for (const rule of activeRules) {
      const identity = `${card.id}:${rule.id}`;
      rules.push(earningRuleToRule(rule, card.id, identity));
      titleByRuleId.set(identity, rule.explanation);
    }
  }

  return runOptimization(purchase, walletCards, rules, titleByRuleId, "personalized");
}

/**
 * Optimize a Purchase against the in-code development wallet fixture.
 *
 * This is explicitly a fallback for testing and local demos. Results are
 * tagged `mode: "development"` and should be labeled as test data by the UI.
 */
export function optimizePurchaseWithDevelopmentWallet(
  purchase: Purchase,
  wallet: Wallet
): PurchaseOptimizationResult {
  const titleByRuleId = new Map<string, string>();

  const rules: RewardEligibilityRule[] = [];
  for (const benefit of wallet.benefits) {
    const rule = benefitToRule(benefit);
    if (rule === null) continue;
    rules.push(rule);
    titleByRuleId.set(benefit.id, benefit.title);
  }

  return runOptimization(purchase, wallet.cards, rules, titleByRuleId, "development");
}

/**
 * Optimize a Purchase against a wallet using canonical rewards eligibility.
 *
 * Flow:
 * Purchase
 *   → normalize category
 *   → evaluate active card rules
 *   → merchant exclusions first
 *   → merchant-specific matches
 *   → root-aware category matches
 *   → value eligible rewards
 *   → select best development card
 *   → return explanation
 *
 * Receipt Purchases use transaction-level merchant and category for reward
 * evaluation; item-level categories remain for spending analytics. Statement
 * Purchases with `items = []` use `Purchase.category` as their reward signal.
 *
 * @deprecated Use `optimizePurchaseWithDevelopmentWallet` for fixture-based
 * testing or `optimizePurchaseWithLinkedCards` for personalized optimization.
 */
export function optimizePurchase(
  purchase: Purchase,
  wallet: Wallet
): PurchaseOptimizationResult {
  return optimizePurchaseWithDevelopmentWallet(purchase, wallet);
}
