import type { Goal, RewardAccount } from "./types";

export type StrategyDataStatus =
  | "live"
  | "catalog"
  | "user_confirmed"
  | "calculated"
  | "estimated";

export interface StrategySource {
  id: string;
  label: string;
  status: StrategyDataStatus;
  observedAt: string | null;
}

export interface StrategySpendingCategory {
  category: string;
  monthlyAverage: number;
}

export interface StrategyAwardOption {
  id: string;
  sourceId: string;
  programName: string;
  itineraryLabel: string;
  pointsRequired: number;
  cashFees: number;
  seats: number;
  cabin: string;
  transferFromProgramId: string | null;
  transferRatio: number | null;
  centsPerPoint: number | null;
  availabilityStatus: "available" | "unavailable" | "unknown";
}

export interface StrategyCardOffer {
  id: string;
  sourceId: string;
  cardName: string;
  issuer: string;
  welcomeBonusPoints: number;
  spendingRequirement: number;
  spendingDeadlineMonths: number;
  annualFee: number;
  destinationProgramId: string | null;
}

export interface PersonalizedStrategyContext {
  goal: Goal;
  rewardAccounts: RewardAccount[];
  walletCards: Array<{
    id: string;
    name: string;
    issuer: string;
    rewardCurrency: string;
    cardProductId: string;
  }>;
  monthlySpendingByCategory: StrategySpendingCategory[];
  awardOptions: StrategyAwardOption[];
  cardOffers: StrategyCardOffer[];
  sources: StrategySource[];
  generatedAt: string;
}

export type StrategyFeasibility =
  | "on_track"
  | "gap_remaining"
  | "depends_on_new_card"
  | "insufficient_information";

export interface StrategyAction {
  priority: number;
  title: string;
  explanation: string;
  deadline: string | null;
  sourceIds: string[];
}

export interface StrategyAlternative {
  title: string;
  tradeoff: string;
  sourceIds: string[];
}

export interface PersonalizedStrategy {
  headline: string;
  summary: string;
  feasibility: StrategyFeasibility;
  pointsGap: number | null;
  recommendedAwardOptionId: string | null;
  recommendedCardOfferId: string | null;
  actions: StrategyAction[];
  alternatives: StrategyAlternative[];
  assumptions: string[];
  warnings: string[];
  followUpQuestions: string[];
}

export interface StrategyProvider {
  generateStrategy(
    context: PersonalizedStrategyContext
  ): Promise<PersonalizedStrategy>;
}