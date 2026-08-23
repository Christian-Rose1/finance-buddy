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
  redemptionType: "flight" | "hotel";
  pricingBasis:
    | "one_way"
    | "round_trip"
    | "per_night"
    | "total_stay"
    | "unknown";
  itineraryLabel: string | null;
  pointsRequired: number;
  cashFees: number | null;
  seats: number | null;
  cabin: string | null;
  transferFromProgramId: string | null;
  transferRatio: number | null;
  centsPerPoint: number | null;
  availabilityStatus: "available" | "unavailable" | "unknown";
  travelerCountCovered?: number | null;
  nightCountCovered?: number | null;
  coverageStatus?:
    | "source_explicit"
    | "standard_assumption"
    | "unknown";
  goalMatch?:
    | "exact"
    | "partial"
    | "general"
    | "different_destination";
  goalMismatchReasons?: Array<
    | "origin"
    | "destination"
    | "dates"
    | "traveler_count"
    | "cabin"
    | "property"
  >;
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

export interface StrategyPointsInventoryItem {
  accountId: string;
  rewardProgramId: string;
  programName: string | null;
  ownerLabel: string;
  ownerType: "self" | "companion";
  balance: number;
  balanceAsOf: string;
  origin: "manual" | "evidence" | "connected";
  verificationStatus: "unverified" | "verified";
}

export interface StrategyPointsAllocation {
  accountId: string;
  rewardProgramId: string;
  programName: string | null;
  ownerLabel: string;
  fundingMethod: "transfer_source" | "direct_program";
  availablePoints: number;
  plannedPoints: number;
  remainingPoints: number;
  pointsGap: number;
}

export interface StrategyAllocationScenario {
  id: string;
  kind: "flight_first" | "hotel_first" | "balanced" | "fallback";
  title: string;
  status:
    | "feasible"
    | "gap"
    | "conditional"
    | "insufficient_information";
  flightOptionId: string | null;
  hotelOptionId: string | null;
  flightPointsRequired: number | null;
  hotelPointsRequired: number | null;
  travelerCount: number;
  tripNights: number | null;
  allocations: StrategyPointsAllocation[];
  assumptions: string[];
  warnings: string[];
}

export interface PersonalizedStrategy {
  headline: string;
  summary: string;
  feasibility: StrategyFeasibility;
  pointsGap: number | null;
  recommendedAwardOptionId: string | null;
  recommendedCardOfferId: string | null;
  flightOptions: StrategyAwardOption[];
  hotelOptions: StrategyAwardOption[];
  actions: StrategyAction[];
  alternatives: StrategyAlternative[];
  assumptions: string[];
  warnings: string[];
  followUpQuestions: string[];
  pointsInventory: StrategyPointsInventoryItem[];
  allocationScenarios: StrategyAllocationScenario[];
}

/**
 * The strategy-model-generated narrative portion of a PersonalizedStrategy.
 * The model never produces pointsInventory or allocationScenarios; these are
 * assembled deterministically by the planner from reward accounts, the
 * reward-program catalog, and award options.
 */
export type PersonalizedStrategyNarrative = Omit<
  PersonalizedStrategy,
  "pointsInventory" | "allocationScenarios"
>;

export interface StrategyProvider {
  generateStrategy(
    context: PersonalizedStrategyContext
  ): Promise<PersonalizedStrategyNarrative>;
}