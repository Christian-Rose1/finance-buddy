import assert from "node:assert/strict";
import { test } from "node:test";
import { projectSerpApiFlightLocation } from "./serpApiFlightLocationProjection";
import { buildSerpApiFlightSearchLocation } from "./serpApiFlightSearchLocation";

function candidate(overrides: Record<string, unknown> = {}) {
  return {
    locationId: "/g/example",
    kind: "city",
    name: "Paris",
    airportIds: ["ORY", "CDG", "ORY", "BVA"],
    ...overrides,
  };
}

function resolvedEnvelope(selected = candidate(), candidates = [candidate()]) {
  return { status: "resolved", selected, candidates };
}

function parisProjection() {
  return projectSerpApiFlightLocation("Paris", {
    suggestions: [
      {
        name: "Paris, France",
        type: "city",
        id: "/m/05qtj",
        airports: [{ id: "CDG" }, { id: "ORY" }],
      },
    ],
  });
}

test("builds DEN as an airport search location", () => {
  const result = buildSerpApiFlightSearchLocation(
    projectSerpApiFlightLocation("DEN"),
  );
  assert.deepEqual(result, {
    searchId: "DEN",
    kind: "airport",
    acceptableAirportIds: ["DEN"],
  });
});

test("keeps Paris as a city with every acceptable airport", () => {
  const result = buildSerpApiFlightSearchLocation(parisProjection());
  assert.deepEqual(result, {
    searchId: "/m/05qtj",
    kind: "city",
    acceptableAirportIds: ["CDG", "ORY"],
  });
  assert.notDeepEqual(result?.acceptableAirportIds, ["CDG"]);
});

test("preserves airport order while deduplicating city airports", () => {
  const selected = candidate();
  const result = buildSerpApiFlightSearchLocation(
    resolvedEnvelope(selected, [candidate()]),
  );
  assert.deepEqual(result?.acceptableAirportIds, ["ORY", "CDG", "BVA"]);
});

test("rejects ambiguous, unresolved, malformed, and incomplete resolved envelopes", () => {
  for (const projection of [
    { status: "ambiguous", selected: null, candidates: [] },
    { status: "unresolved", selected: null, candidates: [] },
    null,
    { status: "resolved", selected: null, candidates: [] },
    { status: "resolved", selected: "hostile", candidates: [] },
    { status: "resolved", selected: candidate() },
    { status: "resolved", selected: candidate(), candidates: {} },
    { status: "resolved", selected: candidate(), candidates: [] },
    resolvedEnvelope(candidate(), [candidate(), candidate()]),
  ]) {
    assert.equal(buildSerpApiFlightSearchLocation(projection), null);
  }
});

test("rejects selected and sole-candidate disagreements", () => {
  const cases = [
    [candidate(), candidate({ locationId: "/g/other" })],
    [candidate(), candidate({ kind: "airport", locationId: "ORY" })],
    [candidate(), candidate({ name: "Different Paris" })],
    [candidate(), candidate({ airportIds: ["ORY", "BVA"] })],
  ];
  for (const [selected, soleCandidate] of cases) {
    assert.equal(
      buildSerpApiFlightSearchLocation(resolvedEnvelope(selected, [soleCandidate])),
      null,
    );
  }
});

test("rejects invalid city IDs and airport IDs", () => {
  assert.equal(buildSerpApiFlightSearchLocation(resolvedEnvelope(
    candidate({ locationId: "Paris", airportIds: ["CDG"] }),
  )), null);
  assert.equal(buildSerpApiFlightSearchLocation(resolvedEnvelope(
    candidate({ locationId: "DEN1", kind: "airport", airportIds: ["DEN1"] }),
  )), null);
  assert.equal(buildSerpApiFlightSearchLocation(resolvedEnvelope(
    candidate({ locationId: "/m/x", airportIds: ["not-an-airport"] }),
  )), null);
  assert.equal(buildSerpApiFlightSearchLocation(resolvedEnvelope(
    candidate({ locationId: "/m/x", airportIds: [] }),
  )), null);
});

test("rejects airport candidates with conflicting or extra airports", () => {
  assert.equal(buildSerpApiFlightSearchLocation(resolvedEnvelope(
    { locationId: "DEN", kind: "airport", name: "DEN", airportIds: ["DEN", "BOS"] },
    [{ locationId: "DEN", kind: "airport", name: "DEN", airportIds: ["DEN", "BOS"] }],
  )), null);
  assert.equal(buildSerpApiFlightSearchLocation(resolvedEnvelope(
    { locationId: "DEN", kind: "airport", name: "DEN", airportIds: ["BOS"] },
    [{ locationId: "DEN", kind: "airport", name: "DEN", airportIds: ["BOS"] }],
  )), null);
});

test("drops hostile fields, freezes output, and does not mutate input", () => {
  const input = resolvedEnvelope(
    {
      ...candidate(),
      ...( { token: "SECRET", nested: { url: "https://hostile.example" } } as Record<string, unknown> ),
    },
    [{
      ...candidate(),
      ...( { token: "SECRET", nested: { url: "https://hostile.example" } } as Record<string, unknown> ),
    }],
  );
  const before = JSON.stringify(input);
  const result = buildSerpApiFlightSearchLocation(input);

  assert.equal(JSON.stringify(input), before);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result?.acceptableAirportIds), true);
  assert.deepEqual(Object.keys(result ?? {}), ["searchId", "kind", "acceptableAirportIds"]);
  const serialized = JSON.stringify(result);
  assert.ok(!serialized.includes("SECRET"));
  assert.ok(!serialized.includes("token"));
  assert.ok(!serialized.includes("nested"));
});
