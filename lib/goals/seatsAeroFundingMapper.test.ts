import assert from "node:assert/strict";
import { test } from "node:test";

import {
  projectSeatsAeroRowsToAwardOptions,
  SEATS_AERO_SOURCE_LABEL,
} from "./seatsAeroFundingMapper";
import type { SeatsAeroAvailabilityRow } from "./seatsAeroClient";

const PROGRAM_NAMES = new Map<string, string>([
  ["prog-aeroplan", "Air Canada Aeroplan"],
  ["prog-united", "United MileagePlus"],
  ["prog-flyingblue", "Air France-KLM Flying Blue"],
  ["prog-virgin", "Virgin Atlantic Flying Club"],
  ["prog-chase", "Chase Ultimate Rewards"],
]);

const ONE_WAY_INPUT = {
  originIata: "RDU",
  destinationIata: "CPH",
  cabin: "economy",
  pricingBasis: "one_way" as const,
};

const ROUND_TRIP_INPUT = {
  originIata: "RDU",
  destinationIata: "CPH",
  cabin: "economy",
  pricingBasis: "round_trip" as const,
};

function makeRow(
  overrides: Partial<SeatsAeroAvailabilityRow> & { source: string; departureDate: string; pointsRequired: number },
): SeatsAeroAvailabilityRow {
  return {
    isReturn: false,
    taxesMinorUnits: null,
    taxesCurrency: null,
    remainingSeats: null,
    direct: null,
    updatedAt: "2026-09-10T12:00:00.000Z",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// One-way projection
// ---------------------------------------------------------------------------

test("one-way rows project one option per mapped program with exact native-unit prices", () => {
  const rows = [
    makeRow({ source: "united", departureDate: "2027-06-11", pointsRequired: 32500 }),
    makeRow({ source: "aeroplan", departureDate: "2027-06-12", pointsRequired: 28000 }),
  ];
  const result = projectSeatsAeroRowsToAwardOptions(rows, PROGRAM_NAMES, ONE_WAY_INPUT);
  assert.equal(result.awardOptions.length, 2);
  assert.equal(result.sources.length, 2);

  const united = result.awardOptions.find((o) => o.programName === "United MileagePlus");
  const aeroplan = result.awardOptions.find((o) => o.programName === "Air Canada Aeroplan");
  assert.ok(united && aeroplan);
  assert.equal(united.pointsRequired, 32500);
  assert.equal(aeroplan.pointsRequired, 28000);
  assert.equal(united.pricingBasis, "one_way");
  assert.equal(united.catalogRewardProgramId, "prog-united");
  assert.equal(aeroplan.catalogRewardProgramId, "prog-aeroplan");
});

test("the best outbound row wins: earliest departure, then lowest price", () => {
  const rows = [
    makeRow({ source: "united", departureDate: "2027-06-14", pointsRequired: 20000 }),
    makeRow({ source: "united", departureDate: "2027-06-11", pointsRequired: 45000 }),
    makeRow({ source: "united", departureDate: "2027-06-11", pointsRequired: 32500 }),
  ];
  const result = projectSeatsAeroRowsToAwardOptions(rows, PROGRAM_NAMES, ONE_WAY_INPUT);
  assert.equal(result.awardOptions.length, 1);
  assert.equal(result.awardOptions[0].pointsRequired, 32500);
});

test("unmapped provider slugs are skipped entirely", () => {
  const rows = [
    makeRow({ source: "delta", departureDate: "2027-06-11", pointsRequired: 30000 }),
    makeRow({ source: "a_completely_unknown_program", departureDate: "2027-06-12", pointsRequired: 10000 }),
  ];
  const result = projectSeatsAeroRowsToAwardOptions(rows, PROGRAM_NAMES, ONE_WAY_INPUT);
  assert.deepEqual(result, { awardOptions: [], sources: [] });
});

test("programs absent from the catalog map are skipped (no funding identity)", () => {
  const rows = [makeRow({ source: "united", departureDate: "2027-06-11", pointsRequired: 32500 })];
  const result = projectSeatsAeroRowsToAwardOptions(
    rows,
    new Map([["prog-virgin", "Virgin Atlantic Flying Club"]]),
    ONE_WAY_INPUT,
  );
  assert.deepEqual(result, { awardOptions: [], sources: [] });
});

test("empty rows produce an empty result", () => {
  const result = projectSeatsAeroRowsToAwardOptions([], PROGRAM_NAMES, ONE_WAY_INPUT);
  assert.deepEqual(result, { awardOptions: [], sources: [] });
});

// ---------------------------------------------------------------------------
// Round-trip combination
// ---------------------------------------------------------------------------

test("round-trip totals sum two same-program legs and never cross programs", () => {
  const rows = [
    makeRow({ source: "united", departureDate: "2027-06-11", pointsRequired: 32500 }),
    makeRow({ source: "united", departureDate: "2027-06-18", pointsRequired: 29000, isReturn: true }),
    makeRow({ source: "aeroplan", departureDate: "2027-06-11", pointsRequired: 28000 }),
    makeRow({ source: "aeroplan", departureDate: "2027-06-20", pointsRequired: 31000, isReturn: true }),
  ];
  const result = projectSeatsAeroRowsToAwardOptions(rows, PROGRAM_NAMES, ROUND_TRIP_INPUT);
  assert.equal(result.awardOptions.length, 2);
  const united = result.awardOptions.find((o) => o.programName === "United MileagePlus");
  const aeroplan = result.awardOptions.find((o) => o.programName === "Air Canada Aeroplan");
  assert.ok(united && aeroplan);
  assert.equal(united.pointsRequired, 32500 + 29000);
  assert.equal(aeroplan.pointsRequired, 28000 + 31000);
});

test("a missing return leg yields no round-trip option (no fabrication)", () => {
  const rows = [
    makeRow({ source: "united", departureDate: "2027-06-11", pointsRequired: 32500 }),
  ];
  const result = projectSeatsAeroRowsToAwardOptions(rows, PROGRAM_NAMES, ROUND_TRIP_INPUT);
  assert.deepEqual(result, { awardOptions: [], sources: [] });
});

test("a missing outbound leg yields no round-trip option", () => {
  const rows = [
    makeRow({ source: "united", departureDate: "2027-06-18", pointsRequired: 29000, isReturn: true }),
  ];
  const result = projectSeatsAeroRowsToAwardOptions(rows, PROGRAM_NAMES, ROUND_TRIP_INPUT);
  assert.deepEqual(result, { awardOptions: [], sources: [] });
});

// ---------------------------------------------------------------------------
// Taxes and fees
// ---------------------------------------------------------------------------

test("per-leg minor-unit taxes convert once and sum to major-unit fees", () => {
  const rows = [
    makeRow({ source: "united", departureDate: "2027-06-11", pointsRequired: 32500, taxesMinorUnits: 18560, taxesCurrency: "USD" }),
    makeRow({ source: "united", departureDate: "2027-06-18", pointsRequired: 29000, taxesMinorUnits: 12345, taxesCurrency: "USD", isReturn: true }),
  ];
  const result = projectSeatsAeroRowsToAwardOptions(rows, PROGRAM_NAMES, ROUND_TRIP_INPUT);
  assert.equal(result.awardOptions[0].cashFees, 309.05);
});

test("one-way fees come from the outbound taxes alone", () => {
  const rows = [
    makeRow({ source: "united", departureDate: "2027-06-11", pointsRequired: 32500, taxesMinorUnits: 5600, taxesCurrency: "USD" }),
  ];
  const result = projectSeatsAeroRowsToAwardOptions(rows, PROGRAM_NAMES, ONE_WAY_INPUT);
  assert.equal(result.awardOptions[0].cashFees, 56.0);
});

test("taxes without a currency never become fees", () => {
  const rows = [
    makeRow({ source: "united", departureDate: "2027-06-11", pointsRequired: 32500, taxesMinorUnits: 5600, taxesCurrency: null }),
  ];
  const result = projectSeatsAeroRowsToAwardOptions(rows, PROGRAM_NAMES, ONE_WAY_INPUT);
  assert.equal(result.awardOptions[0].cashFees, null);
});

test("a partially observed round-trip fees picture stays unknown", () => {
  const rows = [
    makeRow({ source: "united", departureDate: "2027-06-11", pointsRequired: 32500, taxesMinorUnits: 5600, taxesCurrency: "USD" }),
    makeRow({ source: "united", departureDate: "2027-06-18", pointsRequired: 29000, taxesMinorUnits: null, taxesCurrency: null, isReturn: true }),
  ];
  const result = projectSeatsAeroRowsToAwardOptions(rows, PROGRAM_NAMES, ROUND_TRIP_INPUT);
  assert.equal(result.awardOptions[0].cashFees, null);
});

test("mixed-currency per-leg taxes are not summed", () => {
  const rows = [
    makeRow({ source: "united", departureDate: "2027-06-11", pointsRequired: 32500, taxesMinorUnits: 5600, taxesCurrency: "USD" }),
    makeRow({ source: "united", departureDate: "2027-06-18", pointsRequired: 29000, taxesMinorUnits: 7000, taxesCurrency: "EUR", isReturn: true }),
  ];
  const result = projectSeatsAeroRowsToAwardOptions(rows, PROGRAM_NAMES, ROUND_TRIP_INPUT);
  assert.equal(result.awardOptions[0].cashFees, null);
});

// ---------------------------------------------------------------------------
// Seats and evidence fields
// ---------------------------------------------------------------------------

test("round-trip seats are the minimum of both reported leg counts", () => {
  const rows = [
    makeRow({ source: "united", departureDate: "2027-06-11", pointsRequired: 32500, remainingSeats: 7 }),
    makeRow({ source: "united", departureDate: "2027-06-18", pointsRequired: 29000, remainingSeats: 3, isReturn: true }),
  ];
  const result = projectSeatsAeroRowsToAwardOptions(rows, PROGRAM_NAMES, ROUND_TRIP_INPUT);
  assert.equal(result.awardOptions[0].seats, 3);
});

test("a missing leg seat count leaves seats unknown", () => {
  const rows = [
    makeRow({ source: "united", departureDate: "2027-06-11", pointsRequired: 32500, remainingSeats: 7 }),
    makeRow({ source: "united", departureDate: "2027-06-18", pointsRequired: 29000, remainingSeats: null, isReturn: true }),
  ];
  const result = projectSeatsAeroRowsToAwardOptions(rows, PROGRAM_NAMES, ROUND_TRIP_INPUT);
  assert.equal(result.awardOptions[0].seats, null);
});

test("observed options carry observed-price evidence semantics", () => {
  const rows = [
    makeRow({ source: "united", departureDate: "2027-06-11", pointsRequired: 32500, updatedAt: "2026-09-10T13:52:23.000Z" }),
  ];
  const result = projectSeatsAeroRowsToAwardOptions(rows, PROGRAM_NAMES, ONE_WAY_INPUT);
  const option = result.awardOptions[0];
  assert.equal(option.evidenceLevel, "web_observed_not_live");
  assert.equal(option.availabilityStatus, "available");
  assert.equal(option.coverageStatus, "source_explicit");
  assert.equal(option.goalMatch, "exact");
  assert.deepEqual(option.goalMismatchReasons, []);
  assert.equal(option.centsPerPoint, null);
  assert.equal(option.transferFromProgramId, null);
  assert.equal(option.transferRatio, null);
  assert.equal(option.redemptionType, "flight");
  assert.equal(option.travelerCountCovered, 1);
  assert.equal(option.nightCountCovered, null);
  assert.equal(option.cabin, "economy");
  assert.equal(option.itineraryLabel, "RDU to CPH (observed award price)");
  assert.equal(option.seats, null);
});

test("sources use the fixed observed-price label with live status and crawl freshness", () => {
  const rows = [
    makeRow({ source: "united", departureDate: "2027-06-11", pointsRequired: 32500, updatedAt: "2026-09-10T13:52:23.000Z" }),
  ];
  const result = projectSeatsAeroRowsToAwardOptions(rows, PROGRAM_NAMES, ONE_WAY_INPUT);
  assert.equal(result.sources.length, 1);
  assert.equal(result.sources[0].label, SEATS_AERO_SOURCE_LABEL);
  assert.equal(result.sources[0].status, "live");
  assert.equal(result.sources[0].observedAt, "2026-09-10T13:52:23.000Z");
  assert.equal(result.sources[0].id, result.awardOptions[0].sourceId);
});

// ---------------------------------------------------------------------------
// Determinism and bounds
// ---------------------------------------------------------------------------

test("option order follows the fixed program allowlist regardless of row order", () => {
  const rows = [
    makeRow({ source: "virginatlantic", departureDate: "2027-06-11", pointsRequired: 30000 }),
    makeRow({ source: "united", departureDate: "2027-06-11", pointsRequired: 32500 }),
    makeRow({ source: "aeroplan", departureDate: "2027-06-11", pointsRequired: 28000 }),
    makeRow({ source: "flyingblue", departureDate: "2027-06-11", pointsRequired: 50000 }),
  ];
  const result = projectSeatsAeroRowsToAwardOptions(rows, PROGRAM_NAMES, ONE_WAY_INPUT);
  assert.deepEqual(
    result.awardOptions.map((o) => o.programName),
    [
      "Air Canada Aeroplan",
      "United MileagePlus",
      "Air France-KLM Flying Blue",
      "Virgin Atlantic Flying Club",
    ],
  );
});

test("projection is deterministic across repeated calls", () => {
  const rows = [
    makeRow({ source: "united", departureDate: "2027-06-11", pointsRequired: 32500 }),
    makeRow({ source: "aeroplan", departureDate: "2027-06-12", pointsRequired: 28000 }),
  ];
  const a = projectSeatsAeroRowsToAwardOptions(rows, PROGRAM_NAMES, ROUND_TRIP_INPUT);
  const b = projectSeatsAeroRowsToAwardOptions(rows, PROGRAM_NAMES, ROUND_TRIP_INPUT);
  assert.deepEqual(a, b);
});

test("projection never mutates its inputs", () => {
  const rows = [
    makeRow({ source: "united", departureDate: "2027-06-11", pointsRequired: 32500 }),
    makeRow({ source: "united", departureDate: "2027-06-18", pointsRequired: 29000, isReturn: true }),
  ];
  const before = JSON.stringify(rows);
  const programNamesBefore = JSON.stringify([...PROGRAM_NAMES.entries()]);
  projectSeatsAeroRowsToAwardOptions(rows, PROGRAM_NAMES, ROUND_TRIP_INPUT);
  assert.equal(JSON.stringify(rows), before);
  assert.equal(JSON.stringify([...PROGRAM_NAMES.entries()]), programNamesBefore);
});
