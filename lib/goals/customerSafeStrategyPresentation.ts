import type { Goal } from "./types";
import type { CustomerVerifiedTravelOption, EarnPlanAccountProjection, PersonalizedStrategy, PublicExactCashCandidate, StrategyAllocationScenario, StrategyAwardOption, StrategyPointsInventoryItem } from "./strategyTypes";
import { projectFlightPlanningEstimate } from "./flightPlanningEstimate";
import { EARN_PLAN_LABEL, projectEarnPlan } from "./earnPlan";
import {
  TRIP_REALITY_CARD_LABEL,
  TRIP_REALITY_COPY,
} from "./tripRealityCard";
import {
  GOAL_FUNDING_TIMELINE_LABEL,
  GOAL_FUNDING_TIMELINE_WARNING_HORIZON_CAPPED,
  GOAL_FUNDING_TIMELINE_WARNING_MIXED_CURRENCY,
  GOAL_FUNDING_TIMELINE_WARNING_NO_EARN,
  GOAL_FUNDING_TIMELINE_WARNING_NO_FUNDING,
  projectGoalFundingTimeline,
} from "./goalFundingTimeline";
import {
  HOTEL_PLANNING_ESTIMATE_AVAILABILITY_LABEL,
  HOTEL_PLANNING_ESTIMATE_LABEL,
  projectHotelPlanningEstimate,
  type HotelPlanningEstimate,
  type HotelPlanningEstimateOption,
} from "./hotelPlanningEstimate";
import { buildCustomerSafeGoalSummary, safeGoalLabel, toCustomerSafeResearchLabel, type CustomerSafeGoalSummary } from "./customerSafeGoalSummary";
import { formatPersistedStrategyTimestamp } from "./customerSafeStrategyTimestamp";
import { filterCustomerSentences } from "./customerTextPolicy";
import { deterministicNarrativeCopy } from "./strategyNarrativeTrustGate";

export { type CustomerSafeGoalSummary } from "./customerSafeGoalSummary";
export interface CustomerSafeRewardAccount { key: string; programName: string; ownerType: "self" | "companion"; ownerLabel: string; balance: number | null; verificationLabel: string; originLabel: string; balanceAsOf: string; }
export interface CustomerSafeAllocation { key: string; programName: string; ownerLabel: string; ownerType: "self" | "companion" | null; fundingLabel: string | null; availablePoints: number | null; plannedPoints: number | null; remainingPoints: number | null; pointsGap: number | null; verificationLabel: string; }
export interface CustomerSafeEstimate { key: string; programName: string; redemptionLabel: string; pricingLabel: string; itineraryLabel: string | null; pointsRequired: number | null; cashFees: number | null; seats: number | null; cabin: string | null; coverageLabel: string; travelerCountCovered: number | null; nightCountCovered: number | null; evidenceLabel: "Planning estimate" | "Observed price"; availabilityLabel: "Check current availability before acting" | "Observed result; verify before acting"; }
export interface CustomerSafeScenario { key: string; label: string; statusLabel: string; title: string; flight: CustomerSafeEstimate | null; hotel: CustomerSafeEstimate | null; flightPointsRequired: number | null; hotelPointsRequired: number | null; travelerCount: number | null; tripNights: number | null; allocations: CustomerSafeAllocation[]; assumptions: string[]; warnings: string[]; }
export interface CustomerSafeAction { key: string; priority: number | null; title: string; explanation: string; deadline: string | null; }
export interface CustomerSafeAlternative { key: string; title: string; tradeoff: string; }
export interface CustomerSafeExactCashOption { key: string; kind: "flight" | "hotel"; sourceLabel: string; evidenceLabel: "Exact cash quote"; priceLabel: string; taxesLabel: string | null; datesLabel: string | null; coverageLabel: string; cancellationLabel: string | null; baggageLabel: string | null; unknownCount: number; }
export interface CustomerSafeVerifiedOption { key: string; kind: "flight" | "hotel"; summary: string; confirmedAtLabel: string | null; evidenceLabel: "Customer verified"; unknownCount: number; }
export interface CustomerSafeFlightPlanningEstimate { label: "Flight planning estimate"; route: string; dates: string; travelersLabel: string; cabin: string; priceLabel: string; retrievedAt: string; segments: string[]; unknowns: string[]; evidenceLabel: "Planning estimate"; verificationLabel: "Not customer-verified"; availabilityLabel: "Not live or bookable; verify before booking"; }
export interface CustomerSafeHotelPlanningEstimateOption { key: string; propertyName: string; nightlyPriceLabel: string | null; totalPriceLabel: string | null; ratingLabel: string | null; hotelClassLabel: string | null; neighborhoodLabel: string | null; amenities: string[]; trustStatusLabel: string; propertyUrl: string | null; imageUrl: string | null; }
export interface CustomerSafeHotelPlanningEstimate { label: typeof HOTEL_PLANNING_ESTIMATE_LABEL; destination: string; dates: string; nights: number; travelersLabel: string; currencyLabel: string | null; options: CustomerSafeHotelPlanningEstimateOption[]; disclosure: string; evidenceLabel: string; verificationLabel: string; availabilityLabel: string; }
export interface CustomerSafeEarnPlanAccount { key: string; programName: string; ownerLabel: string; currencyLabel: string; balanceLabel: string; monthlyLabel: string | null; projectedLabel: string | null; horizonCapped: boolean; contributingCardsLabel: string | null; }
export interface CustomerSafeEarnPlan { label: typeof EARN_PLAN_LABEL; disclosure: string; accounts: CustomerSafeEarnPlanAccount[]; tripCashLabel: string | null; cashGapLabel: string | null; warnings: string[]; }
export interface CustomerSafeTripRealityCash { status: "available" | "unavailable"; amountLabel: string | null; travelersLabel: string | null; }
export interface CustomerSafeTripRealityPoints { status: "available" | "unavailable"; pointsLabel: string | null; programName: string | null; pricingLabel: "One way" | "Round trip" | null; feesLabel: string | null; programCount: number; unavailableReason: string | null; }
export interface CustomerSafeTripRealityFunding { status: "covered" | "gap" | "unknown"; statusLabel: string; bestPointsLabel: string | null; surplusLabel: string | null; programName: string | null; }
export interface CustomerSafeTripRealityBestCard { status: "available"; cardName: string; monthlyLabel: string | null; comparisonLabel: string | null; }
export interface CustomerSafeTripRealityCard { schemaVersion: 1; label: typeof TRIP_REALITY_CARD_LABEL; disclosure: string; cash: CustomerSafeTripRealityCash; points: CustomerSafeTripRealityPoints; funding: CustomerSafeTripRealityFunding | null; bestCard: CustomerSafeTripRealityBestCard | null; bestCardHint: string | null; warnings: string[]; }

export interface CustomerSafeGoalFundingTimeline {
  label: typeof GOAL_FUNDING_TIMELINE_LABEL;
  /** Fixed status copy; composed here from the validated status enum. */
  statusLabel: string;
  /** Fixed earn-rate sentence, when a verified monthly earn exists. */
  earnLabel: string | null;
  /** Fixed timeline sentence, when an on-track months-to-goal exists. */
  timelineLabel: string | null;
  /** The funding source program's display name, when a funding path exists. */
  sourceProgramName: string | null;
  disclosure: string;
  warnings: string[];
}
export interface CustomerSafeStrategyPresentation { goal: CustomerSafeGoalSummary; strategy: { headline: string; summary: string; actions: CustomerSafeAction[] }; rewards: { confirmedCount: number; needsConfirmationCount: number; pathCount: number; summary: string; verified: CustomerSafeRewardAccount[]; unverified: CustomerSafeRewardAccount[]; scenarios: CustomerSafeScenario[] }; flightEstimates: CustomerSafeEstimate[]; flightPlanningEstimate: CustomerSafeFlightPlanningEstimate | null; hotelPlanningEstimate: CustomerSafeHotelPlanningEstimate | null; hotelEstimates: CustomerSafeEstimate[]; currentCash: CustomerSafeExactCashOption[]; customerVerified: CustomerSafeVerifiedOption[]; alternatives: CustomerSafeAlternative[]; details: { assumptions: string[]; warnings: string[]; unknowns: string[]; evidenceLabels: string[] };  refinementTopics: string[]; lastResearched: string | null; lastResearchedLabel: string | null; earnPlan: CustomerSafeEarnPlan | null; tripRealityCard: CustomerSafeTripRealityCard | null; goalFundingTimeline: CustomerSafeGoalFundingTimeline | null; }
export const CUSTOMER_SAFE_MAX_ESTIMATES = 3;
export const CUSTOMER_SAFE_MAX_ALTERNATIVES = 2;

const pricingLabels: Record<string, string> = { one_way: "One way", round_trip: "Round trip", per_night: "Per night", total_stay: "Total stay", unknown: "Pricing basis not confirmed" };
const coverageLabels: Record<string, string> = { source_explicit: "Coverage stated by the research source", standard_assumption: "Uses a planning assumption", unknown: "Coverage not confirmed" };
const fundingLabels: Record<string, string> = { direct_program: "Use this confirmed rewards account", transfer_source: "Potential transfer path" };
const statusLabels: Record<string, string> = { gap: "We don’t see a confirmed rewards balance that can fund this option.", conditional: "Conditional planning scenario", insufficient_information: "We can’t work out the full points requirement yet." };
const cabinLabels: Record<string, string> = { economy: "Economy", premium_economy: "Premium economy", business: "Business", first: "First class", flexible: "Flexible" };

/** Fixed trust labels for earn-plan balances; never provider- or model-authored. */
const earnPlanBalanceLabels: Record<EarnPlanAccountProjection["balanceVerification"], string> = {
  verified: "Confirmed rewards balance",
  unverified: "Balance needs confirmation",
  no_account: "No rewards account recorded",
};

function safeText(value: unknown, fallback = ""): string {
  if (typeof value !== "string") return fallback;
  return filterCustomerSentences(value) || fallback;
}

/**
 * A "feasible" scenario status only proves points-arithmetic coverage, never
 * trip-level feasibility. Label it by what is actually proven: the verified
 * balance could cover the benchmark (or the structured option).
 */
function scenarioStatusLabel(
  value: StrategyAllocationScenario,
  flights: StrategyAwardOption[],
  hotels: StrategyAwardOption[],
): string {
  if (value.status !== "feasible") {
    return label(statusLabels, value.status, "More information needed");
  }
  const ids = [value.flightOptionId, value.hotelOptionId].filter(
    (id): id is string => id !== null,
  );
  const referenced = ids.flatMap((id) =>
    [...flights, ...hotels].filter((option) => option.id === id),
  );
  const allBenchmark = referenced.every(
    (option) =>
      (option.evidenceLevel ?? "planning_benchmark") === "planning_benchmark",
  );
  return allBenchmark
    ? "Points balance could cover this benchmark"
    : "Points balance could cover this option";
}
function safeList(values: readonly unknown[] | undefined): string[] { return (values ?? []).map((value) => safeText(value)).filter(Boolean); }
function safeDateLabel(value: unknown): string | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  return new Intl.DateTimeFormat("en-US", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" }).format(parsed);
}
function safeCurrencyLabel(value: unknown): string | null {
  return typeof value === "string" && /^[A-Za-z]{3}$/.test(value.trim()) ? value.trim().toUpperCase() : null;
}
function safeCashOption(candidate: PublicExactCashCandidate, index: number): CustomerSafeExactCashOption {
  const departure = safeDateLabel(candidate.search.departureDate);
  const returned = safeDateLabel(candidate.search.returnDate);
  const datesLabel = departure && returned ? `${departure} – ${returned}` : (departure ?? returned);
  const coverageParts = [
    candidate.coverage.travelerCount !== null ? `${candidate.coverage.travelerCount} ${candidate.coverage.travelerCount === 1 ? "traveler" : "travelers"}` : null,
    candidate.coverage.nightCount !== null ? `${candidate.coverage.nightCount} ${candidate.coverage.nightCount === 1 ? "night" : "nights"}` : null,
    candidate.coverage.roomCount !== null ? `${candidate.coverage.roomCount} ${candidate.coverage.roomCount === 1 ? "room" : "rooms"}` : null,
  ].filter((part): part is string => part !== null);
  const currency = safeCurrencyLabel(candidate.price.currency);
  const total = nonNegative(candidate.price.total);
  const priceLabel = currency !== null && total !== null ? `${currency} ${total.toLocaleString("en-US")} total` : "Total not confirmed";
  const taxes = nonNegative(candidate.price.taxes);
  const taxesLabel = currency !== null && taxes !== null ? `Taxes and fees: ${currency} ${taxes.toLocaleString("en-US")}` : null;
  return {
    key: `cash-${index + 1}`,
    kind: candidate.kind,
    sourceLabel: safeText(candidate.sourceLabel) || "Exact cash quote",
    evidenceLabel: "Exact cash quote",
    priceLabel,
    taxesLabel,
    datesLabel: datesLabel ? safeText(datesLabel) || null : null,
    coverageLabel: coverageParts.length > 0 ? coverageParts.join(" · ") : "Coverage not confirmed",
    cancellationLabel: candidate.cancellationTerms ? safeText(candidate.cancellationTerms) || null : null,
    baggageLabel: candidate.baggageTerms ? safeText(candidate.baggageTerms) || null : null,
    unknownCount: Array.isArray(candidate.unknownFields) ? candidate.unknownFields.length : 0,
  };
}
function safeVerifiedOption(option: CustomerVerifiedTravelOption, index: number): CustomerSafeVerifiedOption {
  const confirmed = typeof option.confirmedAt === "string" ? option.confirmedAt.slice(0, 10) : null;
  return {
    key: `verified-${index + 1}`,
    kind: option.kind,
    summary: safeText(option.summary) || "Customer-verified option",
    confirmedAtLabel: confirmed ? safeDateLabel(confirmed) : null,
    evidenceLabel: "Customer verified",
    unknownCount: Array.isArray(option.unknownFields) ? option.unknownFields.length : 0,
  };
}
function timestamp(value: unknown): string | null { if (typeof value !== "string") return null; const parsed = new Date(value); return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString(); }
function label(map: Record<string, string>, value: unknown, fallback: string): string { return typeof value === "string" && map[value] ? map[value] : fallback; }
function finite(value: unknown): number | null { return typeof value === "number" && Number.isFinite(value) ? value : null; }
function nonNegative(value: unknown): number | null { const result = finite(value); return result !== null && result >= 0 ? result : null; }
function nonNegativeInteger(value: unknown): number | null { const result = nonNegative(value); return result !== null && Number.isInteger(result) ? result : null; }
function estimate(
  option: StrategyAwardOption | undefined,
  key: string,
): CustomerSafeEstimate | null {
  if (!option) return null;
  // Observed-price options carry their own fixed evidence labels; every other
  // tier keeps the established planning-estimate wording. Legacy options
  // without an evidence level default to the planning label unchanged.
  const observed = option.evidenceLevel === "web_observed_not_live";
  return {
    key,
    programName: toCustomerSafeResearchLabel(option.programName, "Reward program"),
    redemptionLabel:
      option.redemptionType === "flight"
        ? "Flight"
        : option.redemptionType === "hotel"
          ? "Hotel"
          : "Travel option",
    pricingLabel: label(pricingLabels, option.pricingBasis, "Pricing basis not confirmed"),
    itineraryLabel: option.itineraryLabel
      ? toCustomerSafeResearchLabel(option.itineraryLabel, "") || null
      : null,
    pointsRequired: nonNegativeInteger(option.pointsRequired),
    cashFees: nonNegative(option.cashFees),
    seats: nonNegativeInteger(option.seats),
    cabin: option.cabin ? label(cabinLabels, option.cabin, "Cabin preference saved") : null,
    coverageLabel: label(coverageLabels, option.coverageStatus, "Coverage not confirmed"),
    travelerCountCovered: nonNegativeInteger(option.travelerCountCovered),
    nightCountCovered: nonNegativeInteger(option.nightCountCovered),
    evidenceLabel: observed ? "Observed price" : "Planning estimate",
    availabilityLabel: observed
      ? "Observed result; verify before acting"
      : "Check current availability before acting",
  };
}

/** Fixed per-trust-status labels; never provider- or model-authored. */
const hotelTrustStatusLabels: Record<HotelPlanningEstimateOption["trustStatus"], string> = { search_estimate: "Search estimate only; verify current price and availability", price_unavailable: "Price not confirmed" };

/**
 * Re-projects the persisted earn plan through the strict validator and
 * rebuilds a customer-safe view. A rejected plan becomes null entirely — the
 * same fail-closed convention as the flight and hotel planning estimates.
 * Monthly and projected amounts stay in the program's native points/miles
 * unit with the program's label; no cash value is ever assigned to points.
 */
function buildCustomerSafeEarnPlan(raw: unknown): CustomerSafeEarnPlan | null {
  const plan = projectEarnPlan(raw);
  if (!plan) return null;
  const monthlyLabel = (account: EarnPlanAccountProjection): string | null =>
    account.monthlyPoints > 0
      ? `~${Math.round(account.monthlyPoints).toLocaleString("en-US")} ${account.rewardCurrencyLabel === "miles" ? "miles" : "points"}/month`
      : null;
  const projectedLabel = (account: EarnPlanAccountProjection): string | null =>
    account.projectedBalance !== null && account.monthsProjected !== null
      ? `~${Math.round(account.projectedBalance).toLocaleString("en-US")} by departure (${account.monthsProjected} ${account.monthsProjected === 1 ? "month" : "months"})`
      : null;
  return {
    label: EARN_PLAN_LABEL,
    disclosure: plan.disclosure,
    accounts: plan.accounts.map((account) => ({
      key: account.key,
      programName: toCustomerSafeResearchLabel(account.programName, "Reward program"),
      ownerLabel: safeGoalLabel(account.ownerLabel, account.ownerType === "self" ? "You" : "Companion"),
      currencyLabel: account.rewardCurrencyLabel === "miles" ? "miles" : "points",
      balanceLabel: `${Math.round(account.currentBalance).toLocaleString("en-US")} ${account.rewardCurrencyLabel === "miles" ? "miles" : "points"} · ${earnPlanBalanceLabels[account.balanceVerification]}`,
      monthlyLabel: monthlyLabel(account),
      projectedLabel: projectedLabel(account),
      horizonCapped: account.horizonCapped,
      contributingCardsLabel:
        account.cardNames.length > 0 ? account.cardNames.join(", ") : null,
    })),
    tripCashLabel:
      plan.tripCash !== null
        ? `Searched trip total: ${plan.tripCash.currency} ${plan.tripCash.amount.toLocaleString("en-US")}`
        : null,
    cashGapLabel:
      plan.cashGap !== null
        ? plan.cashGap.remaining >= 0
          ? `Cash budget remaining after searched trip total: ${plan.cashGap.currency} ${plan.cashGap.remaining.toLocaleString("en-US")}`
          : `Searched trip total exceeds your cash budget by ${plan.cashGap.currency} ${Math.abs(plan.cashGap.remaining).toLocaleString("en-US")}`
        : null,
    warnings: plan.warnings.map((warning) => safeText(warning)).filter(Boolean),
  };
}

/**
 * Re-projects the persisted hotel planning estimate through the strict hotel
 * projector and rebuilds a customer-safe view. Any value that fails its
 * validation becomes null; a rejected estimate becomes null entirely — the
 * same fail-closed convention as the flight planning estimate.
 */
function buildCustomerSafeHotelPlanningEstimate(raw: unknown): CustomerSafeHotelPlanningEstimate | null {
  const estimate = projectHotelPlanningEstimate(raw);
  if (!estimate) return null;
  const optionView = (option: HotelPlanningEstimateOption, index: number): CustomerSafeHotelPlanningEstimateOption => ({
    key: `hotel-estimate-option-${index + 1}`,
    propertyName: option.propertyName,
    nightlyPriceLabel: option.nightlyPrice !== null && option.nightlyPriceCurrency !== null
      ? `${option.nightlyPriceCurrency} ${option.nightlyPrice.toLocaleString("en-US")} per night`
      : null,
    totalPriceLabel: option.totalPrice !== null && option.totalPriceCurrency !== null
      ? `${option.totalPriceCurrency} ${option.totalPrice.toLocaleString("en-US")} total stay`
      : null,
    ratingLabel: option.rating !== null && option.reviewCount !== null
      ? `${option.rating.toLocaleString("en-US")} (${option.reviewCount.toLocaleString("en-US")} reviews)`
      : null,
    hotelClassLabel: option.hotelClass !== null ? `${option.hotelClass}-star` : null,
    neighborhoodLabel: option.neighborhood !== null ? safeText(option.neighborhood) || null : null,
    amenities: option.amenities.map((item) => safeText(item)).filter(Boolean).slice(0, 12),
    trustStatusLabel: hotelTrustStatusLabels[option.trustStatus],
    propertyUrl: option.propertyUrl,
    imageUrl: option.imageUrl,
  });
  return {
    label: HOTEL_PLANNING_ESTIMATE_LABEL,
    destination: estimate.destination,
    dates: `${estimate.checkInDate} – ${estimate.checkOutDate}`,
    nights: estimate.nights,
    travelersLabel: `${estimate.travelers} ${estimate.travelers === 1 ? "traveler" : "travelers"}`,
    currencyLabel: safeCurrencyLabel(estimate.currency),
    options: estimate.options.slice(0, CUSTOMER_SAFE_MAX_ESTIMATES).map(optionView),
    disclosure: estimate.disclosure,
    evidenceLabel: estimate.evidenceLabel,
    verificationLabel: estimate.verificationLabel,
    availabilityLabel: HOTEL_PLANNING_ESTIMATE_AVAILABILITY_LABEL,
  };
}

/**
 * Re-projects the persisted Trip Reality Card through a strict allowlist
 * validator (flight/hotel/earn-plan convention): any hostile or malformed
 * value rejects the whole side to `null`, an unknown schema rejects the whole
 * card, and every customer-facing string is rebuilt from fixed server-owned
 * copy — never from the persisted object's own text fields.
 */
function buildCustomerSafeTripRealityCard(raw: unknown): CustomerSafeTripRealityCard | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const card = raw as Record<string, unknown>;
  if (card.schemaVersion !== 1) return null;
  if (card.label !== TRIP_REALITY_CARD_LABEL) return null;
  const ALLOWED_KEYS = new Set(["schemaVersion", "label", "disclosure", "cash", "points", "funding", "bestCard", "warnings"]);
  if (!Object.keys(card).every((key) => ALLOWED_KEYS.has(key))) return null;
  const num = (value: unknown): number | null => {
    if (typeof value !== "number" || !Number.isFinite(value)) return null;
    return value;
  };
  const nonNegInt = (value: unknown): number | null => {
    const result = num(value);
    return result !== null && Number.isInteger(result) && result >= 0 ? result : null;
  };
  const posInt = (value: unknown): number | null => {
    const result = nonNegInt(value);
    return result !== null && result > 0 ? result : null;
  };
  const bounded = (value: unknown, max: number): string | null =>
    typeof value === "string" && value.length > 0 && value.length <= max ? value : null;

  // Warnings: fixed-copy allowlist only. Any non-member string rejects to []
  // (a model- or provider-authored string can never surface as a warning).
  const FIXED_WARNINGS = new Set([
    TRIP_REALITY_COPY.feesUnconfirmed,
    "Card earnings for this trip could not be projected from verified card rates.",
  ]);
  let warnings: string[] = [];
  if (Array.isArray(card.warnings)) {
    const candidates = card.warnings as unknown[];
    if (candidates.length > 4 || candidates.some((item) => !FIXED_WARNINGS.has(item as string))) return null;
    warnings = candidates as string[];
  }

  // Cash side: the searched party-total. Present-but-invalid rejects to
  // unavailable status with no figures rather than to a fabricated value.
  let cashView: CustomerSafeTripRealityCash = { status: "unavailable", amountLabel: null, travelersLabel: null };
  if (card.cash !== null && card.cash !== undefined) {
    if (typeof card.cash !== "object" || Array.isArray(card.cash)) return null;
    const cash = card.cash as Record<string, unknown>;
    if (!Object.keys(cash).every((key) => ["status", "amount", "currency", "travelers"].includes(key))) return null;
    if (cash.status === "available") {
      const amount = num(cash.amount);
      const travelers = posInt(cash.travelers);
      const currency = bounded(cash.currency, 3);
      if (amount === null || amount <= 0 || travelers === null || currency === null || !/^[A-Za-z]{3}$/.test(currency)) return null;
      cashView = {
        status: "available",
        amountLabel: `${currency.toUpperCase()} ${amount.toLocaleString("en-US")} total`,
        travelersLabel: `${travelers} ${travelers === 1 ? "traveler" : "travelers"} · searched-party total`,
      };
    } else if (cash.status !== "unavailable") {
      return null;
    }
  }

  // Points side: the goal-scaled party requirement.
  let pointsView: CustomerSafeTripRealityPoints = { status: "unavailable", pointsLabel: null, programName: null, pricingLabel: null, feesLabel: null, programCount: 0, unavailableReason: null };
  if (card.points !== null && card.points !== undefined) {
    if (typeof card.points !== "object" || Array.isArray(card.points)) return null;
    const points = card.points as Record<string, unknown>;
    if (!Object.keys(points).every((key) => ["status", "pointsRequired", "programName", "pricingBasis", "fees", "programCount", "unavailableReason"].includes(key))) return null;
    if (points.status === "unavailable") {
      // Fixed copy only: the reason must be a known server-owned string.
      const reason = points.unavailableReason;
      if (reason !== TRIP_REALITY_COPY.pointsUnavailableNoCoverage) return null;
      pointsView = { status: "unavailable", pointsLabel: null, programName: null, pricingLabel: null, feesLabel: null, programCount: 0, unavailableReason: reason };
    } else if (points.status === "available") {
      const required = posInt(points.pointsRequired);
      const programName = bounded(points.programName, 80);
      const programCount = nonNegInt(points.programCount);
      const pricingBasis = points.pricingBasis;
      if (required === null || programName === null || programCount === null || (pricingBasis !== "one_way" && pricingBasis !== "round_trip")) return null;
      let feesLabel: string | null = null;
      if (points.fees !== null) {
        const fees = nonNegInt(points.fees);
        if (fees === null) return null;
        feesLabel = `${fees.toLocaleString("en-US")} points in fees noted by the source`;
      }
      pointsView = {
        status: "available",
        pointsLabel: `~${required.toLocaleString("en-US")} points`,
        programName: toCustomerSafeResearchLabel(programName, "Reward program"),
        pricingLabel: pricingBasis === "round_trip" ? "Round trip" : "One way",
        feesLabel,
        programCount,
        unavailableReason: null,
      };
    } else if (points.status !== "unavailable") {
      return null;
    }
  }

  // Funding side: bounded enum status, rebuilt from fixed copy.
  let fundingView: CustomerSafeTripRealityFunding | null = null;
  if (card.funding !== null && card.funding !== undefined) {
    if (typeof card.funding !== "object" || Array.isArray(card.funding)) return null;
    const funding = card.funding as Record<string, unknown>;
    if (!Object.keys(funding).every((key) => ["status", "bestPointsRequired", "verifiedSurplus", "programName"].includes(key))) return null;
    const status = funding.status;
    if (status !== "covered" && status !== "gap" && status !== "unknown") return null;
    const fixedLabel =
      status === "covered"
        ? TRIP_REALITY_COPY.fundingCovered
        : status === "gap"
          ? TRIP_REALITY_COPY.fundingGap
          : TRIP_REALITY_COPY.fundingUnknown;
    const best = nonNegInt(funding.bestPointsRequired);
    // Program names are provider-independent free text: sanitize through the
    // shared research-label sanitizer (URLs, control characters, internal
    // references, and pipeline terms fall back to fixed copy), never through
    // a raw string pass-through.
    const programName = funding.programName === null ? null : toCustomerSafeResearchLabel(funding.programName, "Reward program");
    let surplusLabel: string | null = null;
    if (funding.verifiedSurplus !== null && funding.verifiedSurplus !== undefined) {
      const surplus = num(funding.verifiedSurplus);
      if (surplus === null) return null;
      surplusLabel = surplus >= 0
        ? `${Math.round(surplus).toLocaleString("en-US")} points to spare after booking`
        : `${Math.abs(Math.round(surplus)).toLocaleString("en-US")} more points needed`;
    }
    fundingView = {
      status,
      statusLabel: fixedLabel,
      bestPointsLabel: best !== null ? `Best planning path: ~${best.toLocaleString("en-US")} points` : null,
      surplusLabel,
      programName,
    };
  }

  // Best-card side: fixed shape, bounded strings, computed labels.
  let bestCardView: CustomerSafeTripRealityBestCard | null = null;
  let bestCardHint: string | null = null;
  if (card.bestCard !== null && card.bestCard !== undefined) {
    if (typeof card.bestCard !== "object" || Array.isArray(card.bestCard)) return null;
    const bestCard = card.bestCard as Record<string, unknown>;
    if (!Object.keys(bestCard).every((key) => ["status", "cardId", "cardName", "rate", "monthlyPoints", "nextBestMonthlyPoints", "category", "currencyLabel"].includes(key))) return null;
    if (bestCard.status !== "available") return null;
    const cardName = toCustomerSafeResearchLabel(bestCard.cardName, "Your card");
    if (cardName === "Your card" && typeof bestCard.cardName !== "string") return null;
    const monthly = posInt(bestCard.monthlyPoints);
    const rate = num(bestCard.rate);
    const currencyLabel = bestCard.currencyLabel;
    if (cardName === null || monthly === null || rate === null || rate <= 0 || rate > 100 || (currencyLabel !== "points" && currencyLabel !== "miles")) return null;
    const unit = currencyLabel === "miles" ? "miles" : "points";
    let comparisonLabel: string | null = null;
    if (bestCard.nextBestMonthlyPoints !== null) {
      const nextBest = posInt(bestCard.nextBestMonthlyPoints);
      if (nextBest === null) return null;
      comparisonLabel = monthly > nextBest
        ? `~${Math.round(monthly - nextBest).toLocaleString("en-US")} more ${unit}/month than your next best card`
        : null;
    }
    bestCardView = {
      status: "available",
      cardName,
      monthlyLabel: `~${monthly.toLocaleString("en-US")} ${unit}/month on this trip's travel spend`,
      comparisonLabel,
    };
  } else {
    bestCardHint = TRIP_REALITY_COPY.bestCardUnavailable;
  }

  return {
    schemaVersion: 1,
    label: TRIP_REALITY_CARD_LABEL,
    disclosure: TRIP_REALITY_COPY.disclosure,
    cash: cashView,
    points: pointsView,
    funding: fundingView,
    bestCard: bestCardView,
    bestCardHint,
    warnings,
  };
}

/**
 * Customer-safe funding timeline view. The persisted timeline is re-validated
 * through its strict projector; every sentence is composed here from fixed
 * templates and the validated numbers, never from persisted free text. The
 * source program name is sanitized through the shared research-label
 * sanitizer like every other program name.
 */
const buildCustomerSafeGoalFundingTimeline = (raw: unknown): CustomerSafeGoalFundingTimeline | null => {
  const timeline = projectGoalFundingTimeline(raw);
  if (!timeline) return null;
  const statusLabels: Record<string, string> = {
    covered: "Your confirmed balances could cover this today",
    no_path: "No confirmed funding path to project yet",
    on_track: "Your confirmed balances are on track to cover this",
  };
  const statusLabel = statusLabels[timeline.status] ?? "Funding timeline not confirmed";
  const unit = timeline.currencyLabel === "miles" ? "miles" : "points";
  const earnLabel =
    timeline.monthlyEarn !== null && timeline.monthlyEarn > 0
      ? `Earning about ${Math.round(timeline.monthlyEarn).toLocaleString("en-US")} ${unit}/month from your cards' verified rates`
      : null;
  const timelineLabel =
    timeline.monthsToGoal !== null && timeline.monthlyEarn !== null
      ? `${timeline.monthsToGoal} ${timeline.monthsToGoal === 1 ? "month" : "months"} of earning at this rate covers the remaining gap`
      : null;
  const programName =
    timeline.sourceProgramName === null
      ? null
      : toCustomerSafeResearchLabel(timeline.sourceProgramName, "Reward program");
  return {
    label: GOAL_FUNDING_TIMELINE_LABEL,
    statusLabel,
    earnLabel,
    timelineLabel,
    sourceProgramName: programName,
    disclosure: timeline.disclosure,
    warnings: [...timeline.warnings],
  };
};

export function buildCustomerSafeStrategyPresentation(goal: Goal, strategy: PersonalizedStrategy, generatedAt: string | null = null): CustomerSafeStrategyPresentation {
  const flights = strategy.flightOptions ?? []; const hotels = strategy.hotelOptions ?? []; const inventory = strategy.pointsInventory ?? [];
  const safeAccount = (item: StrategyPointsInventoryItem, index: number): CustomerSafeRewardAccount => ({ key: `account-${index + 1}`, programName: toCustomerSafeResearchLabel(item.programName, "Reward program"), ownerType: item.ownerType, ownerLabel: safeGoalLabel(item.ownerLabel, item.ownerType === "self" ? "You" : "Companion"), balance: nonNegative(item.balance), verificationLabel: item.verificationStatus === "verified" ? "Confirmed rewards balance" : "Balance needs confirmation", originLabel: item.origin === "connected" ? "Connected account" : item.origin === "manual" ? "Manually entered" : "Evidence-backed", balanceAsOf: safeGoalLabel(item.balanceAsOf) });
  const safeAccounts = inventory.map(safeAccount); const safeByRawAccount = new Map(inventory.map((item, index) => [item.accountId, safeAccounts[index]]));
  const safeScenario = (value: StrategyAllocationScenario, index: number): CustomerSafeScenario => ({ key: `scenario-${index + 1}`, label: value.kind === "balanced" ? "Balanced points planning" : value.kind === "flight_first" ? "Flight-first points planning" : value.kind === "hotel_first" ? "Hotel-first points planning" : "Planning path", statusLabel: scenarioStatusLabel(value, flights, hotels), title: safeText(value.title, "Planning path"), flight: value.flightOptionId ? estimate(flights.find((item) => item.id === value.flightOptionId), `scenario-${index + 1}-flight`) : null, hotel: value.hotelOptionId ? estimate(hotels.find((item) => item.id === value.hotelOptionId), `scenario-${index + 1}-hotel`) : null, flightPointsRequired: nonNegativeInteger(value.flightPointsRequired), hotelPointsRequired: nonNegativeInteger(value.hotelPointsRequired), travelerCount: nonNegativeInteger(value.travelerCount), tripNights: nonNegativeInteger(value.tripNights), allocations: (value.allocations ?? []).map((raw, allocationIndex) => { const account = safeByRawAccount.get(raw.accountId); if (!account) return { key: `allocation-${index + 1}-${allocationIndex + 1}`, programName: "Rewards account not confirmed", ownerLabel: "Rewards account not confirmed", ownerType: null, fundingLabel: null, availablePoints: null, plannedPoints: null, remainingPoints: null, pointsGap: null, verificationLabel: "Rewards account not confirmed" }; return { key: `allocation-${index + 1}-${allocationIndex + 1}`, programName: toCustomerSafeResearchLabel(account.programName, "Reward program"), ownerLabel: account.ownerLabel, ownerType: account.ownerType, fundingLabel: label(fundingLabels, raw.fundingMethod, "Funding method not confirmed"), availablePoints: account.balance, plannedPoints: nonNegativeInteger(raw.plannedPoints), remainingPoints: nonNegativeInteger(raw.remainingPoints), pointsGap: nonNegativeInteger(raw.pointsGap), verificationLabel: account.verificationLabel }; }), assumptions: safeList(value.assumptions), warnings: safeList(value.warnings) });
  const assumptions = safeList(strategy.assumptions); const warnings = safeList(strategy.warnings); const confirmed = safeAccounts.filter((item) => item.verificationLabel === "Confirmed rewards balance"); const needs = safeAccounts.filter((item) => item.verificationLabel !== "Confirmed rewards balance"); const scenarios = (strategy.allocationScenarios ?? []).map(safeScenario); const goalSummary = buildCustomerSafeGoalSummary(goal);
  // Deterministic evidence gate (defense in depth). Model-authored narrative
  // is suppressed in EVERY evidence state until claims are bound to specific
  // supporting evidence. The classification only selects the fixed server-owned
  // copy variant; structured exact-cash and customer-verified lanes are
  // projected separately with their own evidence labels.
  const narrativeCopy = deterministicNarrativeCopy({
    flightOptions: flights,
    hotelOptions: hotels,
    currentCashOptions: strategy.currentCashOptions,
    customerVerifiedOptions: strategy.customerVerifiedOptions,
  });
  const currentCash = (strategy.currentCashOptions ?? []).map(safeCashOption);
  const customerVerified = (strategy.customerVerifiedOptions ?? []).map(safeVerifiedOption);
  const planning = projectFlightPlanningEstimate(strategy.flightPlanningEstimate);
  const flightPlanningEstimate: CustomerSafeFlightPlanningEstimate | null = planning ? { label: "Flight planning estimate", route: `${planning.origin} → ${planning.destination}`, dates: `${planning.outboundDate} – ${planning.returnDate}`, travelersLabel: `${planning.travelers} ${planning.travelers === 1 ? "traveler" : "travelers"} · searched-party total`, cabin: label(cabinLabels, planning.cabin, "Cabin not confirmed"), priceLabel: `${safeCurrencyLabel(planning.currency) ?? "Currency not confirmed"} ${planning.total.toLocaleString("en-US")} total`, retrievedAt: timestamp(planning.retrievedAt) ?? "Retrieval time not confirmed", segments: [...planning.outboundSegments, ...planning.returnSegments].map((item) => { const identity = [item.marketingCarrier, item.marketingFlightNumber].filter((part) => typeof part === "string" && part.length > 0).join(" "); return `${item.departureAirport} ${item.departureTime} → ${item.arrivalAirport} ${item.arrivalTime}${identity ? ` · ${identity}` : ""}`; }).slice(0, 16), unknowns: planning.unknowns.filter((item) => safeText(item)), evidenceLabel: "Planning estimate", verificationLabel: "Not customer-verified", availabilityLabel: "Not live or bookable; verify before booking" } : null;
  // The signed hotel-stage estimate is re-projected through the strict hotel
  // projector at the presentation boundary: any value that no longer validates
  // becomes null rather than reaching the customer (flight-estimate
  // convention).
  const hotelPlanningEstimate = buildCustomerSafeHotelPlanningEstimate(strategy.hotelPlanningEstimate);
  // The deterministic earn plan is re-projected through the strict validator
  // at the presentation boundary (flight/hotel-estimate convention): an
  // untrusted or malformed persisted plan becomes null, never a customer
  // figure. Build the typed view first so the interface field type flows.
  const earnPlan = buildCustomerSafeEarnPlan(strategy.earnPlan);
  // The Trip Reality Card is re-projected through its strict allowlist
  // validator at the presentation boundary (earn-plan convention): an
  // untrusted or malformed persisted card becomes null, never a customer
  // figure.
  const tripRealityCard = buildCustomerSafeTripRealityCard(strategy.tripRealityCard);
  // The deterministic funding timeline is re-projected through its strict
  // validator at the presentation boundary (earn-plan convention): an
  // untrusted or malformed persisted timeline becomes null, never a customer
  // figure.
  const goalFundingTimeline = buildCustomerSafeGoalFundingTimeline(strategy.goalFundingTimeline);
  const presentation: CustomerSafeStrategyPresentation = { goal: goalSummary, strategy: { headline: narrativeCopy.headline, summary: narrativeCopy.summary, actions: [] }, rewards: { confirmedCount: confirmed.length, needsConfirmationCount: needs.length, pathCount: scenarios.length, summary: `${confirmed.length} confirmed rewards account${confirmed.length === 1 ? "" : "s"}, ${needs.length} balance${needs.length === 1 ? "" : "s"} needing confirmation, and ${scenarios.length} planning path${scenarios.length === 1 ? "" : "s"}. Accounts and programs remain separate.`, verified: confirmed, unverified: needs, scenarios }, flightEstimates: flights.slice(0, CUSTOMER_SAFE_MAX_ESTIMATES).map((item, index) => estimate(item, `flight-estimate-${index + 1}`)).filter((item): item is CustomerSafeEstimate => item !== null), flightPlanningEstimate, hotelPlanningEstimate, hotelEstimates: hotels.slice(0, CUSTOMER_SAFE_MAX_ESTIMATES).map((item, index) => estimate(item, `hotel-estimate-${index + 1}`)).filter((item): item is CustomerSafeEstimate => item !== null), currentCash, customerVerified, alternatives: [], details: { assumptions, warnings, unknowns: [], evidenceLabels: [...flights, ...hotels].some((item) => (item.evidenceLevel ?? "planning_benchmark") === "planning_benchmark") ? ["Planning estimate"] : [] }, refinementTopics: safeList(strategy.followUpQuestions), lastResearched: timestamp(generatedAt), lastResearchedLabel: formatPersistedStrategyTimestamp(generatedAt)?.label ?? null, earnPlan, tripRealityCard, goalFundingTimeline };
  return presentation;
}
