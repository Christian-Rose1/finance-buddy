import type {
  StrategyAllocationScenario,
  StrategyFeasibility,
  StrategyPointsAllocation,
  StrategyPointsInventoryItem,
} from "./strategyTypes";

export interface DeterministicStrategyOutcome {
  feasibility: StrategyFeasibility;
  pointsGap: number | null;
}

const INSUFFICIENT_OUTCOME: DeterministicStrategyOutcome = {
  feasibility: "insufficient_information",
  pointsGap: null,
};

function findOnlyScenario(
  scenarios: StrategyAllocationScenario[],
  kind: StrategyAllocationScenario["kind"]
): StrategyAllocationScenario | null {
  const matches = scenarios.filter((scenario) => scenario.kind === kind);
  return matches.length === 1 ? matches[0] : null;
}

function allocationKey(allocation: StrategyPointsAllocation): string {
  return JSON.stringify([allocation.accountId, allocation.rewardProgramId]);
}

function isEligibleAllocation(
  allocation: StrategyPointsAllocation,
  inventory: StrategyPointsInventoryItem[]
): boolean {
  if (
    !Number.isFinite(allocation.pointsGap) ||
    allocation.pointsGap < 0 ||
    !Number.isFinite(allocation.availablePoints) ||
    allocation.availablePoints < 0 ||
    !Number.isFinite(allocation.plannedPoints) ||
    allocation.plannedPoints <= 0
  ) {
    return false;
  }

  const matchingAccounts = inventory.filter(
    (item) =>
      item.accountId === allocation.accountId &&
      item.rewardProgramId === allocation.rewardProgramId &&
      item.ownerType === "self" &&
      item.verificationStatus === "verified" &&
      item.balance === allocation.availablePoints
  );

  return matchingAccounts.length === 1;
}

function hasCalculatedPrimaryOption(
  scenario: StrategyAllocationScenario,
  option: "flight" | "hotel",
  inventory: StrategyPointsInventoryItem[]
): boolean {
  const optionId =
    option === "flight" ? scenario.flightOptionId : scenario.hotelOptionId;
  const pointsRequired =
    option === "flight"
      ? scenario.flightPointsRequired
      : scenario.hotelPointsRequired;

  if (
    optionId === null ||
    pointsRequired === null ||
    !Number.isFinite(pointsRequired) ||
    pointsRequired <= 0 ||
    scenario.allocations.length !== 1 ||
    !isEligibleAllocation(scenario.allocations[0], inventory)
  ) {
    return false;
  }

  const hasGap = scenario.allocations[0].pointsGap > 0;
  return scenario.status === (hasGap ? "gap" : "feasible");
}

function sameKeys(left: Set<string>, right: Set<string>): boolean {
  if (left.size !== right.size) return false;

  for (const key of left) {
    if (!right.has(key)) return false;
  }

  return true;
}

/**
 * Derive the top-level outcome from the deterministic whole-trip scenario.
 * A complete result requires calculated and fundable flight and hotel primary
 * scenarios. Gap values remain per account/program and are exposed at the top
 * level only when the balanced scenario uses exactly one allocation.
 */
export function deriveDeterministicStrategyOutcome(
  scenarios: StrategyAllocationScenario[],
  inventory: StrategyPointsInventoryItem[]
): DeterministicStrategyOutcome {
  const flight = findOnlyScenario(scenarios, "flight_first");
  const hotel = findOnlyScenario(scenarios, "hotel_first");
  const balanced = findOnlyScenario(scenarios, "balanced");

  if (
    !flight ||
    !hotel ||
    !balanced ||
    !hasCalculatedPrimaryOption(flight, "flight", inventory) ||
    !hasCalculatedPrimaryOption(hotel, "hotel", inventory) ||
    balanced.flightOptionId !== flight.flightOptionId ||
    balanced.hotelOptionId !== hotel.hotelOptionId ||
    balanced.flightPointsRequired !== flight.flightPointsRequired ||
    balanced.hotelPointsRequired !== hotel.hotelPointsRequired ||
    balanced.allocations.length === 0 ||
    !balanced.allocations.every((allocation) =>
      isEligibleAllocation(allocation, inventory)
    )
  ) {
    return INSUFFICIENT_OUTCOME;
  }

  const primaryAllocationKeys = new Set([
    ...flight.allocations.map(allocationKey),
    ...hotel.allocations.map(allocationKey),
  ]);
  const balancedAllocationKeys = new Set(
    balanced.allocations.map(allocationKey)
  );

  if (!sameKeys(primaryAllocationKeys, balancedAllocationKeys)) {
    return INSUFFICIENT_OUTCOME;
  }

  const hasGap = balanced.allocations.some(
    (allocation) => allocation.pointsGap > 0
  );
  const expectedStatus = hasGap ? "gap" : "feasible";

  if (balanced.status !== expectedStatus) {
    return INSUFFICIENT_OUTCOME;
  }

  return {
    feasibility: hasGap ? "gap_remaining" : "on_track",
    pointsGap:
      balanced.allocations.length === 1
        ? balanced.allocations[0].pointsGap
        : null,
  };
}
