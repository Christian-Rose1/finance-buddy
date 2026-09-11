import { buildSerpApiFlightLocationClient } from "./serpApiFlightLocationClient";
import assert from "node:assert/strict";
import { test } from "node:test";
import { buildFlightPlanningEstimate, projectFlightPlanningEstimate } from "./flightPlanningEstimate";
import type { FlightPlanningEstimateDependencies } from "./flightPlanningEstimate";
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

async function captureEstimateDiagnostics<T>(debug: boolean, operation: () => Promise<T>) {
  const priorDebug = process.env.STRATEGY_DEBUG;
  const priorError = console.error;
  const logs: unknown[][] = [];
  if (debug) process.env.STRATEGY_DEBUG = "1";
  else delete process.env.STRATEGY_DEBUG;
  console.error = (...values: unknown[]) => { logs.push(values); };
  try {
    return { value: await operation(), logs };
  } finally {
    console.error = priorError;
    if (priorDebug === undefined) delete process.env.STRATEGY_DEBUG;
    else process.env.STRATEGY_DEBUG = priorDebug;
  }
}

/**
 * Captures diagnostics while also controlling NODE_ENV, because the
 * temporary ambiguous-candidate diagnostic requires BOTH NODE_ENV=development
 * AND STRATEGY_DEBUG=1. NODE_ENV is always restored in `finally`.
 */
async function captureEstimateDiagnosticsWithNodeEnv<T>(
  debug: boolean,
  nodeEnv: "development" | "production" | undefined,
  operation: () => Promise<T>,
) {
  // NODE_ENV is declared read-only by ambient types; the test harness needs
  // to control it, so it is written through a typed record view and restored
  // exactly in `finally`.
  const env = process.env as Record<string, string | undefined>;
  const priorNodeEnv = env.NODE_ENV;
  if (nodeEnv === undefined) delete env.NODE_ENV;
  else env.NODE_ENV = nodeEnv;
  try {
    return await captureEstimateDiagnostics(debug, operation);
  } finally {
    if (priorNodeEnv === undefined) delete env.NODE_ENV;
    else env.NODE_ENV = priorNodeEnv;
  }
}

/** The ambiguous-candidates diagnostic shape must contain only these keys. */
const AMBIGUOUS_CANDIDATE_KEYS = new Set(["locationId", "name", "airportIds"]);

function findAmbiguousDiagnostic(logs: unknown[][]): Record<string, unknown> | null {
  for (const values of logs) {
    for (const value of values) {
      if (typeof value !== "string" || !value.startsWith("[flight-planning-estimate] ")) continue;
      const parsed = JSON.parse(value.slice("[flight-planning-estimate] ".length)) as Record<string, unknown>;
      if (parsed.category === "ambiguous_location_candidates") return parsed;
    }
  }
  return null;
}

const resolvedDependencies: FlightPlanningEstimateDependencies = {
  resolveLocation: async (value: unknown) => ({ projection: resolved(value === "Paris" ? "CDG" : String(value), "airport", [value === "Paris" ? "CDG" : String(value)]), error: null }),
  fetchFlight: async () => ({ observation, error: null } as any),
};

function assertOnlyCategory(logs: unknown[][], category: string) {
  assert.deepEqual(logs, [[`[flight-planning-estimate] {"category":"${category}"}`]]);
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

test("emits one safe success category and nothing when diagnostics are disabled", async () => {
  const enabled = await captureEstimateDiagnostics(true, () => buildFlightPlanningEstimate(goal, resolvedDependencies));
  assert.ok(enabled.value);
  assertOnlyCategory(enabled.logs, "success");

  const disabled = await captureEstimateDiagnostics(false, () => buildFlightPlanningEstimate(goal, resolvedDependencies));
  assert.ok(disabled.value);
  assert.deepEqual(disabled.logs, []);
});

test("emits one allowlisted category for each controlled preflight and resolution failure", async () => {
  const cases: Array<{ category: string; goal?: Goal; resolveLocation?: FlightPlanningEstimateDependencies["resolveLocation"] }> = [
    { category: "invalid_saved_goal_shape", goal: { ...goal, origin: [] } },
    { category: "origin_resolution_unavailable", resolveLocation: async (value) => value === "DEN" ? { projection: null, error: "http_failure" as const } : resolvedDependencies.resolveLocation(value) },
    { category: "origin_resolution_unresolved", resolveLocation: async (value) => value === "DEN" ? { projection: { status: "unresolved" as const, selected: null, candidates: [] as const }, error: null } : resolvedDependencies.resolveLocation(value) },
    { category: "destination_resolution_unavailable", resolveLocation: async (value) => value === "Paris" ? { projection: null, error: "provider_not_configured" as const } : resolvedDependencies.resolveLocation(value) },
    { category: "destination_resolution_unresolved", resolveLocation: async (value) => value === "Paris" ? { projection: { status: "ambiguous" as const, selected: null, candidates: [] }, error: null } : resolvedDependencies.resolveLocation(value) },
    { category: "invalid_resolved_search_location", resolveLocation: async (value) => ({ projection: resolved(value === "Paris" ? "CDG" : "DEN", "airport", ["LHR"]), error: null }) },
  ];
  for (const item of cases) {
    let fetches = 0;
    const result = await captureEstimateDiagnostics(true, () => buildFlightPlanningEstimate(item.goal ?? goal, {
      resolveLocation: item.resolveLocation ?? resolvedDependencies.resolveLocation,
      fetchFlight: async () => { fetches += 1; return { observation, error: null } as any; },
    }));
    assert.equal(result.value, null, item.category);
    assert.equal(fetches, 0, item.category);
    assertOnlyCategory(result.logs, item.category);
  }
});

test("reports every existing fixed flight-client outcome without leaking injected text", async () => {
  const categories = ["invalid_request", "provider_not_configured", "http_failure", "malformed_initial_response", "no_eligible_outbound", "malformed_return_response", "no_compatible_return", "normalization_failed"] as const;
  for (const category of categories) {
    const result = await captureEstimateDiagnostics(true, () => buildFlightPlanningEstimate(goal, {
      ...resolvedDependencies,
      fetchFlight: async () => ({ observation: null, error: category }),
    }));
    assert.equal(result.value, null);
    assertOnlyCategory(result.logs, `flight_client_${category}`);
  }

  const sensitive = "goal-secret user-secret Paris 2027-04-03 $1736 https://evil.test token provider body";
  const thrown = await captureEstimateDiagnostics(true, () => buildFlightPlanningEstimate(goal, {
    ...resolvedDependencies,
    fetchFlight: async () => { throw new Error(sensitive); },
  }));
  assert.equal(thrown.value, null);
  assertOnlyCategory(thrown.logs, "unexpected_estimate_dependency_failure");
  assert.equal(JSON.stringify(thrown.logs).includes(sensitive), false);
});

test("reports estimate projection rejection once", async () => {
  const result = await captureEstimateDiagnostics(true, () => buildFlightPlanningEstimate(goal, {
    ...resolvedDependencies,
    fetchFlight: async () => ({ observation: { ...observation, price: { amount: 1_000_001, currency: "USD" } }, error: null } as any),
  }));
  assert.equal(result.value, null);
  assertOnlyCategory(result.logs, "estimate_projection_rejected");
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


test("real resolver forwards fixed failure diagnostics including rejected exact matches", async () => {
  const city = { type: "city", name: "Paris", id: "/m/example", airports: [{ id: "CDG" }] };
  const cases = [
    { suggestions: [], reason: "empty_suggestions", generic: "unresolved" },
    // A lone non-matching city now resolves via the provider-authoritative
    // single-suggestion rule, so the no-match failure requires >= 2 cities.
    { suggestions: [{ ...city, name: "London" }, { ...city, name: "Lyon", id: "/m/lyon2" }], reason: "no_matching_city", generic: "unresolved" },
    { suggestions: [city, { ...city, id: "/m/other" }], reason: "ambiguous_matches", generic: "unresolved" },
    { suggestions: [{ ...city, id: "invalid" }], reason: "matching_city_rejected", generic: "unavailable" },
    { suggestions: [{ ...city, airports: [] }], reason: "matching_city_rejected", generic: "unavailable" },
  ];
  for (const item of cases) {
    const client = buildSerpApiFlightLocationClient("fixture", async () => ({ ok: true, json: async () => ({ suggestions: item.suggestions }) }) as Response);
    for (const debug of [true, false]) {
      const captured = await captureEstimateDiagnostics(debug, () => buildFlightPlanningEstimate(goal, {
        resolveLocation: client.resolveLocation,
        fetchFlight: async () => { assert.fail("failed resolution must not fetch flights"); },
      }));
      assert.equal(captured.value, null);
      assert.deepEqual(captured.logs, debug ? [
        [`[flight-planning-estimate] {"category":"destination_resolution_${item.reason}"}`],
        [`[flight-planning-estimate] {"category":"destination_resolution_${item.generic}"}`],
      ] : []);
    }
  }
});

test("truncated successful resolution retains flight success and emits only a fixed limit category", async () => {
  const city = { type: "city", name: "Paris", id: "/m/example", airports: [{ id: "CDG" }] };
  const client = buildSerpApiFlightLocationClient("fixture", async () => ({ ok: true, json: async () => ({ suggestions: Array.from({ length: 26 }, () => city) }) }) as Response);
  const captured = await captureEstimateDiagnostics(true, () => buildFlightPlanningEstimate(goal, {
    ...resolvedDependencies, resolveLocation: client.resolveLocation,
  }));
  assert.deepEqual(captured.value, await buildFlightPlanningEstimate(goal, resolvedDependencies));
  assert.deepEqual(captured.logs, [
    ['[flight-planning-estimate] {"category":"destination_resolution_suggestions_truncated"}'],
    ['[flight-planning-estimate] {"category":"success"}'],
  ]);
});

// ---------------------------------------------------------------------------
// TEMPORARY local ambiguous-candidate diagnostics (NODE_ENV + STRATEGY_DEBUG)
// ---------------------------------------------------------------------------

function ambiguousDependencies(hostileCandidate?: Record<string, unknown>): FlightPlanningEstimateDependencies {
  const candidates: Array<Record<string, unknown>> = [
    { locationId: "/m/copenhagen", kind: "city", name: "Copenhagen, Denmark", airportIds: ["CPH", "KRK"] },
    { locationId: "/g/copenhagen-alias", kind: "city", name: "Copenhagen, Denmark", airportIds: ["CPH"] },
  ];
  if (hostileCandidate) candidates.unshift(hostileCandidate);
  return {
    // Mirrors the real client result: ambiguous projections carry the fixed
    // reason diagnostic, copied onto the client result.
    resolveLocation: async (value) => value === "Paris"
      ? {
          projection: { status: "ambiguous", selected: null, candidates, diagnostic: { reason: "ambiguous_matches" } } as never,
          error: null,
          diagnostic: { reason: "ambiguous_matches" } as never,
        }
      : resolvedDependencies.resolveLocation(value),
    fetchFlight: async () => { assert.fail("ambiguous resolution must not fetch flights"); },
  };
}

test("ambiguous candidate details never appear outside development or with debug disabled", async () => {
  for (const [debug, nodeEnv] of [
    [false, "development"],
    [true, "production"],
    [false, "production"],
    [true, undefined],
  ] as const) {
    const captured = await captureEstimateDiagnosticsWithNodeEnv(debug, nodeEnv, () =>
      buildFlightPlanningEstimate(goal, ambiguousDependencies()));
    assert.equal(captured.value, null);
    // The ambiguous-candidate diagnostic never appears; the category-only
    // diagnostic still appears when STRATEGY_DEBUG=1 (even outside development).
    assert.equal(findAmbiguousDiagnostic(captured.logs), null);
    if (debug) {
      assert.ok(captured.logs.some((values) => values[0] === '[flight-planning-estimate] {"category":"destination_resolution_ambiguous_matches"}'));
    } else {
      assert.deepEqual(captured.logs, []);
    }
    assert.equal(JSON.stringify(captured.logs).includes("Copenhagen"), false);
    assert.equal(JSON.stringify(captured.logs).includes("copenhagen"), false);
  }
});

test("ambiguous diagnostics never change resolution results", async () => {
  // A resolved destination emits no candidate diagnostic and the estimate is
  // identical with and without the observation wired in.
  const withDiagnostics = await captureEstimateDiagnosticsWithNodeEnv(true, "development", () =>
    buildFlightPlanningEstimate(goal, resolvedDependencies));
  assert.ok(withDiagnostics.value);
  assert.equal(findAmbiguousDiagnostic(withDiagnostics.logs), null);
  assert.deepEqual(withDiagnostics.value, await buildFlightPlanningEstimate(goal, resolvedDependencies));

  // An ambiguous destination still returns null with the same category-only
  // diagnostic sequence as before this feature existed.
  const ambiguous = await captureEstimateDiagnosticsWithNodeEnv(true, "development", () =>
    buildFlightPlanningEstimate(goal, ambiguousDependencies()));
  assert.equal(ambiguous.value, null);
  const categoryOnly = ambiguous.logs.filter((values) => !findAmbiguousDiagnostic([values]));
  assert.deepEqual(categoryOnly, [
    ['[flight-planning-estimate] {"category":"destination_resolution_ambiguous_matches"}'],
    ['[flight-planning-estimate] {"category":"destination_resolution_unresolved"}'],
  ]);
});
