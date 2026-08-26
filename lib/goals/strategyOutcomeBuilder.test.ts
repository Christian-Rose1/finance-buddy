import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildStrategyAllocationScenarios } from "./strategyAllocationBuilder";
import { deriveDeterministicStrategyOutcome } from "./strategyOutcomeBuilder";
import type { Goal } from "./types";
import type {
  StrategyAwardOption,
  StrategyPointsInventoryItem,
} from "./strategyTypes";

function makeGoal(): Goal {
  return {
    id: "goal-1",
    userId: "user-1",
    type: "travel",
    title: "Paris trip",
    status: "active",
    origin: ["DEN"],
    destinations: ["CDG"],
    earliestDeparture: "2027-04-03",
    latestReturn: "2027-04-30",
    minimumNights: 3,
    maximumNights: 8,
    travelerCount: 2,
    cabinPreference: "economy",
    optimizationPriority: "balanced",
    maximumCashBudget: null,
    currency: "USD",
    allowNewCards: false,
    createdAt: "2026-08-26T00:00:00.000Z",
    updatedAt: "2026-08-26T00:00:00.000Z",
  };
}

function makeFlight(
  overrides: Partial<StrategyAwardOption> = {}
): StrategyAwardOption {
  return {
    id: "flight-1",
    sourceId: "source-flight",
    programName: "Flying Blue",
    redemptionType: "flight",
    pricingBasis: "round_trip",
    itineraryLabel: "DEN-CDG planning estimate",
    pointsRequired: 50_000,
    cashFees: null,
    seats: null,
    cabin: "economy",
    transferFromProgramId: "chase",
    transferRatio: 1,
    centsPerPoint: null,
    availabilityStatus: "unknown",
    travelerCountCovered: 1,
    coverageStatus: "source_explicit",
    goalMatch: "partial",
    ...overrides,
  };
}

function makeHotel(
  overrides: Partial<StrategyAwardOption> = {}
): StrategyAwardOption {
  return {
    id: "hotel-1",
    sourceId: "source-hotel",
    programName: "World of Hyatt",
    redemptionType: "hotel",
    pricingBasis: "per_night",
    itineraryLabel: "Paris planning estimate",
    pointsRequired: 25_000,
    cashFees: null,
    seats: null,
    cabin: null,
    transferFromProgramId: "chase",
    transferRatio: 1,
    centsPerPoint: null,
    availabilityStatus: "unknown",
    nightCountCovered: 1,
    coverageStatus: "source_explicit",
    goalMatch: "partial",
    ...overrides,
  };
}

function makeInventory(
  overrides: Partial<StrategyPointsInventoryItem> = {}
): StrategyPointsInventoryItem {
  return {
    accountId: "account-chase",
    rewardProgramId: "chase",
    programName: "Chase Ultimate Rewards",
    ownerLabel: "Me",
    ownerType: "self",
    balance: 200_000,
    balanceAsOf: "2026-08-26",
    origin: "manual",
    verificationStatus: "verified",
    ...overrides,
  };
}

function derive(
  flights: StrategyAwardOption[],
  hotels: StrategyAwardOption[],
  inventory: StrategyPointsInventoryItem[]
) {
  const scenarios = buildStrategyAllocationScenarios(
    makeGoal(),
    flights,
    hotels,
    inventory
  );
  return deriveDeterministicStrategyOutcome(scenarios, inventory);
}

describe("deriveDeterministicStrategyOutcome", () => {
  it("reports a feasible whole-trip scenario from one verified self-owned account", () => {
    assert.deepEqual(
      derive([makeFlight()], [makeHotel()], [makeInventory()]),
      { feasibility: "on_track", pointsGap: 0 }
    );
  });

  it("reports an exact gap only for one unambiguous account and program", () => {
    assert.deepEqual(
      derive(
        [makeFlight()],
        [makeHotel()],
        [makeInventory({ balance: 150_000 })]
      ),
      { feasibility: "gap_remaining", pointsGap: 25_000 }
    );
  });

  it("does not sum gaps across multiple programs", () => {
    const inventory = [
      makeInventory({ balance: 80_000 }),
      makeInventory({
        accountId: "account-amex",
        rewardProgramId: "amex",
        programName: "American Express Membership Rewards",
        balance: 60_000,
      }),
    ];

    assert.deepEqual(
      derive(
        [makeFlight()],
        [makeHotel({ transferFromProgramId: "amex" })],
        inventory
      ),
      { feasibility: "gap_remaining", pointsGap: null }
    );
  });

  it("does not combine balances from separate accounts in one program", () => {
    const inventory = [
      makeInventory({ balance: 80_000 }),
      makeInventory({
        accountId: "account-chase-2",
        ownerLabel: "Second account",
        balance: 70_000,
      }),
    ];

    assert.deepEqual(derive([makeFlight()], [makeHotel()], inventory), {
      feasibility: "gap_remaining",
      pointsGap: 95_000,
    });
  });

  it("does not treat an unverified balance as funding", () => {
    assert.deepEqual(
      derive(
        [makeFlight()],
        [makeHotel()],
        [makeInventory({ verificationStatus: "unverified" })]
      ),
      { feasibility: "insufficient_information", pointsGap: null }
    );
  });

  it("does not treat a verified companion balance as funding", () => {
    assert.deepEqual(
      derive(
        [makeFlight()],
        [makeHotel()],
        [makeInventory({ ownerType: "companion", ownerLabel: "Companion" })]
      ),
      { feasibility: "insufficient_information", pointsGap: null }
    );
  });

  it("ignores companion and unverified balances beside verified self-owned funding", () => {
    const inventory = [
      makeInventory({ balance: 150_000 }),
      makeInventory({
        accountId: "account-companion",
        ownerType: "companion",
        ownerLabel: "Companion",
        balance: 500_000,
      }),
      makeInventory({
        accountId: "account-unverified",
        verificationStatus: "unverified",
        balance: 500_000,
      }),
    ];

    assert.deepEqual(derive([makeFlight()], [makeHotel()], inventory), {
      feasibility: "gap_remaining",
      pointsGap: 25_000,
    });
  });

  it("withholds a numeric gap when the allocation identity is ambiguous", () => {
    const duplicatedAccount = makeInventory({ balance: 150_000 });

    assert.deepEqual(
      derive(
        [makeFlight()],
        [makeHotel()],
        [duplicatedAccount, { ...duplicatedAccount }]
      ),
      { feasibility: "insufficient_information", pointsGap: null }
    );
  });

  it("requires both a flight and hotel option", () => {
    assert.deepEqual(
      derive([makeFlight()], [], [makeInventory()]),
      { feasibility: "insufficient_information", pointsGap: null }
    );
    assert.deepEqual(
      derive([], [makeHotel()], [makeInventory()]),
      { feasibility: "insufficient_information", pointsGap: null }
    );
  });

  it("returns insufficient information when either option is uncalculable", () => {
    assert.deepEqual(
      derive(
        [makeFlight({ travelerCountCovered: null })],
        [makeHotel()],
        [makeInventory()]
      ),
      { feasibility: "insufficient_information", pointsGap: null }
    );
    assert.deepEqual(
      derive(
        [makeFlight()],
        [makeHotel({ pricingBasis: "unknown" })],
        [makeInventory()]
      ),
      { feasibility: "insufficient_information", pointsGap: null }
    );
  });
});
