// Deterministic scenario builder that produces exactly four allocation
// scenarios (flight_first, hotel_first, balanced, fallback) from award
// options and points inventory. Never mutates inputs.

import type { Goal } from "./types";
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
  return option.goalMatch ?? "general";
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
    const fundable = findFundingAccount(option, inventory) !== null;

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
 * Build a single StrategyPointsAllocation from a funding match and
 * planned points requirement.
 */
function buildAllocation(
  match: FundingAccountMatch,
  plannedPoints: number,
): StrategyPointsAllocation {
  const availablePoints = match.account.balance;
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
): StrategyAllocationScenario {
  const base = {
    id: "flight_first",
    kind: "flight_first" as const,
    title: "Flight First",
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

  const funding = findFundingAccount(flight, inventory);
  if (!funding) {
    return {
      ...base,
      flightOptionId: flight.id,
      flightPointsRequired: calc.pointsRequired,
      status: "insufficient_information",
      assumptions: mergeUnique(base.assumptions, calc.assumptions),
      warnings: mergeUnique(base.warnings, calc.warnings, [
        "No eligible funding account found for flight option",
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
    assumptions: mergeUnique(base.assumptions, calc.assumptions),
    warnings: mergeUnique(base.warnings, calc.warnings),
  };
}

function buildHotelFirst(
  goal: Goal,
  hotel: StrategyAwardOption | null,
  inventory: StrategyPointsInventoryItem[],
  tripNights: number | null,
): StrategyAllocationScenario {
  const base = {
    id: "hotel_first",
    kind: "hotel_first" as const,
    title: "Hotel First",
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

  const funding = findFundingAccount(hotel, inventory);
  if (!funding) {
    return {
      ...base,
      hotelOptionId: hotel.id,
      hotelPointsRequired: calc.pointsRequired,
      status: "insufficient_information",
      assumptions: mergeUnique(base.assumptions, calc.assumptions),
      warnings: mergeUnique(base.warnings, calc.warnings, [
        "No eligible funding account found for hotel option",
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
    assumptions: mergeUnique(base.assumptions, calc.assumptions),
    warnings: mergeUnique(base.warnings, calc.warnings),
  };
}

function buildBalanced(
  goal: Goal,
  flight: StrategyAwardOption | null,
  hotel: StrategyAwardOption | null,
  inventory: StrategyPointsInventoryItem[],
  tripNights: number | null,
): StrategyAllocationScenario {
  const base = {
    id: "balanced",
    kind: "balanced" as const,
    title: "Balanced",
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
      flightFunding = findFundingAccount(flight, inventory);
    }
  }

  if (hotel) {
    hotelCalc = calculateHotelPointsRequired(hotel, goal);
    if (hotelCalc.status === "calculated") {
      hotelFunding = findFundingAccount(hotel, inventory);
    }
  }

  const flightOk = flightCalc?.status === "calculated" && flightFunding !== null;
  const hotelOk = hotelCalc?.status === "calculated" && hotelFunding !== null;

  // If neither is calculable+fundable, insufficient
  if (!flightOk && !hotelOk) {
    const allWarnings: string[] = [];
    if (flightCalc) allWarnings.push(...flightCalc.warnings);
    if (hotelCalc) allWarnings.push(...hotelCalc.warnings);
    if (flight && !flightFunding) allWarnings.push("No eligible funding account found for flight option");
    if (hotel && !hotelFunding) allWarnings.push("No eligible funding account found for hotel option");
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
    allWarnings.push(...flightCalc.warnings);
  }

  // Build hotel allocation
  let hotelAlloc: StrategyPointsAllocation | null = null;
  if (hotelOk && hotelCalc && hotelFunding) {
    hotelAlloc = buildAllocation(hotelFunding, hotelCalc.pointsRequired!);
    allAssumptions.push(...hotelCalc.assumptions);
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

  const status = determineStatus(allocations, false);

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
): StrategyAllocationScenario {
  const base = {
    id: "fallback",
    kind: "fallback" as const,
    title: "Fallback",
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
  const rankedNonDiffFlight = rankOptions(nonDiffFlight, goal, inventory, false);
  const rankedNonDiffHotel = rankOptions(nonDiffHotel, goal, inventory, false);
  const rankedDiffDest = rankOptions(diffDest, goal, inventory, false);

  // Try each group in order, picking the first calculable+fundable option
  const candidates = [
    ...rankedNonDiffFlight.map((o) => ({ option: o, isDiffDest: false })),
    ...rankedNonDiffHotel.map((o) => ({ option: o, isDiffDest: false })),
    ...rankedDiffDest.map((o) => ({ option: o, isDiffDest: true })),
  ];

  for (const { option, isDiffDest } of candidates) {
    const calc = calcRequirement(option, goal);
    if (calc.status !== "calculated") continue;

    const funding = findFundingAccount(option, inventory);
    if (!funding) continue;

    const allocation = buildAllocation(funding, calc.pointsRequired!);
    const status = determineStatus([allocation], isDiffDest);

    const warnings = [...calc.warnings];
    if (isDiffDest) {
      warnings.push(
        `Option "${option.itineraryLabel ?? option.programName}" does not match the requested destination`,
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
      assumptions: mergeUnique(base.assumptions, calc.assumptions),
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
): StrategyAllocationScenario[] {
  const tripNights = calculateTripNights(goal);

  // Rank and select primary options (exclude different_destination)
  const rankedFlights = rankOptions(flightOptions, goal, pointsInventory, true);
  const rankedHotels = rankOptions(hotelOptions, goal, pointsInventory, true);

  const primaryFlight = rankedFlights[0] ?? null;
  const primaryHotel = rankedHotels[0] ?? null;

  const flightFirst = buildFlightFirst(goal, primaryFlight, pointsInventory, tripNights);
  const hotelFirst = buildHotelFirst(goal, primaryHotel, pointsInventory, tripNights);
  const balanced = buildBalanced(goal, primaryFlight, primaryHotel, pointsInventory, tripNights);
  const fallback = buildFallback(
    goal,
    flightOptions,
    hotelOptions,
    pointsInventory,
    tripNights,
    primaryFlight?.id ?? null,
    primaryHotel?.id ?? null,
  );

  return [flightFirst, hotelFirst, balanced, fallback];
}