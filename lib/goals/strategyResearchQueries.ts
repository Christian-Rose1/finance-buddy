/**
 * A reward program the customer actually owns. Structurally identical to the
 * planner's StrategyRewardProgram; defined here to avoid a circular import
 * while keeping the query builder fully testable on its own.
 */
export interface StrategyRewardProgram {
  id: string;
  name: string;
}

export interface StrategyResearchQueries {
  flightQueries: string[];
  hotelQueries: string[];
  cardQueries: string[];
}

/**
 * The goal fields required to build template research queries. The full
 * Goal type satisfies this shape, and so does the sanitized
 * ResearchPlannerInput.goal — so both callers can share one builder without
 * exposing id/userId/status to the planner path.
 */
export interface ResearchQueriesGoalInput {
  origin: string[];
  destinations: string[];
  earliestDeparture: string | null;
  latestReturn: string | null;
  travelerCount: number;
  cabinPreference: string;
  allowNewCards: boolean;
}

/**
 * Builds a small, bounded set of research queries from the goal and the
 * reward programs the customer actually owns.
 *
 * Guarantees:
 * - at most 1 flight query
 * - at most 1 hotel query
 * - at most 1 card-offer query, and only when goal.allowNewCards is true
 *
 * Queries never claim live availability and never invent hotel names, night
 * counts, award prices, or transfer-partner names — they only ask for options.
 */
export function buildStrategyResearchQueries(
  goal: ResearchQueriesGoalInput,
  customerRewardPrograms: StrategyRewardProgram[]
): StrategyResearchQueries {
  const {
    origin,
    destinations,
    earliestDeparture,
    latestReturn,
    travelerCount,
    cabinPreference,
  } = goal;

  const originStr = origin && origin.length > 0 ? origin.join(", ") : "";
  const destStr =
    destinations && destinations.length > 0 ? destinations.join(", ") : "";
  const dateStr =
    earliestDeparture && latestReturn
      ? `${earliestDeparture} to ${latestReturn}`
      : earliestDeparture || latestReturn || "";
  const cabinStr =
    cabinPreference && cabinPreference !== "flexible" ? cabinPreference : "";
  const travelerStr = travelerCount > 1 ? `${travelerCount} travelers` : "";

  const programNames = customerRewardPrograms.map((p) => p.name).slice(0, 3);
  const programsStr = programNames.join(", ");

  // 1. Flight query — points pricing and transfer-partner redemption options.
  const flightParts: string[] = ["flight award"];
  if (destStr) flightParts.push(`to ${destStr}`);
  if (originStr) flightParts.push(`from ${originStr}`);
  if (dateStr) flightParts.push(`in ${dateStr}`);
  if (cabinStr) flightParts.push(`${cabinStr} class`);
  if (travelerStr) flightParts.push(`for ${travelerStr}`);
  if (programsStr) flightParts.push(`using ${programsStr}`);
  flightParts.push("points pricing and transfer-partner redemption options");
  const flightQuery = flightParts.join(" ").trim();

  // 2. Hotel query — hotel loyalty-program and transfer-partner options.
  const hotelParts: string[] = ["hotel award points per night"];
  if (destStr) hotelParts.push(`to ${destStr}`);
  if (dateStr) hotelParts.push(`in ${dateStr}`);
  if (programsStr) hotelParts.push(`using ${programsStr}`);
  hotelParts.push("hotel loyalty-program and transfer-partner options");
  const hotelQuery = hotelParts.join(" ").trim();

  // 3. Card query — exactly one, and only when goal.allowNewCards is true.
  const cardQueries: string[] = [];
  if (goal.allowNewCards) {
    cardQueries.push(
      programsStr
        ? `best credit card welcome bonus offers for ${programsStr}`
        : "best credit card welcome bonus offers with transfer partners for travel"
    );
  }

  return {
    flightQueries: [flightQuery],
    hotelQueries: [hotelQuery],
    cardQueries,
  };
}