// Deterministic scenario builder that produces exactly four allocation
// scenarios (flight_first, hotel_first, balanced, fallback) from award
// options and points inventory. Never mutates inputs.

import type { Goal } from "./types";
import type { VerifiedTransferPartner } from "@/lib/rewards/awardBenchmarks";
import type {
  StrategyAwardOption,
  StrategyPointsInventoryItem,
  StrategyPointsAllocation,
  StrategyAllocationScenario,
} from "./strategyTypes";
import {
  calculateTripNights,
  calculateFlightPointsRequired,
  calculateHotelPointsRequired,
  findFundingAccount,
  type FundingAccountMatch,
  type OptionRequirementCalculation,
} from "./strategyOptionCalculator";

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

type GoalMatch = "exact" | "partial" | "general" | "different_destination";

function getGoalMatch(option: StrategyAwardOption): GoalMatch {
  // goalMatch is currently classified by the research model, not derived from
  // source-bound structured route/date facts. It must not promote an option
  // above a general planning benchmark. Keep different_destination as a
  // conservative downgrade only: it can never improve deterministic ranking.
  return option.goalMatch === "different_destination"
    ? "different_destination"
    : "general";
}

function goalMatchPriority(match: GoalMatch): number {
  switch (match) {
    case "exact":
      return 0;
    case "partial":
      return 1;
    case "general":
      return 2;
    case "different_destination":
      return 3;
  }
}

interface ScoredOption {
  option: StrategyAwardOption;
  originalIndex: number;
  calculable: boolean;
  fundable: boolean;
  matchPriority: number;
}

/**
 * Rank options by: calculable+fundable first, then goal-match relevance,
 * then original source order. Never ranks by raw points across programs.
 */
function rankOptions(
  options: StrategyAwardOption[],
  goal: Goal,
  inventory: StrategyPointsInventoryItem[],
  excludeDifferentDestination: boolean,
  verifiedTransferPartners?: VerifiedTransferPartner[] | null,
): StrategyAwardOption[] {
  const scored: ScoredOption[] = [];

  for (let i = 0; i < options.length; i++) {
    const option = options[i];

    // Exclude unavailable
    if (option.availabilityStatus === "unavailable") continue;

    const match = getGoalMatch(option);

    // Exclude different_destination for primary scenarios
    if (excludeDifferentDestination && match === "different_destination") continue;

    const calculable = isOptionCalculable(option, goal);
    const fundable =
      findFundingAccount(option, inventory, verifiedTransferPartners) !== null;

    scored.push({
      option,
      originalIndex: i,
      calculable,
      fundable,
      matchPriority: goalMatchPriority(match),
    });
  }

  scored.sort((a, b) => {
    // calculable+fundable first
    const aBoth = a.calculable && a.fundable;
    const bBoth = b.calculable && b.fundable;
    if (aBoth !== bBoth) return aBoth ? -1 : 1;

    // Then goal-match relevance
    if (a.matchPriority !== b.matchPriority) return a.matchPriority - b.matchPriority;

    // Then original order
    return a.originalIndex - b.originalIndex;
  });

  return scored.map((s) => s.option);
}

function isOptionCalculable(
  option: StrategyAwardOption,
  goal: Goal,
): boolean {
  if (option.redemptionType === "flight") {
    return calculateFlightPointsRequired(option, goal).status === "calculated";
  }
  if (option.redemptionType === "hotel") {
    return calculateHotelPointsRequired(option, goal).status === "calculated";
  }
  return false;
}

function calcRequirement(
  option: StrategyAwardOption,
  goal: Goal,
): OptionRequirementCalculation {
  if (option.redemptionType === "flight") {
    return calculateFlightPointsRequired(option, goal);
  }
  return calculateHotelPointsRequired(option, goal);
}

/**
 * Build a single StrategyPointsAllocation from a funding match and the
 * destination-program requirement. Direct matches debit the requirement in
 * the account’s native units. Transfer matches debit the verified partner’s
 * source-program cost: requirement ÷ ratio, rounded UP (conservative, never
 * prorated), with a fixed disclosure — transfer timing and promotions are
 * never established here.
 */
function buildAllocation(
  match: FundingAccountMatch,
  requiredDestinationPoints: number,
): StrategyPointsAllocation {
  const availablePoints = match.account.balance;
  let plannedPoints = requiredDestinationPoints;
  if (match.method === "transfer_source" && match.transfer) {
    plannedPoints = Math.ceil(
      requiredDestinationPoints /
        match.transfer.destinationPointsPerSourcePoint,
    );
  }
  return {
    accountId: match.account.accountId,
    rewardProgramId: match.account.rewardProgramId,
    programName: match.account.programName,
    ownerLabel: match.account.ownerLabel,
    fundingMethod: match.method,
    availablePoints,
    plannedPoints,
    remainingPoints: Math.max(availablePoints - plannedPoints, 0),
    pointsGap: Math.max(plannedPoints - availablePoints, 0),
  };
}

/**
 * Fixed, server-owned disclosure appended for transfer-funded allocations.
 * Never mentions promotions, timing, or availability specifics.
 */
const TRANSFER_FUNDING_ASSUMPTION =
  "Funding is planned through a verified transfer partner; the source points shown are the required destination points divided by the verified transfer ratio, rounded up. Transfer times and current promotions are not established.";

/**
 * Merge string arrays without duplicates, preserving first-seen order.
 */
function mergeUnique(...arrays: string[][]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const arr of arrays) {
    for (const item of arr) {
      if (!seen.has(item)) {
        seen.add(item);
        result.push(item);
      }
    }
  }
  return result;
}

function determineStatus(
  allocations: StrategyPointsAllocation[],
  isConditional: boolean,
): StrategyAllocationScenario["status"] {
  if (isConditional) return "conditional";

  if (allocations.length === 0) return "insufficient_information";

  const hasGap = allocations.some((a) => a.pointsGap > 0);
  if (hasGap) return "gap";

  return "feasible";
}

// ---------------------------------------------------------------------------
// Scenario builders
// ---------------------------------------------------------------------------

function buildFlightFirst(
  goal: Goal,
  flight: StrategyAwardOption | null,
  inventory: StrategyPointsInventoryItem[],
  tripNights: number | null,
  verifiedTransferPartners?: VerifiedTransferPartner[] | null,
): StrategyAllocationScenario {
  const base = {
    id: "flight_first",
    kind: "flight_first" as const,
    title: "Flight-first points planning scenario",
    flightOptionId: null as string | null,
    hotelOptionId: null as string | null,
    flightPointsRequired: null as number | null,
    hotelPointsRequired: null as number | null,
    travelerCount: goal.travelerCount,
    tripNights,
    allocations: [] as StrategyPointsAllocation[],
    assumptions: [] as string[],
    warnings: [] as string[],
  };

  if (!flight) {
    return {
      ...base,
      status: "insufficient_information",
      warnings: ["No eligible flight option available"],
    };
  }

  const calc = calculateFlightPointsRequired(flight, goal);
  if (calc.status !== "calculated") {
    return {
      ...base,
      flightOptionId: flight.id,
      status: "insufficient_information",
      warnings: mergeUnique(base.warnings, calc.warnings),
    };
  }

  const funding = findFundingAccount(flight, inventory, verifiedTransferPartners);
  if (!funding) {
    return {
      ...base,
      flightOptionId: flight.id,
      flightPointsRequired: calc.pointsRequired,
      status: "insufficient_information",
      assumptions: mergeUnique(base.assumptions, calc.assumptions),
      warnings: mergeUnique(base.warnings, calc.warnings, [
        "No eligible direct-program or verified-transfer funding account found for flight option; transfer terms and eligibility are not established",
      ]),
    };
  }

  const allocation = buildAllocation(funding, calc.pointsRequired!);
  const status = determineStatus([allocation], false);

  return {
    ...base,
    flightOptionId: flight.id,
    flightPointsRequired: calc.pointsRequired,
    status,
    allocations: [allocation],
    assumptions: mergeUnique(
      base.assumptions,
      calc.assumptions,
      funding.method === "transfer_source" ? [TRANSFER_FUNDING_ASSUMPTION] : [],
    ),
    warnings: mergeUnique(base.warnings, calc.warnings),
  };
}

function buildHotelFirst(
  goal: Goal,
  hotel: StrategyAwardOption | null,
  inventory: StrategyPointsInventoryItem[],
  tripNights: number | null,
  verifiedTransferPartners?: VerifiedTransferPartner[] | null,
): StrategyAllocationScenario {
  const base = {
    id: "hotel_first",
    kind: "hotel_first" as const,
    title: "Hotel-first points planning scenario",
    flightOptionId: null as string | null,
    hotelOptionId: null as string | null,
    flightPointsRequired: null as number | null,
    hotelPointsRequired: null as number | null,
    travelerCount: goal.travelerCount,
    tripNights,
    allocations: [] as StrategyPointsAllocation[],
    assumptions: [] as string[],
    warnings: [] as string[],
  };

  if (!hotel) {
    return {
      ...base,
      status: "insufficient_information",
      warnings: ["No eligible hotel option available"],
    };
  }

  const calc = calculateHotelPointsRequired(hotel, goal);
  if (calc.status !== "calculated") {
    return {
      ...base,
      hotelOptionId: hotel.id,
      status: "insufficient_information",
      warnings: mergeUnique(base.warnings, calc.warnings),
    };
  }

  const funding = findFundingAccount(hotel, inventory, verifiedTransferPartners);
  if (!funding) {
    return {
      ...base,
      hotelOptionId: hotel.id,
      hotelPointsRequired: calc.pointsRequired,
      status: "insufficient_information",
      assumptions: mergeUnique(base.assumptions, calc.assumptions),
      warnings: mergeUnique(base.warnings, calc.warnings, [
        "No eligible direct-program or verified-transfer funding account found for hotel option; transfer terms and eligibility are not established",
      ]),
    };
  }

  const allocation = buildAllocation(funding, calc.pointsRequired!);
  const status = determineStatus([allocation], false);

  return {
    ...base,
    hotelOptionId: hotel.id,
    hotelPointsRequired: calc.pointsRequired,
    status,
    allocations: [allocation],
    assumptions: mergeUnique(
      base.assumptions,
      calc.assumptions,
      funding.method === "transfer_source" ? [TRANSFER_FUNDING_ASSUMPTION] : [],
    ),
    warnings: mergeUnique(base.warnings, calc.warnings),
  };
}

function buildBalanced(
  goal: Goal,
  flight: StrategyAwardOption | null,
  hotel: StrategyAwardOption | null,
  inventory: StrategyPointsInventoryItem[],
  tripNights: number | null,
  verifiedTransferPartners?: VerifiedTransferPartner[] | null,
): StrategyAllocationScenario {
  const base = {
    id: "balanced",
    kind: "balanced" as const,
    title: "Balanced points planning scenario",
    flightOptionId: null as string | null,
    hotelOptionId: null as string | null,
    flightPointsRequired: null as number | null,
    hotelPointsRequired: null as number | null,
    travelerCount: goal.travelerCount,
    tripNights,
    allocations: [] as StrategyPointsAllocation[],
    assumptions: [] as string[],
    warnings: [] as string[],
  };

  // Need at least one option
  if (!flight && !hotel) {
    return {
      ...base,
      status: "insufficient_information",
      warnings: ["No eligible flight or hotel option available"],
    };
  }

  let flightCalc: OptionRequirementCalculation | null = null;
  let flightFunding: FundingAccountMatch | null = null;
  let hotelCalc: OptionRequirementCalculation | null = null;
  let hotelFunding: FundingAccountMatch | null = null;

  if (flight) {
    flightCalc = calculateFlightPointsRequired(flight, goal);
    if (flightCalc.status === "calculated") {
      flightFunding = findFundingAccount(flight, inventory, verifiedTransferPartners);
    }
  }

  if (hotel) {
    hotelCalc = calculateHotelPointsRequired(hotel, goal);
    if (hotelCalc.status === "calculated") {
      hotelFunding = findFundingAccount(hotel, inventory, verifiedTransferPartners);
    }
  }

  const flightOk = flightCalc?.status === "calculated" && flightFunding !== null;
  const hotelOk = hotelCalc?.status === "calculated" && hotelFunding !== null;

  // If neither is calculable+fundable, insufficient
  if (!flightOk && !hotelOk) {
    const allWarnings: string[] = [];
    if (flightCalc) allWarnings.push(...flightCalc.warnings);
    if (hotelCalc) allWarnings.push(...hotelCalc.warnings);
    if (flight && !flightFunding) allWarnings.push("No eligible direct-program or verified-transfer funding account found for flight option; transfer terms and eligibility are not established");
    if (hotel && !hotelFunding) allWarnings.push("No eligible direct-program or verified-transfer funding account found for hotel option; transfer terms and eligibility are not established");
    return {
      ...base,
      flightOptionId: flight?.id ?? null,
      hotelOptionId: hotel?.id ?? null,
      flightPointsRequired: flightCalc?.pointsRequired ?? null,
      hotelPointsRequired: hotelCalc?.pointsRequired ?? null,
      status: "insufficient_information",
      assumptions: mergeUnique(
        base.assumptions,
        flightCalc?.assumptions ?? [],
        hotelCalc?.assumptions ?? [],
      ),
      warnings: mergeUnique(base.warnings, allWarnings),
    };
  }

  const allocations: StrategyPointsAllocation[] = [];
  const allAssumptions: string[] = [];
  const allWarnings: string[] = [];

  // Build flight allocation
  let flightAlloc: StrategyPointsAllocation | null = null;
  if (flightOk && flightCalc && flightFunding) {
    flightAlloc = buildAllocation(flightFunding, flightCalc.pointsRequired!);
    allAssumptions.push(...flightCalc.assumptions);
    if (flightFunding.method === "transfer_source") {
      allAssumptions.push(TRANSFER_FUNDING_ASSUMPTION);
    }
    allWarnings.push(...flightCalc.warnings);
  }

  // Build hotel allocation
  let hotelAlloc: StrategyPointsAllocation | null = null;
  if (hotelOk && hotelCalc && hotelFunding) {
    hotelAlloc = buildAllocation(hotelFunding, hotelCalc.pointsRequired!);
    allAssumptions.push(...hotelCalc.assumptions);
    if (hotelFunding.method === "transfer_source") {
      allAssumptions.push(TRANSFER_FUNDING_ASSUMPTION);
    }
    allWarnings.push(...hotelCalc.warnings);
  }

  // Combine if both use the same account
  if (flightAlloc && hotelAlloc && flightAlloc.accountId === hotelAlloc.accountId) {
    const combinedPlanned = flightAlloc.plannedPoints + hotelAlloc.plannedPoints;
    const available = flightAlloc.availablePoints;
    allocations.push({
      accountId: flightAlloc.accountId,
      rewardProgramId: flightAlloc.rewardProgramId,
      programName: flightAlloc.programName,
      ownerLabel: flightAlloc.ownerLabel,
      fundingMethod: flightAlloc.fundingMethod,
      availablePoints: available,
      plannedPoints: combinedPlanned,
      remainingPoints: Math.max(available - combinedPlanned, 0),
      pointsGap: Math.max(combinedPlanned - available, 0),
    });
  } else {
    if (flightAlloc) allocations.push(flightAlloc);
    if (hotelAlloc) allocations.push(hotelAlloc);
  }

  const hasUnfundedDemand = (flight !== null && !flightOk) || (hotel !== null && !hotelOk);
  if (flight !== null && !flightOk) {
    allWarnings.push("Flight funding is unresolved; transfer terms and eligibility are not established or coverage is missing");
  }
  if (hotel !== null && !hotelOk) {
    allWarnings.push("Hotel funding is unresolved; transfer terms and eligibility are not established or coverage is missing");
  }
  const status = hasUnfundedDemand
    ? "insufficient_information"
    : determineStatus(allocations, false);

  return {
    ...base,
    flightOptionId: flight?.id ?? null,
    hotelOptionId: hotel?.id ?? null,
    flightPointsRequired: flightCalc?.pointsRequired ?? null,
    hotelPointsRequired: hotelCalc?.pointsRequired ?? null,
    status,
    allocations,
    assumptions: mergeUnique(base.assumptions, allAssumptions),
    warnings: mergeUnique(base.warnings, allWarnings),
  };
}

function buildFallback(
  goal: Goal,
  flightOptions: StrategyAwardOption[],
  hotelOptions: StrategyAwardOption[],
  inventory: StrategyPointsInventoryItem[],
  tripNights: number | null,
  primaryFlightId: string | null,
  primaryHotelId: string | null,
  verifiedTransferPartners?: VerifiedTransferPartner[] | null,
): StrategyAllocationScenario {
  const base = {
    id: "fallback",
    kind: "fallback" as const,
    title: "Fallback points planning scenario",
    flightOptionId: null as string | null,
    hotelOptionId: null as string | null,
    flightPointsRequired: null as number | null,
    hotelPointsRequired: null as number | null,
    travelerCount: goal.travelerCount,
    tripNights,
    allocations: [] as StrategyPointsAllocation[],
    assumptions: [] as string[],
    warnings: [] as string[],
  };

  const usedIds = new Set<string>();
  if (primaryFlightId) usedIds.add(primaryFlightId);
  if (primaryHotelId) usedIds.add(primaryHotelId);

  // Collect unused, available options
  const allUnused = [...flightOptions, ...hotelOptions].filter(
    (o) => o.availabilityStatus !== "unavailable" && !usedIds.has(o.id),
  );

  // Preference order for fallback:
  // 1. Non-different-destination flight
  // 2. Non-different-destination hotel
  // 3. Any different_destination option

  const nonDiffFlight = allUnused.filter(
    (o) => o.redemptionType === "flight" && getGoalMatch(o) !== "different_destination",
  );
  const nonDiffHotel = allUnused.filter(
    (o) => o.redemptionType === "hotel" && getGoalMatch(o) !== "different_destination",
  );
  const diffDest = allUnused.filter(
    (o) => getGoalMatch(o) === "different_destination",
  );

  // Within each group, rank by calculable+fundable, goal match, original order
  const rankedNonDiffFlight = rankOptions(nonDiffFlight, goal, inventory, false, verifiedTransferPartners);
  const rankedNonDiffHotel = rankOptions(nonDiffHotel, goal, inventory, false, verifiedTransferPartners);
  const rankedDiffDest = rankOptions(diffDest, goal, inventory, false, verifiedTransferPartners);

  // Try each group in order, picking the first calculable+fundable option
  const candidates = [
    ...rankedNonDiffFlight.map((o) => ({ option: o, isDiffDest: false })),
    ...rankedNonDiffHotel.map((o) => ({ option: o, isDiffDest: false })),
    ...rankedDiffDest.map((o) => ({ option: o, isDiffDest: true })),
  ];

  for (const { option, isDiffDest } of candidates) {
    const calc = calcRequirement(option, goal);
    if (calc.status !== "calculated") continue;

    const funding = findFundingAccount(option, inventory, verifiedTransferPartners);
    if (!funding) continue;

    const allocation = buildAllocation(funding, calc.pointsRequired!);
    const status = determineStatus([allocation], isDiffDest);

    const warnings = [...calc.warnings];
    if (isDiffDest) {
      warnings.push(
        "This is a conditional planning alternative. Verify that it fits your route and dates before relying on it.",
      );
    }

    const isFlight = option.redemptionType === "flight";

    return {
      ...base,
      flightOptionId: isFlight ? option.id : null,
      hotelOptionId: isFlight ? null : option.id,
      flightPointsRequired: isFlight ? calc.pointsRequired : null,
      hotelPointsRequired: isFlight ? null : calc.pointsRequired,
      status,
      allocations: [allocation],
      assumptions: mergeUnique(
        base.assumptions,
        calc.assumptions,
        funding.method === "transfer_source" ? [TRANSFER_FUNDING_ASSUMPTION] : [],
      ),
      warnings: mergeUnique(base.warnings, warnings),
    };
  }

  // No fallback found
  return {
    ...base,
    status: "insufficient_information",
    warnings: ["No unused calculable and fundable option available for fallback"],
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Build exactly four allocation scenarios from award options and points
 * inventory. Always returns [flight_first, hotel_first, balanced, fallback]
 * in that order. Never mutates inputs.
 */
export function buildStrategyAllocationScenarios(
  goal: Goal,
  flightOptions: StrategyAwardOption[],
  hotelOptions: StrategyAwardOption[],
  pointsInventory: StrategyPointsInventoryItem[],
  verifiedTransferPartners?: VerifiedTransferPartner[] | null,
): StrategyAllocationScenario[] {
  const tripNights = calculateTripNights(goal);

  // Rank and select primary options (exclude different_destination)
  const rankedFlights = rankOptions(
    flightOptions, goal, pointsInventory, true, verifiedTransferPartners,
  );
  const rankedHotels = rankOptions(
    hotelOptions, goal, pointsInventory, true, verifiedTransferPartners,
  );

  const primaryFlight = rankedFlights[0] ?? null;
  const primaryHotel = rankedHotels[0] ?? null;

  const flightFirst = buildFlightFirst(
    goal, primaryFlight, pointsInventory, tripNights, verifiedTransferPartners,
  );
  const hotelFirst = buildHotelFirst(
    goal, primaryHotel, pointsInventory, tripNights, verifiedTransferPartners,
  );
  const balanced = buildBalanced(
    goal, primaryFlight, primaryHotel, pointsInventory, tripNights,
    verifiedTransferPartners,
  );
  const fallback = buildFallback(
    goal,
    flightOptions,
    hotelOptions,
    pointsInventory,
    tripNights,
    primaryFlight?.id ?? null,
    primaryHotel?.id ?? null,
    verifiedTransferPartners,
  );

  return [flightFirst, hotelFirst, balanced, fallback];
}
