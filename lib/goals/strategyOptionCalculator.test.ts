import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Goal } from "./types";
import type { StrategyAwardOption, StrategyPointsInventoryItem } from "./strategyTypes";
import {
  calculateTripNights,
  calculateFlightPointsRequired,
  calculateHotelPointsRequired,
  findFundingAccount,
} from "./strategyOptionCalculator";

// ---------------------------------------------------------------------------
// Synthetic test data helpers
// ---------------------------------------------------------------------------

function makeGoal(overrides: Partial<Goal> = {}): Goal {
  return {
    id: "goal-1",
    userId: "user-1",
    type: "travel",
    title: "Test Goal",
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
    id: "opt-1",
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
    ...overrides,
  };
}

function makeHotelOption(overrides: Partial<StrategyAwardOption> = {}): StrategyAwardOption {
  return {
    id: "opt-2",
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
    ...overrides,
  };
}

function makeInventoryItem(overrides: Partial<StrategyPointsInventoryItem> = {}): StrategyPointsInventoryItem {
  return {
    accountId: "acct-1",
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

// ---------------------------------------------------------------------------
// calculateTripNights
// ---------------------------------------------------------------------------

describe("calculateTripNights", () => {
  it("returns correct nights for a valid date range without timezone drift", () => {
    const goal = makeGoal({
      earliestDeparture: "2026-07-01",
      latestReturn: "2026-07-10",
    });
    // July 1 to July 10 = 9 nights
    assert.equal(calculateTripNights(goal), 9);
  });

  it("returns correct nights across month boundaries", () => {
    const goal = makeGoal({
      earliestDeparture: "2026-06-25",
      latestReturn: "2026-07-05",
    });
    // June 25 to July 5 = 10 nights
    assert.equal(calculateTripNights(goal), 10);
  });

  it("returns correct nights across year boundaries", () => {
    const goal = makeGoal({
      earliestDeparture: "2026-12-28",
      latestReturn: "2027-01-03",
    });
    // Dec 28 to Jan 3 = 6 nights
    assert.equal(calculateTripNights(goal), 6);
  });

  it("returns null for missing earliestDeparture", () => {
    const goal = makeGoal({ earliestDeparture: null, latestReturn: "2026-07-10" });
    assert.equal(calculateTripNights(goal), null);
  });

  it("returns null for missing latestReturn", () => {
    const goal = makeGoal({ earliestDeparture: "2026-07-01", latestReturn: null });
    assert.equal(calculateTripNights(goal), null);
  });

  it("returns null for both dates null", () => {
    const goal = makeGoal({ earliestDeparture: null, latestReturn: null });
    assert.equal(calculateTripNights(goal), null);
  });

  it("returns null for invalid date string", () => {
    const goal = makeGoal({ earliestDeparture: "not-a-date", latestReturn: "2026-07-10" });
    assert.equal(calculateTripNights(goal), null);
  });

  it("returns null for reversed dates (return before departure)", () => {
    const goal = makeGoal({
      earliestDeparture: "2026-07-10",
      latestReturn: "2026-07-01",
    });
    assert.equal(calculateTripNights(goal), null);
  });

  it("returns null for same-day departure and return (zero nights)", () => {
    const goal = makeGoal({
      earliestDeparture: "2026-07-01",
      latestReturn: "2026-07-01",
    });
    assert.equal(calculateTripNights(goal), null);
  });

  it("handles full ISO datetime strings without timezone drift", () => {
    // A datetime with a time component should still use only the date portion
    const goal = makeGoal({
      earliestDeparture: "2026-07-01T15:30:00-04:00",
      latestReturn: "2026-07-10T08:00:00+02:00",
    });
    assert.equal(calculateTripNights(goal), 9);
  });
it("respects declared minimumNights over a wider date window", () => {
    const goal = makeGoal({
      earliestDeparture: "2026-07-01",
      latestReturn: "2026-07-28",
      minimumNights: 8,
      maximumNights: 16,
    });
    // Window span is 27 nights, but the declared minimum (8) is the stay length.
    assert.equal(calculateTripNights(goal), 8);
  });

  it("falls back to maximumNights when only the maximum is declared", () => {
    const goal = makeGoal({
      earliestDeparture: "2026-07-01",
      latestReturn: "2026-07-28",
      minimumNights: null,
      maximumNights: 16,
    });
    assert.equal(calculateTripNights(goal), 16);
  });

  it("prefers declared minimum even when it exceeds the span", () => {
    const goal = makeGoal({
      earliestDeparture: "2026-07-01",
      latestReturn: "2026-07-04",
      minimumNights: 5,
      maximumNights: null,
    });
    // Span is only 3 nights, but the declared minimum (5) wins.
    assert.equal(calculateTripNights(goal), 5);
  });
});

// ---------------------------------------------------------------------------
// calculateFlightPointsRequired
// ---------------------------------------------------------------------------

describe("calculateFlightPointsRequired", () => {
  it("30,000 round-trip × 2 single-traveler groups = 60,000", () => {
    const option = makeFlightOption({
      pointsRequired: 30000,
      pricingBasis: "round_trip",
      travelerCountCovered: 1,
    });
    const goal = makeGoal({ travelerCount: 2 });
    const result = calculateFlightPointsRequired(option, goal);
    assert.equal(result.status, "calculated");
    assert.equal(result.pointsRequired, 60000);
  });

  it("20,000 one-way × 2 travelers × 2 directions = 80,000", () => {
    const option = makeFlightOption({
      pointsRequired: 20000,
      pricingBasis: "one_way",
      travelerCountCovered: 1,
    });
    const goal = makeGoal({ travelerCount: 2, latestReturn: "2026-07-10" });
    const result = calculateFlightPointsRequired(option, goal);
    assert.equal(result.status, "calculated");
    assert.equal(result.pointsRequired, 80000);
  });

  it("75,000 covering 3 travelers remains 75,000 for 2 travelers (no proration)", () => {
    const option = makeFlightOption({
      pointsRequired: 75000,
      pricingBasis: "round_trip",
      travelerCountCovered: 3,
    });
    const goal = makeGoal({ travelerCount: 2 });
    const result = calculateFlightPointsRequired(option, goal);
    assert.equal(result.status, "calculated");
    // ceil(2/3) = 1 group → 75,000 * 1 = 75,000
    assert.equal(result.pointsRequired, 75000);
  });

  it("one-way without latestReturn uses single direction", () => {
    const option = makeFlightOption({
      pointsRequired: 25000,
      pricingBasis: "one_way",
      travelerCountCovered: 1,
    });
    const goal = makeGoal({ travelerCount: 1, latestReturn: null });
    const result = calculateFlightPointsRequired(option, goal);
    assert.equal(result.status, "calculated");
    assert.equal(result.pointsRequired, 25000);
    // Should include direction assumption
    assert.ok(
      result.assumptions.some((a) => a.includes("latestReturn is not set")),
      "Expected assumption about missing latestReturn",
    );
  });

  it("missing travelerCountCovered returns insufficient_information", () => {
    const option = makeFlightOption({ travelerCountCovered: null });
    const goal = makeGoal({ travelerCount: 2 });
    const result = calculateFlightPointsRequired(option, goal);
    assert.equal(result.status, "insufficient_information");
    assert.equal(result.pointsRequired, null);
  });

  it("unknown pricing basis returns insufficient_information", () => {
    const option = makeFlightOption({ pricingBasis: "unknown" });
    const goal = makeGoal({ travelerCount: 2 });
    const result = calculateFlightPointsRequired(option, goal);
    assert.equal(result.status, "insufficient_information");
    assert.equal(result.pointsRequired, null);
  });

  it("per_night pricing basis for flight returns insufficient_information", () => {
    const option = makeFlightOption({ pricingBasis: "per_night" });
    const goal = makeGoal({ travelerCount: 2 });
    const result = calculateFlightPointsRequired(option, goal);
    assert.equal(result.status, "insufficient_information");
  });

  it("total_stay pricing basis for flight returns insufficient_information", () => {
    const option = makeFlightOption({ pricingBasis: "total_stay" });
    const goal = makeGoal({ travelerCount: 2 });
    const result = calculateFlightPointsRequired(option, goal);
    assert.equal(result.status, "insufficient_information");
  });

  it("hotel redemptionType returns insufficient_information", () => {
    const option = makeFlightOption({ redemptionType: "hotel" });
    const goal = makeGoal({ travelerCount: 2 });
    const result = calculateFlightPointsRequired(option, goal);
    assert.equal(result.status, "insufficient_information");
  });

  it("discloses standard_assumption coverage", () => {
    const option = makeFlightOption({
      pointsRequired: 30000,
      pricingBasis: "round_trip",
      travelerCountCovered: 1,
      coverageStatus: "standard_assumption",
    });
    const goal = makeGoal({ travelerCount: 2 });
    const result = calculateFlightPointsRequired(option, goal);
    assert.equal(result.status, "calculated");
    assert.ok(
      result.assumptions.some((a) => a.includes("standard_assumption")),
      "Expected standard_assumption disclosure",
    );
  });

  it("does not mutate the goal or option", () => {
    const option = makeFlightOption({
      pointsRequired: 30000,
      pricingBasis: "round_trip",
      travelerCountCovered: 1,
    });
    const goal = makeGoal({ travelerCount: 2 });
    const frozenGoal = JSON.stringify(goal);
    const frozenOption = JSON.stringify(option);
    calculateFlightPointsRequired(option, goal);
    assert.equal(JSON.stringify(goal), frozenGoal);
    assert.equal(JSON.stringify(option), frozenOption);
  });
});

// ---------------------------------------------------------------------------
// calculateHotelPointsRequired
// ---------------------------------------------------------------------------

describe("calculateHotelPointsRequired", () => {
  it("35,000 per night × 27 nights = 945,000", () => {
    const option = makeHotelOption({
      pointsRequired: 35000,
      pricingBasis: "per_night",
      nightCountCovered: 1,
    });
    const goal = makeGoal({
      earliestDeparture: "2026-07-01",
      latestReturn: "2026-07-28", // 27 nights
    });
    const result = calculateHotelPointsRequired(option, goal);
    assert.equal(result.status, "calculated");
    assert.equal(result.pointsRequired, 945000);
  });

  it("per_night with multi-night coverage groups correctly", () => {
    const option = makeHotelOption({
      pointsRequired: 70000,
      pricingBasis: "per_night",
      nightCountCovered: 2,
    });
    const goal = makeGoal({
      earliestDeparture: "2026-07-01",
      latestReturn: "2026-07-06", // 5 nights
    });
    const result = calculateHotelPointsRequired(option, goal);
    assert.equal(result.status, "calculated");
    // ceil(5/2) = 3 groups → 70,000 * 3 = 210,000
    assert.equal(result.pointsRequired, 210000);
  });

  it("total_stay calculates for exact night-count match", () => {
    const option = makeHotelOption({
      pointsRequired: 150000,
      pricingBasis: "total_stay",
      nightCountCovered: 5,
    });
    const goal = makeGoal({
      earliestDeparture: "2026-07-01",
      latestReturn: "2026-07-06", // 5 nights
    });
    const result = calculateHotelPointsRequired(option, goal);
    assert.equal(result.status, "calculated");
    assert.equal(result.pointsRequired, 150000);
  });

  it("total_stay returns insufficient_information when night counts differ", () => {
    const option = makeHotelOption({
      pointsRequired: 150000,
      pricingBasis: "total_stay",
      nightCountCovered: 5,
    });
    const goal = makeGoal({
      earliestDeparture: "2026-07-01",
      latestReturn: "2026-07-10", // 9 nights, not 5
    });
    const result = calculateHotelPointsRequired(option, goal);
    assert.equal(result.status, "insufficient_information");
    assert.equal(result.pointsRequired, null);
    assert.ok(
      result.warnings.some((w) => w.includes("does not scale linearly")),
      "Expected warning about total-stay not scaling linearly",
    );
  });

  it("invalid hotel dates return insufficient_information", () => {
    const option = makeHotelOption({
      pointsRequired: 35000,
      pricingBasis: "per_night",
      nightCountCovered: 1,
    });
    const goal = makeGoal({
      earliestDeparture: null,
      latestReturn: null,
    });
    const result = calculateHotelPointsRequired(option, goal);
    assert.equal(result.status, "insufficient_information");
    assert.equal(result.pointsRequired, null);
  });

  it("one_way pricing basis for hotel returns insufficient_information", () => {
    const option = makeHotelOption({ pricingBasis: "one_way" });
    const goal = makeGoal({
      earliestDeparture: "2026-07-01",
      latestReturn: "2026-07-06",
    });
    const result = calculateHotelPointsRequired(option, goal);
    assert.equal(result.status, "insufficient_information");
  });

  it("round_trip pricing basis for hotel returns insufficient_information", () => {
    const option = makeHotelOption({ pricingBasis: "round_trip" });
    const goal = makeGoal({
      earliestDeparture: "2026-07-01",
      latestReturn: "2026-07-06",
    });
    const result = calculateHotelPointsRequired(option, goal);
    assert.equal(result.status, "insufficient_information");
  });

  it("unknown pricing basis for hotel returns insufficient_information", () => {
    const option = makeHotelOption({ pricingBasis: "unknown" });
    const goal = makeGoal({
      earliestDeparture: "2026-07-01",
      latestReturn: "2026-07-06",
    });
    const result = calculateHotelPointsRequired(option, goal);
    assert.equal(result.status, "insufficient_information");
  });

  it("flight redemptionType returns insufficient_information", () => {
    const option = makeHotelOption({ redemptionType: "flight" });
    const goal = makeGoal({
      earliestDeparture: "2026-07-01",
      latestReturn: "2026-07-06",
    });
    const result = calculateHotelPointsRequired(option, goal);
    assert.equal(result.status, "insufficient_information");
  });

  it("discloses one-room assumption", () => {
    const option = makeHotelOption({
      pointsRequired: 35000,
      pricingBasis: "per_night",
      nightCountCovered: 1,
    });
    const goal = makeGoal({
      earliestDeparture: "2026-07-01",
      latestReturn: "2026-07-06",
    });
    const result = calculateHotelPointsRequired(option, goal);
    assert.equal(result.status, "calculated");
    assert.ok(
      result.assumptions.some((a) => a.includes("one room")),
      "Expected one-room assumption",
    );
  });

  it("discloses standard_assumption coverage for hotel", () => {
    const option = makeHotelOption({
      pointsRequired: 35000,
      pricingBasis: "per_night",
      nightCountCovered: 1,
      coverageStatus: "standard_assumption",
    });
    const goal = makeGoal({
      earliestDeparture: "2026-07-01",
      latestReturn: "2026-07-06",
    });
    const result = calculateHotelPointsRequired(option, goal);
    assert.equal(result.status, "calculated");
    assert.ok(
      result.assumptions.some((a) => a.includes("standard_assumption")),
      "Expected standard_assumption disclosure for hotel",
    );
  });

  it("does not mutate the goal or option", () => {
    const option = makeHotelOption({
      pointsRequired: 35000,
      pricingBasis: "per_night",
      nightCountCovered: 1,
    });
    const goal = makeGoal({
      earliestDeparture: "2026-07-01",
      latestReturn: "2026-07-06",
    });
    const frozenGoal = JSON.stringify(goal);
    const frozenOption = JSON.stringify(option);
    calculateHotelPointsRequired(option, goal);
    assert.equal(JSON.stringify(goal), frozenGoal);
    assert.equal(JSON.stringify(option), frozenOption);
  });
});

// ---------------------------------------------------------------------------
// findFundingAccount
// ---------------------------------------------------------------------------

describe("findFundingAccount", () => {
  it("exact transferFromProgramId match is preferred (transfer_source)", () => {
    const option = makeFlightOption({
      transferFromProgramId: "chase_ur",
      programName: "Air France/KLM Flying Blue",
    });
    const inventory: StrategyPointsInventoryItem[] = [
      makeInventoryItem({
        accountId: "acct-chase",
        rewardProgramId: "chase_ur",
        programName: "Chase Ultimate Rewards",
        balance: 100000,
        verificationStatus: "verified",
        ownerType: "self",
      }),
    ];
    const match = findFundingAccount(option, inventory);
    assert.ok(match !== null);
    assert.equal(match!.method, "transfer_source");
    assert.equal(match!.account.accountId, "acct-chase");
  });

  it("exact direct-program name match works (direct_program)", () => {
    const option = makeFlightOption({
      transferFromProgramId: null,
      programName: "Air France/KLM Flying Blue",
    });
    const inventory: StrategyPointsInventoryItem[] = [
      makeInventoryItem({
        accountId: "acct-af",
        rewardProgramId: "flying_blue",
        programName: "Air France/KLM Flying Blue",
        balance: 50000,
        verificationStatus: "verified",
        ownerType: "self",
      }),
    ];
    const match = findFundingAccount(option, inventory);
    assert.ok(match !== null);
    assert.equal(match!.method, "direct_program");
    assert.equal(match!.account.accountId, "acct-af");
  });

  it("transfer_source takes priority over direct_program when both match", () => {
    const option = makeFlightOption({
      transferFromProgramId: "chase_ur",
      programName: "Chase Ultimate Rewards",
    });
    const inventory: StrategyPointsInventoryItem[] = [
      makeInventoryItem({
        accountId: "acct-chase",
        rewardProgramId: "chase_ur",
        programName: "Chase Ultimate Rewards",
        balance: 100000,
        verificationStatus: "verified",
        ownerType: "self",
      }),
      makeInventoryItem({
        accountId: "acct-chase-direct",
        rewardProgramId: "other_id",
        programName: "Chase Ultimate Rewards",
        balance: 200000,
        verificationStatus: "verified",
        ownerType: "self",
      }),
    ];
    const match = findFundingAccount(option, inventory);
    assert.ok(match !== null);
    // Should pick transfer_source even though direct has higher balance
    assert.equal(match!.method, "transfer_source");
    assert.equal(match!.account.accountId, "acct-chase");
  });

  it("unverified accounts are excluded", () => {
    const option = makeFlightOption({
      transferFromProgramId: "chase_ur",
    });
    const inventory: StrategyPointsInventoryItem[] = [
      makeInventoryItem({
        accountId: "acct-unverified",
        rewardProgramId: "chase_ur",
        balance: 500000,
        verificationStatus: "unverified",
        ownerType: "self",
      }),
    ];
    const match = findFundingAccount(option, inventory);
    assert.equal(match, null);
  });

  it("companion accounts are excluded", () => {
    const option = makeFlightOption({
      transferFromProgramId: "chase_ur",
    });
    const inventory: StrategyPointsInventoryItem[] = [
      makeInventoryItem({
        accountId: "acct-companion",
        rewardProgramId: "chase_ur",
        balance: 500000,
        verificationStatus: "verified",
        ownerType: "companion",
      }),
    ];
    const match = findFundingAccount(option, inventory);
    assert.equal(match, null);
  });

  it("multiple accounts are never combined (returns single best match)", () => {
    const option = makeFlightOption({
      transferFromProgramId: "chase_ur",
    });
    const inventory: StrategyPointsInventoryItem[] = [
      makeInventoryItem({
        accountId: "acct-1",
        rewardProgramId: "chase_ur",
        balance: 30000,
        verificationStatus: "verified",
        ownerType: "self",
      }),
      makeInventoryItem({
        accountId: "acct-2",
        rewardProgramId: "chase_ur",
        balance: 70000,
        verificationStatus: "verified",
        ownerType: "self",
      }),
    ];
    const match = findFundingAccount(option, inventory);
    assert.ok(match !== null);
    // Should return exactly one account, not a combined total
    assert.equal(match!.account.balance, 70000);
    assert.equal(match!.account.accountId, "acct-2");
  });

  it("highest eligible balance wins among same-priority matches", () => {
    const option = makeFlightOption({
      transferFromProgramId: "chase_ur",
    });
    const inventory: StrategyPointsInventoryItem[] = [
      makeInventoryItem({
        accountId: "acct-low",
        rewardProgramId: "chase_ur",
        balance: 10000,
        verificationStatus: "verified",
        ownerType: "self",
      }),
      makeInventoryItem({
        accountId: "acct-high",
        rewardProgramId: "chase_ur",
        balance: 200000,
        verificationStatus: "verified",
        ownerType: "self",
      }),
      makeInventoryItem({
        accountId: "acct-mid",
        rewardProgramId: "chase_ur",
        balance: 50000,
        verificationStatus: "verified",
        ownerType: "self",
      }),
    ];
    const match = findFundingAccount(option, inventory);
    assert.ok(match !== null);
    assert.equal(match!.account.accountId, "acct-high");
    assert.equal(match!.account.balance, 200000);
  });

  it("stable tie behavior: first-seen order preserved for equal balances", () => {
    const option = makeFlightOption({
      transferFromProgramId: "chase_ur",
    });
    const inventory: StrategyPointsInventoryItem[] = [
      makeInventoryItem({
        accountId: "acct-first",
        rewardProgramId: "chase_ur",
        balance: 100000,
        verificationStatus: "verified",
        ownerType: "self",
      }),
      makeInventoryItem({
        accountId: "acct-second",
        rewardProgramId: "chase_ur",
        balance: 100000,
        verificationStatus: "verified",
        ownerType: "self",
      }),
    ];
    const match = findFundingAccount(option, inventory);
    assert.ok(match !== null);
    assert.equal(match!.account.accountId, "acct-first");
  });

  it("returns null when no eligible accounts exist", () => {
    const option = makeFlightOption({
      transferFromProgramId: "chase_ur",
    });
    const inventory: StrategyPointsInventoryItem[] = [];
    const match = findFundingAccount(option, inventory);
    assert.equal(match, null);
  });

  it("returns null when no accounts match by programId or name", () => {
    const option = makeFlightOption({
      transferFromProgramId: "amex_mr",
      programName: "Delta SkyMiles",
    });
    const inventory: StrategyPointsInventoryItem[] = [
      makeInventoryItem({
        accountId: "acct-chase",
        rewardProgramId: "chase_ur",
        programName: "Chase Ultimate Rewards",
        balance: 100000,
        verificationStatus: "verified",
        ownerType: "self",
      }),
    ];
    const match = findFundingAccount(option, inventory);
    assert.equal(match, null);
  });

  it("does not mutate the option or inventory", () => {
    const option = makeFlightOption({
      transferFromProgramId: "chase_ur",
    });
    const inventory: StrategyPointsInventoryItem[] = [
      makeInventoryItem({
        accountId: "acct-1",
        rewardProgramId: "chase_ur",
        balance: 100000,
        verificationStatus: "verified",
        ownerType: "self",
      }),
    ];
    const frozenOption = JSON.stringify(option);
    const frozenInventory = JSON.stringify(inventory);
    findFundingAccount(option, inventory);
    assert.equal(JSON.stringify(option), frozenOption);
    assert.equal(JSON.stringify(inventory), frozenInventory);
  });

  it("does not infer transferability from a name mismatch", () => {
    // Even if names are similar, only exact match counts
    const option = makeFlightOption({
      transferFromProgramId: null,
      programName: "Air France/KLM Flying Blue",
    });
    const inventory: StrategyPointsInventoryItem[] = [
      makeInventoryItem({
        accountId: "acct-similar",
        rewardProgramId: "flying_blue",
        programName: "Flying Blue", // different from "Air France/KLM Flying Blue"
        balance: 50000,
        verificationStatus: "verified",
        ownerType: "self",
      }),
    ];
    const match = findFundingAccount(option, inventory);
    assert.equal(match, null);
  });
});