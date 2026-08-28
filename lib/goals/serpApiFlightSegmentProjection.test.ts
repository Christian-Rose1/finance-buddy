import assert from "node:assert/strict";
import { test } from "node:test";
import { projectSerpApiFlightSegments } from "./serpApiFlightSegmentProjection";

function segment(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    departure_airport: { id: "JFK", time: "2027-04-03 08:00" },
    arrival_airport: { id: "CDG", time: "2027-04-03 20:00" },
    airline: "Example Air",
    flight_number: "EA123",
    travel_class: "economy",
    url: "https://provider.example/flight",
    token: "opaque-token",
    provider_metadata: { secret: "hostile" },
    ...overrides,
  };
}

test("projects a valid nonstop nested SerpApi segment", () => {
  assert.deepEqual(projectSerpApiFlightSegments([segment()]), [{
    sequence: 1,
    departureAirport: "JFK",
    departureTime: "2027-04-03 08:00",
    arrivalAirport: "CDG",
    arrivalTime: "2027-04-03 20:00",
    marketingCarrier: "Example Air",
    marketingFlightNumber: "EA123",
    cabin: "economy",
    operatingCarrier: null,
  }]);
});

test("projects a connecting flight and recomputes local sequence", () => {
  const result = projectSerpApiFlightSegments([
    segment({ sequence: 99 }),
    segment({
      departure_airport: { id: "CDG", time: "2027-04-03 21:00" },
      arrival_airport: { id: "LHR", time: "2027-04-03 22:00" },
      sequence: 100,
    }),
  ]);
  assert.ok(result);
  assert.deepEqual(result.map((item) => item.sequence), [1, 2]);
  assert.equal(result[1].departureAirport, "CDG");
});

test("rejects disconnected segments", () => {
  assert.equal(projectSerpApiFlightSegments([
    segment(),
    segment({ departure_airport: { id: "LHR", time: "2027-04-03 21:00" } }),
  ]), null);
});

test("requires nested airport objects and rejects the invented flat shape", () => {
  assert.equal(projectSerpApiFlightSegments([segment({
    departure_airport: "JFK",
    arrival_airport: "CDG",
    departure_airport_time: "2027-04-03 08:00",
    arrival_airport_time: "2027-04-03 20:00",
  })]), null);
});

test("accepts exact minute boundaries and rejects ISO, seconds, and impossible timestamps", () => {
  for (const value of ["2027-04-03 00:00", "2027-04-03 23:59"]) {
    const result = projectSerpApiFlightSegments([segment({
      departure_airport: { id: "JFK", time: value },
      arrival_airport: { id: "CDG", time: value },
    })]);
    assert.ok(result);
  }
  for (const value of ["2027-04-03T08:00:00Z", "2027-04-03 08:00:00", "2027-02-29 08:00", "2027-04-03 24:00", "2027-04-03 08:60"]) {
    assert.equal(projectSerpApiFlightSegments([segment({
      departure_airport: { id: "JFK", time: value },
    })]), null);
  }
});

test("keeps marketing and operating carriers truthful", () => {
  const result = projectSerpApiFlightSegments([segment({ operating_carrier: "Operating Air" })]);
  assert.ok(result);
  assert.equal(result[0].marketingCarrier, "Example Air");
  assert.equal(result[0].operatingCarrier, "Operating Air");
  const absent = projectSerpApiFlightSegments([segment()]);
  assert.ok(absent);
  assert.equal(absent[0].operatingCarrier, null);
});

test("maps missing optional fields to null and bounds hostile text", () => {
  const result = projectSerpApiFlightSegments([segment({
    airline: undefined,
    flight_number: undefined,
    travel_class: undefined,
    operating_carrier: "https://evil.example",
  })]);
  assert.ok(result);
  assert.equal(result[0].marketingCarrier, null);
  assert.equal(result[0].marketingFlightNumber, null);
  assert.equal(result[0].cabin, null);
  assert.equal(result[0].operatingCarrier, null);
  for (const key of ["airline", "flight_number", "travel_class", "operating_carrier"]) {
    assert.equal(key in result[0], false);
  }
});

test("rejects invalid optional field shapes and preserves no hostile extras", () => {
  for (const field of ["airline", "flight_number", "operating_carrier"] as const) {
    const objectValue = projectSerpApiFlightSegments([segment({ [field]: {} })]);
    const arrayValue = projectSerpApiFlightSegments([segment({ [field]: [] })]);
    assert.ok(objectValue);
    assert.ok(arrayValue);
    const canonicalField = field === "airline"
      ? "marketingCarrier"
      : field === "flight_number"
        ? "marketingFlightNumber"
        : "operatingCarrier";
    assert.equal(objectValue[0][canonicalField], null);
    assert.equal(arrayValue[0][canonicalField], null);
  }
  for (const field of ["travel_class"] as const) {
    assert.equal(projectSerpApiFlightSegments([segment({ [field]: {} })]), null);
    assert.equal(projectSerpApiFlightSegments([segment({ [field]: [] })]), null);
  }
  const result = projectSerpApiFlightSegments([segment()]);
  assert.ok(result);
  const serialized = JSON.stringify(result);
  for (const forbidden of ["https://provider.example", "opaque-token", "provider_metadata", "hostile", "departure_airport", "search_id"]) {
    assert.equal(serialized.includes(forbidden), false, forbidden);
  }
});

test("rejects hostile optional carrier text and preserves safe optional-field policy", () => {
  for (const value of ["bad\u0000carrier", "https://evil.example", "A".repeat(40), "token_" + "a".repeat(40)]) {
    const result = projectSerpApiFlightSegments([segment({ airline: value, operating_carrier: value, flight_number: value })]);
    assert.ok(result);
    assert.equal(result[0].marketingCarrier, null);
    assert.equal(result[0].marketingFlightNumber, null);
    assert.equal(result[0].operatingCarrier, null);
  }
  assert.equal(projectSerpApiFlightSegments([segment({ travel_class: "bad\u0000cabin" })]), null);
  assert.equal(projectSerpApiFlightSegments([segment({ travel_class: "https://evil.example" })]), null);
  assert.equal(projectSerpApiFlightSegments([segment({ travel_class: "A".repeat(41) })]), null);
});

test("enforces one-to-eight segments", () => {
  assert.equal(projectSerpApiFlightSegments([]), null);
  assert.equal(projectSerpApiFlightSegments(Array.from({ length: 9 }, (_, index) => segment({
    departure_airport: { id: index === 0 ? "JFK" : "CDG", time: "2027-04-03 08:00" },
    arrival_airport: { id: "CDG", time: "2027-04-03 20:00" },
  }))), null);
});
