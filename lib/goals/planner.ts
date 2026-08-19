import {
  CalculateGoalPlanOptionInput,
  GoalPlanOption,
  ProgramFundingSummary,
  ProgramPointsProjection,
  ProgramPointsRequirement,
  RewardAccount,
} from "./types";

function isFiniteNumber(value: number): value is number {
  return Number.isFinite(value) && value >= 0;
}

function validateInput(input: CalculateGoalPlanOptionInput): void {
  if (!isFiniteNumber(input.scenario.estimatedTaxesAndFees)) {
    throw new RangeError("estimatedTaxesAndFees must be a finite non-negative number");
  }
  if (!isFiniteNumber(input.scenario.estimatedAnnualFees)) {
    throw new RangeError("estimatedAnnualFees must be a finite non-negative number");
  }
  if (input.scenario.currency.length === 0) {
    throw new RangeError("currency must be a non-empty string");
  }
  if (input.scenario.requirements.some((r) => !isFiniteNumber(r.requiredPoints))) {
    throw new RangeError("requiredPoints must be a finite non-negative number");
  }
  if (input.rewardAccounts.some((a) => !isFiniteNumber(a.balance))) {
    throw new RangeError("balance must be a finite non-negative number");
  }
  if (input.projections.some((p) => !isFiniteNumber(p.projectedOrganicPoints))) {
    throw new RangeError("projectedOrganicPoints must be a finite non-negative number");
  }
  if (input.projections.some((p) => !isFiniteNumber(p.conditionalPoints))) {
    throw new RangeError("conditionalPoints must be a finite non-negative number");
  }
}

function aggregateByOwnerKeyAndProgramId<T extends { ownerKey: string; rewardProgramId: string }>(
  items: T[]
): Map<string, T[]> {
  const aggregated = new Map<string, T[]>();
  for (const item of items) {
    const key = JSON.stringify([item.ownerKey, item.rewardProgramId]);
    if (!aggregated.has(key)) {
      aggregated.set(key, []);
    }
    aggregated.get(key)!.push(item);
  }
  return aggregated;
}

function sumArray<T>(items: T[], key: keyof T): number {
  return items.reduce((sum, item) => sum + (Number(item[key]) || 0), 0);
}

function calculateFundingSummary(
  required: ProgramPointsRequirement,
  accounts: RewardAccount[],
  projections: ProgramPointsProjection[]
): ProgramFundingSummary {
  const verifiedCurrent = accounts.reduce((sum, account) => {
    return sum + (account.verificationStatus === "verified" ? account.balance : 0);
  }, 0);
  const unverifiedCurrent = accounts.reduce((sum, account) => {
    return sum + (account.verificationStatus === "unverified" ? account.balance : 0);
  }, 0);
  const projectedOrganic = sumArray(projections, "projectedOrganicPoints");
  const conditionalPoints = sumArray(projections, "conditionalPoints");

  const onTrackGap = Math.max(required.requiredPoints - verifiedCurrent - projectedOrganic, 0);
  const verifiedPlusUnverifiedGap = Math.max(
    required.requiredPoints - verifiedCurrent - unverifiedCurrent - projectedOrganic,
    0
  );
  const optimisticGap = Math.max(
    required.requiredPoints - verifiedCurrent - unverifiedCurrent - projectedOrganic - conditionalPoints,
    0
  );

  return {
    ownerKey: required.ownerKey,
    rewardProgramId: required.rewardProgramId,
    requiredPoints: required.requiredPoints,
    verifiedCurrentPoints: verifiedCurrent,
    unverifiedCurrentPoints: unverifiedCurrent,
    projectedOrganicPoints: projectedOrganic,
    conditionalPoints: conditionalPoints,
    onTrackGap,
    verifiedPlusUnverifiedGap,
    optimisticGap,
  };
}

function determineFeasibility(
  fundingSummaries: ProgramFundingSummary[]
): "on_track" | "depends_on_unverified_balances" | "depends_on_conditional_points" | "gap_remaining" | "insufficient_information" {
  if (fundingSummaries.length === 0) {
    return "insufficient_information";
  }

  const allOnTrack = fundingSummaries.every((summary) => summary.onTrackGap === 0);
  if (allOnTrack) {
    return "on_track";
  }

  const allVerifiedPlusUnverified = fundingSummaries.every(
    (summary) => summary.verifiedPlusUnverifiedGap === 0
  );
  if (allVerifiedPlusUnverified) {
    return "depends_on_unverified_balances";
  }

  const allOptimistic = fundingSummaries.every((summary) => summary.optimisticGap === 0);
  if (allOptimistic) {
    return "depends_on_conditional_points";
  }

  return "gap_remaining";
}

export function calculateGoalPlanOption(
  input: CalculateGoalPlanOptionInput
): GoalPlanOption {
  validateInput(input);

  const requirementsMap = aggregateByOwnerKeyAndProgramId(input.scenario.requirements);
  const accountsMap = aggregateByOwnerKeyAndProgramId(input.rewardAccounts);
  const projectionsMap = aggregateByOwnerKeyAndProgramId(input.projections);

  const fundingSummaries: ProgramFundingSummary[] = [];

  for (const [key, requirements] of requirementsMap.entries()) {
    const [ownerKey, rewardProgramId] = JSON.parse(key);
    const accounts = accountsMap.get(key) || [];
    const projections = projectionsMap.get(key) || [];

    const totalRequiredPoints = requirements.reduce((sum, req) => sum + req.requiredPoints, 0);
    const fundingSummary = calculateFundingSummary(
      { ownerKey, rewardProgramId, requiredPoints: totalRequiredPoints },
      accounts,
      projections
    );
    fundingSummaries.push(fundingSummary);
  }

  fundingSummaries.sort((a, b) => {
    if (a.ownerKey !== b.ownerKey) {
      return a.ownerKey.localeCompare(b.ownerKey);
    }
    return a.rewardProgramId.localeCompare(b.rewardProgramId);
  });

  const feasibility = determineFeasibility(fundingSummaries);
  const totalEstimatedCashCost = input.scenario.estimatedTaxesAndFees + input.scenario.estimatedAnnualFees;

  return {
    scenarioId: input.scenario.id,
    name: input.scenario.name,
    feasibility,
    programFunding: fundingSummaries,
    estimatedTaxesAndFees: input.scenario.estimatedTaxesAndFees,
    estimatedAnnualFees: input.scenario.estimatedAnnualFees,
    totalEstimatedCashCost,
    currency: input.scenario.currency,
    availabilityStatus: input.scenario.availabilityStatus,
    assumptions: [...input.scenario.assumptions],
    warnings: [...input.scenario.warnings],
  };
}