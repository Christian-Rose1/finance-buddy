/**
 * Server-only saved-goal-first planning for public-web travel discovery.
 *
 * This module deliberately produces queries and planning metadata only. It
 * does not inspect web results, create candidates, rank options, or make any
 * availability claim.
 */

import { OFFICIAL_DOMAINS, SPECIALIST_DOMAINS } from "./researchTypes";
import type { OptimizationPriority } from "./types";
import type {
  PlannerTransferPartner,
  ResearchPlan,
  ResearchPlanQuery,
  ResearchPlannerInput,
} from "./researchPlannerTypes";

export type TripShapeMode = "exact_confirmed" | "flexible_planning";

export type WebTravelQueryKind =
  | "cash_flight_discovery"
  | "award_flight_discovery"
  | "cash_hotel_discovery"
  | "award_hotel_discovery"
  | "program_policy_research";

export interface WebTravelTripShape {
  /** Opaque, plan-local identifier. It is never a goal or database ID. */
  id: string;
  label: string;
  mode: TripShapeMode;
  departureDate: string | null;
  returnDate: string | null;
  nightCount: number | null;
  unknownDimensions: string[];
  planningAssumptions: string[];
  exactSuppressionReasons: string[];
}

export interface WebTravelDiscoveryQuery extends ResearchPlanQuery {
  kind: WebTravelQueryKind;
  tripShapeIds: string[];
  mode: TripShapeMode;
  unknownDimensions: string[];
  planningAssumptions: string[];
  exactSuppressionReasons: string[];
}

export interface WebTravelDiscoveryPlan extends ResearchPlan {
  tripShapes: WebTravelTripShape[];
  queries: WebTravelDiscoveryQuery[];
}

/** Minimal saved-goal data allowed into deterministic public-web planning. */
export interface SavedGoalWebDiscoveryInput {
  goal: Pick<
    ResearchPlannerInput["goal"],
    | "origin"
    | "destinations"
    | "earliestDeparture"
    | "latestReturn"
    | "minimumNights"
    | "maximumNights"
    | "travelerCount"
    | "cabinPreference"
    | "optimizationPriority"
  >;
  customerRewardPrograms: Array<{ name: string }>;
  transferPartners: PlannerTransferPartner[];
}

/** Removes balances, spending, card data, and all identifiers before web planning. */
export function toSavedGoalWebDiscoveryInput(
  input: ResearchPlannerInput,
): SavedGoalWebDiscoveryInput {
  return {
    goal: {
      origin: [...input.goal.origin],
      destinations: [...input.goal.destinations],
      earliestDeparture: input.goal.earliestDeparture,
      latestReturn: input.goal.latestReturn,
      minimumNights: input.goal.minimumNights,
      maximumNights: input.goal.maximumNights,
      travelerCount: input.goal.travelerCount,
      cabinPreference: input.goal.cabinPreference,
      optimizationPriority: input.goal.optimizationPriority,
    },
    customerRewardPrograms: input.customerRewardPrograms.map((program) => ({ name: program.name })),
    transferPartners: input.transferPartners.map((partner) => ({ ...partner })),
  };
}

const MAX_TRIP_SHAPES = 3;
const MAX_QUERIES = 8;

/**
 * Saved-goal query selection profiles. These influence only research order
 * and bounded family selection; they never imply a price, transfer,
 * availability, or customer preference beyond the saved priority itself.
 */
export const SAVED_GOAL_PRIORITY_PROFILES: Record<
  OptimizationPriority,
  readonly WebTravelQueryKind[]
> = Object.freeze({
  // Compare cash first, then retain award discovery as planning context.
  lowest_cash: [
    "cash_flight_discovery",
    "cash_hotel_discovery",
    "award_flight_discovery",
    "award_hotel_discovery",
  ],
  // Explore program-backed flight and hotel possibilities before cash context.
  best_experience: [
    "award_flight_discovery",
    "award_hotel_discovery",
    "cash_flight_discovery",
    "cash_hotel_discovery",
  ],
  // Preserve normal route and destination discovery with the smallest plan.
  simplest: ["cash_flight_discovery", "cash_hotel_discovery"],
  // Keep flight and hotel cash/award discovery interleaved.
  balanced: [
    "cash_flight_discovery",
    "award_flight_discovery",
    "cash_hotel_discovery",
    "award_hotel_discovery",
  ],
});

/**
 * Persisted goal values are a runtime boundary. Only an own supported profile
 * key may select a profile; absent or legacy values use balanced coverage.
 */
export function resolveSavedGoalPriorityProfile(
  value: unknown,
): readonly WebTravelQueryKind[] {
  if (
    typeof value === "string" &&
    Object.prototype.hasOwnProperty.call(SAVED_GOAL_PRIORITY_PROFILES, value)
  ) {
    return SAVED_GOAL_PRIORITY_PROFILES[value as OptimizationPriority];
  }
  return SAVED_GOAL_PRIORITY_PROFILES.balanced;
}

function validDate(value: string | null): value is string {
  return value !== null && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

function dayAfter(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function daysBetween(start: string, end: string): number {
  return Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000);
}

function safeTerm(value: string): string | null {
  const normalized = value.trim().replace(/\s+/g, " ");
  if (!normalized || normalized.length > 120 || /(?:https?:\/\/|www\.)/i.test(normalized)) return null;
  return normalized;
}

function safeTerms(values: string[]): string[] {
  return [...new Set(values.map(safeTerm).filter((value): value is string => value !== null))];
}

function preferredNights(input: SavedGoalWebDiscoveryInput): number | null {
  const { minimumNights, maximumNights } = input.goal;
  if (Number.isInteger(minimumNights) && (minimumNights as number) > 0) return minimumNights;
  if (Number.isInteger(maximumNights) && (maximumNights as number) > 0) return maximumNights;
  return null;
}

function baseUnknownDimensions(input: SavedGoalWebDiscoveryInput): string[] {
  const unknown: string[] = [
    "airport_flexibility",
    "baggage",
    "layover_tolerance",
    "room_breakdown",
    "neighborhood_or_property_preference",
  ];
  if (!validDate(input.goal.earliestDeparture) || !validDate(input.goal.latestReturn)) unknown.push("travel_dates");
  if (preferredNights(input) === null) unknown.push("stay_length");
  return unknown;
}

/**
 * Current goals persist a window, not a separately confirmed date pair.
 * Therefore no existing Goal value is promoted to exact_confirmed here.
 */
export function deriveSavedGoalTripShapes(input: SavedGoalWebDiscoveryInput): WebTravelTripShape[] {
  const unknownDimensions = baseUnknownDimensions(input);
  const start = input.goal.earliestDeparture;
  const end = input.goal.latestReturn;
  const nights = preferredNights(input);
  const common = {
    mode: "flexible_planning" as const,
    unknownDimensions,
    planningAssumptions: ["Date alternatives are planning shapes within the saved travel window, not confirmed travel dates."],
    exactSuppressionReasons: ["The saved goal provides a date window rather than a separately confirmed departure and return pair."],
  };

  if (!validDate(start) || !validDate(end) || nights === null || daysBetween(start, end) < nights) {
    return [{
      id: "trip-shape-1",
      label: "Saved travel window",
      departureDate: validDate(start) ? start : null,
      returnDate: validDate(end) ? end : null,
      nightCount: nights,
      ...common,
    }];
  }

  const latestDeparture = dayAfter(end, -nights);
  const span = daysBetween(start, latestDeparture);
  const departures = [start, dayAfter(start, Math.floor(span / 2)), latestDeparture];
  const labels = ["Earliest planning alternative", "Mid-window planning alternative", "Latest planning alternative"];

  return [...new Set(departures)].slice(0, MAX_TRIP_SHAPES).map((departureDate, index) => ({
    id: `trip-shape-${index + 1}`,
    label: labels[index],
    departureDate,
    returnDate: dayAfter(departureDate, nights),
    nightCount: nights,
    ...common,
  }));
}

function queryDateContext(input: SavedGoalWebDiscoveryInput): string {
  const start = validDate(input.goal.earliestDeparture) ? input.goal.earliestDeparture : null;
  const end = validDate(input.goal.latestReturn) ? input.goal.latestReturn : null;
  if (start && end) return `${start} to ${end} flexible planning dates`;
  if (start) return `from ${start} flexible planning dates`;
  if (end) return `by ${end} flexible planning dates`;
  return "dates not specified";
}

function queryNightContext(input: SavedGoalWebDiscoveryInput): string {
  const min = input.goal.minimumNights;
  const max = input.goal.maximumNights;
  if (Number.isInteger(min) && Number.isInteger(max) && min !== null && max !== null && min > 0 && max >= min) return `${min} to ${max} nights`;
  if (Number.isInteger(min) && min !== null && min > 0) return `${min} nights minimum`;
  if (Number.isInteger(max) && max !== null && max > 0) return `up to ${max} nights`;
  return "stay length not specified";
}

function cabinContext(input: SavedGoalWebDiscoveryInput): string {
  return input.goal.cabinPreference === "flexible" ? "cabin flexible" : `${input.goal.cabinPreference} cabin`;
}

function programNames(input: SavedGoalWebDiscoveryInput): string[] {
  return safeTerms(input.customerRewardPrograms.map((program) => program.name)).slice(0, 2);
}

function validatedTransfer(input: SavedGoalWebDiscoveryInput): PlannerTransferPartner | null {
  return input.transferPartners.find((partner) =>
    safeTerm(partner.sourceProgramName) !== null && safeTerm(partner.partnerProgramName) !== null
  ) ?? null;
}

function makeQuery(
  query: string,
  kind: WebTravelQueryKind,
  category: ResearchPlanQuery["category"],
  shapes: WebTravelTripShape[],
  purpose: string,
  includeDomains: string[],
  searchDepth: "basic" | "advanced",
): WebTravelDiscoveryQuery | null {
  const normalized = query.replace(/\s+/g, " ").trim();
  if (!normalized || /(?:https?:\/\/|www\.)/i.test(normalized)) return null;
  const unknownDimensions = [...new Set(shapes.flatMap((shape) => shape.unknownDimensions))];
  const planningAssumptions = [...new Set(shapes.flatMap((shape) => shape.planningAssumptions))];
  const exactSuppressionReasons = [...new Set(shapes.flatMap((shape) => shape.exactSuppressionReasons))];
  return {
    query: normalized,
    includeDomains,
    purpose,
    category,
    searchDepth,
    kind,
    tripShapeIds: shapes.map((shape) => shape.id),
    mode: shapes.every((shape) => shape.mode === "exact_confirmed") ? "exact_confirmed" : "flexible_planning",
    unknownDimensions,
    planningAssumptions,
    exactSuppressionReasons,
  };
}

/** Deduplicates planned queries while retaining the selected profile order. */
export function deduplicateWebTravelDiscoveryQueries(
  queries: WebTravelDiscoveryQuery[],
): WebTravelDiscoveryQuery[] {
  return queries.filter((query, index, all) =>
    all.findIndex((candidate) => candidate.query === query.query) === index
  ).slice(0, MAX_QUERIES);
}

/** Builds the bounded public-web discovery plan exclusively from saved, sanitized facts. */
export function buildSavedGoalWebTravelDiscoveryPlan(input: SavedGoalWebDiscoveryInput): WebTravelDiscoveryPlan {
  const shapes = deriveSavedGoalTripShapes(input);
  const origins = safeTerms(input.goal.origin);
  const destinations = safeTerms(input.goal.destinations);
  const origin = origins[0] ?? null;
  const destination = destinations[0] ?? null;
  const dates = queryDateContext(input);
  const nights = queryNightContext(input);
  const travelers = Number.isInteger(input.goal.travelerCount) && input.goal.travelerCount > 0
    ? `${input.goal.travelerCount} travelers`
    : "traveler count not specified";
  const programs = programNames(input);
  const candidates = new Map<WebTravelQueryKind, WebTravelDiscoveryQuery>();

  if (origin && destination) {
    const cashFlight = makeQuery(
      `${origin} to ${destination} cash flights ${dates} ${travelers} ${cabinContext(input)}`,
      "cash_flight_discovery", "flight", shapes,
      "Saved-goal route and date-window cash-flight discovery.",
      [...OFFICIAL_DOMAINS], "advanced",
    );
    if (cashFlight) candidates.set(cashFlight.kind, cashFlight);

    if (programs.length > 0) {
      const awardFlight = makeQuery(
        `${programs.join(" ")} award flight ${origin} to ${destination} ${dates} ${travelers} ${cabinContext(input)}`,
        "award_flight_discovery", "flight", shapes,
        "Saved-goal route, date-window, and known-program award-flight discovery.",
        [...OFFICIAL_DOMAINS, ...SPECIALIST_DOMAINS], "advanced",
      );
      if (awardFlight) candidates.set(awardFlight.kind, awardFlight);
    }
  }

  if (destination) {
    const cashHotel = makeQuery(
      `${destination} hotel cash stay ${dates} ${nights} ${travelers} room breakdown not specified`,
      "cash_hotel_discovery", "hotel", shapes,
      "Saved-goal destination, date-window, and night-range hotel discovery.",
      [...OFFICIAL_DOMAINS], "advanced",
    );
    if (cashHotel) candidates.set(cashHotel.kind, cashHotel);

    if (programs.length > 0) {
      const awardHotel = makeQuery(
        `${programs.join(" ")} award hotel ${destination} ${dates} ${nights} property preference not specified`,
        "award_hotel_discovery", "hotel", shapes,
        "Saved-goal destination, date-window, night-range, and known-program hotel-award discovery.",
        [...OFFICIAL_DOMAINS, ...SPECIALIST_DOMAINS], "advanced",
      );
      if (awardHotel) candidates.set(awardHotel.kind, awardHotel);
    }
  }

  const transfer = validatedTransfer(input);
  if (transfer) {
    const policy = makeQuery(
      `${transfer.sourceProgramName} ${transfer.partnerProgramName} transfer Points Cash booking window cancellation policy`,
      "program_policy_research", "temporal", shapes,
      "Separate policy research for a validated saved transfer relationship.",
      [...OFFICIAL_DOMAINS], "basic",
    );
    if (policy) candidates.set(policy.kind, policy);
  }

  const priorityProfile = resolveSavedGoalPriorityProfile(input.goal.optimizationPriority);
  const selected = priorityProfile
    .map((kind) => candidates.get(kind))
    .filter((query): query is WebTravelDiscoveryQuery => query !== undefined);
  // Policy research remains separate from the default 2–4 discovery profile
  // and is included only for an explicitly validated transfer relationship.
  const policy = candidates.get("program_policy_research");
  if (policy) selected.push(policy);
  const deduplicated = deduplicateWebTravelDiscoveryQueries(selected);

  return {
    tripShapes: shapes,
    queries: deduplicated,
    reasoning: "Deterministic saved-goal-first public-web discovery plan. Query text is planning research only and does not claim live availability or exact-trip confirmation.",
    generatedAt: new Date().toISOString(),
  };
}
