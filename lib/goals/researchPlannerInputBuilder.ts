/**
 * Builds the sanitized ResearchPlannerInput from the full personalized
 * strategy context plus catalog data.
 *
 * Sanitization boundary: userId, internal database IDs, ownerKey, ownerLabel,
 * balanceAsOf, and goal.status are never carried into the planner input.
 */

import type {
  PersonalizedStrategyContext,
} from "./strategyTypes";
import type {
  PlannerRewardAccount,
  PlannerSpendingCategory,
  PlannerTransferPartner,
  PlannerWalletCard,
  ResearchPlannerInput,
} from "./researchPlannerTypes";

export interface CatalogRewardProgramForPlanner {
  id: string;
  name: string;
  family?: string;
}

/**
 * Computes the number of whole days between now and a target date string.
 * Returns null when the target is missing or unparseable.
 */
function daysUntil(dateStr: string | null, now: Date): number | null {
  if (!dateStr) return null;
  const target = new Date(dateStr);
  if (Number.isNaN(target.getTime())) return null;
  const ms = target.getTime() - now.getTime();
  return Math.round(ms / 86_400_000);
}

/**
 * Builds the sanitized planner input. All identifiers that could reveal the
 * user's identity are excluded.
 */
export function buildResearchPlannerInput(
  context: PersonalizedStrategyContext,
  catalogRewardPrograms: CatalogRewardProgramForPlanner[],
  now: Date = new Date()
): ResearchPlannerInput {
  const goal = context.goal;

  // Resolve program names with internal catalog IDs server-side, then omit all
  // identifiers from the cloud-bound account payload.
  const programNameById = new Map(
    catalogRewardPrograms.map((p) => [p.id, p.name])
  );

  const rewardAccounts: PlannerRewardAccount[] = context.rewardAccounts.map(
    (acc) => ({
      programName: programNameById.get(acc.rewardProgramId) ?? null,
      balance: acc.balance,
      ownerType: acc.ownerType,
      verificationStatus: acc.verificationStatus,
    })
  );

  const walletCards: PlannerWalletCard[] = context.walletCards.map((c) => ({
    name: c.name,
    issuer: c.issuer,
    rewardCurrency: c.rewardCurrency,
  }));

  const monthlySpendingByCategory: PlannerSpendingCategory[] =
    context.monthlySpendingByCategory.map((s) => ({
      category: s.category,
      monthlyAverage: s.monthlyAverage,
    }));

  const ownedProgramNames = new Set(
    rewardAccounts
      .map((a) => a.programName)
      .filter((n): n is string => n !== null)
  );

  // The planner input has no authoritative transfer-relationship source.
  // Catalog membership, program family, cards, and program names are not
  // evidence of a transfer relationship, so omit all such relationships.
  const transferPartners: PlannerTransferPartner[] = [];

  return {
    goal: {
      type: "travel",
      title: goal.title,
      origin: goal.origin,
      destinations: goal.destinations,
      earliestDeparture: goal.earliestDeparture,
      latestReturn: goal.latestReturn,
      minimumNights: goal.minimumNights,
      maximumNights: goal.maximumNights,
      travelerCount: goal.travelerCount,
      cabinPreference: goal.cabinPreference,
      optimizationPriority: goal.optimizationPriority,
      maximumCashBudget: goal.maximumCashBudget,
      currency: goal.currency,
      allowNewCards: goal.allowNewCards,
    },
    rewardAccounts,
    walletCards,
    monthlySpendingByCategory,
    customerRewardPrograms: [...ownedProgramNames].map((name) => ({
      id: "",
      name,
    })),
    transferPartners,
    currentDate: now.toISOString(),
    daysUntilDeparture: daysUntil(goal.earliestDeparture, now),
  };
}
