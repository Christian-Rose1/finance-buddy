import assert from "node:assert/strict";
import { test } from "node:test";
import {
  normalizeSerpApiFlightPartyTotal,
  type SerpApiFlightNormalizerInput,
} from "./serpApiFlightNormalizer";
import {
  selectSerpApiFlightRoundTrip,
  type SerpApiFlightSelectionInput,
} from "./serpApiFlightSelection";

const segment = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  departureAirport: "JFK",
  departureTime: "2027-04-03 08:00",
  arrivalAirport: "CDG",
  arrivalTime: "2027-04-03 20:00",
  marketingCarrier: "Example Air",
  marketingFlightNumber: "EA123",
  cabin: "economy",
  operatingCarrier: "Example Air",
  url: "https://provider.example/flight",
  search_id: "search-123",
  provider_metadata: { secret: "hostile nested value" },
  nested: { token: "nested-token" },
  ...overrides,
});

const baseInput = (): SerpApiFlightNormalizerInput => ({
  origin: "JFK",
  destination: "CDG",
  outboundDate: "2027-04-03",
  returnDate: "2027-04-12",
  travelers: 2,
  cabin: "economy",
  currency: "USD",
  outboundSegments: [segment()],
  returnSegments: [
    segment({
      departureAirport: "CDG",
      departureTime: "2027-04-12 09:00",
      arrivalAirport: "JFK",
      arrivalTime: "2027-04-12 11:30",
    }),
  ],
  roundTripPrice: 1736,
  retrievedAt: "2026-08-28T12:34:56.000Z",
});

// The normalizer consumes canonical selector-shaped segments.
const validInput = (): SerpApiFlightNormalizerInput => {
  const input = baseInput();
  input.outboundSegments = [
    segment({
      departureAirport: "JFK",
      departureTime: "2027-04-03 08:00",
      arrivalAirport: "CDG",
      arrivalTime: "2027-04-03 20:00",
    }),
  ];
  input.returnSegments = [
    segment({
      departureAirport: "CDG",
      departureTime: "2027-04-12 09:00",
      arrivalAirport: "JFK",
      arrivalTime: "2027-04-12 11:30",
    }),
  ];
  return input;
};

test("preserves the searched party-total price without multiplying it", () => {
  const observation = normalizeSerpApiFlightPartyTotal(validInput());
  assert.ok(observation);
  assert.deepEqual(observation.price, { amount: 1736, currency: "USD" });
  assert.equal(observation.travelers, 2);
  assert.equal(observation.priceCoverage, "searched_party_total");
  assert.equal(observation.evidenceLevel, "web_observed_not_live");
  assert.equal(observation.verificationRequired, true);
});

test("accepts a missing segment cabin and preserves it as unknown", () => {
  const input = validInput();
  input.outboundSegments = [
    segment({ cabin: null }),
  ];
  const observation = normalizeSerpApiFlightPartyTotal(input);
  assert.ok(observation);
  assert.equal(observation.outboundSegments[0].cabin, null);
});

test("rejects an explicitly conflicting segment cabin", () => {
  const input = validInput();
  input.returnSegments = [
    segment({ cabin: "business" }),
  ];
  assert.equal(normalizeSerpApiFlightPartyTotal(input), null);
});

test("normalizes the real selector-produced completed-round-trip input directly", () => {
  const selectorInput: SerpApiFlightSelectionInput = {
    outboundResults: [
      {
        segments: validInput().outboundSegments,
        roundTripPrice: 1736,
        retrievedAt: "2026-08-28T12:34:56.000Z",
        durationMinutes: 500,
      },
    ],
    request: {
      origin: "JFK",
      destination: "CDG",
      outboundDate: "2027-04-03",
      returnDate: "2027-04-12",
      travelers: 2,
      cabin: "economy",
      currency: "USD",
    },
    returnOptionsForSelectedOutbound: [
      {
        segments: validInput().returnSegments,
        roundTripPrice: 1736,
        retrievedAt: "2026-08-28T12:34:56.000Z",
        durationMinutes: 500,
      },
    ],
  };
  const selected = selectSerpApiFlightRoundTrip(selectorInput);
  assert.ok(selected);
  const observation = normalizeSerpApiFlightPartyTotal(selected);
  assert.ok(observation);
  assert.equal(observation.travelers, 2);
  assert.equal(observation.price.amount, 1736);
  assert.equal(observation.outboundSegments.length, 1);
  assert.equal(observation.returnSegments.length, 1);
});

test("does not create a per-traveler price", () => {
  const observation = normalizeSerpApiFlightPartyTotal(validInput());
  assert.ok(observation);
  assert.equal("perTravelerPrice" in observation, false);
  assert.equal("pricePerTraveler" in observation, false);
  assert.equal(JSON.stringify(observation).includes("868"), false);
});

test("accepts canonical selector-shaped segments and ignores input sequence", () => {
  const input = validInput();
  input.outboundSegments = [
    segment({ sequence: 99, marketingFlightNumber: "EA-raw", arrivalAirport: "LHR", arrivalTime: "2027-04-03 10:00", hostile: { token: "bad" } }),
    segment({ sequence: 100, departureAirport: "LHR", departureTime: "2027-04-03 12:00", arrivalAirport: "CDG", arrivalTime: "2027-04-03 20:00" }),
  ];
  const observation = normalizeSerpApiFlightPartyTotal(input);
  assert.ok(observation);
  assert.deepEqual(observation.outboundSegments.map((item) => item.sequence), [1, 2]);
  assert.equal("flight_number" in observation.outboundSegments[0], false);
  assert.equal(observation.outboundSegments[0].marketingFlightNumber, "EA-raw");
});

test("rejects raw snake-case-only segments", () => {
  const input = validInput();
  input.outboundSegments = [{ departure_airport: { id: "JFK", time: "2027-04-03 08:00" }, arrival_airport: { id: "CDG", time: "2027-04-03 20:00" }, airline: "Example Air", flight_number: "EA123", travel_class: "economy" }];
  assert.equal(normalizeSerpApiFlightPartyTotal(input), null);
});

test("preserves valid reconstructed outbound and return segments", () => {
  const observation = normalizeSerpApiFlightPartyTotal(validInput());
  assert.ok(observation);
  assert.deepEqual(observation.outboundSegments, [
    {
      sequence: 1,
      departureAirport: "JFK",
      departureTime: "2027-04-03 08:00",
      arrivalAirport: "CDG",
      arrivalTime: "2027-04-03 20:00",
      marketingCarrier: "Example Air",
      marketingFlightNumber: "EA123",
      cabin: "economy",
      operatingCarrier: "Example Air",
    },
  ]);
  assert.deepEqual(observation.returnSegments, [
    {
      sequence: 1,
      departureAirport: "CDG",
      departureTime: "2027-04-12 09:00",
      arrivalAirport: "JFK",
      arrivalTime: "2027-04-12 11:30",
      marketingCarrier: "Example Air",
      marketingFlightNumber: "EA123",
      cabin: "economy",
      operatingCarrier: "Example Air",
    },
  ]);
});

test("rejects route and date mismatches", () => {
  for (const mutation of [
    { origin: "LAX" },
    { destination: "LHR" },
    { outboundDate: "2027-04-04" },
    { returnDate: "2027-04-13" },
    { returnDate: "2027-04-02" },
    { outboundSegments: [segment({ departureAirport: "LAX" })] },
    { returnSegments: [segment({ departureAirport: "CDG", arrivalAirport: "LAX" })] },
  ]) {
    assert.equal(normalizeSerpApiFlightPartyTotal({ ...validInput(), ...mutation }), null);
  }
});

test("rejects invalid traveler counts, numeric values, currency, and missing segments", () => {
  for (const travelers of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, "2"]) {
    assert.equal(normalizeSerpApiFlightPartyTotal({ ...validInput(), travelers }), null);
  }
  for (const roundTripPrice of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -0.01, "1736"]) {
    assert.equal(normalizeSerpApiFlightPartyTotal({ ...validInput(), roundTripPrice }), null);
  }
  for (const currency of ["US$", "USD1", "usd", "US", "https://currency.example"]) {
    assert.equal(normalizeSerpApiFlightPartyTotal({ ...validInput(), currency }), null);
  }
  assert.equal(normalizeSerpApiFlightPartyTotal({ ...validInput(), outboundSegments: [] }), null);
  assert.equal(normalizeSerpApiFlightPartyTotal({ ...validInput(), returnSegments: null }), null);
});

test("reconstructs an explicit unknown operating carrier when absent", () => {
  const input = validInput();
  input.outboundSegments = [
    segment({ operatingCarrier: null }),
  ];
  const observation = normalizeSerpApiFlightPartyTotal(input);
  assert.ok(observation);
  assert.deepEqual(observation.unknowns, ["offer_expiry", "tax_inclusion", "operating_carrier"]);
});

test("allowlists serialized output and drops provider extras and hostile nested fields", () => {
  const observation = normalizeSerpApiFlightPartyTotal(validInput());
  assert.ok(observation);
  const serialized = JSON.stringify(observation);
  for (const forbidden of [
    "https://provider.example",
    "search-123",
    "provider_metadata",
    "hostile",
    "nested-token",
    "secret",
    "departure_airport",
    "arrival_airport",
  ]) {
    assert.equal(serialized.includes(forbidden), false, forbidden);
  }
  assert.deepEqual(Object.keys(observation).sort(), [
    "cabin",
    "currency",
    "destination",
    "evidenceLevel",
    "origin",
    "outboundDate",
    "outboundSegments",
    "price",
    "priceCoverage",
    "retrievedAt",
    "returnDate",
    "returnSegments",
    "travelers",
    "unknowns",
    "verificationRequired",
  ]);
});
