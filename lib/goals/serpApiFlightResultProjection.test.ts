import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeSerpApiFlightPartyTotal } from "./serpApiFlightNormalizer";
import { selectSerpApiFlightRoundTrip } from "./serpApiFlightSelection";
import { projectSerpApiFlightResult } from "./serpApiFlightResultProjection";

const request = {
  origin: "JFK", destination: "CDG", outboundDate: "2027-04-03", returnDate: "2027-04-12",
  travelers: 2, cabin: "economy", currency: "USD",
};
const retrievedAt = "2026-08-28T12:34:56.000Z";

function rawSegment(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    departure_airport: { id: "JFK", time: "2027-04-03 08:00" },
    arrival_airport: { id: "CDG", time: "2027-04-03 20:00" },
    airline: "Example Air", flight_number: "EA123", travel_class: "economy",
    url: "https://provider.example/flight", token: "opaque-token",
    search_id: "search-123", provider_metadata: { hostile: true }, ...overrides,
  };
}

function rawResult(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { flights: [rawSegment()], price: 1736, total_duration: 500, provider_retrieved_at: "1999-01-01T00:00:00Z", ...overrides };
}

test("projects outbound and return results from the same raw flights field", () => {
  const outbound = projectSerpApiFlightResult(rawResult(), retrievedAt);
  const returned = projectSerpApiFlightResult(
    rawResult({ flights: [rawSegment({ departure_airport: { id: "CDG", time: "2027-04-12 09:00" }, arrival_airport: { id: "JFK", time: "2027-04-12 11:30" } })] }),
    retrievedAt,
  );
  assert.ok(outbound && returned);
  assert.equal((outbound.segments as Array<Record<string, unknown>>)[0].departureAirport, "JFK");
  assert.equal((returned.segments as Array<Record<string, unknown>>)[0].departureAirport, "CDG");
  assert.equal(outbound.roundTripPrice, 1736);
});

test("projected phases are accepted by selection and flow directly through selector and normalizer", () => {
  const outbound = projectSerpApiFlightResult(rawResult(), retrievedAt);
  const returned = projectSerpApiFlightResult(
    rawResult({ flights: [rawSegment({ departure_airport: { id: "CDG", time: "2027-04-12 09:00" }, arrival_airport: { id: "JFK", time: "2027-04-12 11:30" } })] }),
    retrievedAt,
  );
  assert.ok(outbound && returned);
  const selected = selectSerpApiFlightRoundTrip({ outboundResults: [outbound], request, returnOptionsForSelectedOutbound: [returned] });
  assert.ok(selected);
  const observation = normalizeSerpApiFlightPartyTotal(selected);
  assert.ok(observation);
  assert.equal(observation.price.amount, 1736);
  assert.equal(observation.priceCoverage, "searched_party_total");
});

test("ignores return_flights and provider retrieval metadata", () => {
  const result = projectSerpApiFlightResult(rawResult({ return_flights: [{ hostile: true }] }), retrievedAt);
  assert.ok(result);
  assert.equal(result.retrievedAt, retrievedAt);
  assert.equal("return_flights" in result, false);
});

test("reconstructs only the allowlisted result fields and excludes hostile data", () => {
  const result = projectSerpApiFlightResult(rawResult(), retrievedAt);
  assert.ok(result);
  assert.deepEqual(Object.keys(result).sort(), ["durationMinutes", "retrievedAt", "roundTripPrice", "segments"]);
  const serialized = JSON.stringify(result);
  for (const forbidden of ["opaque-token", "https://provider.example", "search-123", "provider_metadata", "hostile", "provider_retrieved_at"]) assert.equal(serialized.includes(forbidden), false, forbidden);
});

test("rejects malformed input, segments, price, duration, and supplied retrieval time", () => {
  for (const raw of [null, [], "text", 42, { flights: null }, { flights: [rawSegment({ departure_airport: "JFK" })] }]) assert.equal(projectSerpApiFlightResult(raw, retrievedAt), null);
  for (const price of [-1, Infinity, "1736"]) assert.equal(projectSerpApiFlightResult(rawResult({ price }), retrievedAt), null);
  for (const duration of [-1, Infinity, "500"]) assert.equal(projectSerpApiFlightResult(rawResult({ total_duration: duration }), retrievedAt), null);
  for (const timestamp of [null, "", "not-a-time"]) assert.equal(projectSerpApiFlightResult(rawResult(), timestamp), null);
});

test("does not perform arithmetic or create a per-traveler price", () => {
  const result = projectSerpApiFlightResult(rawResult({ price: 1736 }), retrievedAt);
  assert.ok(result);
  assert.equal(result.roundTripPrice, 1736);
  assert.equal("perTravelerPrice" in result, false);
  assert.equal(JSON.stringify(result).includes("868"), false);
});
