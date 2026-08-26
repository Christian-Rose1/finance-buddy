import assert from "node:assert/strict";
import { test } from "node:test";
import type { StrategyAllocationScenario } from "../../lib/goals/strategyTypes";
import {
  formatBalanceAsOf,
  formatPoints,
  getGenerationProgressAnnouncement,
  getStepState,
  sortAllocationScenarios,
} from "./presentation";

function scenario(
  kind: StrategyAllocationScenario["kind"]
): StrategyAllocationScenario {
  return {
    id: kind,
    kind,
    title: kind,
    status: "insufficient_information",
    flightOptionId: null,
    hotelOptionId: null,
    flightPointsRequired: null,
    hotelPointsRequired: null,
    travelerCount: 1,
    tripNights: null,
    allocations: [],
    assumptions: [],
    warnings: [],
  };
}

test("formatting helpers preserve points and balance date presentation", () => {
  assert.equal(formatPoints(123456), "123,456");
  assert.equal(formatBalanceAsOf("2026-08-20T12:00:00.000Z"), "Aug 20, 2026");
  assert.equal(formatBalanceAsOf("not-a-date"), "not-a-date");
});

test("step statuses retain their existing customer-facing progression", () => {
  assert.equal(getStepState("idle"), "waiting");
  assert.equal(getStepState("loading"), "in-progress");
  assert.equal(getStepState("succeeded"), "complete");
  assert.equal(getStepState("failed"), "could-not-complete");
});

test("progress announcements include stage state and isolated research errors", () => {
  const announcement = getGenerationProgressAnnouncement({
    flightStatus: "failed",
    flightMessage: "Flight research is temporarily unavailable.",
    hotelStatus: "loading",
    hotelMessage: null,
    finalStatus: "idle",
  });

  assert.match(
    announcement,
    /Researching flight options: could not complete\. Flight research is temporarily unavailable\./
  );
  assert.match(announcement, /Researching hotel options: in progress/);
  assert.match(
    announcement,
    /Building your personalized points plan: waiting/
  );
});

test("allocation scenarios use the established order without mutating input", () => {
  const input = [
    scenario("fallback"),
    scenario("hotel_first"),
    scenario("balanced"),
    scenario("flight_first"),
  ];

  const result = sortAllocationScenarios(input);

  assert.deepEqual(
    result.map((item) => item.kind),
    ["balanced", "flight_first", "hotel_first", "fallback"]
  );
  assert.deepEqual(
    input.map((item) => item.kind),
    ["fallback", "hotel_first", "balanced", "flight_first"]
  );
});
