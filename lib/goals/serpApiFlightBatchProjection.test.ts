import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeSerpApiFlightPartyTotal } from "./serpApiFlightNormalizer";
import { selectSerpApiFlightOutbound, selectSerpApiFlightRoundTrip } from "./serpApiFlightSelection";
import {
  getSerpApiFlightDepartureToken,
  projectSerpApiFlightInitialBatch,
  projectSerpApiFlightReturnBatch,
} from "./serpApiFlightBatchProjection";

const retrievedAt = "2026-08-28T12:34:56.000Z";
const request = {
  origin: "JFK", destination: "CDG", outboundDate: "2027-04-03", returnDate: "2027-04-12",
  travelers: 2, cabin: "economy", currency: "USD",
};

function rawSegment(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    departure_airport: { id: "JFK", time: "2027-04-03 08:00" },
    arrival_airport: { id: "CDG", time: "2027-04-03 20:00" },
    airline: "Example Air", flight_number: "EA123", travel_class: "economy",
    url: "https://provider.example", search_id: "search-id", metadata: { hostile: true }, ...overrides,
  };
}

function rawResult(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { flights: [rawSegment()], price: 1736, total_duration: 500, departure_token: "token-1", ...overrides };
}

function returnResult(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return rawResult({
    flights: [rawSegment({ departure_airport: { id: "CDG", time: "2027-04-12 09:00" }, arrival_airport: { id: "JFK", time: "2027-04-12 11:30" } })],
    ...overrides,
  });
}

test("preserves best_flights then other_flights order and freezes visible arrays", () => {
  const batch = projectSerpApiFlightInitialBatch({
    best_flights: [rawResult({ price: 1000, departure_token: "best" })],
    other_flights: [rawResult({ price: 1200, departure_token: "other" })],
  }, retrievedAt);
  assert.ok(batch);
  assert.equal(batch.candidates[0].roundTripPrice, 1000);
  assert.equal(batch.candidates[1].roundTripPrice, 1200);
  assert.equal(Object.isFrozen(batch), true);
  assert.equal(Object.isFrozen(batch.candidates), true);
});

test("drops malformed and tokenless outbound siblings while keeping token indices aligned", () => {
  const batch = projectSerpApiFlightInitialBatch({
    best_flights: [
      rawResult({ flights: [], departure_token: "bad-result" }),
      rawResult({ departure_token: "" }),
      rawResult({ price: 1100, departure_token: "usable-token" }),
    ],
  }, retrievedAt);
  assert.ok(batch);
  assert.equal(batch.candidates.length, 1);
  assert.equal(getSerpApiFlightDepartureToken(batch, 0), "usable-token");
});

test("selector source index remains tied to the filtered outbound candidate and retrieves its token", () => {
  const batch = projectSerpApiFlightInitialBatch({
    best_flights: [
      rawResult({ flights: [], departure_token: "dropped-token" }),
      rawResult({ price: 1400, departure_token: "token-A" }),
      rawResult({ price: 1100, departure_token: "token-B" }),
    ],
  }, retrievedAt);
  assert.ok(batch);
  const selected = selectSerpApiFlightOutbound(batch.candidates, request);
  assert.ok(selected);
  assert.equal(selected.sourceIndex, 1);
  assert.equal(getSerpApiFlightDepartureToken(batch, selected.sourceIndex), "token-B");
  assert.notEqual(getSerpApiFlightDepartureToken(batch, selected.sourceIndex), "token-A");
  assert.notEqual(getSerpApiFlightDepartureToken(batch, selected.sourceIndex), "dropped-token");
  assert.equal(JSON.stringify(batch).includes("token-A"), false);
  assert.equal(JSON.stringify(batch).includes("token-B"), false);
  assert.equal(JSON.stringify(batch).includes("dropped-token"), false);
});

test("WeakMap identity rejects copies, serialization, lookalikes, unrelated batches, and invalid indices", () => {
  const batch = projectSerpApiFlightInitialBatch({ best_flights: [rawResult()] }, retrievedAt);
  const unrelated = projectSerpApiFlightInitialBatch({ best_flights: [rawResult({ departure_token: "other" })] }, retrievedAt);
  assert.ok(batch && unrelated);
  assert.equal(getSerpApiFlightDepartureToken(batch, 0), "token-1");
  assert.equal(getSerpApiFlightDepartureToken(unrelated, 0), "other");
  assert.equal(getSerpApiFlightDepartureToken({ candidates: batch.candidates }, 0), null);
  assert.equal(getSerpApiFlightDepartureToken(JSON.parse(JSON.stringify(batch)), 0), null);
  assert.equal(getSerpApiFlightDepartureToken(batch, -1), null);
  assert.equal(getSerpApiFlightDepartureToken(batch, 1), null);
  assert.equal(getSerpApiFlightDepartureToken(batch, 0.5), null);
});

test("return batches require no departure token and preserve completed $1,736", () => {
  const batch = projectSerpApiFlightReturnBatch({ best_flights: [returnResult({ departure_token: undefined, price: 1736 })] }, retrievedAt);
  assert.ok(batch);
  assert.equal(batch.candidates[0].roundTripPrice, 1736);
  assert.equal(getSerpApiFlightDepartureToken(batch, 0), null);
});

test("all-invalid batches return null", () => {
  assert.equal(projectSerpApiFlightInitialBatch({ best_flights: [rawResult({ departure_token: "" })] }, retrievedAt), null);
  assert.equal(projectSerpApiFlightReturnBatch({ best_flights: [{ flights: [], price: 1, total_duration: 1 }] }, retrievedAt), null);
});

test("sensitive raw fields never serialize from either batch", () => {
  const outbound = projectSerpApiFlightInitialBatch({ best_flights: [rawResult()] }, retrievedAt);
  const returned = projectSerpApiFlightReturnBatch({ best_flights: [returnResult()] }, retrievedAt);
  assert.ok(outbound && returned);
  const serialized = JSON.stringify({ outbound, returned });
  for (const forbidden of ["token-1", "https://provider.example", "search-id", "metadata", "hostile", "departure_token"]) assert.equal(serialized.includes(forbidden), false, forbidden);
});

test("outbound and return batches flow through selector and normalizer to a $1,736 observation", () => {
  const outbound = projectSerpApiFlightInitialBatch({ best_flights: [rawResult({ departure_token: "outbound-token" })] }, retrievedAt);
  const returned = projectSerpApiFlightReturnBatch({ best_flights: [returnResult({ price: 1736 })] }, retrievedAt);
  assert.ok(outbound && returned);
  const selected = selectSerpApiFlightRoundTrip({ outboundResults: outbound.candidates, request, returnOptionsForSelectedOutbound: returned.candidates });
  assert.ok(selected);
  const observation = normalizeSerpApiFlightPartyTotal(selected);
  assert.ok(observation);
  assert.equal(observation.price.amount, 1736);
});
