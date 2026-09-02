import assert from "node:assert/strict";
import { test } from "node:test";
import {
  isValidSerpApiFlightSelectionRequest,
  selectSerpApiFlightOutbound,
  selectSerpApiFlightRoundTrip,
  serpApiTravelClassForCabin,
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
    segments: [rawSegment("JFK", "2027-04-03 08:00", "CDG", "2027-04-03 20:00")],
    roundTripPrice: 1800,
    retrievedAt: "2026-08-28T12:34:56.000Z",
    durationMinutes: 500,
    ...overrides,
  };
}

function returnResult(overrides: Partial<SerpApiFlightSelectionResult> = {}): SerpApiFlightSelectionResult {
  return {
    segments: [rawSegment("CDG", "2027-04-12 09:00", "JFK", "2027-04-12 11:30")],
    roundTripPrice: 1800,
    retrievedAt: "2026-08-28T12:34:56.000Z",
    durationMinutes: 500,
    ...overrides,
  };
}

function input(
  outboundResults: readonly SerpApiFlightSelectionResult[] = [outboundResult()],
  returnOptionsForSelectedOutbound: readonly SerpApiFlightSelectionResult[] = [returnResult()],
  selectedRequest: SerpApiFlightSelectionRequest = request,
): SerpApiFlightSelectionInput {
  return { outboundResults, request: selectedRequest, returnOptionsForSelectedOutbound };
}

test("validates exact requests and maps all supported cabins", () => {
  assert.equal(isValidSerpApiFlightSelectionRequest(request), true);
  assert.deepEqual(
    ["economy", "premium_economy", "business", "first"].map(serpApiTravelClassForCabin),
    ["1", "2", "3", "4"],
  );
  assert.equal(serpApiTravelClassForCabin(" premium_economy"), null);
});

test("accepts airport-only DEN to CDG requests unchanged", () => {
  const airportRequest = { ...request, origin: "DEN", destination: "CDG" };
  assert.equal(isValidSerpApiFlightSelectionRequest(airportRequest), true);
  assert.ok(selectSerpApiFlightRoundTrip(input(
    [outboundResult({ segments: [rawSegment("DEN", "2027-04-03 08:00", "CDG", "2027-04-03 20:00")] })],
    [returnResult({ segments: [rawSegment("CDG", "2027-04-12 09:00", "DEN", "2027-04-12 11:30")] })],
    airportRequest,
  )));
});

test("accepts city scopes for CDG or ORY and rejects LHR", () => {
  const parisRequest = { ...request, destination: "/m/05qtj", destinationAirportIds: ["CDG", "ORY"] };
  for (const airport of ["CDG", "ORY"]) {
    assert.ok(selectSerpApiFlightOutbound([outboundResult({ segments: [rawSegment("JFK", "2027-04-03 08:00", airport, "2027-04-03 20:00")] })], parisRequest));
  }
  assert.equal(selectSerpApiFlightOutbound([outboundResult({ segments: [rawSegment("JFK", "2027-04-03 08:00", "LHR", "2027-04-03 20:00")] })], parisRequest), null);
});

test("reverses city scopes for return selection and returns actual outbound endpoints", () => {
  const parisRequest = { ...request, destination: "/m/05qtj", destinationAirportIds: ["CDG", "ORY"] };
  const result = selectSerpApiFlightRoundTrip(input(
    [outboundResult({ segments: [rawSegment("JFK", "2027-04-03 08:00", "ORY", "2027-04-03 20:00")] })],
    [returnResult({ segments: [rawSegment("CDG", "2027-04-12 09:00", "JFK", "2027-04-12 11:30")] })],
    parisRequest,
  ));
  assert.ok(result);
  assert.equal(result.origin, "JFK");
  assert.equal(result.destination, "ORY");
  assert.equal((result.returnSegments as Array<Record<string, unknown>>)[0].departureAirport, "CDG");
  assert.notEqual(result.destination, "/m/05qtj");
});

test("accepts /g/ city identifiers with a valid scope", () => {
  const cityRequest = { ...request, destination: "/g/example", destinationAirportIds: ["CDG"] };
  assert.equal(isValidSerpApiFlightSelectionRequest(cityRequest), true);
  assert.ok(selectSerpApiFlightOutbound([outboundResult()], cityRequest));
});

test("uses multi-airport city scopes at both outbound endpoints", () => {
  const cityRequest = {
    ...request,
    origin: "/m/new-york",
    originAirportIds: ["JFK", "EWR"],
    destination: "/g/paris",
    destinationAirportIds: ["CDG", "ORY"],
  };
  const valid = selectSerpApiFlightRoundTrip(input(
    [outboundResult({ segments: [rawSegment("EWR", "2027-04-03 08:00", "ORY", "2027-04-03 20:00")] })],
    [returnResult({ segments: [rawSegment("CDG", "2027-04-12 09:00", "JFK", "2027-04-12 11:30")] })],
    cityRequest,
  ));
  assert.ok(valid);
  assert.equal(valid.origin, "EWR");
  assert.equal(valid.destination, "ORY");

  assert.equal(selectSerpApiFlightRoundTrip(input(
    [outboundResult({ segments: [rawSegment("BOS", "2027-04-03 08:00", "ORY", "2027-04-03 20:00")] })],
    [returnResult({ segments: [rawSegment("CDG", "2027-04-12 09:00", "JFK", "2027-04-12 11:30")] })],
    cityRequest,
  )), null);
  assert.equal(selectSerpApiFlightRoundTrip(input(
    [outboundResult({ segments: [rawSegment("EWR", "2027-04-03 08:00", "ORY", "2027-04-03 20:00")] })],
    [returnResult({ segments: [rawSegment("LHR", "2027-04-12 09:00", "JFK", "2027-04-12 11:30")] })],
    cityRequest,
  )), null);
});

test("requires valid city scopes and rejects malformed scopes", () => {
  const invalidRequests: unknown[] = [
    { ...request, destination: "/m/05qtj" },
    { ...request, destination: "/m/05qtj", destinationAirportIds: [] },
    { ...request, destination: "/m/05qtj", destinationAirportIds: "CDG" },
    { ...request, destination: "/m/05qtj", destinationAirportIds: ["cdg"] },
    { ...request, destination: "/m/05qtj", destinationAirportIds: ["CDG", "CDG"] },
    { ...request, destination: "/m/05qtj", destinationAirportIds: ["CDG", "ORY", ...Array(11).fill("BOS")] },
    { ...request, destination: "not-a-location", destinationAirportIds: ["CDG"] },
  ];
  for (const invalid of invalidRequests) assert.equal(isValidSerpApiFlightSelectionRequest(invalid), false);
});

test("requires airport scopes to be exactly their search airport and rejects overlap", () => {
  assert.equal(
    isValidSerpApiFlightSelectionRequest({ ...request, originAirportIds: ["JFK", "BOS"] }),
    false,
  );
  assert.equal(
    isValidSerpApiFlightSelectionRequest({ ...request, destinationAirportIds: ["CDG", "ORY"] }),
    false,
  );
  assert.equal(
    isValidSerpApiFlightSelectionRequest({ ...request, originAirportIds: ["BOS"] }),
    false,
  );
  assert.equal(
    isValidSerpApiFlightSelectionRequest({ ...request, destinationAirportIds: ["ORY"] }),
    false,
  );
  assert.equal(
    isValidSerpApiFlightSelectionRequest({
      ...request,
      originAirportIds: ["JFK"],
      destinationAirportIds: ["JFK"],
    }),
    false,
  );
  assert.equal(
    isValidSerpApiFlightSelectionRequest({
      ...request,
      origin: "/m/origin",
      originAirportIds: ["JFK"],
      destination: "/g/destination",
      destinationAirportIds: ["JFK"],
    }),
    false,
  );
});

test("rejects impossible or malformed request values without normalization", () => {
  for (const mutation of [
    { outboundDate: "2027-02-29" },
    { outboundDate: "2027-04-03T00:00:00Z" },
    { returnDate: "2027-04-02" },
    { origin: "jfk" },
    { destination: "CD" },
    { origin: "JFK", destination: "JFK" },
    { travelers: 0 },
    { travelers: 1.5 },
    { currency: "usd" },
    { cabin: "premium economy" },
  ]) {
    const invalid = { ...request, ...mutation };
    assert.equal(isValidSerpApiFlightSelectionRequest(invalid), false);
    assert.equal(selectSerpApiFlightOutbound([outboundResult()], invalid), null);
    assert.equal(selectSerpApiFlightRoundTrip({ ...input(), request: invalid }), null);
  }
});

test("selects an outbound-only candidate and preserves its original source index", () => {
  const selected = selectSerpApiFlightOutbound(
    [
      { ...outboundResult({ roundTripPrice: Number.NaN }), sourceLabel: "invalid" },
      outboundResult({ roundTripPrice: 1700 }),
    ],
    request,
  );
  assert.ok(selected);
  assert.equal(selected.sourceIndex, 1);
  assert.equal(selected.outboundSegments[0].marketingFlightNumber, "EA123");
});

test("selects a return-only candidate without requiring an opposite leg", () => {
  const result = selectSerpApiFlightRoundTrip(
    input(
      [outboundResult({ roundTripPrice: 1700 })],
      [returnResult({ roundTripPrice: 1736 })],
    ),
  );
  assert.ok(result);
  assert.equal(result.roundTripPrice, 1736);
  assert.equal((result.returnSegments as Array<Record<string, unknown>>)[0].arrivalAirport, "JFK");
});

test("selects the lowest searched-party-total return and preserves the completed price", () => {
  const result = selectSerpApiFlightRoundTrip(
    input(
      [outboundResult({ roundTripPrice: 1900 })],
      [returnResult({ roundTripPrice: 1800 }), returnResult({ roundTripPrice: 1736 })],
    ),
  );
  assert.ok(result);
  assert.equal(result.roundTripPrice, 1736);
});

test("uses duration and then original result order as deterministic tie-breakers", () => {
  const first = outboundResult({ roundTripPrice: 1700, durationMinutes: 600 });
  const shortest = outboundResult({
    roundTripPrice: 1700,
    durationMinutes: 500,
    segments: [rawSegment("JFK", "2027-04-03 09:00", "CDG", "2027-04-03 20:00")],
  });
  const returnFirst = returnResult({
    roundTripPrice: 1600,
    durationMinutes: 600,
    segments: [rawSegment("CDG", "2027-04-12 09:00", "JFK", "2027-04-12 11:30")],
  });
  const returnShortest = returnResult({
    roundTripPrice: 1600,
    durationMinutes: 500,
    segments: [rawSegment("CDG", "2027-04-12 10:00", "JFK", "2027-04-12 12:30")],
  });
  const selected = selectSerpApiFlightRoundTrip(input([first, shortest], [returnFirst, returnShortest]));
  assert.ok(selected);
  assert.equal((selected.outboundSegments as Array<Record<string, unknown>>)[0].departureTime, "2027-04-03 09:00");
  assert.equal((selected.returnSegments as Array<Record<string, unknown>>)[0].departureTime, "2027-04-12 10:00");

  const sourceFirst = outboundResult({ roundTripPrice: 1700, durationMinutes: 500, retrievedAt: "2026-08-28T01:00:00.000Z" });
  const sourceSecond = outboundResult({ roundTripPrice: 1700, durationMinutes: 500, retrievedAt: "2026-08-28T02:00:00.000Z", segments: [rawSegment("JFK", "2027-04-03 09:00", "CDG", "2027-04-03 21:00")] });
  const selectedSource = selectSerpApiFlightRoundTrip(input([sourceFirst, sourceSecond]));
  assert.ok(selectedSource);
  assert.equal((selectedSource.outboundSegments as Array<Record<string, unknown>>)[0].departureTime, "2027-04-03 08:00");

  const returnSourceFirst = returnResult({ roundTripPrice: 1600, durationMinutes: 500, segments: [rawSegment("CDG", "2027-04-12 08:00", "JFK", "2027-04-12 10:30")] });
  const returnSourceSecond = returnResult({ roundTripPrice: 1600, durationMinutes: 500, segments: [rawSegment("CDG", "2027-04-12 10:00", "JFK", "2027-04-12 12:30")] });
  const selectedReturnSource = selectSerpApiFlightRoundTrip(input([outboundResult()], [returnSourceFirst, returnSourceSecond]));
  assert.ok(selectedReturnSource);
  assert.equal((selectedReturnSource.returnSegments as Array<Record<string, unknown>>)[0].departureTime, "2027-04-12 08:00");
});

test("rejects wrong-phase routes or dates", () => {
  assert.equal(selectSerpApiFlightRoundTrip(input([outboundResult({ segments: [rawSegment("CDG", "2027-04-12 09:00", "JFK", "2027-04-12 11:30")] })])), null);
  assert.equal(selectSerpApiFlightRoundTrip(input([outboundResult({ segments: [rawSegment("JFK", "2027-04-04 08:00", "CDG", "2027-04-04 20:00")] })])), null);
  assert.equal(selectSerpApiFlightRoundTrip(input([outboundResult()], [returnResult({ segments: [rawSegment("JFK", "2027-04-03 09:00", "CDG", "2027-04-03 11:30")] })])), null);
  assert.equal(selectSerpApiFlightRoundTrip(input([outboundResult()], [returnResult({ segments: [rawSegment("CDG", "2027-04-13 09:00", "JFK", "2027-04-13 11:30")] })])), null);
});

test("accepts missing optional cabin and rejects conflicting cabin", () => {
  const missing = selectSerpApiFlightRoundTrip(input([outboundResult({ segments: [rawSegment("JFK", "2027-04-03 08:00", "CDG", "2027-04-03 20:00", null)] })]));
  assert.ok(missing);
  assert.equal((missing.outboundSegments as Array<Record<string, unknown>>)[0].cabin, null);

  const conflicting = selectSerpApiFlightRoundTrip(input([outboundResult({ segments: [rawSegment("JFK", "2027-04-03 08:00", "CDG", "2027-04-03 20:00", "business")] })]));
  assert.equal(conflicting, null);
});

test("rejects disconnected segments in either phase", () => {
  const disconnectedOutbound = outboundResult({
    segments: [
      rawSegment("JFK", "2027-04-03 08:00", "LHR", "2027-04-03 10:00"),
      rawSegment("CDG", "2027-04-03 12:00", "CDG", "2027-04-03 20:00"),
    ],
  });
  const disconnectedReturn = returnResult({
    segments: [
      rawSegment("CDG", "2027-04-12 09:00", "LHR", "2027-04-12 10:00"),
      rawSegment("JFK", "2027-04-12 11:00", "JFK", "2027-04-12 11:30"),
    ],
  });
  assert.equal(selectSerpApiFlightRoundTrip(input([disconnectedOutbound])), null);
  assert.equal(selectSerpApiFlightRoundTrip(input([outboundResult()], [disconnectedReturn])), null);
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

test("does not mutate request scope arrays or result inputs", () => {
  const destinationAirportIds = ["CDG", "ORY"];
  const cityRequest = { ...request, destination: "/m/05qtj", destinationAirportIds };
  const results = [outboundResult()];
  const beforeRequest = JSON.stringify(cityRequest);
  const beforeResults = JSON.stringify(results);
  assert.ok(selectSerpApiFlightOutbound(results, cityRequest));
  assert.equal(JSON.stringify(cityRequest), beforeRequest);
  assert.equal(JSON.stringify(results), beforeResults);
});
