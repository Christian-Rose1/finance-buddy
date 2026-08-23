/**
 * Sanitized strategy payload builder.
 *
 * Produces a cloud-safe prompt object that contains only the data needed for
 * personalized strategy generation. Internal database IDs, userId, ownerKey,
 * ownerLabel, and other sensitive fields are stripped before the payload
 * leaves the server.
 */

import type {
  PersonalizedStrategyContext,
  SanitizedStrategyPrompt,
  SanitizedGoal,
  SanitizedPointsInventoryItem,
  SanitizedWalletCard,
} from "./strategyTypes";

// Re-export for convenience
export type {
  SanitizedStrategyPrompt,
  SanitizedGoal,
  SanitizedPointsInventoryItem,
  SanitizedWalletCard,
};

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

export interface RewardProgramName {
  id: string;
  name: string;
}

/**
 * Builds a sanitized, cloud-safe strategy prompt from the full
 * PersonalizedStrategyContext and the reward-program catalog.
 *
 * Stripped fields:
 * - Goal: id, userId, status, createdAt, updatedAt
 * - RewardAccount: id, userId, ownerKey, ownerLabel, rewardProgramId,
 *   balanceAsOf, createdAt, updatedAt
 * - WalletCard: id, cardProductId
 *
 * Program names are resolved from the catalog. When a program is not found
 * in the catalog, programName is null.
 */
export function buildSanitizedStrategyPayload(
  context: PersonalizedStrategyContext,
  catalogRewardPrograms: RewardProgramName[]
): SanitizedStrategyPrompt {
  // Resolve program names from the catalog.
  const programNamesById = new Map<string, string>();
  for (const program of catalogRewardPrograms) {
    if (!programNamesById.has(program.id)) {
      programNamesById.set(program.id, program.name);
    }
  }

  // Sanitize goal — strip internal plumbing.
  const sanitizedGoal: SanitizedGoal = {
    type: context.goal.type,
    title: context.goal.title,
    origin: context.goal.origin,
    destinations: context.goal.destinations,
    earliestDeparture: context.goal.earliestDeparture,
    latestReturn: context.goal.latestReturn,
    minimumNights: context.goal.minimumNights,
    maximumNights: context.goal.maximumNights,
    travelerCount: context.goal.travelerCount,
    cabinPreference: context.goal.cabinPreference,
    optimizationPriority: context.goal.optimizationPriority,
    maximumCashBudget: context.goal.maximumCashBudget,
    currency: context.goal.currency,
    allowNewCards: context.goal.allowNewCards,
  };

  // Sanitize reward accounts — strip IDs, userId, ownerKey, ownerLabel,
  // rewardProgramId, balanceAsOf, and timestamps. Resolve programName from
  // the catalog.
  const sanitizedPointsInventory: SanitizedPointsInventoryItem[] =
    context.rewardAccounts.map((account) => ({
      programName:
        programNamesById.get(account.rewardProgramId) ?? null,
      ownerType: account.ownerType,
      balance: account.balance,
      verificationStatus: account.verificationStatus,
      origin: account.origin,
    }));

  // Sanitize wallet cards — strip id and cardProductId.
  const sanitizedWalletCards: SanitizedWalletCard[] =
    context.walletCards.map((card) => ({
      name: card.name,
      issuer: card.issuer,
      rewardCurrency: card.rewardCurrency,
    }));

  return {
    goal: sanitizedGoal,
    pointsInventory: sanitizedPointsInventory,
    walletCards: sanitizedWalletCards,
    monthlySpendingByCategory: context.monthlySpendingByCategory,
    awardOptions: context.awardOptions,
    cardOffers: context.cardOffers,
    sources: context.sources,
    generatedAt: context.generatedAt,
  };
}