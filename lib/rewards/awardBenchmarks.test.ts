import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildAirportRegionMap,
  isUsableBenchmarkRow,
  selectFlightAwardBenchmarks,
  selectVerifiedTransferPartnersInto,
  type AirportRegionEntry,
  type AwardPriceBenchmark,
  type VerifiedTransferPartner,
} from "./awardBenchmarks";

const NOW = new Date("2026-09-09T00:00:00Z");

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

function regionEntry(
  overrides: Partial<AirportRegionEntry> = {},
): AirportRegionEntry {
  return {
    iataCode: "DEN",
    region: "us_domestic",
    source: "IATA airport registry",
    lastVerifiedAt: "2026-09-01T00:00:00Z",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// buildAirportRegionMap
// ---------------------------------------------------------------------------

test("airport region map keeps verified entries and normalizes codes", () => {
  const map = buildAirportRegionMap([
    regionEntry({ iataCode: "den", region: "us_domestic" }),
    regionEntry({ iataCode: "CPH", region: "transatlantic_europe" }),
  ]);
  assert.equal(map.get("DEN"), "us_domestic");
  assert.equal(map.get("CPH"), "transatlantic_europe");
});

test("airport region map drops unverified, malformed, and duplicate entries", () => {
  const map = buildAirportRegionMap([
    regionEntry({ lastVerifiedAt: null }), // unverified
    regionEntry({ iataCode: "TOOLONG" }), // not IATA-shaped
    regionEntry({ iataCode: "XX" }), // too short
    regionEntry({ region: "atlantis" as never }), // unknown region
    regionEntry({ iataCode: "DEN", region: "us_domestic" }),
    regionEntry({ iataCode: "den", region: "canada" }), // duplicate (case-insensitive)
  ]);
  assert.equal(map.size, 1);
  assert.equal(map.get("DEN"), "us_domestic");
});

test("airport region map handles null and non-array input", () => {
  assert.equal(buildAirportRegionMap(null).size, 0);
  assert.equal(buildAirportRegionMap(undefined).size, 0);
  assert.equal(buildAirportRegionMap("nope" as never).size, 0);
});

// ---------------------------------------------------------------------------
// isUsableBenchmarkRow
// ---------------------------------------------------------------------------

test("a fully verified active row is usable", () => {
  assert.equal(isUsableBenchmarkRow(row(), NOW), true);
});

test("inactive and unverified rows are unusable", () => {
  assert.equal(isUsableBenchmarkRow(row({ active: false }), NOW), false);
  assert.equal(isUsableBenchmarkRow(row({ lastVerifiedAt: null }), NOW), false);
  assert.equal(isUsableBenchmarkRow(row({ source: null as never }), NOW), false);
});

test("rows outside their validity window are unusable", () => {
  assert.equal(
    isUsableBenchmarkRow(row({ validUntil: "2026-09-08T00:00:00Z" }), NOW),
    false,
  );
  assert.equal(
    isUsableBenchmarkRow(row({ validFrom: "2026-09-10T00:00:00Z" }), NOW),
    false,
  );
  assert.equal(
    isUsableBenchmarkRow(row({ validFrom: "2026-09-01", validUntil: "2027-09-01" }), NOW),
    true,
  );
  // Malformed window strings fail closed.
  assert.equal(isUsableBenchmarkRow(row({ validUntil: "not-a-date" }), NOW), false);
  // An invalid caller clock fails closed: an expired row can never pass.
  assert.equal(
    isUsableBenchmarkRow(row({ validUntil: "2020-01-01T00:00:00Z" }), new Date("garbage")),
    false,
  );
  assert.equal(isUsableBenchmarkRow(row(), new Date("garbage")), false);
});

test("malformed numbers, enums, and identifiers make a row unusable", () => {
  assert.equal(isUsableBenchmarkRow(row({ pointsRequired: 0 }), NOW), false);
  assert.equal(isUsableBenchmarkRow(row({ pointsRequired: -5 }), NOW), false);
  assert.equal(isUsableBenchmarkRow(row({ pointsRequired: "60000" as never }), NOW), false);
  assert.equal(isUsableBenchmarkRow(row({ cashFees: 0 }), NOW), false);
  assert.equal(isUsableBenchmarkRow(row({ cashFees: -1 }), NOW), false);
  assert.equal(isUsableBenchmarkRow(row({ pricingBasis: "per_night" as never }), NOW), false);
  assert.equal(isUsableBenchmarkRow(row({ redemptionType: "hotel" as never }), NOW), false);
  assert.equal(isUsableBenchmarkRow(row({ originRegion: "atlantis" as never }), NOW), false);
  assert.equal(isUsableBenchmarkRow(row({ travelerCountCovered: 0 }), NOW), false);
  assert.equal(isUsableBenchmarkRow(row({ nightCountCovered: 0 }), NOW), false);
  assert.equal(isUsableBenchmarkRow(row({ rewardProgramId: "" }), NOW), false);
  assert.equal(isUsableBenchmarkRow(null as never, NOW), false);
});

// ---------------------------------------------------------------------------
// selectFlightAwardBenchmarks
// ---------------------------------------------------------------------------

function regionMap(): Map<string, ReturnType<typeof buildAirportRegionMap> extends Map<string, infer R> ? R : never> {
  return buildAirportRegionMap([
    regionEntry({ iataCode: "DEN", region: "us_domestic" }),
    regionEntry({ iataCode: "CPH", region: "transatlantic_europe" }),
    regionEntry({ iataCode: "JFK", region: "us_domestic" }),
  ]);
}

test("selects only rows matching route regions and cabin", () => {
  const rows = [
    row(), // matches
    row({ id: "bench-2", cabin: "business" }), // cabin mismatch
    row({
      id: "bench-3",
      originRegion: "us_domestic",
      destinationRegion: "east_asia",
    }), // destination mismatch
    row({ id: "bench-4", active: false }), // unusable
  ];
  const selected = selectFlightAwardBenchmarks({
    benchmarks: rows,
    airportRegions: regionMap(),
    originIata: "DEN",
    destinationIata: "CPH",
    cabin: "economy",
    now: NOW,
  });
  assert.deepEqual(selected.map((r) => r.id), ["bench-1"]);
});

test("unmapped origin or destination yields nothing (no region guessing)", () => {
  const empty = { airportRegions: regionMap(), cabin: "economy", now: NOW };
  assert.deepEqual(
    selectFlightAwardBenchmarks({ ...empty, benchmarks: [row()], originIata: "XXX", destinationIata: "CPH" }),
    [],
  );
  assert.deepEqual(
    selectFlightAwardBenchmarks({ ...empty, benchmarks: [row()], originIata: "DEN", destinationIata: null }),
    [],
  );
  assert.deepEqual(
    selectFlightAwardBenchmarks({ ...empty, benchmarks: [row()], originIata: "  ", destinationIata: "CPH" }),
    [],
  );
});

test("selection is deterministic and does not mutate its inputs", () => {
  const rows = [row({ id: "bench-2" }), row()];
  const before = JSON.stringify(rows);
  const selected = selectFlightAwardBenchmarks({
    benchmarks: rows,
    airportRegions: regionMap(),
    originIata: "DEN",
    destinationIata: "CPH",
    cabin: "economy",
    now: NOW,
  });
  assert.deepEqual(selected.map((r) => r.id), ["bench-2", "bench-1"]);
  assert.equal(JSON.stringify(rows), before);
});

// ---------------------------------------------------------------------------
// selectVerifiedTransferPartnersInto
// ---------------------------------------------------------------------------

function partner(
  overrides: Partial<VerifiedTransferPartner> = {},
): VerifiedTransferPartner {
  return {
    id: "tp-1",
    fromProgramId: "prog-chase-ur",
    toProgramId: "prog-united",
    destinationPointsPerSourcePoint: 1,
    source: "Issuer transfer-partner documentation",
    lastVerifiedAt: "2026-09-01T00:00:00Z",
    ...overrides,
  };
}

test("selects verified partners from owned source programs only", () => {
  const partners = [
    partner(),
    partner({ id: "tp-2", fromProgramId: "prog-other" }),
    partner({ id: "tp-3", toProgramId: "prog-aegean" }),
    partner({ id: "tp-4", lastVerifiedAt: null }),
    partner({ id: "tp-5", destinationPointsPerSourcePoint: 0 }),
    partner({ id: "tp-6", destinationPointsPerSourcePoint: -1 }),
  ];
  const selected = selectVerifiedTransferPartnersInto(
    partners,
    "prog-united",
    new Set(["prog-chase-ur"]),
  );
  assert.deepEqual(selected.map((p) => p.id), ["tp-1"]);
});

test("self-transfers and empty owned sets yield nothing", () => {
  assert.deepEqual(
    selectVerifiedTransferPartnersInto(
      [partner({ fromProgramId: "prog-united" })],
      "prog-united",
      new Set(["prog-united"]),
    ),
    [],
  );
  assert.deepEqual(
    selectVerifiedTransferPartnersInto([partner()], "prog-united", new Set()),
    [],
  );
});
