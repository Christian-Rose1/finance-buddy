import assert from "node:assert/strict";
import { test } from "node:test";
import { buildSerpApiFlightLocationClient } from "./serpApiFlightLocationClient";

function citySuggestion(overrides: Record<string, unknown> = {}) {
  return {
    position: 1,
    name: "Paris, France",
    type: "city",
    description: "Capital of France",
    id: "/m/05qtj",
    airports: [{ id: "CDG" }, { id: "ORY" }],
    ...overrides,
  };
}

function response(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => body,
  } as Response;
}

test("resolves a saved airport identifier without configuration or HTTP", async () => {
  let callCount = 0;
  const fetch = async () => {
    callCount += 1;
    return response({});
  };
  const client = buildSerpApiFlightLocationClient("", fetch);

  const result = await client.resolveLocation(" den ");

  assert.equal(result.error, null);
  assert.equal(result.projection?.status, "resolved");
  assert.equal(result.projection?.selected?.locationId, "DEN");
  assert.equal(callCount, 0);
});

test("makes one exact autocomplete request for a saved city", async () => {
  const urls: string[] = [];
  const methods: Array<string | undefined> = [];
  const cacheModes: Array<RequestCache | undefined> = [];
  const fetch = async (url: string, init: RequestInit) => {
    urls.push(url);
    methods.push(init.method);
    cacheModes.push(init.cache);
    return response({ suggestions: [citySuggestion()] });
  };
  const client = buildSerpApiFlightLocationClient("test-key", fetch);

  const result = await client.resolveLocation(" Paris ");

  assert.equal(result.error, null);
  assert.equal(result.projection?.selected?.locationId, "/m/05qtj");
  assert.equal(urls.length, 1);
  assert.deepEqual(methods, ["GET"]);
  assert.deepEqual(cacheModes, ["no-store"]);

  const url = new URL(urls[0]);
  assert.equal(url.origin + url.pathname, "https://serpapi.com/search");
  assert.deepEqual([...url.searchParams.keys()].sort(), [
    "api_key",
    "engine",
    "exclude_regions",
    "gl",
    "hl",
    "q",
  ]);
  assert.equal(url.searchParams.get("engine"), "google_flights_autocomplete");
  assert.equal(url.searchParams.get("q"), "Paris");
  assert.equal(url.searchParams.get("gl"), "us");
  assert.equal(url.searchParams.get("hl"), "en");
  assert.equal(url.searchParams.get("exclude_regions"), "true");
  assert.equal(url.searchParams.get("api_key"), "test-key");
  assert.equal(url.searchParams.has("no_cache"), false);
});

test("preserves ambiguous city projections without choosing or retrying", async () => {
  let callCount = 0;
  const fetch = async () => {
    callCount += 1;
    return response({
      suggestions: [
        citySuggestion(),
        citySuggestion({
          name: "Paris, Texas, United States",
          id: "/m/0td75",
          airports: [{ id: "PRX" }],
        }),
      ],
    });
  };
  const client = buildSerpApiFlightLocationClient("test-key", fetch);

  const result = await client.resolveLocation("Paris");

  assert.equal(result.error, null);
  assert.equal(result.projection?.status, "ambiguous");
  assert.equal(result.projection?.selected, null);
  assert.equal(callCount, 1);
});

test("preserves a valid unresolved result without guessing", async () => {
  const client = buildSerpApiFlightLocationClient(
    "test-key",
    async () => response({ suggestions: [citySuggestion({ name: "London, United Kingdom" })] }),
  );

  const result = await client.resolveLocation("Paris");

  assert.equal(result.error, null);
  assert.equal(result.projection?.status, "unresolved");
  assert.equal(result.projection?.selected, null);
});

test("rejects invalid saved locations before configuration or HTTP", async () => {
  let callCount = 0;
  const fetch = async () => {
    callCount += 1;
    return response({});
  };
  const client = buildSerpApiFlightLocationClient("", fetch);

  for (const location of [null, "", "https://hostile.example", "api_key=secret"]) {
    const result = await client.resolveLocation(location);
    assert.deepEqual(result, { projection: null, error: "invalid_location" });
  }
  assert.equal(callCount, 0);
});

test("requires provider configuration for a safe city without making HTTP", async () => {
  let callCount = 0;
  const fetch = async () => {
    callCount += 1;
    return response({});
  };

  for (const apiKey of ["", "   "]) {
    const client = buildSerpApiFlightLocationClient(apiKey, fetch);
    const result = await client.resolveLocation("Paris");
    assert.deepEqual(result, { projection: null, error: "provider_not_configured" });
  }
  assert.equal(callCount, 0);
});

test("returns a fixed HTTP failure for a thrown request without retrying", async () => {
  let callCount = 0;
  const client = buildSerpApiFlightLocationClient("test-key", async () => {
    callCount += 1;
    throw new Error("secret network failure");
  });

  const result = await client.resolveLocation("Paris");

  assert.deepEqual(result, { projection: null, error: "http_failure" });
  assert.equal(callCount, 1);
  assert.ok(!JSON.stringify(result).includes("secret network failure"));
});

test("does not read or retry a non-success response", async () => {
  let callCount = 0;
  let jsonCallCount = 0;
  const client = buildSerpApiFlightLocationClient("test-key", async () => {
    callCount += 1;
    return {
      ok: false,
      status: 429,
      json: async () => {
        jsonCallCount += 1;
        return { error: "secret provider body" };
      },
    } as Response;
  });

  const result = await client.resolveLocation("Paris");

  assert.deepEqual(result, { projection: null, error: "http_failure" });
  assert.equal(callCount, 1);
  assert.equal(jsonCallCount, 0);
});

test("maps thrown or structurally malformed JSON to one fixed error", async () => {
  const throwingClient = buildSerpApiFlightLocationClient("test-key", async () => ({
    ok: true,
    status: 200,
    json: async () => {
      throw new SyntaxError("secret malformed JSON");
    },
  }) as unknown as Response);
  const malformedClient = buildSerpApiFlightLocationClient(
    "test-key",
    async () => response({ wrong: "shape" }),
  );

  assert.deepEqual(await throwingClient.resolveLocation("Paris"), {
    projection: null,
    error: "malformed_response",
  });
  assert.deepEqual(await malformedClient.resolveLocation("Paris"), {
    projection: null,
    error: "malformed_response",
  });
});

test("never returns the API key or raw provider metadata", async () => {
  const secret = "SECRET_AUTOCOMPLETE_API_KEY";
  const client = buildSerpApiFlightLocationClient(secret, async () =>
    response({
      search_metadata: { id: secret, json_endpoint: "https://hostile.example" },
      error: secret,
      suggestions: [citySuggestion({ description: secret })],
    }),
  );

  const result = await client.resolveLocation("Paris");
  const serialized = JSON.stringify(result);

  assert.equal(result.error, null);
  assert.ok(!serialized.includes(secret));
  assert.ok(!serialized.includes("https://"));
  assert.ok(!serialized.includes("search_metadata"));
  assert.ok(!serialized.includes("description"));
});
