/**
 * Builds the sanitized ResearchPlannerInput from the full personalized
 * strategy context plus catalog data.
 *
 * Sanitization boundary: userId, internal database IDs (except reward-program
 * IDs needed for transfer-partner mapping), ownerKey, ownerLabel,
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

  // Sanitize reward accounts: keep balance + program name, drop ownerKey,
  // ownerLabel, balanceAsOf, and database IDs other than rewardProgramId.
  const programNameById = new Map(
    catalogRewardPrograms.map((p) => [p.id, p.name])
  );
  const programFamilyById = new Map(
    catalogRewardPrograms.map((p) => [p.id, p.family ?? "other"])
  );

  const rewardAccounts: PlannerRewardAccount[] = context.rewardAccounts.map(
    (acc) => ({
      rewardProgramId: acc.rewardProgramId,
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

  // Transfer partners: for each reward program the customer owns, enumerate
  // the catalog programs it can transfer to (family-filtered from catalog).
  const ownedProgramIds = new Set(rewardAccounts.map((a) => a.rewardProgramId));
  const ownedProgramNames = new Set(
    rewardAccounts
      .map((a) => a.programName)
      .filter((n): n is string => n !== null)
  );

  const transferPartners: PlannerTransferPartner[] = [];
  for (const ownedName of ownedProgramNames) {
    for (const partner of catalogRewardPrograms) {
      if (ownedProgramIds.has(partner.id)) continue; // skip self
      const family = programFamilyById.get(partner.id) ?? "other";
      const partnerFamily: PlannerTransferPartner["partnerFamily"] =
        family === "airline_miles" || family === "hotel_points"
          ? (family as PlannerTransferPartner["partnerFamily"])
          : "other";
      transferPartners.push({
        sourceProgramName: ownedName,
        partnerProgramName: partner.name,
        partnerFamily,
      });
    }
  }

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