import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Goal } from "./types";
import type {
  StrategyAwardOption,
  StrategyPointsInventoryItem,
  StrategyAllocationScenario,
} from "./strategyTypes";
import { buildStrategyAllocationScenarios } from "./strategyAllocationBuilder";

// ---------------------------------------------------------------------------
// Synthetic test data helpers
// ---------------------------------------------------------------------------

function makeGoal(overrides: Partial<Goal> = {}): Goal {
  return {
    id: "goal-1",
    userId: "user-1",
    type: "travel",
    title: "Paris Summer 2026",
    status: "active",
    origin: ["JFK"],
    destinations: ["CDG"],
    earliestDeparture: "2026-07-01",
    latestReturn: "2026-07-10",
    minimumNights: null,
    maximumNights: null,
    travelerCount: 2,
    cabinPreference: "economy",
    optimizationPriority: "balanced",
    maximumCashBudget: null,
    currency: "USD",
    allowNewCards: false,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function makeFlightOption(overrides: Partial<StrategyAwardOption> = {}): StrategyAwardOption {
  return {
    id: "flight-1",
    sourceId: "src-1",
    programName: "Air France/KLM Flying Blue",
    redemptionType: "flight",
    pricingBasis: "round_trip",
    itineraryLabel: "JFK-CDG",
    pointsRequired: 30000,
    cashFees: null,
    seats: null,
    cabin: "economy",
    transferFromProgramId: "chase_ur",
    transferRatio: 1,
    centsPerPoint: null,
    availabilityStatus: "available",
    travelerCountCovered: 1,
    coverageStatus: "standard_assumption",
    goalMatch: "exact",
    ...overrides,
  };
}

function makeHotelOption(overrides: Partial<StrategyAwardOption> = {}): StrategyAwardOption {
  return {
    id: "hotel-1",
    sourceId: "src-2",
    programName: "World of Hyatt",
    redemptionType: "hotel",
    pricingBasis: "per_night",
    itineraryLabel: "Park Hyatt Paris",
    pointsRequired: 35000,
    cashFees: null,
    seats: null,
    cabin: null,
    transferFromProgramId: "chase_ur",
    transferRatio: 1,
    centsPerPoint: null,
    availabilityStatus: "available",
    nightCountCovered: 1,
    coverageStatus: "standard_assumption",
    goalMatch: "exact",
    ...overrides,
  };
}

function makeInventoryItem(overrides: Partial<StrategyPointsInventoryItem> = {}): StrategyPointsInventoryItem {
  return {
    accountId: "acct-chase",
    rewardProgramId: "chase_ur",
    programName: "Chase Ultimate Rewards",
    ownerLabel: "Me",
    ownerType: "self",
    balance: 100000,
    balanceAsOf: "2026-08-01",
    origin: "manual",
    verificationStatus: "verified",
    ...overrides,
  };
}

function findScenario(
  scenarios: StrategyAllocationScenario[],
  kind: string,
): StrategyAllocationScenario {
  const s = scenarios.find((sc) => sc.kind === kind);
  if (!s) throw new Error(`Scenario "${kind}" not found`);
  return s;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("buildStrategyAllocationScenarios", () => {
  it("returns exactly four scenarios in required order", () => {
    const goal = makeGoal();
    const flights = [makeFlightOption()];
    const hotels = [makeHotelOption()];
    const inventory = [makeInventoryItem()];

    const scenarios = buildStrategyAllocationScenarios(goal, flights, hotels, inventory);
    assert.equal(scenarios.length, 4);
    assert.equal(scenarios[0].kind, "flight_first");
    assert.equal(scenarios[1].kind, "hotel_first");
    assert.equal(scenarios[2].kind, "balanced");
    assert.equal(scenarios[3].kind, "fallback");
    assert.match(scenarios[0].title, /points planning scenario/i);
  });

  it("2-traveler 30k round-trip flight requires 60k", () => {
    const goal = makeGoal({ travelerCount: 2 });
    const flights = [
      makeFlightOption({
        id: "flight-1",
        pointsRequired: 30000,
        pricingBasis: "round_trip",
        travelerCountCovered: 1,
      }),
    ];
    const hotels: StrategyAwardOption[] = [];
    const inventory = [makeInventoryItem({ balance: 100000 })];

    const scenarios = buildStrategyAllocationScenarios(goal, flights, hotels, inventory);
    const ff = findScenario(scenarios, "flight_first");
    assert.equal(ff.status, "feasible");
    assert.equal(ff.flightPointsRequired, 60000);
    assert.equal(ff.allocations.length, 1);
    assert.equal(ff.allocations[0].plannedPoints, 60000);
  });

  it("27-night 35k-per-night hotel requires 945k", () => {
    const goal = makeGoal({
      earliestDeparture: "2026-07-01",
      latestReturn: "2026-07-28",
    });
    const flights: StrategyAwardOption[] = [];
    const hotels = [
      makeHotelOption({
        id: "hotel-1",
        pointsRequired: 35000,
        pricingBasis: "per_night",
        nightCountCovered: 1,
      }),
    ];
    const inventory = [makeInventoryItem({ balance: 1000000 })];

    const scenarios = buildStrategyAllocationScenarios(goal, flights, hotels, inventory);
    const hf = findScenario(scenarios, "hotel_first");
    assert.equal(hf.status, "feasible");
    assert.equal(hf.hotelPointsRequired, 945000);
    assert.equal(hf.allocations.length, 1);
    assert.equal(hf.allocations[0].plannedPoints, 945000);
  });

  it("flight-first with 80k balance leaves 20k remaining", () => {
    const goal = makeGoal({ travelerCount: 2 });
    const flights = [
      makeFlightOption({
        id: "flight-1",
        pointsRequired: 30000,
        pricingBasis: "round_trip",
        travelerCountCovered: 1,
      }),
    ];
    const hotels: StrategyAwardOption[] = [];
    const inventory = [makeInventoryItem({ balance: 80000 })];

    const scenarios = buildStrategyAllocationScenarios(goal, flights, hotels, inventory);
    const ff = findScenario(scenarios, "flight_first");
    assert.equal(ff.status, "feasible");
    assert.equal(ff.allocations[0].plannedPoints, 60000);
    assert.equal(ff.allocations[0].availablePoints, 80000);
    assert.equal(ff.allocations[0].remainingPoints, 20000);
    assert.equal(ff.allocations[0].pointsGap, 0);
  });

  it("hotel-first with 80k balance has an 865k gap", () => {
    const goal = makeGoal({
      earliestDeparture: "2026-07-01",
      latestReturn: "2026-07-28",
    });
    const flights: StrategyAwardOption[] = [];
    const hotels = [
      makeHotelOption({
        id: "hotel-1",
        pointsRequired: 35000,
        pricingBasis: "per_night",
        nightCountCovered: 1,
      }),
    ];
    const inventory = [makeInventoryItem({ balance: 80000 })];

    const scenarios = buildStrategyAllocationScenarios(goal, flights, hotels, inventory);
    const hf = findScenario(scenarios, "hotel_first");
    assert.equal(hf.status, "gap");
    assert.equal(hf.hotelPointsRequired, 945000);
    assert.equal(hf.allocations[0].plannedPoints, 945000);
    assert.equal(hf.allocations[0].availablePoints, 80000);
    assert.equal(hf.allocations[0].remainingPoints, 0);
    assert.equal(hf.allocations[0].pointsGap, 865000);
  });

  it("balanced same-account allocation combines only that account", () => {
    const goal = makeGoal({ travelerCount: 2 });
    const flights = [
      makeFlightOption({
        id: "flight-1",
        pointsRequired: 30000,
        pricingBasis: "round_trip",
        travelerCountCovered: 1,
        transferFromProgramId: "chase_ur",
      }),
    ];
    const hotels = [
      makeHotelOption({
        id: "hotel-1",
        pointsRequired: 35000,
        pricingBasis: "per_night",
        nightCountCovered: 1,
        transferFromProgramId: "chase_ur",
      }),
    ];
    const inventory = [makeInventoryItem({ accountId: "acct-chase", rewardProgramId: "chase_ur", balance: 200000 })];

    const scenarios = buildStrategyAllocationScenarios(goal, flights, hotels, inventory);
    const bal = findScenario(scenarios, "balanced");
    // Should have exactly one allocation (combined)
    assert.equal(bal.allocations.length, 1);
    assert.equal(bal.allocations[0].accountId, "acct-chase");
    // 60k flight + 315k hotel (9 nights * 35k) = 375k
    assert.equal(bal.allocations[0].plannedPoints, 60000 + 315000);
    assert.equal(bal.allocations[0].availablePoints, 200000);
    assert.equal(bal.allocations[0].remainingPoints, 0);
    assert.equal(bal.allocations[0].pointsGap, 175000);
  });

  it("different-program allocations remain separate", () => {
    const goal = makeGoal({ travelerCount: 2 });
    const flights = [
      makeFlightOption({
        id: "flight-1",
        pointsRequired: 30000,
        pricingBasis: "round_trip",
        travelerCountCovered: 1,
        transferFromProgramId: "chase_ur",
        programName: "Air France/KLM Flying Blue",
      }),
    ];
    const hotels = [
      makeHotelOption({
        id: "hotel-1",
        pointsRequired: 35000,
        pricingBasis: "per_night",
        nightCountCovered: 1,
        transferFromProgramId: "amex_mr",
        programName: "World of Hyatt",
      }),
    ];
    const inventory: StrategyPointsInventoryItem[] = [
      makeInventoryItem({
        accountId: "acct-chase",
        rewardProgramId: "chase_ur",
        programName: "Chase Ultimate Rewards",
        balance: 100000,
      }),
      makeInventoryItem({
        accountId: "acct-amex",
        rewardProgramId: "amex_mr",
        programName: "Amex Membership Rewards",
        balance: 500000,
        ownerLabel: "Me",
        ownerType: "self",
        verificationStatus: "verified",
      }),
    ];

    const scenarios = buildStrategyAllocationScenarios(goal, flights, hotels, inventory);
    const bal = findScenario(scenarios, "balanced");
    assert.equal(bal.allocations.length, 2);
    const chaseAlloc = bal.allocations.find((a) => a.accountId === "acct-chase");
    const amexAlloc = bal.allocations.find((a) => a.accountId === "acct-amex");
    assert.ok(chaseAlloc, "Expected Chase allocation");
    assert.ok(amexAlloc, "Expected Amex allocation");
    assert.equal(chaseAlloc!.plannedPoints, 60000);
    assert.equal(amexAlloc!.plannedPoints, 315000);
  });

  it("unverified balances are never used", () => {
    const goal = makeGoal({ travelerCount: 2 });
    const flights = [
      makeFlightOption({
        id: "flight-1",
        pointsRequired: 30000,
        pricingBasis: "round_trip",
        travelerCountCovered: 1,
        transferFromProgramId: "chase_ur",
      }),
    ];
    const hotels: StrategyAwardOption[] = [];
    const inventory: StrategyPointsInventoryItem[] = [
      makeInventoryItem({
        accountId: "acct-unverified",
        rewardProgramId: "chase_ur",
        balance: 500000,
        verificationStatus: "unverified",
      }),
    ];

    const scenarios = buildStrategyAllocationScenarios(goal, flights, hotels, inventory);
    const ff = findScenario(scenarios, "flight_first");
    assert.equal(ff.status, "insufficient_information");
  });

  it("companion balances are never used", () => {
    const goal = makeGoal({ travelerCount: 2 });
    const flights = [
      makeFlightOption({
        id: "flight-1",
        pointsRequired: 30000,
        pricingBasis: "round_trip",
        travelerCountCovered: 1,
        transferFromProgramId: "chase_ur",
      }),
    ];
    const hotels: StrategyAwardOption[] = [];
    const inventory: StrategyPointsInventoryItem[] = [
      makeInventoryItem({
        accountId: "acct-companion",
        rewardProgramId: "chase_ur",
        balance: 500000,
        verificationStatus: "verified",
        ownerType: "companion",
      }),
    ];

    const scenarios = buildStrategyAllocationScenarios(goal, flights, hotels, inventory);
    const ff = findScenario(scenarios, "flight_first");
    assert.equal(ff.status, "insufficient_information");
  });

  it("model exact and partial labels cannot outrank an otherwise equivalent general option", () => {
    const goal = makeGoal({ travelerCount: 2 });
    // All are equally calculable and fundable. Their labels are model-produced
    // rather than source-bound structured evidence, so source order wins.
    const flights: StrategyAwardOption[] = [
      makeFlightOption({
        id: "flight-general",
        pointsRequired: 30000,
        pricingBasis: "round_trip",
        travelerCountCovered: 1,
        goalMatch: "general",
      }),
      makeFlightOption({
        id: "flight-partial",
        pointsRequired: 30000,
        pricingBasis: "round_trip",
        travelerCountCovered: 1,
        goalMatch: "partial",
      }),
      makeFlightOption({
        id: "flight-exact",
        pointsRequired: 30000,
        pricingBasis: "round_trip",
        travelerCountCovered: 1,
        goalMatch: "exact",
      }),
    ];
    const hotels: StrategyAwardOption[] = [];
    const inventory = [makeInventoryItem({ balance: 100000 })];

    const scenarios = buildStrategyAllocationScenarios(goal, flights, hotels, inventory);
    const ff = findScenario(scenarios, "flight_first");
    assert.equal(ff.flightOptionId, "flight-general");
  });

  it("different-destination option is excluded from primary scenarios", () => {
    const goal = makeGoal({ travelerCount: 2 });
    const flights: StrategyAwardOption[] = [
      makeFlightOption({
        id: "flight-diff",
        pointsRequired: 30000,
        pricingBasis: "round_trip",
        travelerCountCovered: 1,
        goalMatch: "different_destination",
        itineraryLabel: "JFK-LHR",
      }),
    ];
    const hotels: StrategyAwardOption[] = [];
    const inventory = [makeInventoryItem({ balance: 100000 })];

    const scenarios = buildStrategyAllocationScenarios(goal, flights, hotels, inventory);
    const ff = findScenario(scenarios, "flight_first");
    // No non-different-destination flight exists, so flight_first is insufficient
    assert.equal(ff.status, "insufficient_information");
  });

  it("London option may appear only as conditional fallback for Paris", () => {
    const goal = makeGoal({
      travelerCount: 2,
      destinations: ["CDG"],
    });
    const flights: StrategyAwardOption[] = [
      makeFlightOption({
        id: "flight-paris",
        pointsRequired: 30000,
        pricingBasis: "round_trip",
        travelerCountCovered: 1,
        goalMatch: "exact",
        itineraryLabel: "JFK-CDG",
      }),
    ];
    const hotels: StrategyAwardOption[] = [];
    const inventory = [makeInventoryItem({ balance: 100000 })];

    // Add a London option that is different_destination
    const londonFlight = makeFlightOption({
      id: "flight-london",
      pointsRequired: 25000,
      pricingBasis: "round_trip",
      travelerCountCovered: 1,
      goalMatch: "different_destination",
      itineraryLabel: "JFK-LHR",
    });

    const scenarios = buildStrategyAllocationScenarios(
      goal,
      [flights[0], londonFlight],
      hotels,
      inventory,
    );

    // Primary scenarios use Paris
    const ff = findScenario(scenarios, "flight_first");
    assert.equal(ff.flightOptionId, "flight-paris");

    // Fallback should use London (different_destination) since Paris is already used
    const fb = findScenario(scenarios, "fallback");
    assert.equal(fb.flightOptionId, "flight-london");
    assert.equal(fb.status, "conditional");
    assert.ok(
      fb.warnings.some((w) => w.includes("conditional planning alternative")),
      "Expected conditional planning warning",
    );
    assert.ok(
      !fb.warnings.some((w) => w.includes("does not match the requested destination")),
      "Model classification must not be rendered as a proven mismatch",
    );
  });

  it("unavailable options are excluded", () => {
    const goal = makeGoal({ travelerCount: 2 });
    const flights: StrategyAwardOption[] = [
      makeFlightOption({
        id: "flight-unavailable",
        pointsRequired: 30000,
        pricingBasis: "round_trip",
        travelerCountCovered: 1,
        availabilityStatus: "unavailable",
      }),
    ];
    const hotels: StrategyAwardOption[] = [];
    const inventory = [makeInventoryItem({ balance: 100000 })];

    const scenarios = buildStrategyAllocationScenarios(goal, flights, hotels, inventory);
    const ff = findScenario(scenarios, "flight_first");
    assert.equal(ff.status, "insufficient_information");
  });

  it("missing coverage produces insufficient_information", () => {
    const goal = makeGoal({ travelerCount: 2 });
    const flights: StrategyAwardOption[] = [
      makeFlightOption({
        id: "flight-no-coverage",
        pointsRequired: 30000,
        pricingBasis: "round_trip",
        travelerCountCovered: null,
      }),
    ];
    const hotels: StrategyAwardOption[] = [];
    const inventory = [makeInventoryItem({ balance: 100000 })];

    const scenarios = buildStrategyAllocationScenarios(goal, flights, hotels, inventory);
    const ff = findScenario(scenarios, "flight_first");
    assert.equal(ff.status, "insufficient_information");
  });

  it("no alternative produces an insufficient fallback", () => {
    const goal = makeGoal({ travelerCount: 2 });
    const flights: StrategyAwardOption[] = [
      makeFlightOption({
        id: "flight-1",
        pointsRequired: 30000,
        pricingBasis: "round_trip",
        travelerCountCovered: 1,
      }),
    ];
    const hotels: StrategyAwardOption[] = [];
    const inventory = [makeInventoryItem({ balance: 100000 })];

    const scenarios = buildStrategyAllocationScenarios(goal, flights, hotels, inventory);
    const fb = findScenario(scenarios, "fallback");
    // The only option is already used by flight_first, so fallback has nothing
    assert.equal(fb.status, "insufficient_information");
  });

  it("no cross-program total is created", () => {
    const goal = makeGoal({ travelerCount: 2 });
    const flights = [
      makeFlightOption({
        id: "flight-1",
        pointsRequired: 30000,
        pricingBasis: "round_trip",
        travelerCountCovered: 1,
        transferFromProgramId: "chase_ur",
      }),
    ];
    const hotels = [
      makeHotelOption({
        id: "hotel-1",
        pointsRequired: 35000,
        pricingBasis: "per_night",
        nightCountCovered: 1,
        transferFromProgramId: "amex_mr",
      }),
    ];
    const inventory: StrategyPointsInventoryItem[] = [
      makeInventoryItem({
        accountId: "acct-chase",
        rewardProgramId: "chase_ur",
        balance: 100000,
      }),
      makeInventoryItem({
        accountId: "acct-amex",
        rewardProgramId: "amex_mr",
        balance: 500000,
        ownerLabel: "Me",
        ownerType: "self",
        verificationStatus: "verified",
      }),
    ];

    const scenarios = buildStrategyAllocationScenarios(goal, flights, hotels, inventory);
    const bal = findScenario(scenarios, "balanced");
    // Two separate allocations, never combined across programs
    assert.equal(bal.allocations.length, 2);
    // Verify no allocation combines both programs
    for (const alloc of bal.allocations) {
      assert.ok(
        alloc.rewardProgramId === "chase_ur" || alloc.rewardProgramId === "amex_mr",
        "Allocation should belong to exactly one program",
      );
    }
  });

  it("inputs remain unchanged", () => {
    const goal = makeGoal({ travelerCount: 2 });
    const flights = [makeFlightOption()];
    const hotels = [makeHotelOption()];
    const inventory = [makeInventoryItem()];

    const frozenGoal = JSON.stringify(goal);
    const frozenFlights = JSON.stringify(flights);
    const frozenHotels = JSON.stringify(hotels);
    const frozenInventory = JSON.stringify(inventory);

    buildStrategyAllocationScenarios(goal, flights, hotels, inventory);

    assert.equal(JSON.stringify(goal), frozenGoal);
    assert.equal(JSON.stringify(flights), frozenFlights);
    assert.equal(JSON.stringify(hotels), frozenHotels);
    assert.equal(JSON.stringify(inventory), frozenInventory);
  });

  it("every scenario includes travelerCount and tripNights", () => {
    const goal = makeGoal({ travelerCount: 2 });
    const flights = [makeFlightOption()];
    const hotels = [makeHotelOption()];
    const inventory = [makeInventoryItem()];

    const scenarios = buildStrategyAllocationScenarios(goal, flights, hotels, inventory);
    for (const s of scenarios) {
      assert.equal(s.travelerCount, 2);
      assert.equal(s.tripNights, 9);
    }
  });
it("scenarios use the declared minimumNights, not the full date-window span", () => {
    const goal = makeGoal({
      earliestDeparture: "2026-07-01",
      latestReturn: "2026-07-28",
      minimumNights: 8,
      maximumNights: 16,
    });
    const flights = [makeFlightOption()];
    const hotels = [makeHotelOption()];
    const inventory = [makeInventoryItem()];

    const scenarios = buildStrategyAllocationScenarios(goal, flights, hotels, inventory);
    assert.ok(scenarios.length > 0);
    for (const s of scenarios) {
      assert.equal(s.tripNights, 8);
    }
  });
});
