import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeSerpApiFlightPartyTotal } from "./serpApiFlightNormalizer";
import { selectSerpApiFlightOutbound, selectSerpApiFlightRoundTrip } from "./serpApiFlightSelection";
import {
  getSerpApiFlightDepartureToken,
  projectSerpApiFlightInitialBatch,
  projectSerpApiFlightInitialBatchOutcome,
  projectSerpApiFlightReturnBatch,
  projectSerpApiFlightReturnBatchOutcome,
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

test("classifies malformed envelopes and missing or wrongly typed result arrays", () => {
  for (const response of [null, [], {}, { best_flights: null }, { other_flights: {} }, { best_flights: [], other_flights: null }, { best_flights: {}, other_flights: [] }]) {
    assert.equal(projectSerpApiFlightInitialBatchOutcome(response, retrievedAt).status, "malformed_response");
    assert.equal(projectSerpApiFlightReturnBatchOutcome(response, retrievedAt).status, "malformed_response");
  }
});

test("classifies best-only and other-only empty responses as phase-specific no-options outcomes, but both absent as malformed", () => {
  for (const response of [{ best_flights: [] }, { other_flights: [] }, { best_flights: [], other_flights: [] }]) {
    assert.deepEqual(projectSerpApiFlightInitialBatchOutcome(response, retrievedAt), { status: "no_eligible_outbound" });
    assert.deepEqual(projectSerpApiFlightReturnBatchOutcome(response, retrievedAt), { status: "no_return_options" });
  }
  assert.equal(projectSerpApiFlightInitialBatchOutcome({}, retrievedAt).status, "malformed_response");
  assert.equal(projectSerpApiFlightReturnBatchOutcome({}, retrievedAt).status, "malformed_response");
});

test("projects best-only and other-only valid responses", () => {
  const best = projectSerpApiFlightInitialBatchOutcome({ best_flights: [rawResult()] }, retrievedAt);
  const other = projectSerpApiFlightReturnBatchOutcome({ other_flights: [returnResult()] }, retrievedAt);
  assert.equal(best.status, "ok");
  assert.equal(other.status, "ok");
});

test("classifies raw results with no structurally valid siblings as malformed", () => {
  const response = { best_flights: [{ flights: [], price: 1, total_duration: 1 }], other_flights: [{ flights: null, price: 2, total_duration: 2 }] };
  assert.deepEqual(projectSerpApiFlightInitialBatchOutcome(response, retrievedAt), { status: "malformed_response" });
  assert.deepEqual(projectSerpApiFlightReturnBatchOutcome(response, retrievedAt), { status: "malformed_response" });
});

test("classifies structurally valid tokenless initial results separately", () => {
  const response = { best_flights: [rawResult({ departure_token: "" })], other_flights: [] };
  assert.deepEqual(projectSerpApiFlightInitialBatchOutcome(response, retrievedAt), { status: "no_eligible_outbound" });
});

test("returns ok when a valid sibling survives malformed or tokenless siblings", () => {
  const response = {
    best_flights: [{ flights: [], price: 1, total_duration: 1 }, rawResult({ departure_token: "" })],
    other_flights: [rawResult({ price: 1200, departure_token: "usable" })],
  };
  const initial = projectSerpApiFlightInitialBatchOutcome(response, retrievedAt);
  assert.equal(initial.status, "ok");
  if (initial.status === "ok") {
    assert.equal(initial.batch.candidates.length, 1);
    assert.equal(getSerpApiFlightDepartureToken(initial.batch, 0), "usable");
  }
  const returned = projectSerpApiFlightReturnBatchOutcome({ best_flights: [{ flights: [], price: 1, total_duration: 1 }], other_flights: [returnResult()] }, retrievedAt);
  assert.equal(returned.status, "ok");
});

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
    best_flights: [rawResult({ flights: [], departure_token: "bad-result" }), rawResult({ departure_token: "" }), rawResult({ price: 1100, departure_token: "usable-token" })],
    other_flights: [],
  }, retrievedAt);
  assert.ok(batch);
  assert.equal(batch.candidates.length, 1);
  assert.equal(getSerpApiFlightDepartureToken(batch, 0), "usable-token");
});

test("retains a realistic opaque token above the legacy cap privately and by source index", () => {
  const longToken = `opaque-${"x".repeat(270)}`;
  const batch = projectSerpApiFlightInitialBatch({
    best_flights: [rawResult({ flights: [], departure_token: "dropped-token" }), rawResult({ departure_token: longToken })],
    other_flights: [],
  }, retrievedAt);
  assert.ok(batch);
  assert.equal(batch.candidates.length, 1);
  const selected = selectSerpApiFlightOutbound(batch.candidates, request);
  assert.ok(selected);
  assert.equal(selected.sourceIndex, 0);
  assert.equal(getSerpApiFlightDepartureToken(batch, selected.sourceIndex), longToken);
  assert.equal(JSON.stringify(batch).includes(longToken), false);
});

test("rejects an opaque departure token over the bounded maximum", () => {
  const overLimitToken = "x".repeat(1025);
  const outcome = projectSerpApiFlightInitialBatchOutcome({
    best_flights: [rawResult({ departure_token: overLimitToken })],
    other_flights: [],
  }, retrievedAt);
  assert.deepEqual(outcome, { status: "no_eligible_outbound" });
});

test("selector source index remains tied to the filtered outbound candidate and retrieves its token", () => {
  const batch = projectSerpApiFlightInitialBatch({ best_flights: [rawResult({ flights: [], departure_token: "dropped-token" }), rawResult({ price: 1400, departure_token: "token-A" }), rawResult({ price: 1100, departure_token: "token-B" })], other_flights: [] }, retrievedAt);
  assert.ok(batch);
  const selected = selectSerpApiFlightOutbound(batch.candidates, request);
  assert.ok(selected);
  assert.equal(selected.sourceIndex, 1);
  assert.equal(getSerpApiFlightDepartureToken(batch, selected.sourceIndex), "token-B");
  assert.equal(JSON.stringify(batch).includes("token-B"), false);
});

test("WeakMap identity rejects copies, serialization, lookalikes, unrelated batches, and invalid indices", () => {
  const batch = projectSerpApiFlightInitialBatch({ best_flights: [rawResult()], other_flights: [] }, retrievedAt);
  const unrelated = projectSerpApiFlightInitialBatch({ best_flights: [rawResult({ departure_token: "other" })], other_flights: [] }, retrievedAt);
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
  const batch = projectSerpApiFlightReturnBatch({ best_flights: [returnResult({ departure_token: undefined, price: 1736 })], other_flights: [] }, retrievedAt);
  assert.ok(batch);
  assert.equal(batch.candidates[0].roundTripPrice, 1736);
  assert.equal(getSerpApiFlightDepartureToken(batch, 0), null);
});

test("all-invalid batches return null", () => {
  assert.equal(projectSerpApiFlightInitialBatch({ best_flights: [rawResult({ departure_token: "" })], other_flights: [] }, retrievedAt), null);
  assert.equal(projectSerpApiFlightReturnBatch({ best_flights: [{ flights: [], price: 1, total_duration: 1 }], other_flights: [] }, retrievedAt), null);
});

test("sensitive raw fields never serialize from either batch", () => {
  const outbound = projectSerpApiFlightInitialBatch({ best_flights: [rawResult()], other_flights: [] }, retrievedAt);
  const returned = projectSerpApiFlightReturnBatch({ best_flights: [returnResult()], other_flights: [] }, retrievedAt);
  assert.ok(outbound && returned);
  const serialized = JSON.stringify({ outbound, returned });
  for (const forbidden of ["token-1", "https://provider.example", "search-id", "metadata", "hostile", "departure_token"]) assert.equal(serialized.includes(forbidden), false, forbidden);
});

test("opaque departure tokens never appear in projected candidates or client-facing results", () => {
  const longToken = `opaque-${"y".repeat(300)}`;
  const outbound = projectSerpApiFlightInitialBatch({ best_flights: [rawResult({ departure_token: longToken })], other_flights: [] }, retrievedAt);
  const returned = projectSerpApiFlightReturnBatch({ best_flights: [returnResult()], other_flights: [] }, retrievedAt);
  assert.ok(outbound && returned);
  const selected = selectSerpApiFlightRoundTrip({ outboundResults: outbound.candidates, request, returnOptionsForSelectedOutbound: returned.candidates });
  assert.ok(selected);
  const observation = normalizeSerpApiFlightPartyTotal(selected);
  assert.ok(observation);
  const serialized = JSON.stringify({ outbound, returned, observation });
  assert.equal(serialized.includes(longToken), false);
  assert.equal(serialized.includes("departure_token"), false);
});

test("outbound and return batches flow through selector and normalizer to a $1,736 observation", () => {
  const outbound = projectSerpApiFlightInitialBatch({ best_flights: [rawResult({ departure_token: "outbound-token" })], other_flights: [] }, retrievedAt);
  const returned = projectSerpApiFlightReturnBatch({ best_flights: [returnResult({ price: 1736 })], other_flights: [] }, retrievedAt);
  assert.ok(outbound && returned);
  const selected = selectSerpApiFlightRoundTrip({ outboundResults: outbound.candidates, request, returnOptionsForSelectedOutbound: returned.candidates });
  assert.ok(selected);
  const observation = normalizeSerpApiFlightPartyTotal(selected);
  assert.ok(observation);
  assert.equal(observation.price.amount, 1736);
});
