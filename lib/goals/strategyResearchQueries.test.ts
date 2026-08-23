import { test } from "node:test";
import assert from "node:assert/strict";

import type { Goal } from "./types";
import { buildStrategyResearchQueries } from "./strategyResearchQueries";

function makeGoal(
  overrides: Partial<Goal> = {}
): Goal {
  return {
    id: "goal-1",
    userId: "user-1",
    type: "travel",
    title: "Trip to Europe",
    status: "active",
    origin: ["JFK"],
    destinations: ["CDG"],
    earliestDeparture: "2027-06-01",
    latestReturn: "2027-06-15",
    minimumNights: 10,
    maximumNights: 14,
    travelerCount: 2,
    cabinPreference: "economy",
    optimizationPriority: "balanced",
    maximumCashBudget: 500,
    currency: "USD",
    allowNewCards: true,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

test("detailed goal returns exactly one flight and one hotel query", () => {
  const goal = makeGoal();
  const programs = [{ id: "p-1", name: "Program One" }];

  const result = buildStrategyResearchQueries(goal, programs);

  assert.equal(result.flightQueries.length, 1);
  assert.equal(result.hotelQueries.length, 1);
});

test("flight query contains origin, destination, dates, cabin, traveler count, and customer program", () => {
  const goal = makeGoal({ travelerCount: 2, cabinPreference: "business" });
  const programs = [{ id: "p-1", name: "Program One" }];

  const { flightQueries } = buildStrategyResearchQueries(goal, programs);
  const flight = flightQueries[0];

  assert.ok(flight.includes("flight"), "should mention flight");
  assert.ok(flight.includes("award"), "should mention award");
  assert.ok(flight.includes("to CDG"), "should include destination");
  assert.ok(flight.includes("from JFK"), "should include origin");
  assert.ok(flight.includes("2027-06-01 to 2027-06-15"), "should include dates");
  assert.ok(flight.includes("business class"), "should include cabin when non-flexible");
  assert.ok(flight.includes("2 travelers"), "should include traveler count when > 1");
  assert.ok(flight.includes("Program One"), "should include customer program");
  assert.ok(flight.includes("points pricing"), "should ask for points pricing");
  assert.ok(flight.includes("transfer-partner redemption options"), "should ask for transfer-partner options");
  assert.ok(!flight.includes("available"), "must not claim availability");
});

test("hotel query contains destination, dates, hotel, and points per night", () => {
  const goal = makeGoal();
  const programs = [{ id: "p-1", name: "Program One" }];

  const { hotelQueries } = buildStrategyResearchQueries(goal, programs);
  const hotel = hotelQueries[0];

  assert.ok(hotel.includes("hotel"), "should mention hotel");
  assert.ok(hotel.includes("award"), "should mention award");
  assert.ok(hotel.includes("points per night"), "should mention points per night");
  assert.ok(hotel.includes("to CDG"), "should include destination");
  assert.ok(hotel.includes("2027-06-01 to 2027-06-15"), "should include dates");
  assert.ok(hotel.includes("Program One"), "should include customer program");
  assert.ok(hotel.includes("hotel loyalty-program and transfer-partner options"), "should ask for loyalty/transfer-partner options");
  assert.ok(!hotel.includes("available"), "must not claim availability");
  assert.ok(!/Hotel One|\d+ nights/.test(hotel), "must not invent hotel names or night counts");
});

test("flexible cabin is not added as a cabin restriction", () => {
  const goal = makeGoal({ cabinPreference: "flexible" });
  const { flightQueries } = buildStrategyResearchQueries(goal, []);
  const flight = flightQueries[0];

  assert.ok(!flight.includes("flexible class"), "should not add flexible as a cabin restriction");
  assert.ok(!flight.includes("class"), "should not add any class phrase");
});

test("one traveler is not added as a traveler-count phrase", () => {
  const goal = makeGoal({ travelerCount: 1 });
  const { flightQueries } = buildStrategyResearchQueries(goal, []);
  const flight = flightQueries[0];

  assert.ok(!flight.includes("1 travelers"), "should not add a traveler-count phrase for one traveler");
});

test("missing destination still returns both query categories", () => {
  const goal = makeGoal({ destinations: [] });
  const { flightQueries, hotelQueries } = buildStrategyResearchQueries(goal, []);

  assert.equal(flightQueries.length, 1, "should still return one generic flight query");
  assert.equal(hotelQueries.length, 1, "should still return one generic hotel query");
  assert.ok(flightQueries[0].includes("flight award"), "flight query should still be flight-award focused");
  assert.ok(hotelQueries[0].includes("hotel award points per night"), "hotel query should still be hotel-award focused");
});

test("allowNewCards=false returns no card query", () => {
  const goal = makeGoal({ allowNewCards: false });
  const { cardQueries } = buildStrategyResearchQueries(goal, []);

  assert.equal(cardQueries.length, 0);
});

test("allowNewCards=true returns exactly one card query", () => {
  const goal = makeGoal({ allowNewCards: true });
  const { cardQueries } = buildStrategyResearchQueries(goal, []);

  assert.equal(cardQueries.length, 1);
});

test("results never exceed three total queries", () => {
  const goal = makeGoal({ allowNewCards: true });
  const programs = [
    { id: "p-1", name: "Program One" },
    { id: "p-2", name: "Program Two" },
    { id: "p-3", name: "Program Three" },
    { id: "p-4", name: "Program Four" },
  ];

  const { flightQueries, hotelQueries, cardQueries } = buildStrategyResearchQueries(goal, programs);
  const total = flightQueries.length + hotelQueries.length + cardQueries.length;

  assert.ok(total <= 3, "should never exceed three total queries");
  assert.equal(flightQueries.length, 1);
  assert.equal(hotelQueries.length, 1);
  assert.equal(cardQueries.length, 1);
});