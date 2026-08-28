import assert from "node:assert/strict";
import { test } from "node:test";
import {
  selectSerpApiFlightOutbound,
  selectSerpApiFlightRoundTrip,
  type SerpApiFlightSelectionInput,
  type SerpApiFlightSelectionResult,
  type SerpApiFlightSelectionRequest,
} from "./serpApiFlightSelection";

const request: SerpApiFlightSelectionRequest = {
  origin: "JFK",
  destination: "CDG",
  outboundDate: "2027-04-03",
  returnDate: "2027-04-12",
  travelers: 2,
  cabin: "economy",
  currency: "USD",
};

function rawSegment(
  departureAirport: string,
  departureTime: string,
  arrivalAirport: string,
  arrivalTime: string,
  cabin: string | null = "economy",
): Record<string, unknown> {
  return {
    departureAirport,
    departureTime,
    arrivalAirport,
    arrivalTime,
    marketingCarrier: "Example Air",
    marketingFlightNumber: "EA123",
    cabin,
    operatingCarrier: "Example Air",
    url: "https://provider.example/flight",
    token: "opaque-token",
  };
}

function outboundResult(overrides: Partial<SerpApiFlightSelectionResult> = {}): SerpApiFlightSelectionResult {
  return {
    outboundSegments: [rawSegment("JFK", "2027-04-03 08:00", "CDG", "2027-04-03 20:00")],
    returnSegments: [rawSegment("CDG", "2027-04-12 09:00", "JFK", "2027-04-12 11:30")],
    roundTripPrice: 1800,
    retrievedAt: "2026-08-28T12:34:56.000Z",
    durationMinutes: 500,
    ...overrides,
  };
}

function returnResult(overrides: Partial<SerpApiFlightSelectionResult> = {}): SerpApiFlightSelectionResult {
  return outboundResult({
    outboundSegments: [rawSegment("CDG", "2027-04-12 09:00", "JFK", "2027-04-12 11:30")],
    returnSegments: [rawSegment("CDG", "2027-04-12 09:00", "JFK", "2027-04-12 11:30")],
    ...overrides,
  });
}

function input(
  outboundResults: readonly SerpApiFlightSelectionResult[] = [outboundResult()],
  returnOptionsForSelectedOutbound: readonly SerpApiFlightSelectionResult[] = [returnResult()],
): SerpApiFlightSelectionInput {
  return { outboundResults, request, returnOptionsForSelectedOutbound };
}

test("selects outbound in two phases and preserves its original source index", () => {
  const selected = selectSerpApiFlightOutbound(
    [outboundResult({ roundTripPrice: Number.NaN }), outboundResult({ roundTripPrice: 1700 })],
    request,
  );
  assert.ok(selected);
  assert.equal(selected.sourceIndex, 1);
  assert.equal(selected.outboundSegments[0].marketingFlightNumber, "EA123");
});

test("selects the lowest searched-party-total outbound and compatible return", () => {
  const result = selectSerpApiFlightRoundTrip(
    input(
      [outboundResult({ roundTripPrice: 1900 }), outboundResult({ roundTripPrice: 1700 })],
      [returnResult({ roundTripPrice: 1800 }), returnResult({ roundTripPrice: 1600 })],
    ),
  );
  assert.ok(result);
  assert.equal((result.outboundSegments as Array<Record<string, unknown>>)[0].marketingFlightNumber, "EA123");
  assert.equal(result.roundTripPrice, 1600);
});

test("uses duration and then original result order as deterministic tie-breakers", () => {
  const first = outboundResult({ roundTripPrice: 1700, durationMinutes: 600 });
  const shortest = outboundResult({
    roundTripPrice: 1700,
    durationMinutes: 500,
    outboundSegments: [rawSegment("JFK", "2027-04-03 09:00", "CDG", "2027-04-03 20:00")],
  });
  const returnFirst = returnResult({
    roundTripPrice: 1600,
    durationMinutes: 600,
    returnSegments: [rawSegment("CDG", "2027-04-12 09:00", "JFK", "2027-04-12 11:30")],
  });
  const returnShortest = returnResult({
    roundTripPrice: 1600,
    durationMinutes: 500,
    returnSegments: [rawSegment("CDG", "2027-04-12 10:00", "JFK", "2027-04-12 12:30")],
  });
  const selected = selectSerpApiFlightRoundTrip(input([first, shortest], [returnFirst, returnShortest]));
  assert.ok(selected);
  assert.equal((selected.outboundSegments as Array<Record<string, unknown>>)[0].departureTime, "2027-04-03 09:00");
  assert.equal((selected.returnSegments as Array<Record<string, unknown>>)[0].departureTime, "2027-04-12 10:00");

  const sourceFirst = outboundResult({ roundTripPrice: 1700, durationMinutes: 500, retrievedAt: "2026-08-28T01:00:00.000Z", outboundSegments: [rawSegment("JFK", "2027-04-03 08:00", "CDG", "2027-04-03 20:00")] });
  const sourceSecond = outboundResult({ roundTripPrice: 1700, durationMinutes: 500, retrievedAt: "2026-08-28T02:00:00.000Z", outboundSegments: [rawSegment("JFK", "2027-04-03 09:00", "CDG", "2027-04-03 21:00")] });
  const selectedSource = selectSerpApiFlightRoundTrip(input([sourceFirst, sourceSecond], [returnResult()]));
  assert.ok(selectedSource);
  assert.equal((selectedSource.outboundSegments as Array<Record<string, unknown>>)[0].departureTime, "2027-04-03 08:00");

  const returnSourceFirst = returnResult({
    roundTripPrice: 1600,
    durationMinutes: 500,
    returnSegments: [rawSegment("CDG", "2027-04-12 08:00", "JFK", "2027-04-12 10:30")],
  });
  const returnSourceSecond = returnResult({
    roundTripPrice: 1600,
    durationMinutes: 500,
    returnSegments: [rawSegment("CDG", "2027-04-12 10:00", "JFK", "2027-04-12 12:30")],
  });
  const selectedReturnSource = selectSerpApiFlightRoundTrip(input([outboundResult()], [returnSourceFirst, returnSourceSecond]));
  assert.ok(selectedReturnSource);
  assert.equal((selectedReturnSource.returnSegments as Array<Record<string, unknown>>)[0].departureTime, "2027-04-12 08:00");
});

test("rejects wrong route or dates", () => {
  assert.equal(
    selectSerpApiFlightRoundTrip(input([outboundResult({ outboundSegments: [rawSegment("LAX", "2027-04-03 08:00", "CDG", "2027-04-03 20:00")] })])),
    null,
  );
  assert.equal(
    selectSerpApiFlightRoundTrip(input([outboundResult({ outboundSegments: [rawSegment("JFK", "2027-04-04 08:00", "CDG", "2027-04-04 20:00")] })])),
    null,
  );
});

test("accepts missing optional cabin and rejects conflicting cabin", () => {
  const missing = selectSerpApiFlightRoundTrip(
    input([outboundResult({ outboundSegments: [rawSegment("JFK", "2027-04-03 08:00", "CDG", "2027-04-03 20:00", null)] })]),
  );
  assert.ok(missing);
  assert.equal((missing.outboundSegments as Array<Record<string, unknown>>)[0].cabin, null);

  const conflicting = selectSerpApiFlightRoundTrip(
    input([outboundResult({ outboundSegments: [rawSegment("JFK", "2027-04-03 08:00", "CDG", "2027-04-03 20:00", "business")] })]),
  );
  assert.equal(conflicting, null);
});

test("rejects disconnected outbound and return segments", () => {
  const disconnectedOutbound = outboundResult({
    outboundSegments: [
      rawSegment("JFK", "2027-04-03 08:00", "LHR", "2027-04-03 10:00"),
      rawSegment("CDG", "2027-04-03 12:00", "CDG", "2027-04-03 20:00"),
    ],
  });
  const disconnectedReturn = returnResult({
    returnSegments: [
      rawSegment("CDG", "2027-04-12 09:00", "LHR", "2027-04-12 10:00"),
      rawSegment("JFK", "2027-04-12 11:00", "JFK", "2027-04-12 11:30"),
    ],
  });
  assert.equal(selectSerpApiFlightRoundTrip(input([disconnectedOutbound])), null);
  assert.equal(selectSerpApiFlightRoundTrip(input([outboundResult()], [disconnectedReturn])), null);
});

test("rejects an incompatible return result", () => {
  const result = selectSerpApiFlightRoundTrip(
    input([outboundResult()], [returnResult({ returnSegments: [rawSegment("CDG", "2027-04-13 09:00", "JFK", "2027-04-13 11:30")] })]),
  );
  assert.equal(result, null);
});

test("preserves the selected complete round-trip party total without per-traveler math", () => {
  const result = selectSerpApiFlightRoundTrip(input([outboundResult({ roundTripPrice: 1900 })], [returnResult({ roundTripPrice: 1736 })]));
  assert.ok(result);
  assert.equal(result.roundTripPrice, 1736);
  assert.equal(result.travelers, 2);
  assert.equal("perTravelerPrice" in result, false);
  assert.equal(JSON.stringify(result).includes("868"), false);
});

test("excludes opaque tokens, URLs, search IDs, and metadata from returned normalized input", () => {
  const result = selectSerpApiFlightRoundTrip(input());
  assert.ok(result);
  const serialized = JSON.stringify(result);
  for (const forbidden of ["opaque-token", "https://provider.example", "result-token", "search-id", "provider_metadata"]) {
    assert.equal(serialized.includes(forbidden), false, forbidden);
  }
  assert.deepEqual(Object.keys(result).sort(), [
    "cabin",
    "currency",
    "destination",
    "origin",
    "outboundDate",
    "outboundSegments",
    "retrievedAt",
    "returnDate",
    "returnSegments",
    "roundTripPrice",
    "travelers",
  ]);
});
