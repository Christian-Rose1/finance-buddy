import assert from "node:assert/strict";
import { test } from "node:test";
import { buildFlightPlanningEstimate, projectFlightPlanningEstimate } from "./flightPlanningEstimate";
import { buildStrategyRunStagePayload, validateStrategyRunStagePayload } from "./strategyRunPayload";
import { toClientSafeStrategy } from "./travelEvidence";
import { buildCustomerSafeStrategyPresentation } from "./customerSafeStrategyPresentation";
import type { PersonalizedStrategy } from "./strategyTypes";
import type { Goal } from "./types";

const goal: Goal = {
  id: "goal-1", userId: "user-1", type: "travel", title: "Paris", status: "active",
  origin: ["DEN"], destinations: ["Paris"], earliestDeparture: "2027-04-03", latestReturn: "2027-04-12",
  minimumNights: 8, maximumNights: 8, travelerCount: 2, cabinPreference: "economy", optimizationPriority: "balanced",
  maximumCashBudget: 3000, currency: "USD", allowNewCards: false,
  createdAt: "2027-01-01T00:00:00.000Z", updatedAt: "2027-01-01T00:00:00.000Z",
};

const resolved = (locationId: string, kind: "airport" | "city", airportIds: string[]) => ({
  status: "resolved", selected: { locationId, kind, name: locationId, airportIds },
  candidates: [{ locationId, kind, name: locationId, airportIds }],
} as const);

const observation = {
  origin: "DEN", destination: "CDG", outboundDate: "2027-04-03", returnDate: "2027-04-12", travelers: 2,
  cabin: "economy", currency: "USD", price: { amount: 1736, currency: "USD" }, priceCoverage: "searched_party_total",
  evidenceLevel: "web_observed_not_live", verificationRequired: true, retrievedAt: "2027-01-02T03:04:05.000Z",
  outboundSegments: [{ sequence: 1, departureAirport: "DEN", departureTime: "2027-04-03 08:00", arrivalAirport: "CDG", arrivalTime: "2027-04-03 20:00", marketingCarrier: "Example Air", marketingFlightNumber: "EA123", cabin: "economy", operatingCarrier: null }],
  returnSegments: [{ sequence: 1, departureAirport: "CDG", departureTime: "2027-04-12 09:00", arrivalAirport: "DEN", arrivalTime: "2027-04-12 11:30", marketingCarrier: "Example Air", marketingFlightNumber: "EA124", cabin: "economy", operatingCarrier: null }],
  unknowns: ["offer_expiry", "tax_inclusion", "operating_carrier"],
} as const;

function estimateInput() {
  return {
    label: "Flight planning estimate", origin: "DEN", destination: "CDG", outboundDate: "2027-04-03", returnDate: "2027-04-12",
    travelers: 2, cabin: "economy", currency: "USD", total: 1736, priceCoverage: "searched_party_total",
    retrievedAt: "2027-01-02T03:04:05.000Z", outboundSegments: [{ sequence: 1, departureAirport: "DEN", departureTime: "2027-04-03 08:00", arrivalAirport: "CDG", arrivalTime: "2027-04-03 20:00", marketingCarrier: "Example Air", marketingFlightNumber: "EA123", cabin: "economy" }], returnSegments: [{ sequence: 1, departureAirport: "CDG", departureTime: "2027-04-12 09:00", arrivalAirport: "DEN", arrivalTime: "2027-04-12 11:30", marketingCarrier: "Example Air", marketingFlightNumber: "EA124", cabin: "economy" }],
    unknowns: ["offer_expiry"], evidenceLabel: "Planning estimate", verificationLabel: "Not customer-verified",
    availabilityLabel: "Not live or bookable; verify before booking",
  };
}

function interpreted(flightPlanningEstimate?: any) {
  return { awardOptions: [], cardOffers: [], sources: [], assumptions: [], warnings: [], ...(flightPlanningEstimate === undefined ? {} : { flightPlanningEstimate }) };
}

function persistedProjection(value: unknown) {
  return toClientSafeStrategy({
    flightOptions: [], hotelOptions: [], actions: [], alternatives: [],
    flightPlanningEstimate: value,
  } as unknown as PersonalizedStrategy).flightPlanningEstimate;
}

function presentedProjection(value: unknown) {
  return buildCustomerSafeStrategyPresentation(goal, {
    flightOptions: [], hotelOptions: [], pointsInventory: [], allocationScenarios: [], actions: [], alternatives: [],
    assumptions: [], warnings: [], followUpQuestions: [], flightPlanningEstimate: value,
  } as unknown as PersonalizedStrategy).flightPlanningEstimate;
}

function assertSafelyOmittedEverywhere(value: unknown) {
  assert.equal(projectFlightPlanningEstimate(value), null);
  assert.throws(() => validateStrategyRunStagePayload({ schemaVersion: 1, stage: "flight", interpreted: interpreted(value) }, "flight"));
  assert.doesNotThrow(() => persistedProjection(value));
  assert.equal(persistedProjection(value), null);
  assert.doesNotThrow(() => presentedProjection(value));
  assert.equal(presentedProjection(value), null);
}

test("builds an airport-only planning estimate with searched-party total", async () => {
  let fetches = 0;
  const estimate = await buildFlightPlanningEstimate(goal, {
    resolveLocation: async (value) => ({ projection: resolved(value === "Paris" ? "CDG" : String(value), "airport", [value === "Paris" ? "CDG" : String(value)]), error: null }),
    fetchFlight: async (request) => { fetches += 1; assert.equal(request.travelers, 2); assert.equal(typeof request.origin, "object"); return { observation, error: null } as any; },
  });
  assert.equal(fetches, 1);
  assert.equal(estimate?.total, 1736);
  assert.equal(estimate?.origin, "DEN");
});

test("uses resolved city locations and preserves actual selected airports", async () => {
  let request: unknown;
  const estimate = await buildFlightPlanningEstimate(goal, {
    resolveLocation: async (value) => value === "DEN" ? { projection: resolved("DEN", "airport", ["DEN"]), error: null } : { projection: resolved("/m/paris", "city", ["CDG", "ORY"]), error: null },
    fetchFlight: async (value) => { request = value; return { observation, error: null } as any; },
  });
  assert.equal((request as { origin: { searchId: string } }).origin.searchId, "DEN");
  assert.equal((request as { destination: { searchId: string } }).destination.searchId, "/m/paris");
  assert.equal(estimate?.destination, "CDG");
});

test("omits ambiguous or unusable locations and does not fetch flights", async () => {
  let fetches = 0;
  const estimate = await buildFlightPlanningEstimate(goal, {
    resolveLocation: async () => ({ projection: { status: "ambiguous", selected: null, candidates: [] }, error: null }),
    fetchFlight: async () => { fetches += 1; return { observation, error: null } as any; },
  });
  assert.equal(estimate, null);
  assert.equal(fetches, 0);
});

test("isolates resolver and flight-client failures as omitted estimates", async () => {
  const resolverFailure = await buildFlightPlanningEstimate(goal, {
    resolveLocation: async () => { throw new Error("resolver failure"); },
    fetchFlight: async () => ({ observation, error: null } as any),
  });
  const clientFailure = await buildFlightPlanningEstimate(goal, {
    resolveLocation: async (value) => ({ projection: resolved(value === "Paris" ? "CDG" : String(value), "airport", [value === "Paris" ? "CDG" : String(value)]), error: null }),
    fetchFlight: async () => { throw new Error("client failure"); },
  });
  assert.equal(resolverFailure, null);
  assert.equal(clientFailure, null);
});

test("strictly validates and reconstructs the signed estimate payload", () => {
  const input = estimateInput() as any;
  const envelope = buildStrategyRunStagePayload("flight", interpreted(input));
  input.outboundSegments[0].departureAirport = "LHR";
  assert.equal(envelope.interpreted.flightPlanningEstimate?.origin, "DEN");
  assert.notEqual(envelope.interpreted.flightPlanningEstimate, input);
  for (const bad of [
    { ...estimateInput(), providerToken: "opaque" },
    { ...estimateInput(), outboundSegments: [{ ...estimateInput().outboundSegments[0], metadata: {} }] },
    { ...estimateInput(), origin: "bad" },
    { ...estimateInput(), currency: "usd" },
    { ...estimateInput(), total: Number.POSITIVE_INFINITY },
    { ...estimateInput(), unknowns: Array(21).fill("unknown") },
  ]) {
    assert.throws(() => validateStrategyRunStagePayload({ schemaVersion: 1, stage: "flight", interpreted: interpreted(bad) }, "flight"));
  }
});

test("planning estimate remains separate from award and allocation data", () => {
  const value = validateStrategyRunStagePayload({ schemaVersion: 1, stage: "flight", interpreted: interpreted(estimateInput()) }, "flight");
  assert.deepEqual(value.interpreted.awardOptions, []);
  assert.equal(Object.prototype.hasOwnProperty.call(value.interpreted.flightPlanningEstimate, "providerToken"), false);
  assert.equal((value.interpreted.flightPlanningEstimate as { total: number }).total, 1736);
});

test("round-trips a valid estimate through signed and persisted boundaries with mutation isolation", () => {
  const input = estimateInput();
  input.unknowns = ["tax_breakdown", "offer_expiry"];
  const staged = validateStrategyRunStagePayload({ schemaVersion: 1, stage: "flight", interpreted: interpreted(input) }, "flight").interpreted.flightPlanningEstimate!;
  const persisted = persistedProjection(input)!;
  input.unknowns[0] = "hostile";
  input.outboundSegments[0].arrivalAirport = "LHR";
  assert.deepEqual(staged.unknowns, ["offer_expiry", "tax_breakdown"]);
  assert.deepEqual(persisted.unknowns, ["offer_expiry", "tax_breakdown"]);
  assert.equal(staged.outboundSegments[0].arrivalAirport, "CDG");
  assert.equal(persisted.outboundSegments[0].arrivalAirport, "CDG");
  assert.notEqual(staged.outboundSegments, input.outboundSegments);
  assert.notEqual(persisted.outboundSegments, input.outboundSegments);
});

test("rejects every non-allowlisted or duplicate unknown label", () => {
  for (const unknowns of [["unknown"], ["offer_expiry", "offer_expiry"], ["https://evil.test"], ["token_abc123"], ["Taxes might change later."]]) {
    const input = { ...estimateInput(), unknowns };
    assert.equal(projectFlightPlanningEstimate(input), null);
    assert.throws(() => validateStrategyRunStagePayload({ schemaVersion: 1, stage: "flight", interpreted: interpreted(input) }, "flight"));
  }
});

test("rejects disconnected, mis-sequenced, nonchronological, overlapping, and reversed itineraries", () => {
  const twoSegments = [
    { ...estimateInput().outboundSegments[0], arrivalAirport: "JFK", arrivalTime: "2027-04-03 12:00" },
    { ...estimateInput().outboundSegments[0], sequence: 2, departureAirport: "JFK", departureTime: "2027-04-03 13:00" },
  ];
  const invalid = [
    { ...estimateInput(), outboundSegments: [twoSegments[0], { ...twoSegments[1], departureAirport: "EWR" }] },
    { ...estimateInput(), outboundSegments: [twoSegments[0], { ...twoSegments[1], sequence: 3 }] },
    { ...estimateInput(), outboundSegments: [twoSegments[0], { ...twoSegments[1], sequence: 1 }] },
    { ...estimateInput(), outboundSegments: [{ ...estimateInput().outboundSegments[0], arrivalTime: "2027-04-03 07:59" }] },
    { ...estimateInput(), outboundSegments: [twoSegments[0], { ...twoSegments[1], departureTime: "2027-04-03 11:59" }] },
    { ...estimateInput(), outboundDate: "2027-04-13" },
  ];
  for (const value of invalid) assert.equal(projectFlightPlanningEstimate(value), null);
});

test("accepts overnight final arrivals while binding the first departure to the trip date", () => {
  const value = estimateInput();
  value.outboundSegments[0].arrivalTime = "2027-04-04 06:30";
  assert.equal(projectFlightPlanningEstimate(value)?.outboundSegments[0].arrivalTime, "2027-04-04 06:30");
  value.outboundSegments[0].departureTime = "2027-04-04 00:01";
  assert.equal(projectFlightPlanningEstimate(value), null);
});

test("omits malformed persisted estimates including hostile extra fields and segments", () => {
  const hostile = { ...estimateInput(), providerToken: "secret", outboundSegments: [...estimateInput().outboundSegments, { raw: "provider payload" }] };
  assert.equal(persistedProjection(hostile), null);
  const presented = buildCustomerSafeStrategyPresentation(goal, {
    flightOptions: [], hotelOptions: [], pointsInventory: [], allocationScenarios: [], actions: [], alternatives: [],
    assumptions: [], warnings: [], followUpQuestions: [], flightPlanningEstimate: hostile,
  } as unknown as PersonalizedStrategy);
  assert.equal(presented.flightPlanningEstimate, null);
  assert.equal(persistedProjection({ legacyPrice: 1736 }), null);
  assert.equal(persistedProjection(undefined), null);
});

test("enforces the established maximum total at signed and persisted boundaries", () => {
  const maximum = { ...estimateInput(), total: 1_000_000 };
  assert.equal(validateStrategyRunStagePayload({ schemaVersion: 1, stage: "flight", interpreted: interpreted(maximum) }, "flight").interpreted.flightPlanningEstimate?.total, 1_000_000);
  assert.equal(persistedProjection(maximum)?.total, 1_000_000);
  const excessive = { ...estimateInput(), total: 1_000_001 };
  assert.throws(() => validateStrategyRunStagePayload({ schemaVersion: 1, stage: "flight", interpreted: interpreted(excessive) }, "flight"));
  assert.equal(persistedProjection(excessive), null);
});

test("requires explicit segment cabins to match the requested cabin case-insensitively", () => {
  const matching = estimateInput();
  matching.outboundSegments[0].cabin = "ECONOMY";
  assert.equal(projectFlightPlanningEstimate(matching)?.outboundSegments[0].cabin, "ECONOMY");
  const unknown = estimateInput();
  unknown.outboundSegments[0].cabin = null as unknown as string;
  assert.equal(projectFlightPlanningEstimate(unknown)?.outboundSegments[0].cabin, null);
  const conflicting = estimateInput();
  conflicting.outboundSegments[0].cabin = "business";
  assert.equal(projectFlightPlanningEstimate(conflicting), null);
});

test("rejects cross-leg overlap and accepts a chronological same-date round trip", () => {
  const overlap = estimateInput();
  overlap.returnDate = overlap.outboundDate;
  overlap.returnSegments[0].departureTime = "2027-04-03 19:59";
  overlap.returnSegments[0].arrivalTime = "2027-04-03 23:00";
  assert.equal(projectFlightPlanningEstimate(overlap), null);
  const valid = estimateInput();
  valid.returnDate = valid.outboundDate;
  valid.returnSegments[0].departureTime = "2027-04-03 20:00";
  valid.returnSegments[0].arrivalTime = "2027-04-03 23:00";
  assert.ok(projectFlightPlanningEstimate(valid));
});

test("hostile accessors and revoked proxies are safely omitted by every boundary", () => {
  const topLevel = estimateInput();
  Object.defineProperty(topLevel, "total", { enumerable: true, get() { throw new Error("hostile getter"); } });
  const nested = estimateInput();
  Object.defineProperty(nested.outboundSegments[0], "arrivalTime", { enumerable: true, get() { throw new Error("hostile nested getter"); } });
  const target = estimateInput();
  const revoked = Proxy.revocable(target, {});
  revoked.revoke();
  for (const value of [topLevel, nested, revoked.proxy]) assertSafelyOmittedEverywhere(value);
});
