/**
 * Goal Funding Timeline (V2) — deterministic months-to-goal projection.
 *
 * Answers: "Your confirmed balances don't cover this yet — when will they?"
 * built ONLY from values already validated by the existing pipeline:
 *
 * - The funding side reuses the Trip Reality Card's funding selection and
 *   arithmetic exactly (`findFundingAccount` with identical debit rounding):
 *   verified + self-owned accounts only, catalog-id transfer matching, debit
 *   rounded UP for transfers, lowest-debit first-occurrence winner.
 * - The earn side reuses the earn plan's verified-rate selectors
 *   (`selectVerifiedPointEarnRates`, `monthlyPointsForCard`): only verified,
 *   active, points/miles catalog rates for the funding SOURCE program's own
 *   cards, applied to the customer's real card-attributed spending. Currencies
 *   are never combined; a program whose contributing cards mix currencies
 *   fails closed instead of merging.
 * - `monthsToGoal` is pure arithmetic over the winner's debit and balance:
 *   ceil((debit − balance) / monthlyEarn). No availability, price, or
 *   approval claim is made or implied.
 *
 * Trust rules:
 * - Pure module: no I/O, no clocks, no model. Every output is derived
 *   deterministically from the passed inputs; nothing is invented.
 * - Fail closed: no verified funding path or no verifiable monthly earn
 *   yields `no_path` with fixed warning copy, never a guessed number.
 * - Every customer-facing string is fixed server-owned copy; numeric fields
 *   are persisted raw so the presentation layer composes all sentences from
 *   its own fixed templates.
 * - Output is a fresh object; inputs are never mutated.
 */

import type {
  PersonalizedStrategyContext,
  StrategyAwardOption,
  StrategyPointsInventoryItem,
} from "./strategyTypes";
import {
  calculateFlightPointsRequired,
  findFundingAccount,
} from "./strategyOptionCalculator";
import {
  monthlyPointsForCard,
  selectVerifiedPointEarnRates,
  EARN_PLAN_DISCLOSURE,
  EARN_PLAN_MAX_PROJECTION_MONTHS,
} from "./earnPlan";
import { normalizeCategory } from "@/lib/rewards/categories";

export const GOAL_FUNDING_TIMELINE_LABEL = "Points timeline";

/** Fixed customer-facing warnings. Never provider- or model-authored. */
export const GOAL_FUNDING_TIMELINE_WARNING_NO_EARN =
  "No verified card earn rates apply to your recorded spending for this program, so no monthly earn can be projected.";
export const GOAL_FUNDING_TIMELINE_WARNING_NO_FUNDING =
  "No confirmed funding path from your verified balances matches this requirement, so a timeline is not shown.";
export const GOAL_FUNDING_TIMELINE_WARNING_MIXED_CURRENCY =
  "Some verified earn rates were omitted because their reward currency could not be kept separate.";
export const GOAL_FUNDING_TIMELINE_WARNING_HORIZON_CAPPED =
  "Reaching this requirement would take more than 36 months at your projected earn rate, so no timeline is shown.";

/**
 * Reuses the earn-plan disclosure verbatim so the two projections carry one
 * identical, fixed provenance statement.
 */
export const GOAL_FUNDING_TIMELINE_DISCLOSURE = EARN_PLAN_DISCLOSURE;

/**
 * Consistent with the earn plan: projections are refused beyond this horizon
 * rather than presented as precision.
 */
const MAX_MONTHS_TO_GOAL = EARN_PLAN_MAX_PROJECTION_MONTHS;

const MAX_WARNINGS = 4;

/** Bounded so the presentation layer can map each to fixed copy. */
export type GoalFundingTimelineStatus = "covered" | "on_track" | "no_path";

export interface GoalFundingTimeline {
  schemaVersion: 1;
  label: typeof GOAL_FUNDING_TIMELINE_LABEL;
  status: GoalFundingTimelineStatus;
  /**
   * Verified monthly earn for the funding source program's own cards from
   * the customer's attributed spending. Null when no verifiable earn exists.
   */
  monthlyEarn: number | null;
  currencyLabel: "points" | "miles" | null;
  /** The funding source program's display name, when a funding path exists. */
  sourceProgramName: string | null;
  /** Whole months of projected earn needed to cover the debit; null otherwise. */
  monthsToGoal: number | null;
  warnings: string[];
  disclosure: string;
}

/** Inputs assembled by the planner, mirroring the Trip Reality Card inputs. */
export interface GoalFundingTimelineInputs {
  flightOptions: StrategyAwardOption[];
  pointsInventory: StrategyPointsInventoryItem[];
}

/** One verified funding candidate for the trip requirement. */
interface TripFundingCandidate {
  /** Points debited from the source account for the requirement. */
  debit: number;
  /** The verified source account's current balance. */
  balance: number;
  /** The funded program's display name. */
  programName: string;
  /** The funding SOURCE program's catalog id (own earn rates are matched here). */
  sourceProgramId: string;
}

function isNonNegativeFinite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Build the deterministic funding timeline, or null when the strategy carries
 * no flight options at all (no requirement exists to timeline).
 */
export function buildGoalFundingTimeline(
  context: PersonalizedStrategyContext,
  inputs: GoalFundingTimelineInputs,
): GoalFundingTimeline | null {
  if (inputs.flightOptions.length === 0) return null;

  // Goal-scaled requirements with the exact Trip Reality Card math.
  const requirementsByOption = inputs.flightOptions.map((option) => {
    const calc = calculateFlightPointsRequired(option, context.goal);
    return calc.status === "calculated" ? calc.pointsRequired : null;
  });

  // Funding candidates with the exact Trip Reality Card selection.
  const candidates: TripFundingCandidate[] = [];
  inputs.flightOptions.forEach((option, index) => {
    const requirement = requirementsByOption[index];
    if (requirement === null) return;
    const match = findFundingAccount(
      option,
      inputs.pointsInventory,
      context.verifiedTransferPartners ?? null,
    );
    if (!match) return;
    const debit =
      match.method === "transfer_source" && match.transfer
        ? Math.ceil(requirement / match.transfer.destinationPointsPerSourcePoint)
        : requirement;
    candidates.push({
      debit,
      balance: match.account.balance,
      programName: match.account.programName ?? option.programName,
      sourceProgramId: match.account.rewardProgramId,
    });
  });

  // Winner: lowest debit, first occurrence on ties — mirrors buildFunding.
  let winner: TripFundingCandidate | null = null;
  for (const candidate of candidates) {
    if (!winner || candidate.debit < winner.debit) winner = candidate;
  }

  // Monthly earn for the funding source program from attributed spending.
  const warnings: string[] = [];
  let monthlyEarn: number | null = null;
  let currencyLabel: "points" | "miles" | null = null;

  if (winner) {
    const earned = monthlyEarnForProgram(context, winner.sourceProgramId, warnings);
    monthlyEarn = earned.monthly;
    currencyLabel = earned.currency;
  }

  if (!winner) {
    warnings.push(GOAL_FUNDING_TIMELINE_WARNING_NO_FUNDING);
    return {
      schemaVersion: 1,
      label: GOAL_FUNDING_TIMELINE_LABEL,
      status: "no_path",
      monthlyEarn,
      currencyLabel,
      sourceProgramName: null,
      monthsToGoal: null,
      warnings: Array.from(new Set(warnings)).slice(0, MAX_WARNINGS),
      disclosure: GOAL_FUNDING_TIMELINE_DISCLOSURE,
    };
  }

  if (winner.balance >= winner.debit) {
    return {
      schemaVersion: 1,
      label: GOAL_FUNDING_TIMELINE_LABEL,
      status: "covered",
      monthlyEarn,
      currencyLabel,
      sourceProgramName: winner.programName,
      monthsToGoal: null,
      warnings: Array.from(new Set(warnings)).slice(0, MAX_WARNINGS),
      disclosure: GOAL_FUNDING_TIMELINE_DISCLOSURE,
    };
  }

  // A gap exists: a timeline requires a positive verified monthly earn.
  if (monthlyEarn === null || monthlyEarn <= 0) {
    if (!warnings.some((w) => w === GOAL_FUNDING_TIMELINE_WARNING_MIXED_CURRENCY)) {
      warnings.push(GOAL_FUNDING_TIMELINE_WARNING_NO_EARN);
    }
    return {
      schemaVersion: 1,
      label: GOAL_FUNDING_TIMELINE_LABEL,
      status: "no_path",
      monthlyEarn,
      currencyLabel,
      sourceProgramName: winner.programName,
      monthsToGoal: null,
      warnings: Array.from(new Set(warnings)).slice(0, MAX_WARNINGS),
      disclosure: GOAL_FUNDING_TIMELINE_DISCLOSURE,
    };
  }

  const gap = winner.debit - winner.balance;
  const rawMonths = Math.ceil(gap / monthlyEarn);
  if (!Number.isFinite(rawMonths) || rawMonths > MAX_MONTHS_TO_GOAL) {
    warnings.push(GOAL_FUNDING_TIMELINE_WARNING_HORIZON_CAPPED);
    return {
      schemaVersion: 1,
      label: GOAL_FUNDING_TIMELINE_LABEL,
      status: "no_path",
      monthlyEarn,
      currencyLabel,
      sourceProgramName: winner.programName,
      monthsToGoal: null,
      warnings: Array.from(new Set(warnings)).slice(0, MAX_WARNINGS),
      disclosure: GOAL_FUNDING_TIMELINE_DISCLOSURE,
    };
  }

  return {
    schemaVersion: 1,
    label: GOAL_FUNDING_TIMELINE_LABEL,
    status: "on_track",
    monthlyEarn,
    currencyLabel,
    sourceProgramName: winner.programName,
    monthsToGoal: rawMonths,
    warnings: Array.from(new Set(warnings)).slice(0, MAX_WARNINGS),
    disclosure: GOAL_FUNDING_TIMELINE_DISCLOSURE,
  };
}

// ---------------------------------------------------------------------------
// Verified monthly earn for one program (earn-plan reuse)
// ---------------------------------------------------------------------------

/**
 * Monthly points/miles for one program's own wallet cards from the customer's
 * card-attributed spending, using the earn plan's verified-rate selectors.
 * Fail-closed: cards without verified rates contribute nothing; a program
 * whose contributing cards would mix currencies contributes nothing and sets
 * the mixed-currency warning; no attribution data means no earn at all.
 */
function monthlyEarnForProgram(
  context: PersonalizedStrategyContext,
  programId: string,
  warnings: string[],
): { monthly: number | null; currency: "points" | "miles" | null } {
  const ratesByProduct = selectVerifiedPointEarnRates(context.earningRules);
  const cardSpending = Array.isArray(context.monthlySpendingByCategoryCard)
    ? context.monthlySpendingByCategoryCard
    : null;
  if (!cardSpending || cardSpending.length === 0 || ratesByProduct.size === 0) {
    return { monthly: null, currency: null };
  }

  const programIds = context.walletCardProgramIds ?? {};
  const currencyLanes = new Map<"points" | "miles", number>();
  let sawMixedCurrency = false;

  for (const card of context.walletCards) {
    if (programIds[card.id] !== programId) continue;
    if (typeof card.cardProductId !== "string" || card.cardProductId.length === 0) {
      continue;
    }
    const rates = ratesByProduct.get(card.cardProductId) ?? [];
    if (rates.length === 0) continue;
    const currencies = new Set(rates.map((rate) => rate.currency));
    if (currencies.size !== 1) {
      sawMixedCurrency = true;
      continue;
    }
    const currency = currencies.values().next().value;
    if (!currency) continue;

    let monthly = 0;
    for (const entry of cardSpending) {
      if (entry.cardId !== card.id) continue;
      if (!isNonNegativeFinite(entry.monthlyAverage)) continue;
      const canonical =
        typeof entry.category === "string"
          ? normalizeCategory(entry.category)
          : null;
      const laneRates = rates.filter((rate) => rate.currency === currency);
      monthly += monthlyPointsForCard(laneRates, [
        { category: canonical ?? "uncategorized", monthlyAverage: entry.monthlyAverage },
      ]);
    }
    if (monthly > 0) {
      currencyLanes.set(currency, (currencyLanes.get(currency) ?? 0) + monthly);
    }
  }

  if (currencyLanes.size === 0) {
    if (sawMixedCurrency) {
      warnings.push(GOAL_FUNDING_TIMELINE_WARNING_MIXED_CURRENCY);
    }
    return { monthly: null, currency: null };
  }
  if (currencyLanes.size > 1) {
    // Cards of the same program earn in different currencies; they are never
    // added together. Fail closed rather than merge.
    warnings.push(GOAL_FUNDING_TIMELINE_WARNING_MIXED_CURRENCY);
    return { monthly: null, currency: null };
  }

  const currency = currencyLanes.keys().next().value;
  if (!currency) return { monthly: null, currency: null };
  return { monthly: round2(currencyLanes.get(currency) ?? 0), currency };
}

// ---------------------------------------------------------------------------
// Strict persisted-shape re-projection (presentation boundary)
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isFixedWarning(value: unknown): boolean {
  return (
    value === GOAL_FUNDING_TIMELINE_WARNING_NO_EARN ||
    value === GOAL_FUNDING_TIMELINE_WARNING_NO_FUNDING ||
    value === GOAL_FUNDING_TIMELINE_WARNING_MIXED_CURRENCY ||
    value === GOAL_FUNDING_TIMELINE_WARNING_HORIZON_CAPPED
  );
}

/**
 * Strict re-projection of a persisted funding timeline (untrusted input).
 * Rebuilds a fresh customer-safe object, rejecting any unknown key, malformed
 * value, or unfixed warning string. Returns null when the shape cannot be
 * trusted.
 */
export function projectGoalFundingTimeline(
  value: unknown,
): GoalFundingTimeline | null {
  if (!isRecord(value)) return null;
  const allowed = new Set([
    "schemaVersion",
    "label",
    "status",
    "monthlyEarn",
    "currencyLabel",
    "sourceProgramName",
    "monthsToGoal",
    "warnings",
    "disclosure",
  ]);
  if (Object.keys(value).some((key) => !allowed.has(key))) return null;
  if (value.schemaVersion !== 1) return null;
  if (value.label !== GOAL_FUNDING_TIMELINE_LABEL) return null;
  if (
    value.status !== "covered" &&
    value.status !== "on_track" &&
    value.status !== "no_path"
  ) {
    return null;
  }
  if (
    value.monthlyEarn !== null &&
    !isNonNegativeFinite(value.monthlyEarn)
  ) {
    return null;
  }
  if (
    value.currencyLabel !== null &&
    value.currencyLabel !== "points" &&
    value.currencyLabel !== "miles"
  ) {
    return null;
  }
  if (
    value.sourceProgramName !== null &&
    (typeof value.sourceProgramName !== "string" ||
      value.sourceProgramName.trim().length === 0 ||
      value.sourceProgramName.length > 200 ||
      /(?:https?:\/\/|www\.)/i.test(value.sourceProgramName))
  ) {
    return null;
  }
  if (
    value.monthsToGoal !== null &&
    (typeof value.monthsToGoal !== "number" ||
      !Number.isInteger(value.monthsToGoal) ||
      value.monthsToGoal < 1 ||
      value.monthsToGoal > MAX_MONTHS_TO_GOAL)
  ) {
    return null;
  }
  // monthsToGoal is set only for on_track plans, and an on_track plan always
  // carries a positive verified monthly earn with its currency label (the
  // builder can never emit zero-earn on_track; a tampered row must not either).
  if ((value.status === "on_track") !== (value.monthsToGoal !== null)) {
    return null;
  }
  if (value.status === "on_track") {
    if (
      value.monthlyEarn === null ||
      value.monthlyEarn <= 0 ||
      value.currencyLabel === null
    ) {
      return null;
    }
  }
  // monthlyEarn and its currency label are always set together.
  if ((value.monthlyEarn !== null) !== (value.currencyLabel !== null)) {
    return null;
  }
  if (!Array.isArray(value.warnings)) return null;
  if (value.warnings.length > MAX_WARNINGS) return null;
  if (!value.warnings.every(isFixedWarning)) return null;
  if (value.disclosure !== GOAL_FUNDING_TIMELINE_DISCLOSURE) return null;

  return {
    schemaVersion: 1,
    label: GOAL_FUNDING_TIMELINE_LABEL,
    status: value.status,
    monthlyEarn: value.monthlyEarn,
    currencyLabel: value.currencyLabel,
    sourceProgramName: value.sourceProgramName,
    monthsToGoal: value.monthsToGoal,
    warnings: [...value.warnings],
    disclosure: value.disclosure,
  };
}
