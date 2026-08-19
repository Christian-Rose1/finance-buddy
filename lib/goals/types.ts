export type GoalStatus = "draft" | "active" | "completed" | "paused";

export type OptimizationPriority =
  | "lowest_cash"
  | "best_experience"
  | "simplest"
  | "balanced";

export type CabinPreference =
  | "economy"
  | "premium_economy"
  | "business"
  | "first"
  | "flexible";

export interface Goal {
  id: string;
  userId: string;
  type: "travel";
  title: string;
  status: GoalStatus;
  origin: string[];
  destinations: string[];
  earliestDeparture: string | null;
  latestReturn: string | null;
  minimumNights: number | null;
  maximumNights: number | null;
  travelerCount: number;
  cabinPreference: CabinPreference;
  optimizationPriority: OptimizationPriority;
  maximumCashBudget: number | null;
  currency: string;
  allowNewCards: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface RewardAccount {
  id: string;
  userId: string;
  rewardProgramId: string;
  ownerKey: string;
  ownerLabel: string;
  ownerType: "self" | "companion";
  balance: number;
  balanceAsOf: string;
  origin: "manual" | "evidence" | "connected";
  verificationStatus: "unverified" | "verified";
  createdAt: string;
  updatedAt: string;
}

export interface ProgramPointsProjection {
  ownerKey: string;
  rewardProgramId: string;
  projectedOrganicPoints: number;
  conditionalPoints: number;
}

export interface ProgramPointsRequirement {
  ownerKey: string;
  rewardProgramId: string;
  requiredPoints: number;
}

export interface GoalPlanScenario {
  id: string;
  name: string;
  requirements: ProgramPointsRequirement[];
  estimatedTaxesAndFees: number;
  estimatedAnnualFees: number;
  currency: string;
  availabilityStatus: "planning_estimate" | "observed" | "confirmed";
  assumptions: string[];
  warnings: string[];
}

export interface ProgramFundingSummary {
  ownerKey: string;
  rewardProgramId: string;
  requiredPoints: number;
  verifiedCurrentPoints: number;
  unverifiedCurrentPoints: number;
  projectedOrganicPoints: number;
  conditionalPoints: number;
  onTrackGap: number;
  verifiedPlusUnverifiedGap: number;
  optimisticGap: number;
}

export type GoalPlanFeasibility =
  | "on_track"
  | "depends_on_unverified_balances"
  | "depends_on_conditional_points"
  | "gap_remaining"
  | "insufficient_information";

export interface GoalPlanOption {
  scenarioId: string;
  name: string;
  feasibility: GoalPlanFeasibility;
  programFunding: ProgramFundingSummary[];
  estimatedTaxesAndFees: number;
  estimatedAnnualFees: number;
  totalEstimatedCashCost: number;
  currency: string;
  availabilityStatus: GoalPlanScenario["availabilityStatus"];
  assumptions: string[];
  warnings: string[];
}

export interface CalculateGoalPlanOptionInput {
  rewardAccounts: RewardAccount[];
  projections: ProgramPointsProjection[];
  scenario: GoalPlanScenario;
}