import assert from "node:assert/strict";
import { test } from "node:test";
import { projectSerpApiFlightLocation } from "./serpApiFlightLocationProjection";

function citySuggestion(overrides: Record<string, unknown> = {}) {
  return {
    position: 1,
    name: "Paris, France",
    type: "city",
    description: "Capital of France",
    id: "/m/05qtj",
    airports: [
      { name: "Charles de Gaulle Airport", id: "CDG", city: "Paris" },
      { name: "Paris Orly Airport", id: "ORY", city: "Paris" },
    ],
    ...overrides,
  };
}

test("resolves a saved IATA code without provider data", () => {
  const result = projectSerpApiFlightLocation(" den ");

  assert.equal(result.status, "resolved");
  assert.deepEqual(result.selected, {
    locationId: "DEN",
    kind: "airport",
    name: "DEN",
    airportIds: ["DEN"],
  });
});

test("projects one exact city-name match with its location ID and airport set", () => {
  const result = projectSerpApiFlightLocation("Paris", {
    suggestions: [citySuggestion()],
  });

  assert.equal(result.status, "resolved");
  assert.deepEqual(result.selected, {
    locationId: "/m/05qtj",
    kind: "city",
    name: "Paris, France",
    airportIds: ["CDG", "ORY"],
  });
});

test("preserves provider order while deduplicating location and airport IDs", () => {
  const result = projectSerpApiFlightLocation("Paris", {
    suggestions: [
      citySuggestion({
        airports: [{ id: "CDG" }, { id: "cdg" }, { id: "ORY" }],
      }),
      citySuggestion({ name: "Paris", airports: [{ id: "BVA" }] }),
    ],
  });

  assert.equal(result.status, "resolved");
  assert.deepEqual(result.selected?.airportIds, ["CDG", "ORY"]);
  assert.equal(result.candidates.length, 1);
});

test("returns ambiguity without selecting among multiple matching cities", () => {
  const result = projectSerpApiFlightLocation("Paris", {
    suggestions: [
      citySuggestion(),
      citySuggestion({
        position: 2,
        name: "Paris, Texas, United States",
        id: "/m/0td75",
        airports: [{ id: "PRX" }],
      }),
    ],
  });

  assert.equal(result.status, "ambiguous");
  assert.equal(result.selected, null);
  assert.deepEqual(result.candidates.map((candidate) => candidate.locationId), [
    "/m/05qtj",
    "/m/0td75",
  ]);
});

test("ignores regions, nonmatching cities, and malformed siblings", () => {
  const result = projectSerpApiFlightLocation("Paris", {
    suggestions: [
      { name: "France", type: "region", id: "/m/0f8l9c" },
      citySuggestion({ name: "London, United Kingdom", id: "/m/04jpl" }),
      citySuggestion({ id: "not-a-location-id" }),
      citySuggestion({ airports: [] }),
      citySuggestion(),
    ],
  });

  assert.equal(result.status, "resolved");
  assert.equal(result.selected?.locationId, "/m/05qtj");
});

test("distinguishes malformed autocomplete envelopes from valid unresolved results", () => {
  const malformedEnvelope = projectSerpApiFlightLocation("Paris", null);
  assert.deepEqual(malformedEnvelope, {
    status: "malformed_response",
    selected: null,
    candidates: [],
  });
  assert.deepEqual(projectSerpApiFlightLocation("Paris", { suggestions: {} }), {
    status: "malformed_response",
    selected: null,
    candidates: [],
  });
  const unresolved = projectSerpApiFlightLocation("Paris", { suggestions: [] });
  assert.deepEqual(unresolved, {
    status: "unresolved",
    selected: null,
    candidates: [],
  });
  assert.equal(Object.isFrozen(malformedEnvelope), true);
  assert.equal(Object.isFrozen(malformedEnvelope.candidates), true);
  assert.equal(Object.isFrozen(unresolved), true);
  assert.equal(Object.isFrozen(unresolved.candidates), true);
  assert.deepEqual(
    projectSerpApiFlightLocation("Paris", {
      suggestions: [{ type: "city", name: "Paris", id: "invalid", airports: [] }],
    }),
    { status: "malformed_response", selected: null, candidates: [] },
  );
  assert.deepEqual(
    projectSerpApiFlightLocation("Paris", {
      suggestions: [citySuggestion({ name: "London, United Kingdom", id: "/m/04jpl" })],
    }),
    { status: "unresolved", selected: null, candidates: [] },
  );
});

test("rejects unsafe saved values and hostile provider text", () => {
  assert.equal(projectSerpApiFlightLocation("https://hostile.example").status, "unresolved");
  assert.equal(projectSerpApiFlightLocation("api_key=secret").status, "unresolved");

  const result = projectSerpApiFlightLocation("Paris", {
    suggestions: [
      citySuggestion({ name: "Paris\u0000France" }),
      citySuggestion({ name: "https://hostile.example" }),
      citySuggestion({ name: "departure_token=secret" }),
    ],
  });
  assert.equal(result.status, "malformed_response");
});

test("reconstructs an allowlisted frozen result without provider metadata", () => {
  const secret = "SECRET_AUTOCOMPLETE_VALUE";
  const result = projectSerpApiFlightLocation("Paris", {
    search_metadata: { id: secret, json_endpoint: "https://hostile.example" },
    error: secret,
    suggestions: [
      citySuggestion({
        description: secret,
        thumbnail: "https://hostile.example/image.png",
        airports: [
          {
            id: "CDG",
            name: secret,
            distance: "1 mi",
            city_id: "/m/05qtj",
            token: secret,
          },
        ],
      }),
    ],
  });

  assert.equal(result.status, "resolved");
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.candidates), true);
  assert.equal(Object.isFrozen(result.selected), true);
  assert.equal(Object.isFrozen(result.selected?.airportIds), true);

  const serialized = JSON.stringify(result);
  assert.ok(!serialized.includes(secret));
  assert.ok(!serialized.includes("https://"));
  assert.ok(!serialized.includes("search_metadata"));
  assert.ok(!serialized.includes("description"));
  assert.ok(!serialized.includes("distance"));
  assert.ok(!serialized.includes("city_id"));
});
