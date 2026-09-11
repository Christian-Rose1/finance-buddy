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
    diagnostic: { reason: "empty_suggestions" },
  });
  assert.equal(Object.isFrozen(malformedEnvelope), true);
  assert.equal(Object.isFrozen(malformedEnvelope.candidates), true);
  assert.equal(Object.isFrozen(unresolved), true);
  assert.equal(Object.isFrozen(unresolved.candidates), true);
  assert.deepEqual(
    projectSerpApiFlightLocation("Paris", {
      suggestions: [{ type: "city", name: "Paris", id: "invalid", airports: [] }],
    }),
    { status: "malformed_response", selected: null, candidates: [], diagnostic: { reason: "matching_city_rejected" } },
  );
  assert.deepEqual(
    projectSerpApiFlightLocation("Paris", {
      suggestions: [
        citySuggestion({ name: "London, United Kingdom", id: "/m/04jpl" }),
        citySuggestion({ name: "Lyon, France", id: "/m/lyon1", airports: [{ id: "LYS" }] }),
      ],
    }),
    { status: "unresolved", selected: null, candidates: [], diagnostic: { reason: "no_matching_city" } },
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


test("fixed reasons distinguish matching failures without altering selection", () => {
  const cases = [
    { suggestions: [], reason: "empty_suggestions", status: "unresolved" },
    // Two non-matching cities: the single-suggestion rule cannot apply, so
    // the no-match failure remains fail-closed.
    { suggestions: [citySuggestion({ name: "London" }), citySuggestion({ name: "Lyon, France", id: "/m/lyon1", airports: [{ id: "LYS" }] })], reason: "no_matching_city", status: "unresolved" },
    { suggestions: [citySuggestion(), citySuggestion({ id: "/m/other" })], reason: "ambiguous_matches", status: "ambiguous" },
    { suggestions: [citySuggestion({ id: "invalid" })], reason: "matching_city_rejected", status: "malformed_response" },
    { suggestions: [citySuggestion({ airports: [] })], reason: "matching_city_rejected", status: "malformed_response" },
    { suggestions: [citySuggestion({ airports: [] }), citySuggestion({ name: "London" })], reason: "matching_city_rejected", status: "unresolved" },
  ];
  for (const item of cases) {
    const snapshot = structuredClone(item.suggestions);
    const result = projectSerpApiFlightLocation("Paris", { suggestions: item.suggestions });
    assert.equal(result.diagnostic?.reason, item.reason);
    assert.equal(result.status, item.status);
    assert.equal(result.selected, null);
    assert.deepEqual(item.suggestions, snapshot);
  }
});

test("truncation reports only the inspection limit and preserves bounded selection", () => {
  const prefix = Array.from({ length: 25 }, () => citySuggestion({ name: "London" }));
  const limited = projectSerpApiFlightLocation("Paris", { suggestions: [...prefix, citySuggestion()] });
  assert.equal(limited.status, "unresolved");
  assert.deepEqual(limited.diagnostic, { reason: "no_matching_city", suggestionLimit: "suggestions_truncated" });
  const ordinary = projectSerpApiFlightLocation("Paris", { suggestions: [citySuggestion()] });
  const success = projectSerpApiFlightLocation("Paris", { suggestions: [citySuggestion(), ...prefix] });
  assert.equal(success.status, "resolved");
  assert.deepEqual(success.selected, ordinary.selected);
  assert.deepEqual(success.candidates, ordinary.candidates);
  assert.deepEqual(success.diagnostic, { suggestionLimit: "suggestions_truncated" });
  assert.equal(projectSerpApiFlightLocation("Paris", { suggestions: prefix }).diagnostic?.suggestionLimit, undefined);
});

test("lenient tier: qualified saved location resolves against a compatible canonical qualifier", () => {
  // "Denver, CO" vs Google's canonical "Denver, Colorado": no exact match,
  // resolved uniquely through the lenient qualifier tier.
  const result = projectSerpApiFlightLocation("Denver, CO", {
    suggestions: [
      {
        position: 1,
        name: "Denver, Colorado",
        type: "city",
        description: "City in Colorado",
        id: "/m/01_d4",
        airports: [
          { name: "Denver International Airport", id: "DEN", city: "Denver" },
        ],
      },
    ],
  });

  assert.equal(result.status, "resolved");
  assert.deepEqual(result.selected, {
    locationId: "/m/01_d4",
    kind: "city",
    name: "Denver, Colorado",
    airportIds: ["DEN"],
  });
});

test("lenient tier: multiple qualifier-compatible matches stay ambiguous without selecting", () => {
  // "Denver, CO" is genuinely ambiguous between Colorado and Connecticut:
  // both lenient-compatible, no exact match, so selection is prohibited.
  const result = projectSerpApiFlightLocation("Denver, CO", {
    suggestions: [
      {
        position: 1,
        name: "Denver, Colorado",
        type: "city",
        description: "City in Colorado",
        id: "/m/01_d4",
        airports: [{ id: "DEN" }],
      },
      {
        position: 2,
        name: "Denver, Connecticut",
        type: "city",
        description: "City in Connecticut",
        id: "/m/fake01",
        airports: [{ id: "XXX" }],
      },
    ],
  });

  assert.equal(result.status, "ambiguous");
  assert.equal(result.selected, null);
  assert.deepEqual(result.diagnostic, { reason: "ambiguous_matches" });
});

test("lenient tier: exact matches always take precedence over lenient candidates", () => {
  // "Paris, France" matches the first suggestion exactly; the lenient-only
  // sibling must not widen or reorder the candidate set.
  const result = projectSerpApiFlightLocation("Paris, France", {
    suggestions: [
      citySuggestion(),
      citySuggestion({ position: 2, name: "Paris, Texas, United States", id: "/m/0td75", airports: [{ id: "PRX" }] }),
    ],
  });

  assert.equal(result.status, "resolved");
  assert.equal(result.selected?.locationId, "/m/05qtj");
  assert.equal(result.candidates.length, 1);
});

test("lenient and single-suggestion tiers keep their fail-closed boundaries", () => {
  // Different primary name, two cities → no tier matches, no single rule.
  const wrongPrimary = projectSerpApiFlightLocation("Denver, CO", {
    suggestions: [
      { type: "city", name: "London, England", id: "/m/04jpl", airports: [{ id: "LHR" }] },
      { type: "city", name: "Lyon, France", id: "/m/lyon1", airports: [{ id: "LYS" }] },
    ],
  });
  assert.equal(wrongPrimary.status, "unresolved");
  assert.deepEqual(wrongPrimary.diagnostic, { reason: "no_matching_city" });

  // Disjoint qualifiers with no prefix relationship never lenient-match:
  // both cities fail closed as a plain no-match.
  const disjoint = projectSerpApiFlightLocation("Denver, Ohio", {
    suggestions: [
      { type: "city", name: "Denver, Colorado", id: "/m/01_d4", airports: [{ id: "DEN" }] },
      { type: "city", name: "Raleigh, North Carolina", id: "/m/01f_2", airports: [{ id: "RDU" }] },
    ],
  });
  assert.equal(disjoint.status, "unresolved");
  assert.deepEqual(disjoint.diagnostic, { reason: "no_matching_city" });

  // Single-character qualifier is below the two-character floor: not even
  // the lenient near-miss flag fires, so it stays a plain no-match.
  const tooShort = projectSerpApiFlightLocation("Paris, F", {
    suggestions: [citySuggestion(), citySuggestion({ name: "London, United Kingdom", id: "/m/04jpl" })],
  });
  assert.equal(tooShort.status, "unresolved");
  assert.deepEqual(tooShort.diagnostic, { reason: "no_matching_city" });

  // Unqualified saved location never enters the lenient tier and matches
  // exactly through the primary-name rule regardless of suggestion count.
  const bareSaved = projectSerpApiFlightLocation("Denver", {
    suggestions: [
      { type: "city", name: "Denver, Colorado", id: "/m/01_d4", airports: [{ id: "DEN" }] },
      { type: "city", name: "Raleigh, North Carolina", id: "/m/01f_2", airports: [{ id: "RDU" }] },
    ],
  });
  assert.equal(bareSaved.status, "resolved");
  assert.equal(bareSaved.selected?.locationId, "/m/01_d4");
});

test("lenient tier: rejected lenient match still reports matching_city_rejected", () => {
  // A lenient-matching city whose structure fails validation must keep the
  // established rejected-match diagnostic instead of degrading silently.
  const result = projectSerpApiFlightLocation("Denver, CO", {
    suggestions: [{ type: "city", name: "Denver, Colorado", id: "invalid", airports: [] }],
  });

  assert.equal(result.status, "malformed_response");
  assert.deepEqual(result.diagnostic, { reason: "matching_city_rejected" });
});

test("single-suggestion rule: multiple city suggestions stay fail-closed", () => {
  const result = projectSerpApiFlightLocation("Raleigh, NC", {
    suggestions: [
      { type: "city", name: "Raleigh, North Carolina", id: "/m/01f_2", airports: [{ id: "RDU" }] },
      { type: "city", name: "Raleigh, Mississippi", id: "/m/fake02", airports: [{ id: "RYY" }] },
    ],
  });

  assert.equal(result.status, "unresolved");
  assert.equal(result.selected, null);
  assert.deepEqual(result.diagnostic, { reason: "no_matching_city" });
});

test("single-suggestion rule: never overrides exact-rejection or non-city suggestion sets", () => {
  // An exact-matching city that failed structural validation keeps its
  // rejected-match diagnostic; the unrelated valid sibling must not be
  // substituted for it.
  const rejected = projectSerpApiFlightLocation("Paris", {
    suggestions: [
      { type: "city", name: "Paris", id: "invalid", airports: [] },
      { type: "city", name: "Lyon, France", id: "/m/lyon1", airports: [{ id: "LYS" }] },
    ],
  });
  assert.equal(rejected.status, "unresolved");
  assert.deepEqual(rejected.diagnostic, { reason: "matching_city_rejected" });

  // No city-type suggestion (region only) → nothing to resolve.
  const regionsOnly = projectSerpApiFlightLocation("France", {
    suggestions: [{ type: "region", name: "France", id: "/m/0f8l9c" }],
  });
  assert.equal(regionsOnly.status, "unresolved");
  assert.deepEqual(regionsOnly.diagnostic, { reason: "no_matching_city" });
});
