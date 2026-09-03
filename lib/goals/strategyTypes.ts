import type { Goal, RewardAccount } from "./types";
import type { FlightPlanningEstimate } from "./flightPlanningEstimate";

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
  /** Missing on legacy saved strategies; always defaults to planning_benchmark. */
  evidenceLevel?: TravelEvidenceLevel;
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

export type TravelEvidenceLevel =
  | "exact_cash_offer"
  | "customer_verified"
  | "planning_benchmark";

/** Server-only identity for a provider quote. Never put this shape in a client payload. */
export interface ExactCashCandidate {
  id: string;
  kind: "flight" | "hotel";
  evidenceLevel: "exact_cash_offer";
  providerIdentity: string;
  offerIdentity: string;
  retrievedAt: string;
  expiresAt: string;
  search: {
    origin: string[] | null;
    destinations: string[];
    departureDate: string | null;
    returnDate: string | null;
    travelerCount: number | null;
    roomCount: number | null;
    nightCount: number | null;
  };
  coverage: { travelerCount: number | null; roomCount: number | null; nightCount: number | null };
  price: { currency: string; total: number; base: number | null; taxes: number | null; mandatoryFees: number | null };
  cancellationTerms: string | null;
  baggageTerms: string | null;
  paymentTiming: string | null;
  unknownFields: string[];
}

/** Client-safe projection: provider and offer identifiers remain server-side. */
export type PublicExactCashCandidate = Omit<
  ExactCashCandidate,
  "providerIdentity" | "offerIdentity"
> & { sourceLabel: string };

export interface CustomerVerifiedTravelOption {
  id: string;
  evidenceLevel: "customer_verified";
  kind: "flight" | "hotel";
  confirmedAt: string;
  summary: string;
  unknownFields: string[];
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
  /** Empty until a future server-side provider adapter returns validated cash evidence. */
  currentCashOptions?: PublicExactCashCandidate[];
  customerVerifiedOptions?: CustomerVerifiedTravelOption[];
  flightPlanningEstimate?: FlightPlanningEstimate | null;
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

export const FOLLOW_UP_DECISION_TOPICS = [
  "flight_time_preference",
  "layover_tolerance",
  "hotel_neighborhood_preference",
  "room_preference",
  "cash_vs_points_preference",
] as const;

export type FollowUpDecisionTopic = (typeof FOLLOW_UP_DECISION_TOPICS)[number];

// ---------------------------------------------------------------------------
// Sanitized cloud-safe prompt types
// ---------------------------------------------------------------------------

export interface SanitizedGoal {
  type: "travel";
  title: string;
  origin: string[];
  destinations: string[];
  earliestDeparture: string | null;
  latestReturn: string | null;
  minimumNights: number | null;
  maximumNights: number | null;
  travelerCount: number;
  cabinPreference: string;
  optimizationPriority: string;
  maximumCashBudget: number | null;
  currency: string;
  allowNewCards: boolean;
}

export interface SanitizedPointsInventoryItem {
  programName: string | null;
  ownerType: "self" | "companion";
  balance: number;
  verificationStatus: "unverified" | "verified";
  origin: "manual" | "evidence" | "connected";
}

export interface SanitizedWalletCard {
  name: string;
  issuer: string;
  rewardCurrency: string;
}

/** Server-built, cloud-safe facts that narrative prose must treat as fixed. */
export interface GroundedStrategyBrief {
  goal: SanitizedGoal & { resolvedTripNights: number | null };
  pointsSummary: Array<{
    programName: string | null;
    ownerType: "self" | "companion";
    verifiedPoints: number;
    unverifiedPoints: number;
  }>;
  optionRequirements: Array<{
    optionReference: string;
    redemptionType: "flight" | "hotel";
    pointsRequired: number | null;
    status: "calculated" | "insufficient_information";
    assumptions: string[];
    warnings: string[];
  }>;
  allocationScenarios: Array<{
    kind: StrategyAllocationScenario["kind"];
    status: StrategyAllocationScenario["status"];
    flightPointsRequired: number | null;
    hotelPointsRequired: number | null;
    travelerCount: number;
    tripNights: number | null;
    assumptions: string[];
    warnings: string[];
  }>;
  sanitizationWarnings: string[];
}

/** Kept non-enumerable by the payload builder; never serialized to a provider. */
export interface StrategyPromptReferenceMap {
  awardOptions: StrategyAwardOption[];
  cardOffers: StrategyCardOffer[];
  sources: StrategySource[];
  excludedSourceBoundRecords: boolean;
}

export interface SanitizedStrategyPrompt {
  goal: SanitizedGoal;
  pointsInventory: SanitizedPointsInventoryItem[];
  walletCards: SanitizedWalletCard[];
  monthlySpendingByCategory: StrategySpendingCategory[];
  awardOptions: StrategyAwardOption[];
  cardOffers: StrategyCardOffer[];
  sources: StrategySource[];
  generatedAt: string;
  brief: GroundedStrategyBrief;
  referenceMap: StrategyPromptReferenceMap;
}

// ---------------------------------------------------------------------------
// Provider interface
// ---------------------------------------------------------------------------

export interface StrategyProvider {
  generateStrategy(
    prompt: SanitizedStrategyPrompt
  ): Promise<PersonalizedStrategyNarrative>;
}
