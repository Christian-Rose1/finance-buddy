import assert from "node:assert/strict";
import { test } from "node:test";

import {
  AWARD_BENCHMARK_SOURCE_LABEL,
  projectBenchmarksToAwardOptions,
} from "./awardBenchmarkOptions";
import type { AwardPriceBenchmark } from "@/lib/rewards/awardBenchmarks";

function row(overrides: Partial<AwardPriceBenchmark> = {}): AwardPriceBenchmark {
  return {
    id: "bench-1",
    rewardProgramId: "prog-united",
    redemptionType: "flight",
    originRegion: "us_domestic",
    destinationRegion: "transatlantic_europe",
    cabin: "economy",
    pricingBasis: "round_trip",
    pointsRequired: 60000,
    cashFees: 80,
    currency: "USD",
    travelerCountCovered: 1,
    nightCountCovered: null,
    validFrom: null,
    validUntil: null,
    source: "United published award chart",
    lastVerifiedAt: "2026-09-01T00:00:00Z",
    active: true,
    ...overrides,
  };
}

const PROGRAM_NAMES = new Map([
  ["prog-united", "United MileagePlus"],
  ["prog-air-canada", "Air Canada Aeroplan"],
]);

test("projects a valid benchmark into an award option and its source", () => {
  const { awardOptions, sources } = projectBenchmarksToAwardOptions(
    [row()],
    PROGRAM_NAMES,
  );
  assert.equal(awardOptions.length, 1);
  const option = awardOptions[0];
  assert.equal(option.programName, "United MileagePlus");
  assert.equal(option.redemptionType, "flight");
  assert.equal(option.pricingBasis, "round_trip");
  assert.equal(option.pointsRequired, 60000);
  assert.equal(option.cashFees, 80);
  assert.equal(option.availabilityStatus, "unknown");
  assert.equal(option.centsPerPoint, null);
  assert.equal(option.transferFromProgramId, null);
  assert.equal(option.transferRatio, null);
  assert.equal(option.evidenceLevel, "planning_benchmark");
  assert.equal(option.travelerCountCovered, 1);
  assert.equal(option.coverageStatus, "source_explicit");
  assert.equal(option.goalMatch, "exact");
  assert.match(option.itineraryLabel ?? "", /U\.S\. domestic to U\.S\. to Europe/);

  assert.equal(sources.length, 1);
  assert.equal(sources[0].id, option.sourceId);
  assert.equal(sources[0].label, AWARD_BENCHMARK_SOURCE_LABEL);
  assert.equal(sources[0].status, "catalog");
  assert.equal(sources[0].observedAt, "2026-09-01T00:00:00Z");
  // Option and source ids must be linked and simple.
  assert.equal(option.sourceId, `award-benchmark-${row().id}`);
  assert.equal(option.id, option.sourceId);
});

test("a benchmark with an unknown program is skipped entirely", () => {
  const { awardOptions, sources } = projectBenchmarksToAwardOptions(
    [row({ rewardProgramId: "prog-unknown" })],
    PROGRAM_NAMES,
  );
  assert.equal(awardOptions.length, 0);
  assert.equal(sources.length, 0);
});

test("duplicate program/route/cabin/basis combinations keep only the first", () => {
  const { awardOptions } = projectBenchmarksToAwardOptions(
    [row({ pointsRequired: 60000 }), row({ id: "bench-2", pointsRequired: 99999 })],
    PROGRAM_NAMES,
  );
  assert.equal(awardOptions.length, 1);
  assert.equal(awardOptions[0].pointsRequired, 60000);
});

test("distinct programs with identical routes both survive", () => {
  const { awardOptions } = projectBenchmarksToAwardOptions(
    [
      row(),
      row({ id: "bench-2", rewardProgramId: "prog-air-canada", pointsRequired: 70000 }),
    ],
    PROGRAM_NAMES,
  );
  assert.equal(awardOptions.length, 2);
  assert.deepEqual(awardOptions.map((o) => o.programName), [
    "United MileagePlus",
    "Air Canada Aeroplan",
  ]);
});

test("malformed identifiers and over-bound values are skipped, not sanitized", () => {
  const results = projectBenchmarksToAwardOptions(
    [
      row({ id: "bad id with spaces" }),
      row({ id: "../escape" }),
      row({ id: "x".repeat(101) }),
      row({ rewardProgramId: "" }),
      row({ cabin: "x".repeat(41) }),
      row({ lastVerifiedAt: null }),
      row({ pricingBasis: "per_night" as never }),
      row({ originRegion: "atlantis" as never }),
    ],
    PROGRAM_NAMES,
  );
  assert.equal(results.awardOptions.length, 0);
  assert.equal(results.sources.length, 0);
});

test("projection output is fresh and does not reference or mutate inputs", () => {
  const input = [row()];
  const before = JSON.stringify(input);
  const { awardOptions } = projectBenchmarksToAwardOptions(input, PROGRAM_NAMES);
  awardOptions[0].pointsRequired = 1;
  awardOptions[0].itineraryLabel = "mutated";
  assert.equal(JSON.stringify(input), before);
  assert.notEqual(awardOptions[0], input[0]);
});

test("transfer fields never ride the option; availability never claimed", () => {
  const { awardOptions } = projectBenchmarksToAwardOptions(
    [row(), row({ id: "bench-2", pricingBasis: "one_way" })],
    PROGRAM_NAMES,
  );
  for (const option of awardOptions) {
    assert.equal(option.availabilityStatus, "unknown");
    assert.equal(option.centsPerPoint, null);
    assert.equal(option.seats, null);
    assert.equal(option.transferFromProgramId, null);
    assert.equal(option.transferRatio, null);
  }
});
