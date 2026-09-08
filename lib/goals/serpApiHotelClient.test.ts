import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildSerpApiHotelClient,
  createSerpApiHotelClient,
} from "./serpApiHotelClient";

function validRequest(overrides: Record<string, unknown> = {}) {
  return {
    destination: "Copenhagen",
    checkInDate: "2027-04-03",
    checkOutDate: "2027-04-11",
    travelers: 2,
    currency: "USD",
    ...overrides,
  };
}

function validProviderBody() {
  return {
    search_metadata: { id: "raw-provider-search-id" },
    search_parameters: { currency: "USD" },
    properties: [
      {
        type: "hotel",
        name: "Example Grand Hotel",
        rate_per_night: { lowest: "$1,200", extracted_lowest: 1200 },
        total_rate: { lowest: "$9,600", extracted_lowest: 9600 },
        overall_rating: 4.5,
        reviews: 812,
        hotel_class: "4-star hotel",
        extracted_hotel_class: 4,
        amenities: ["Free Wi-Fi", "Breakfast included"],
        link: "https://example.com/property",
        images: [{ thumbnail: "https://example.com/image.jpg" }],
      },
    ],
  };
}

function okResponse(body: unknown) {
  return {
    ok: true,
    status: 200,
    json: async () => body,
  } as unknown as Response;
}

function captureFetch(
  body: unknown,
  overrides: Partial<{ ok: boolean; status: number; throws: boolean; jsonThrows: boolean }> = {},
) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchFn = (url: string, init: RequestInit) => {
    calls.push({ url, init });
    if (overrides.throws) return Promise.reject(new Error("network down"));
    if (overrides.ok === false) {
      return Promise.resolve({ ok: false, status: overrides.status ?? 500, json: async () => ({ error: "nope" }) } as unknown as Response);
    }
    return Promise.resolve(
      overrides.jsonThrows
        ? { ok: true, status: 200, json: async () => { throw new Error("bad json"); } }
        : okResponse(body),
    );
  };
  return { calls, fetchFn: fetchFn as unknown as (url: string, init: RequestInit) => Promise<Response> };
}

test("builds the request exactly from the saved-goal inputs", async () => {
  const { calls, fetchFn } = captureFetch(validProviderBody());
  const client = buildSerpApiHotelClient("test-key", fetchFn, () => new Date("2027-01-02T03:04:05Z"));
  const result = await client.fetchHotelEstimate(validRequest());
  assert.equal(result.error, null);
  assert.ok(result.estimate);
  assert.equal(calls.length, 1);
  const url = new URL(calls[0].url);
  assert.equal(url.origin + url.pathname, "https://serpapi.com/search");
  assert.equal(url.searchParams.get("engine"), "google_hotels");
  assert.equal(url.searchParams.get("q"), "Copenhagen");
  assert.equal(url.searchParams.get("check_in_date"), "2027-04-03");
  assert.equal(url.searchParams.get("check_out_date"), "2027-04-11");
  assert.equal(url.searchParams.get("adults"), "2");
  assert.equal(url.searchParams.get("currency"), "USD");
  // Extra parameters never appear.
  for (const key of url.searchParams.keys()) {
    assert.ok(
      ["engine", "q", "check_in_date", "check_out_date", "adults", "currency", "gl", "hl", "api_key"].includes(key),
      `unexpected request parameter: ${key}`,
    );
  }
});

test("missing inputs prevent fetch and fail safely", async () => {
  for (const bad of [
    null,
    undefined,
    {},
    validRequest({ destination: "" }),
    validRequest({ checkInDate: "2027-13-01" }),
    validRequest({ checkOutDate: "2027-04-03" }), // same as check-in
    validRequest({ travelers: 0 }),
    validRequest({ travelers: 2.5 }),
    validRequest({ currency: "usd" }),
    validRequest({ destination: "bad\ncontrol" }),
    "Copenhagen",
  ]) {
    const { calls, fetchFn } = captureFetch(validProviderBody());
    const client = buildSerpApiHotelClient("test-key", fetchFn);
    const result = await client.fetchHotelEstimate(bad);
    assert.deepEqual(result, { estimate: null, error: "invalid_request" });
    assert.equal(calls.length, 0, "fetch must not be called for invalid requests");
  }
});

test("missing or blank API key prevents fetch and fails safely", async () => {
  for (const key of ["", "   "]) {
    const { calls, fetchFn } = captureFetch(validProviderBody());
    const client = buildSerpApiHotelClient(key, fetchFn);
    const result = await client.fetchHotelEstimate(validRequest());
    assert.deepEqual(result, { estimate: null, error: "provider_not_configured" });
    assert.equal(calls.length, 0, "fetch must not be called without a key");
  }
});

test("network errors, non-2xx responses, and invalid JSON fail safely", async () => {
  const network = captureFetch(validProviderBody(), { throws: true });
  const networkResult = await buildSerpApiHotelClient("test-key", network.fetchFn).fetchHotelEstimate(validRequest());
  assert.deepEqual(networkResult, { estimate: null, error: "http_failure" });
  assert.equal(network.calls.length, 1);

  const http = captureFetch({ error: "nope" }, { ok: false, status: 500 });
  const httpResult = await buildSerpApiHotelClient("test-key", http.fetchFn).fetchHotelEstimate(validRequest());
  assert.deepEqual(httpResult, { estimate: null, error: "http_failure" });

  const json = captureFetch(validProviderBody(), { jsonThrows: true });
  const jsonResult = await buildSerpApiHotelClient("test-key", json.fetchFn).fetchHotelEstimate(validRequest());
  assert.deepEqual(jsonResult, { estimate: null, error: "malformed_response" });
});

test("provider errors and invalid projections reject the result without leaking the body", async () => {
  const malformed = captureFetch({ properties: [] });
  const malformedResult = await buildSerpApiHotelClient("test-key", malformed.fetchFn).fetchHotelEstimate(validRequest());
  assert.deepEqual(malformedResult, { estimate: null, error: "projection_rejected" });

  const hostile = captureFetch({
    search_metadata: { id: "raw-provider-search-id", internal_url: "https://serpapi.com/search?api_key=secret" },
    properties: [{ type: "google_hotels", name: "X", rates: [{ per_night: { lowest: "free" } }] }],
  });
  const hostileResult = await buildSerpApiHotelClient("test-key", hostile.fetchFn).fetchHotelEstimate(validRequest());
  assert.deepEqual(hostileResult, { estimate: null, error: "projection_rejected" });
});

test("valid responses are projected into the strict customer-safe estimate", async () => {
  const { fetchFn } = captureFetch(validProviderBody());
  const result = await buildSerpApiHotelClient("test-key", fetchFn, () => new Date("2027-01-02T03:04:05Z")).fetchHotelEstimate(validRequest());
  assert.equal(result.error, null);
  assert.ok(result.estimate);
  const estimate = result.estimate!;
  assert.equal(estimate.destination, "Copenhagen");
  assert.equal(estimate.checkInDate, "2027-04-03");
  assert.equal(estimate.checkOutDate, "2027-04-11");
  assert.equal(estimate.nights, 8);
  assert.equal(estimate.travelers, 2);
  assert.equal(estimate.currency, "USD");
  assert.equal(estimate.options.length, 1);
  assert.equal(estimate.options[0].propertyName, "Example Grand Hotel");
  assert.equal(estimate.options[0].nightlyPrice, 1200);
  assert.equal(estimate.options[0].totalPrice, 9600);
  assert.equal(estimate.options[0].trustStatus, "search_estimate");
  // Provider metadata and key material never survive.
  const serialized = JSON.stringify(estimate).toLowerCase();
  for (const forbidden of ["api_key", "apikey", "test-key", "search_metadata", "raw-provider-search-id", "token", "signature", "serpapi.com"]) {
    assert.equal(serialized.includes(forbidden), false, `estimate must not contain ${forbidden}`);
  }
});

test("the request URL and key never appear in any returned result", async () => {
  const { fetchFn } = captureFetch(validProviderBody());
  const outcomes = await Promise.all([
    buildSerpApiHotelClient("super-secret-key", fetchFn).fetchHotelEstimate(validRequest()),
    buildSerpApiHotelClient("super-secret-key", captureFetch(validProviderBody(), { ok: false }).fetchFn).fetchHotelEstimate(validRequest()),
    buildSerpApiHotelClient("super-secret-key", captureFetch(validProviderBody(), { throws: true }).fetchFn).fetchHotelEstimate(validRequest()),
    buildSerpApiHotelClient("", captureFetch(validProviderBody()).fetchFn).fetchHotelEstimate(validRequest()),
    buildSerpApiHotelClient("super-secret-key", captureFetch({}).fetchFn).fetchHotelEstimate(validRequest()),
  ]);
  for (const outcome of outcomes) {
    const serialized = JSON.stringify(outcome).toLowerCase();
    for (const forbidden of ["super-secret-key", "api_key=", "serpapi.com"]) {
      assert.equal(serialized.includes(forbidden), false, `result must not contain ${forbidden}`);
    }
  }
});

test("production factory reads the environment key convention without exposing it", () => {
  const previous = process.env.SERPAPI_API_KEY;
  try {
    process.env.SERPAPI_API_KEY = "env-key";
    const client = createSerpApiHotelClient(captureFetch(validProviderBody()).fetchFn);
    assert.equal(typeof client.fetchHotelEstimate, "function");
    const serialized = JSON.stringify(Object.keys(client));
    assert.equal(serialized.includes("env-key"), false);
  } finally {
    if (previous === undefined) delete process.env.SERPAPI_API_KEY;
    else process.env.SERPAPI_API_KEY = previous;
  }
});
