import type { Goal, RewardAccount } from "./types";
import type { FlightPlanningEstimate } from "./flightPlanningEstimate";
import type { HotelPlanningEstimate } from "./hotelPlanningEstimate";
import type { EarningRule } from "@/lib/rewards/catalogTypes";
import type {
  TripRealityCard,
  TripRealityCash,
  TripRealityPoints,
  TripRealityFunding,
  TripRealityBestCard,
} from "./tripRealityCard";
import type { GoalFundingTimeline } from "./goalFundingTimeline";

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
  /**
   * Catalog reward-program id when the option's program is identified by a
   * verified catalog row (benchmark-derived options). Null for model- or
   * research-derived options, which are identified only by name. Drives
   * deterministic transfer funding; never exposed to the customer payload.
   */
  catalogRewardProgramId?: string | null;
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
  | "web_observed_not_live"
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

/** Monthly spending aggregated per wallet card and canonical category. */
export interface StrategyCardSpendingCategory {
  cardId: string;
  category: string;
  monthlyAverage: number;
}

export interface PersonalizedStrategyContext {
  goal: Goal;
  rewardAccounts: RewardAccount[];
  walletCards: Array<
    {
      id: string;
      name: string;
      issuer: string;
      rewardCurrency: string;
      cardProductId: string;
    }
  >;
  monthlySpendingByCategory: StrategySpendingCategory[];
  /**
   * Same spending attributed to the wallet card used for each purchase (the
   * spend's `cardId`), aggregated per card and canonical category. Null when
   * no accepted purchase carries a card attribution. Raw purchases never
   * travel on the context; only this derived aggregate does.
   */
  monthlySpendingByCategoryCard?: StrategyCardSpendingCategory[] | null;
  awardOptions: StrategyAwardOption[];
  cardOffers: StrategyCardOffer[];
  sources: StrategySource[];
  generatedAt: string;
  /**
   * Catalog earning rules for the customer's wallet-card products, attached by
   * `prepareGoalStrategyContext` after context construction. Only rules for
   * products linked to the customer's own cards are included. Optional and
   * null-safe so legacy builders/tests without catalog access remain valid.
   */
  earningRules?: EarningRule[] | null;
  /** Wallet-card id → linked catalog reward-program id (null when unlinked). */
  walletCardProgramIds?: Record<string, string | null>;
  /**
   * Verified award-benchmark catalog rows (Route A of the R2 milestone),
   * attached by `prepareGoalStrategyContext`. Shared catalog data, not user
   * data. Optional and null-safe for legacy builders/tests.
   */
  awardPriceBenchmarks?: import("@/lib/rewards/awardBenchmarks").AwardPriceBenchmark[] | null;
  /** Verified IATA → route-region entries backing benchmark selection. */
  airportRegionEntries?: import("@/lib/rewards/awardBenchmarks").AirportRegionEntry[] | null;
  /** Verified airline transfer-partner rows backing transfer funding. */
  verifiedTransferPartners?: import("@/lib/rewards/awardBenchmarks").VerifiedTransferPartner[] | null;
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
  /**
   * Copied only from the verified signed hotel-stage payload during
   * deterministic planner assembly; never sourced from model output,
   * browser input, award options, warnings, or assumptions.
   */
  hotelPlanningEstimate?: HotelPlanningEstimate | null;
  /**
   * Deterministic earnings projection built only from verified catalog earn
   * rules, recorded spending, and owned reward accounts. Null when no verified
   * points/miles rules exist. Never model-authored.
   */
  earnPlan?: EarnPlan | null;
  /**
   * Deterministic trip-cost reality card (V1): searched cash party-total,
   * goal-scaled points requirement, funding verdict, and the best attributed
   * card for the trip spend. Assembled only from already-validated pipeline
   * values; null when the strategy carries no flight evidence. Never
   * model-authored.
   */
  tripRealityCard?: TripRealityCard | null;
  /**
   * Deterministic goal funding timeline (V2): months-to-goal projection for
   * the verified funding path, from the funding source program's verified
   * card-attributed earn rates. Assembled only from already-validated
   * pipeline values; null when no flight options exist. Never model-authored.
   */
  goalFundingTimeline?: GoalFundingTimeline | null;
}

// ---------------------------------------------------------------------------
// Trip Reality Card (V1) — deterministic trip-cost assembly
// (shapes are declared in ./tripRealityCard and re-exported here for the
// persisted strategy contract; the local names above type the strategy field)
// ---------------------------------------------------------------------------

export type {
  TripRealityCard,
  TripRealityCash,
  TripRealityPoints,
  TripRealityFunding,
  TripRealityBestCard,
} from "./tripRealityCard";

/** --------------------------------------------------------------------------
 * Deterministic earnings plan (verified-catalog projections only)
 * -------------------------------------------------------------------------- */

/** Per-owner-and-program earnings projection. Currencies are never combined. */
export interface EarnPlanAccountProjection {
  key: string;
  programName: string | null;
  ownerType: "self" | "companion";
  ownerLabel: string;
  rewardCurrencyLabel: "points" | "miles";
  /** Current recorded balance for this owner+program (may be unverified). */
  currentBalance: number;
  balanceVerification: "verified" | "unverified" | "no_account";
  /** Monthly points/miles projected from verified earn rates (self cards only). */
  monthlyPoints: number;
  /** Whole calendar months from now to the goal's earliest departure (0–36). */
  monthsProjected: number | null;
  /** currentBalance + monthlyPoints × monthsProjected; null when undated/capped. */
  projectedBalance: number | null;
  /** True when the trip is more than 36 months away (no projection provided). */
  horizonCapped: boolean;
  /** Wallet cards contributing to this projection (bounded, deterministic order). */
  cardNames: string[];
}

/** Searched cash total carried through unchanged from planning estimates. */
export interface EarnPlanTripCash {
  amount: number;
  currency: string;
  /** Fixed source labels; never provider- or model-authored. */
  sources: string[];
}

/** Cash gap between the searched trip total and the goal's cash budget. */
export interface EarnPlanCashGap {
  currency: string;
  tripTotal: number;
  cashBudget: number;
  /** budget − tripTotal; negative means the trip exceeds the budget. */
  remaining: number;
}

export interface EarnPlan {
  schemaVersion: 1;
  label: "Earnings plan";
  /** Fixed server-owned disclosure; never provider- or model-authored. */
  disclosure: string;
  accounts: EarnPlanAccountProjection[];
  tripCash: EarnPlanTripCash | null;
  cashGap: EarnPlanCashGap | null;
  warnings: string[];
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
    prompt: SanitizedStrategyPrompt,
    options?: { signal?: AbortSignal },
  ): Promise<PersonalizedStrategyNarrative>;
}
