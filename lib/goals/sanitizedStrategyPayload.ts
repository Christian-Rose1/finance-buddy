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
import { buildPointsInventory } from "./pointsInventoryBuilder";
import { buildStrategyAllocationScenarios } from "./strategyAllocationBuilder";
import {
  calculateFlightPointsRequired,
  calculateHotelPointsRequired,
  calculateTripNights,
} from "./strategyOptionCalculator";

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

  const validSources = context.sources.filter((source) => source.id.trim().length > 0);
  const validSourceIds = new Set(validSources.map((source) => source.id));
  const validAwardOptions = context.awardOptions.filter((option) => validSourceIds.has(option.sourceId));
  const validCardOffers = context.cardOffers.filter((offer) => validSourceIds.has(offer.sourceId));
  const excludedSourceBoundRecords =
    validAwardOptions.length !== context.awardOptions.length ||
    validCardOffers.length !== context.cardOffers.length;
  const pointsInventory = buildPointsInventory(context.rewardAccounts, catalogRewardPrograms);
  const allocationScenarios = buildStrategyAllocationScenarios(
    context.goal,
    validAwardOptions.filter((option) => option.redemptionType === "flight"),
    validAwardOptions.filter((option) => option.redemptionType === "hotel"),
    pointsInventory
  );
  const sourceReferences = new Map(validSources.map((source, index) => [source.id, `source-${index + 1}`]));
  const awardReferences = new Map(validAwardOptions.map((option, index) => [option.id, `award-${index + 1}`]));
  const cardReferences = new Map(validCardOffers.map((offer, index) => [offer.id, `card-${index +1}`]));
  const publicSources = validSources.map((source) => ({
    ...source,
    id: sourceReferences.get(source.id)!,
  }));
  const publicAwardOptions = validAwardOptions.map((option) => ({
    ...option,
    id: awardReferences.get(option.id)!,
    sourceId: sourceReferences.get(option.sourceId)!,
    transferFromProgramId: null,
  }));
  const publicCardOffers = validCardOffers.map((offer) => ({
    ...offer,
    id: cardReferences.get(offer.id)!,
    sourceId: sourceReferences.get(offer.sourceId)!,
    destinationProgramId: null,
  }));
  const pointsSummary = new Map<string, { programName: string | null; ownerType: "self" | "companion"; verifiedPoints: number; unverifiedPoints: number }>();
  for (const item of sanitizedPointsInventory) {
    const key = `${item.programName ?? "unknown"}:${item.ownerType}`;
    const summary = pointsSummary.get(key) ?? { programName: item.programName, ownerType: item.ownerType, verifiedPoints: 0, unverifiedPoints: 0 };
    if (item.verificationStatus === "verified") summary.verifiedPoints += item.balance;
    else summary.unverifiedPoints += item.balance;
    pointsSummary.set(key, summary);
  }
  const optionRequirements = validAwardOptions.map((option) => {
    const calculation = option.redemptionType === "flight"
      ? calculateFlightPointsRequired(option, context.goal)
      : calculateHotelPointsRequired(option, context.goal);
    return {
      optionReference: awardReferences.get(option.id)!,
      redemptionType: option.redemptionType,
      pointsRequired: calculation.status === "calculated" ? calculation.pointsRequired : null,
      status: calculation.status,
      assumptions: calculation.assumptions,
      warnings: calculation.warnings,
    };
  });
  const prompt: SanitizedStrategyPrompt = {
    goal: sanitizedGoal,
    pointsInventory: sanitizedPointsInventory,
    walletCards: sanitizedWalletCards,
    monthlySpendingByCategory: context.monthlySpendingByCategory,
    awardOptions: publicAwardOptions,
    cardOffers: publicCardOffers,
    sources: publicSources,
    generatedAt: context.generatedAt,
    brief: {
      goal: { ...sanitizedGoal, resolvedTripNights: calculateTripNights(context.goal) },
      pointsSummary: [...pointsSummary.values()],
      optionRequirements,
      allocationScenarios: allocationScenarios.map((scenario) => ({
        kind: scenario.kind,
        status: scenario.status,
        flightPointsRequired: scenario.flightPointsRequired,
        hotelPointsRequired: scenario.hotelPointsRequired,
        travelerCount: scenario.travelerCount,
        tripNights: scenario.tripNights,
        assumptions: scenario.assumptions,
        warnings: scenario.warnings,
      })),
      sanitizationWarnings: excludedSourceBoundRecords
        ? ["Some research records were omitted because their source could not be resolved."]
        : [],
    },
    referenceMap: {
      awardOptions: validAwardOptions,
      cardOffers: validCardOffers,
      sources: validSources,
      excludedSourceBoundRecords,
    },
  };
  Object.defineProperty(prompt, "referenceMap", { enumerable: false, value: prompt.referenceMap });
  return prompt;
}
