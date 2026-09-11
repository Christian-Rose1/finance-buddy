// Deterministic trip-cost and funding-account calculation helpers.
// These operate on the canonical strategy types and never mutate inputs.

import type { Goal } from "./types";
import type { VerifiedTransferPartner } from "@/lib/rewards/awardBenchmarks";
import type {
  StrategyAwardOption,
  StrategyPointsInventoryItem,
} from "./strategyTypes";

// ---------------------------------------------------------------------------
// Exported types
// ---------------------------------------------------------------------------

export type OptionCalculationStatus =
  | "calculated"
  | "insufficient_information";

export interface OptionRequirementCalculation {
  status: OptionCalculationStatus;
  pointsRequired: number | null;
  assumptions: string[];
  warnings: string[];
}

export interface FundingAccountMatch {
  account: StrategyPointsInventoryItem;
  method: "direct_program" | "transfer_source";
  /**
   * Transfer funding details. Set only for `transfer_source` matches:
   * the source (owned) account's program id and the verified ratio of
   * destination points per source point. The debit math uses these.
   */
  transfer?: {
    fromProgramId: string;
    destinationPointsPerSourcePoint: number;
  } | null;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Parse a date string as a UTC calendar date to avoid local timezone drift.
 * Returns the number of milliseconds since epoch for midnight UTC.
 * Returns NaN for unparseable input.
 */
function utcMidnight(dateStr: string): number {
  // Accept ISO date-only (YYYY-MM-DD) or full ISO datetime strings.
  const trimmed = dateStr.trim();
  if (trimmed.length === 0) return NaN;

  // Try ISO date-only first: YYYY-MM-DD
  const dateOnlyMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (dateOnlyMatch) {
    const year = parseInt(dateOnlyMatch[1], 10);
    const month = parseInt(dateOnlyMatch[2], 10);
    const day = parseInt(dateOnlyMatch[3], 10);
    return Date.UTC(year, month - 1, day);
  }

  // Fall back to full ISO datetime parsing via the Date constructor,
  // then extract UTC date components to strip the time portion.
  const parsed = new Date(trimmed);
  if (isNaN(parsed.getTime())) return NaN;
  return Date.UTC(
    parsed.getUTCFullYear(),
    parsed.getUTCMonth(),
    parsed.getUTCDate(),
  );
}

/**
 * Return true when value is a finite positive number.
 */
function isPositiveFinite(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

/**
 * Build an insufficient_information result with optional warnings.
 */
function insufficient(
  warnings: string[] = [],
): OptionRequirementCalculation {
  return {
    status: "insufficient_information",
    pointsRequired: null,
    assumptions: [],
    warnings,
  };
}

/**
 * Build a calculated result.
 */
function calculated(
  pointsRequired: number,
  assumptions: string[] = [],
  warnings: string[] = [],
): OptionRequirementCalculation {
  return { status: "calculated", pointsRequired, assumptions, warnings };
}

// ---------------------------------------------------------------------------
// Trip nights
// ---------------------------------------------------------------------------

/**
 * Return the positive whole-day difference between earliestDeparture and
 * latestReturn, parsed as UTC calendar dates to avoid local timezone drift.
 *
 * Returns null for missing, invalid, zero, or reversed dates.
 */
export function calculateTripNights(goal: Goal): number | null {
  const { earliestDeparture, latestReturn, minimumNights, maximumNights } =
    goal;

  if (!earliestDeparture || !latestReturn) return null;

  const dep = utcMidnight(earliestDeparture);
  const ret = utcMidnight(latestReturn);

  if (isNaN(dep) || isNaN(ret)) return null;

  const diffMs = ret - dep;
  if (diffMs <= 0) return null;

  const spanNights = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (spanNights <= 0) return null;

  // Option C: respect the saved stay-length range. Use the declared minimum
  // as the concrete default single-stay length; fall back to the maximum, then
  // to the full earliestDeparture→latestReturn window span only when no range
  // is declared. This stops the whole departure/return window from being
  // treated as one long stay (which previously inflated tripNights and the
  // hotel per-night math).
  const declaredNights =
    minimumNights !== null &&
    minimumNights !== undefined &&
    Number.isInteger(minimumNights) &&
    minimumNights > 0
      ? minimumNights
      : maximumNights !== null &&
          maximumNights !== undefined &&
          Number.isInteger(maximumNights) &&
          maximumNights > 0
        ? maximumNights
        : spanNights;

  return declaredNights > 0 ? declaredNights : null;
}

// ---------------------------------------------------------------------------
// Flight points required
// ---------------------------------------------------------------------------

/**
 * Calculate the points required for a flight award option.
 *
 * Requirements:
 * - redemptionType === "flight"
 * - positive goal.travelerCount
 * - positive option.travelerCountCovered
 * - pricingBasis one_way or round_trip
 *
 * Groups are calculated conservatively (ceil) and never prorated.
 */
export function calculateFlightPointsRequired(
  option: StrategyAwardOption,
  goal: Goal,
): OptionRequirementCalculation {
  const assumptions: string[] = [];
  const warnings: string[] = [];

  // Guard: redemption type
  if (option.redemptionType !== "flight") {
    return insufficient([
      `Expected redemptionType "flight", got "${option.redemptionType}"`,
    ]);
  }

  // Guard: traveler count
  if (!isPositiveFinite(goal.travelerCount)) {
    return insufficient(["Goal travelerCount is missing or not positive"]);
  }

  // Guard: traveler coverage
  const covered = option.travelerCountCovered;
  if (covered == null || !isPositiveFinite(covered)) {
    return insufficient(["Option travelerCountCovered is missing or not positive"]);
  }

  // Guard: pricing basis
  const { pricingBasis } = option;
  if (pricingBasis !== "one_way" && pricingBasis !== "round_trip") {
    return insufficient([
      `Flight pricingBasis must be "one_way" or "round_trip", got "${pricingBasis}"`,
    ]);
  }

  // Guard: points required
  if (!isPositiveFinite(option.pointsRequired)) {
    return insufficient(["Option pointsRequired is missing or not positive"]);
  }

  // Calculate traveler groups (ceil, never prorate)
  const groups = Math.ceil(goal.travelerCount / covered);

  let pointsRequired: number;

  if (pricingBasis === "round_trip") {
    pointsRequired = option.pointsRequired * groups;
  } else {
    // one_way
    if (goal.latestReturn) {
      // Round-trip assumed: multiply by 2 directions
      pointsRequired = option.pointsRequired * groups * 2;
      assumptions.push(
        "One-way pricing multiplied by 2 directions because latestReturn is set (round-trip assumed)",
      );
    } else {
      pointsRequired = option.pointsRequired * groups;
      assumptions.push(
        "One-way pricing used without direction multiplier because latestReturn is not set",
      );
    }
  }

  // Validate result
  if (!isPositiveFinite(pointsRequired)) {
    return insufficient(["Calculated pointsRequired is not a finite positive number"]);
  }

  // Coverage assumption
  if (option.coverageStatus === "standard_assumption") {
    assumptions.push(
      `Single-traveler coverage assumed (coverageStatus: standard_assumption); ${covered} traveler(s) covered per ${option.pointsRequired.toLocaleString()} points`,
    );
  }

  return calculated(pointsRequired, assumptions, warnings);
}

// ---------------------------------------------------------------------------
// Hotel points required
// ---------------------------------------------------------------------------

/**
 * Calculate the points required for a hotel award option.
 *
 * Requirements:
 * - redemptionType === "hotel"
 * - valid positive trip-night count
 * - positive option.nightCountCovered
 *
 * per_night: groups = ceil(tripNights / nightCountCovered)
 * total_stay: only when nightCountCovered exactly equals trip nights
 * one_way / round_trip / unknown: insufficient_information
 */
export function calculateHotelPointsRequired(
  option: StrategyAwardOption,
  goal: Goal,
): OptionRequirementCalculation {
  const assumptions: string[] = [];
  const warnings: string[] = [];

  // Guard: redemption type
  if (option.redemptionType !== "hotel") {
    return insufficient([
      `Expected redemptionType "hotel", got "${option.redemptionType}"`,
    ]);
  }

  // Guard: trip nights
  const tripNights = calculateTripNights(goal);
  if (tripNights === null || !isPositiveFinite(tripNights)) {
    return insufficient([
      "Cannot calculate hotel points: trip nights are missing, invalid, or not positive",
    ]);
  }

  // Guard: night coverage
  const covered = option.nightCountCovered;
  if (covered == null || !isPositiveFinite(covered)) {
    return insufficient(["Option nightCountCovered is missing or not positive"]);
  }

  // Guard: points required
  if (!isPositiveFinite(option.pointsRequired)) {
    return insufficient(["Option pointsRequired is missing or not positive"]);
  }

  // Pricing basis dispatch
  const { pricingBasis } = option;

  if (pricingBasis === "per_night") {
    const groups = Math.ceil(tripNights / covered);
    const pointsRequired = option.pointsRequired * groups;

    if (!isPositiveFinite(pointsRequired)) {
      return insufficient(["Calculated hotel pointsRequired is not a finite positive number"]);
    }

    assumptions.push(
      "Estimate is for one room because the current goal does not record room count",
    );

    if (option.coverageStatus === "standard_assumption") {
      assumptions.push(
        `One-night coverage assumed (coverageStatus: standard_assumption); ${covered} night(s) covered per ${option.pointsRequired.toLocaleString()} points`,
      );
    }

    return calculated(pointsRequired, assumptions, warnings);
  }

  if (pricingBasis === "total_stay") {
    // Only valid when nightCountCovered exactly equals trip nights
    if (covered !== tripNights) {
      return insufficient([
        `Total-stay pricing requires nightCountCovered (${covered}) to equal trip nights (${tripNights}); total-stay pricing does not scale linearly`,
      ]);
    }

    assumptions.push(
      "Estimate is for one room because the current goal does not record room count",
    );

    if (option.coverageStatus === "standard_assumption") {
      assumptions.push(
        `One-night coverage assumed (coverageStatus: standard_assumption); ${covered} night(s) covered per ${option.pointsRequired.toLocaleString()} points`,
      );
    }

    return calculated(option.pointsRequired, assumptions, warnings);
  }

  // one_way, round_trip, or unknown
  return insufficient([
    `Hotel pricingBasis must be "per_night" or "total_stay", got "${pricingBasis}"`,
  ]);
}

// ---------------------------------------------------------------------------
// Funding account matching
// ---------------------------------------------------------------------------

/**
 * Find the best eligible funding account for an award option.
 *
 * Eligible accounts must be:
 * - verificationStatus === "verified"
 * - ownerType === "self"
 *
 * Only exact non-null programName matches fund directly. The existing award
 * contract has a bare transferRatio, but no ratio unit convention, validated
 * account eligibility, or transfer minimum/increment terms. A source-program
 * reference alone therefore cannot authorize a transfer debit, even at 1:1.
 * Destination requirements remain calculable separately from funding.
 *
 * Tiebreaker: highest balance, then first-seen order for equal balances.
 *
 * Never combines accounts, uses companion balances, unverified balances,
 * infers transferability from name mismatch, converts points, or values
 * points in dollars.
 */
export function findFundingAccount(
  option: StrategyAwardOption,
  pointsInventory: StrategyPointsInventoryItem[],
  verifiedTransferPartners?: VerifiedTransferPartner[] | null,
): FundingAccountMatch | null {
  // Filter to eligible accounts only
  const eligible = pointsInventory.filter(
    (item) =>
      item.verificationStatus === "verified" && item.ownerType === "self",
  );

  if (eligible.length === 0) return null;

  // Direct same-program funding needs no conversion or transfer assumptions.
  const directMatches = eligible.filter(
    (item) =>
      item.programName !== null &&
      item.programName === option.programName,
  );

  if (directMatches.length > 0) {
    const best = pickHighestBalance(directMatches);
    return { account: best, method: "direct_program" };
  }

  // Transfer funding: the option's program must be identified by catalog id,
  // and a verified partner row must connect an owned account's program to it.
  // Both identifiers must be structurally valid, positive-ratio, verified
  // rows — selection is deterministic (highest partner ratio, then loader
  // order via reduce-left keep-first on strictly-greater comparisons).
  if (
    verifiedTransferPartners &&
    verifiedTransferPartners.length > 0 &&
    typeof option.catalogRewardProgramId === "string" &&
    option.catalogRewardProgramId.length > 0
  ) {
    const partnerById = new Map(
      eligible.map((item) => [item.rewardProgramId, item]),
    );
    const usablePartners = verifiedTransferPartners.filter(
      (partner) =>
        partner &&
        typeof partner === "object" &&
        typeof partner.fromProgramId === "string" &&
        partner.fromProgramId.length > 0 &&
        typeof partner.toProgramId === "string" &&
        partner.toProgramId === option.catalogRewardProgramId &&
        typeof partner.destinationPointsPerSourcePoint === "number" &&
        Number.isFinite(partner.destinationPointsPerSourcePoint) &&
        partner.destinationPointsPerSourcePoint > 0 &&
        typeof partner.lastVerifiedAt === "string" &&
        partner.lastVerifiedAt.length > 0,
    );
    const matches: Array<{
      item: StrategyPointsInventoryItem;
      partner: VerifiedTransferPartner;
    }> = [];
    for (const partner of usablePartners) {
      const item = partnerById.get(partner.fromProgramId);
      if (item) {
        matches.push({ item, partner });
      }
    }
    if (matches.length > 0) {
      let best = matches[0];
      for (let i = 1; i < matches.length; i++) {
        if (
          matches[i].partner.destinationPointsPerSourcePoint >
          best.partner.destinationPointsPerSourcePoint
        ) {
          best = matches[i];
        }
      }
      return {
        account: best.item,
        method: "transfer_source",
        transfer: {
          fromProgramId: best.partner.fromProgramId,
          destinationPointsPerSourcePoint:
            best.partner.destinationPointsPerSourcePoint,
        },
      };
    }
  }

  return null;
}

/**
 * Select the account with the highest balance from a non-empty array.
 * Preserves first-seen order for equal balances.
 */
function pickHighestBalance(
  items: StrategyPointsInventoryItem[],
): StrategyPointsInventoryItem {
  let best = items[0];
  for (let i = 1; i < items.length; i++) {
    if (items[i].balance > best.balance) {
      best = items[i];
    }
  }
  return best;
}