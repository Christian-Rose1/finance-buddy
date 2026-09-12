/**
 * Trip Reality Card (V1) — deterministic assembly of what the trip actually
 * costs across cash and points, built ONLY from values already validated by
 * the existing pipeline:
 *
 * - Cash side: the searched flight party-total from the verified
 *   `FlightPlanningEstimate` (party total, round trip; never a per-person
 *   figure). No nightly or per-option hotel price is ever aggregated here.
 * - Points side: the goal-scaled flight requirement from
 *   `calculateFlightPointsRequired` — the same traveler-coverage, basis, and
 *   direction math the allocation scenarios use — so this card can never
 *   disagree with the scenarios about what the trip costs in points.
 * - Funding side: reuses `findFundingAccount` exactly (verified + self-owned
 *   accounts, catalog-id transfer matching, debit rounded UP), including the
 *   verified transfer path. Unverified balances never claim coverage.
 * - Best-card side: the customer's real card-attributed travel spending at
 *   verified catalog earn rates — "which of your cards should pay for this".
 *
 * Trust rules:
 * - Pure module: no I/O, no clocks, no model. Every output is derived
 *   deterministically from the passed inputs; nothing is invented.
 * - Fail closed: a side is built only when its evidence exists; missing
 *   evidence yields `null` plus fixed copy, never a guessed number.
 * - Every customer-facing string is fixed server-owned copy.
 * - Output is a fresh object; inputs are never mutated.
 */

import type {
  PersonalizedStrategyContext,
  StrategyAllocationScenario,
  StrategyAwardOption,
  StrategyPointsInventoryItem,
} from "./strategyTypes";
import type { FlightPlanningEstimate } from "./flightPlanningEstimate";
import {
  calculateFlightPointsRequired,
  findFundingAccount,
} from "./strategyOptionCalculator";
import { normalizeCategory, type CanonicalCategoryKey } from "@/lib/rewards/categories";
import type { EarningRule } from "@/lib/rewards/catalogTypes";

export const TRIP_REALITY_CARD_LABEL = "Trip reality";

/** Fixed customer-facing copy. Never provider- or model-authored. */
export const TRIP_REALITY_COPY = Object.freeze({
  cashUnavailable: "Cash total not confirmed",
  pointsUnavailable: "Points requirement not confirmed",
  pointsUnavailableNoCoverage:
    "The found benchmarks don't state how many travelers each price covers, so a trip total can't be calculated",
  fundingCovered: "Your confirmed balances could cover this",
  fundingGap: "Your confirmed balances don't cover this yet",
  fundingUnknown: "No confirmed funding path from your balances yet",
  feesUnconfirmed: "Taxes and fees are not included in this figure",
  bestCardUnavailable:
    "Add your cards to purchases to see which card should pay for this trip",
  disclosure:
    "Totals are planning estimates from your saved goal and searched prices, not bookable quotes. Verify current prices and availability before acting.",
});

/** Statuses are bounded so the presentation layer can map them to fixed labels. */
export type TripRealityCashStatus = "available" | "unavailable";
export type TripRealityPointsStatus = "available" | "unavailable";
export type TripRealityFundingStatus = "covered" | "gap" | "unknown";
export type TripRealityBestCardStatus = "available" | "no_attribution" | "unavailable";

export interface TripRealityCash {
  status: TripRealityCashStatus;
  /** Searched party total for the whole trip (all travelers, round trip). */
  amount: number;
  currency: string;
  travelers: number;
}

export interface TripRealityPoints {
  status: TripRealityPointsStatus;
  /** Goal-scaled party requirement (all travelers, full trip) in points. */
  pointsRequired: number;
  programName: string;
  pricingBasis: "one_way" | "round_trip";
  /** Verified option fees when the winning option carries them; else null. */
  fees: number | null;
  /** How many distinct programs offered a usable requirement. */
  programCount: number;
  /**
   * Why no points requirement could be calculated, when that is the case.
   * Fixed server-owned copy only; present exactly when status is
   * "unavailable".
   */
  unavailableReason: string | null;
}

export interface TripRealityFunding {
  status: TripRealityFundingStatus;
  /** Best (lowest) scenario points requirement, for context. */
  bestPointsRequired: number | null;
  /** Confirmed-balance surplus over the debit for the cheapest fundable option (may be negative). */
  verifiedSurplus: number | null;
  /** The funded program's display name, when a funding path exists. */
  programName: string | null;
}

export interface TripRealityBestCard {
  status: TripRealityBestCardStatus;
  cardId: string;
  cardName: string;
  /** Verified earn rate of the winning card for the travel category. */
  rate: number;
  /** Points/miles per month the winning card earns on attributed travel spend. */
  monthlyPoints: number;
  /** Points/miles per month the next best attributed card earns, when one exists. */
  nextBestMonthlyPoints: number | null;
  category: string;
  currencyLabel: "points" | "miles";
}

export interface TripRealityCard {
  schemaVersion: 1;
  label: typeof TRIP_REALITY_CARD_LABEL;
  disclosure: string;
  cash: TripRealityCash | null;
  points: TripRealityPoints | null;
  funding: TripRealityFunding | null;
  bestCard: TripRealityBestCard | null;
  warnings: string[];
}

/** Input assembled by the planner after points inventory construction. */
export interface TripRealityCardInputs {
  flightOptions: StrategyAwardOption[];
  allocationScenarios: StrategyAllocationScenario[];
  pointsInventory: StrategyPointsInventoryItem[];
}

const MAX_WARNINGS = 4;

function isPositiveFinite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function isNonNegativeFinite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

// ---------------------------------------------------------------------------
// Cash side
// ---------------------------------------------------------------------------

function buildCash(
  estimate: FlightPlanningEstimate | null,
): TripRealityCash | null {
  if (!estimate) return null;
  // The verified flight estimate's total is a searched party total for the
  // full trip (priceCoverage is pinned to "searched_party_total" by the
  // estimator). Anything else is rejected upstream; nothing is derived here.
  if (estimate.priceCoverage !== "searched_party_total") return null;
  if (!isPositiveFinite(estimate.total)) return null;
  if (typeof estimate.currency !== "string" || estimate.currency.length !== 3) {
    return null;
  }
  if (!isPositiveFinite(estimate.travelers)) return null;
  return {
    status: "available",
    amount: estimate.total,
    currency: estimate.currency,
    travelers: estimate.travelers,
  };
}

// ---------------------------------------------------------------------------
// Points side
// ---------------------------------------------------------------------------

interface ProgramCandidate {
  optionIndex: number;
  pointsRequired: number;
  fees: number | null;
  pricingBasis: StrategyAwardOption["pricingBasis"];
}

/**
 * Pick the cheapest goal-scaled flight requirement per program. Equal
 * requirements keep the first occurrence (input order), matching the
 * repository's first-occurrence deduplication convention.
 */
function pickBestPerProgram(
  flightOptions: StrategyAwardOption[],
  requirementsByOption: Array<number | null>,
): Map<string, ProgramCandidate> {
  const best = new Map<string, ProgramCandidate>();
  flightOptions.forEach((option, index) => {
    const requirement = requirementsByOption[index];
    if (requirement === null) return;
    const existing = best.get(option.programName);
    if (!existing || requirement < existing.pointsRequired) {
      best.set(option.programName, {
        optionIndex: index,
        pointsRequired: requirement,
        fees: option.cashFees,
        pricingBasis: option.pricingBasis,
      });
    }
  });
  return best;
}

function buildPoints(
  requirementsByOption: Array<number | null>,
  flightOptions: StrategyAwardOption[],
  goalHasReturn: boolean,
): TripRealityPoints | null {
  if (flightOptions.length > 0 && requirementsByOption.every((value) => value === null)) {
    // Options exist but the shared requirement math rejected every one (e.g.
    // missing traveler coverage on the source data). Say why instead of
    // rendering a bare "not confirmed".
    return {
      status: "unavailable",
      pointsRequired: 0,
      programName: "",
      pricingBasis: "one_way",
      fees: null,
      programCount: 0,
      unavailableReason: TRIP_REALITY_COPY.pointsUnavailableNoCoverage,
    };
  }
  const bestPerProgram = pickBestPerProgram(flightOptions, requirementsByOption);
  let winner: { programName: string; candidate: ProgramCandidate } | null = null;
  for (const [programName, candidate] of bestPerProgram) {
    if (
      !winner ||
      candidate.pointsRequired < winner.candidate.pointsRequired ||
      (candidate.pointsRequired === winner.candidate.pointsRequired &&
        programName < winner.programName)
    ) {
      winner = { programName, candidate };
    }
  }
  if (!winner) return null;
  const candidate = winner.candidate;
  // Label the basis exactly as the requirement was calculated: a round_trip
  // option is round trip; a one_way option is presented as round trip only
  // when the calculator actually applied the 2-direction multiplier (the
  // goal's return date is set); otherwise one way.
  const pricingBasis: "one_way" | "round_trip" =
    candidate.pricingBasis === "round_trip" ||
    (candidate.pricingBasis === "one_way" && goalHasReturn)
      ? "round_trip"
      : "one_way";
  return {
    status: "available",
    pointsRequired: candidate.pointsRequired,
    programName: winner.programName,
    pricingBasis,
    fees:
      candidate.fees !== null && isNonNegativeFinite(candidate.fees)
        ? candidate.fees
        : null,
    programCount: bestPerProgram.size,
    unavailableReason: null,
  };
}

// ---------------------------------------------------------------------------
// Funding side — reuses findFundingAccount exactly
// ---------------------------------------------------------------------------

function buildFunding(
  requirementsByOption: Array<number | null>,
  flightOptions: StrategyAwardOption[],
  pointsInventory: StrategyPointsInventoryItem[],
  verifiedTransferPartners: PersonalizedStrategyContext["verifiedTransferPartners"],
  bestPointsRequired: number | null,
): TripRealityFunding | null {
  // Only options with a usable requirement can be funded.
  const candidates: Array<{
    debit: number;
    balance: number;
    programName: string;
  }> = [];

  flightOptions.forEach((option, index) => {
    const requirement = requirementsByOption[index];
    if (requirement === null) return;
    const match = findFundingAccount(
      option,
      pointsInventory,
      verifiedTransferPartners ?? null,
    );
    if (!match) return;
    // Debit math mirrors the allocation builder: direct matches debit the
    // requirement; transfers debit requirement ÷ ratio rounded UP.
    const debit =
      match.method === "transfer_source" && match.transfer
        ? Math.ceil(requirement / match.transfer.destinationPointsPerSourcePoint)
        : requirement;
    candidates.push({
      debit,
      balance: match.account.balance,
      programName: match.account.programName ?? option.programName,
    });
  });

  if (candidates.length === 0) {
    return {
      status: "unknown",
      bestPointsRequired,
      verifiedSurplus: null,
      programName: null,
    };
  }
  let best = candidates[0];
  for (let i = 1; i < candidates.length; i++) {
    if (candidates[i].debit < best.debit) best = candidates[i];
  }
  return {
    status: best.balance >= best.debit ? "covered" : "gap",
    bestPointsRequired,
    verifiedSurplus: best.balance - best.debit,
    programName: best.programName,
  };
}

// ---------------------------------------------------------------------------
// Best-card side (real card attribution, verified rates only)
// ---------------------------------------------------------------------------

interface RateView {
  rate: number;
  currency: "points" | "miles";
}

/**
 * Select the verified points/miles rate for `category` on one card product.
 * Mirrors the earn-plan conventions: the rule must be an active earning_rate
 * rule verified by the catalog, exact category match beats the base
 * ("other"/null) rate, cash-back never enters point math, and rules whose
 * eligibility cannot be honored for aggregated category spending
 * (merchant-scoped, exclusions) are skipped. Returns null when the product
 * has no usable rate.
 */
function selectTripRate(
  rules: readonly EarningRule[],
  cardProductId: string,
  category: CanonicalCategoryKey,
): RateView | null {
  let base: RateView | null = null;
  let exact: RateView | null = null;
  for (const rule of rules) {
    if (rule.cardProductId !== cardProductId) continue;
    if (rule.type !== "earning_rate" || !rule.active) continue;
    if (rule.eligibleMerchant !== null || rule.excludedMerchants.length > 0) {
      continue;
    }
    if (
      typeof rule.rewardValue !== "number" ||
      !Number.isFinite(rule.rewardValue) ||
      rule.rewardValue <= 0
    ) {
      continue;
    }
    if (rule.rewardCurrency !== "points" && rule.rewardCurrency !== "miles") {
      continue;
    }
    if (
      typeof rule.lastVerifiedAt !== "string" ||
      rule.lastVerifiedAt.trim().length === 0
    ) {
      continue;
    }
    const view: RateView = { rate: rule.rewardValue, currency: rule.rewardCurrency };
    if (rule.eligibleCategory === null || rule.eligibleCategory === "other") {
      if (!base || rule.rewardValue > base.rate) base = view;
    } else if (rule.eligibleCategory === category) {
      if (!exact || rule.rewardValue > exact.rate) exact = view;
    }
  }
  return exact ?? base;
}

function buildBestCard(
  context: PersonalizedStrategyContext,
  warnings: string[],
): TripRealityBestCard | null {
  const attributed = context.monthlySpendingByCategoryCard;
  if (!attributed || attributed.length === 0) return null;
  const rules = context.earningRules;
  if (!rules || rules.length === 0) {
    // Attributed travel spend exists but no verified catalog rates were
    // loaded — explain the absence instead of failing silently.
    warnings.push(
      "Card earnings for this trip could not be projected from verified card rates.",
    );
    return null;
  }

  // The trip's spending category is travel (the canonical catalog category
  // covering airfare). Other categories are daily-spend intelligence for
  // later milestones; the card that should PAY for this trip is the best
  // travel-earning card among the cards the customer actually uses.
  const tripCategory = normalizeCategory("travel");
  if (tripCategory !== "travel") return null;

  const monthlyByCard = new Map<string, number>();
  for (const entry of attributed) {
    if (normalizeCategory(entry.category) !== tripCategory) continue;
    if (!isPositiveFinite(entry.monthlyAverage)) continue;
    monthlyByCard.set(
      entry.cardId,
      (monthlyByCard.get(entry.cardId) ?? 0) + entry.monthlyAverage,
    );
  }
  if (monthlyByCard.size === 0) return null;

  const cardNames = new Map<string, string>();
  for (const card of context.walletCards) {
    cardNames.set(card.id, card.name);
  }

  let winner: TripRealityBestCard | null = null;
  let runnerUpMonthly: number | null = null;
  for (const [cardId, monthly] of monthlyByCard) {
    const card = context.walletCards.find((candidate) => candidate.id === cardId);
    if (!card) continue;
    const rateView = selectTripRate(rules, card.cardProductId, tripCategory);
    if (!rateView) continue;
    const monthlyPoints = round2(monthly * rateView.rate);
    if (
      !winner ||
      monthlyPoints > winner.monthlyPoints ||
      (monthlyPoints === winner.monthlyPoints && cardId < winner.cardId)
    ) {
      if (winner) {
        runnerUpMonthly =
          runnerUpMonthly === null
            ? winner.monthlyPoints
            : Math.max(runnerUpMonthly, winner.monthlyPoints);
      }
      winner = {
        status: "available",
        cardId,
        cardName: cardNames.get(cardId) ?? "Your card",
        rate: rateView.rate,
        monthlyPoints,
        nextBestMonthlyPoints: null,
        category: tripCategory,
        currencyLabel: rateView.currency,
      };
    } else {
      runnerUpMonthly =
        runnerUpMonthly === null
          ? monthlyPoints
          : Math.max(runnerUpMonthly, monthlyPoints);
    }
  }

  if (!winner) {
    // The customer attributes travel spending to cards, but none of those
    // cards has a verified points/miles rate. Distinguish this from "no
    // attribution at all" so the customer copy can be accurate.
    warnings.push(
      "Card earnings for this trip could not be projected from verified card rates.",
    );
    return null;
  }
  winner.nextBestMonthlyPoints = runnerUpMonthly;
  return winner;
}

// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------

/**
 * Build the Trip Reality Card. Returns null only when the strategy carries no
 * flight evidence at all (no estimate and no options) — the honest empty
 * state; every partial-evidence combination yields a card with the missing
 * sides explicitly unavailable.
 */
export function buildTripRealityCard(
  context: PersonalizedStrategyContext,
  inputs: TripRealityCardInputs,
  flightEstimate: FlightPlanningEstimate | null,
): TripRealityCard | null {
  const hasEvidence =
    flightEstimate !== null || inputs.flightOptions.length > 0;
  if (!hasEvidence) return null;

  const warnings: string[] = [];
  const goalHasReturn = Boolean(context.goal.latestReturn);

  const cash = buildCash(flightEstimate);

  // Goal-scaled requirements, one per strategy flight option (null when the
  // shared calculator rejects the option). The requirement math is the exact
  // allocation-scenario math, so the card and the scenarios can never
  // disagree about what a trip costs in points.
  const requirementsByOption = inputs.flightOptions.map((option) => {
    const calc = calculateFlightPointsRequired(option, context.goal);
    return calc.status === "calculated" ? calc.pointsRequired : null;
  });

  const points = buildPoints(
    requirementsByOption,
    inputs.flightOptions,
    goalHasReturn,
  );

  // Best (lowest) scenario requirement, for funding context.
  const scenarioRequirements = inputs.allocationScenarios
    .map((scenario) => scenario.flightPointsRequired)
    .filter((value): value is number => isPositiveFinite(value));
  const bestPointsRequired =
    scenarioRequirements.length > 0 ? Math.min(...scenarioRequirements) : null;

  const funding = buildFunding(
    requirementsByOption,
    inputs.flightOptions,
    inputs.pointsInventory,
    context.verifiedTransferPartners,
    bestPointsRequired,
  );

  const bestCard = buildBestCard(context, warnings);

  if (points && points.fees === null) {
    warnings.push(TRIP_REALITY_COPY.feesUnconfirmed);
  }

  return {
    schemaVersion: 1,
    label: TRIP_REALITY_CARD_LABEL,
    disclosure: TRIP_REALITY_COPY.disclosure,
    cash,
    points,
    funding,
    bestCard,
    warnings: warnings.slice(0, MAX_WARNINGS),
  };
}
