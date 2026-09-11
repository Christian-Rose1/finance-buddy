import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildSeatsAeroClient,
  createSeatsAeroClient,
  projectSeatsAeroAvailability,
  type SeatsAeroSearchRequest,
} from "./seatsAeroClient";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const VALID_REQUEST: SeatsAeroSearchRequest = {
  originAirport: "RDU",
  destinationAirport: "CPH",
  cabin: "economy",
  startDate: "2027-06-10",
  endDate: "2027-06-20",
};

function rowFixture(overrides: Record<string, unknown> = {}) {
  return {
    ID: "row-1",
    Route: {
      ID: "route-1",
      OriginAirport: "RDU",
      OriginRegion: "North America",
      DestinationAirport: "CPH",
      DestinationRegion: "Europe",
      NumDaysOut: 271,
      Distance: 4300,
      Source: "united",
    },
    Date: "2027-06-11",
    ParsedDate: "2027-06-11T00:00:00Z",
    YAvailable: true,
    WAvailable: false,
    JAvailable: true,
    FAvailable: false,
    YMileageCost: "32500",
    WMileageCost: null,
    JMileageCost: "64000",
    FMileageCost: null,
    YRemainingSeats: 5,
    WRemainingSeats: 0,
    JRemainingSeats: 2,
    FRemainingSeats: 0,
    YAirlines: "UA",
    WAirlines: "",
    JAirlines: "LH",
    FAirlines: "",
    YDirect: true,
    WDirect: false,
    JDirect: false,
    FDirect: false,
    Source: "united",
    CreatedAt: "2026-09-01T08:37:32.218426Z",
    UpdatedAt: "2026-09-10T13:52:23.343425Z",
    AvailabilityTrips: null,
    ...overrides,
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
  overrides: Partial<{
    ok: boolean;
    status: number;
    throws: boolean;
    jsonThrows: boolean;
  }> = {},
) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchFn = async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    if (overrides.throws) return Promise.reject(new Error("network down"));
    if (overrides.ok === false) {
      return Promise.resolve({
        ok: false,
        status: overrides.status ?? 500,
        json: async () => ({ error: "nope" }),
      } as unknown as Response);
    }
    return {
      ok: true,
      status: 200,
      json: async () => {
        if (overrides.jsonThrows) throw new Error("bad json");
        return body;
      },
    } as unknown as Response;
  };
  return { calls, fetchFn };
}

const emptyEnvelope = (rows: unknown[]) => ({
  data: rows,
  count: rows.length,
  hasMore: false,
  cursor: null,
});

// ---------------------------------------------------------------------------
// Request validation
// ---------------------------------------------------------------------------

test("rejects every malformed runtime request without fetching", async () => {
  const { calls, fetchFn } = captureFetch(emptyEnvelope([]));
  const client = buildSeatsAeroClient("pro_test_key", fetchFn);
  const invalidInputs: unknown[] = [
    null,
    "nope",
    42,
    [],
    {},
    { ...VALID_REQUEST, originAirport: "rdu" },
    { ...VALID_REQUEST, originAirport: "RD" },
    { ...VALID_REQUEST, originAirport: "RDUU" },
    { ...VALID_REQUEST, originAirport: 12 },
    { ...VALID_REQUEST, destinationAirport: "RDU" },
    { ...VALID_REQUEST, destinationAirport: "cph" },
    { ...VALID_REQUEST, cabin: "coach" },
    { ...VALID_REQUEST, cabin: 3 },
    { ...VALID_REQUEST, startDate: "2027-06-31" },
    { ...VALID_REQUEST, startDate: "27-06-2027" },
    { ...VALID_REQUEST, endDate: "2027-13-01" },
    { ...VALID_REQUEST, endDate: "2027-06-01" },
    { ...VALID_REQUEST, startDate: null },
    { ...VALID_REQUEST, sources: "united" },
    { ...VALID_REQUEST, sources: [42] },
    { ...VALID_REQUEST, sources: ["United"] },
    { ...VALID_REQUEST, sources: ["united", "united"] },
    { ...VALID_REQUEST, take: 9 },
    { ...VALID_REQUEST, take: 1001 },
    { ...VALID_REQUEST, take: 3.5 },
    { ...VALID_REQUEST, take: "500" },
  ];
  for (const input of invalidInputs) {
    const result = await client.searchAvailability(input, "outbound");
    assert.deepEqual(result, { rows: null, error: "invalid_request" });
  }
  assert.equal(calls.length, 0, "no fetch may occur for invalid requests");
});

test("rejects before fetching when the API key is missing or blank", async () => {
  const { calls, fetchFn } = captureFetch(emptyEnvelope([]));
  const client = buildSeatsAeroClient("", fetchFn);
  const result = await client.searchAvailability(VALID_REQUEST, "outbound");
  assert.deepEqual(result, { rows: null, error: "provider_not_configured" });
  assert.equal(calls.length, 0);
});

test("accepts a valid request and sends exactly the documented parameters", async () => {
  const { calls, fetchFn } = captureFetch(emptyEnvelope([]));
  const client = buildSeatsAeroClient("pro_test_key", fetchFn);
  const result = await client.searchAvailability(
    {
      ...VALID_REQUEST,
      sources: ["united", "aeroplan", "flyingblue"],
      take: 100,
    },
    "outbound",
  );
  assert.deepEqual(result, { rows: [], error: null });
  assert.equal(calls.length, 1);
  const url = new URL(calls[0].url);
  assert.equal(
    `${url.origin}${url.pathname}`,
    "https://seats.aero/partnerapi/search",
  );
  assert.equal(url.searchParams.get("origin_airport"), "RDU");
  assert.equal(url.searchParams.get("destination_airport"), "CPH");
  assert.equal(url.searchParams.get("cabins"), "economy");
  assert.equal(url.searchParams.get("start_date"), "2027-06-10");
  assert.equal(url.searchParams.get("end_date"), "2027-06-20");
  assert.equal(url.searchParams.get("sources"), "united,aeroplan,flyingblue");
  assert.equal(url.searchParams.get("take"), "100");
  assert.equal(calls[0].init.method, "GET");
  const headers = calls[0].init.headers as Record<string, string>;
  assert.equal(headers.accept, "application/json");
  assert.equal(headers["Partner-Authorization"], "pro_test_key");
  // The key must never appear in the URL itself.
  assert.equal(calls[0].url.includes("pro_test_key"), false);
});

test("return direction swaps the corridor endpoints in the request", async () => {
  const { calls, fetchFn } = captureFetch(emptyEnvelope([]));
  const client = buildSeatsAeroClient("pro_test_key", fetchFn);
  await client.searchAvailability(VALID_REQUEST, "return");
  const url = new URL(calls[0].url);
  assert.equal(url.searchParams.get("origin_airport"), "CPH");
  assert.equal(url.searchParams.get("destination_airport"), "RDU");
});

// ---------------------------------------------------------------------------
// Transport failures
// ---------------------------------------------------------------------------

test("network errors, non-2xx responses, and invalid JSON map to fixed categories", async () => {
  const envelope = emptyEnvelope([]);
  const throws = captureFetch(envelope, { throws: true });
  const httpFail = captureFetch(envelope, { ok: false, status: 429 });
  const badJson = captureFetch(envelope, { jsonThrows: true });

  const network = await buildSeatsAeroClient("pro_test_key", throws.fetchFn)
    .searchAvailability(VALID_REQUEST, "outbound");
  const http = await buildSeatsAeroClient("pro_test_key", httpFail.fetchFn)
    .searchAvailability(VALID_REQUEST, "outbound");
  const json = await buildSeatsAeroClient("pro_test_key", badJson.fetchFn)
    .searchAvailability(VALID_REQUEST, "outbound");

  assert.deepEqual(network, { rows: null, error: "http_failure" });
  assert.deepEqual(http, { rows: null, error: "http_failure" });
  assert.deepEqual(json, { rows: null, error: "malformed_response" });
});

// ---------------------------------------------------------------------------
// Envelope projection
// ---------------------------------------------------------------------------

test("empty data projects to an empty row set, not an error", async () => {
  const { fetchFn } = captureFetch(emptyEnvelope([]));
  const client = buildSeatsAeroClient("pro_test_key", fetchFn);
  const result = await client.searchAvailability(VALID_REQUEST, "outbound");
  assert.deepEqual(result, { rows: [], error: null });
});

test("valid rows project with exact native-unit prices and direction tags", async () => {
  const { fetchFn } = captureFetch(emptyEnvelope([rowFixture()]));
  const client = buildSeatsAeroClient("pro_test_key", fetchFn);
  const result = await client.searchAvailability(VALID_REQUEST, "outbound");
  assert.equal(result.error, null);
  assert.equal(result.rows!.length, 1);
  const row = result.rows![0];
  assert.equal(row.pointsRequired, 32500);
  assert.equal(row.source, "united");
  assert.equal(row.departureDate, "2027-06-11");
  assert.equal(row.isReturn, false);
  assert.equal(row.remainingSeats, 5);
  assert.equal(row.direct, true);
  // The projector normalizes provider timestamps to millisecond ISO.
  assert.equal(row.updatedAt, "2026-09-10T13:52:23.343Z");
  assert.equal("ID" in row, false);
  assert.equal("Route" in row, false);
  assert.equal("AvailabilityTrips" in row, false);
  assert.equal("CreatedAt" in row, false);
});

test("return-direction rows require the reversed corridor on each row", async () => {
  // A provider row for the outbound corridor arriving in a return search is
  // a contract violation and must reject the whole response.
  const { fetchFn } = captureFetch(emptyEnvelope([rowFixture()]));
  const client = buildSeatsAeroClient("pro_test_key", fetchFn);
  const result = await client.searchAvailability(
    VALID_REQUEST,
    "return",
  );
  assert.deepEqual(result, { rows: null, error: "projection_rejected" });
});

test("return-direction rows on the reversed corridor project correctly", async () => {
  const { fetchFn } = captureFetch(
    emptyEnvelope([rowFixture({ Route: { Source: "united", OriginAirport: "CPH", DestinationAirport: "RDU" } })]),
  );
  const client = buildSeatsAeroClient("pro_test_key", fetchFn);
  const result = await client.searchAvailability(VALID_REQUEST, "return");
  assert.equal(result.error, null);
  assert.equal(result.rows!.length, 1);
  assert.equal(result.rows![0].isReturn, true);
});

// ---------------------------------------------------------------------------
// Corridor and date gates
// ---------------------------------------------------------------------------

test("an out-of-corridor row rejects the entire response", async () => {
  const good = rowFixture();
  const hostile = rowFixture({
    ID: "row-2",
    Route: {
      ID: "route-2",
      OriginAirport: "JFK",
      OriginRegion: "North America",
      DestinationAirport: "LHR",
      DestinationRegion: "Europe",
      NumDaysOut: 100,
      Distance: 5540,
      Source: "united",
    },
  });
  const { fetchFn } = captureFetch(emptyEnvelope([good, hostile]));
  const client = buildSeatsAeroClient("pro_test_key", fetchFn);
  const result = await client.searchAvailability(VALID_REQUEST, "outbound");
  assert.deepEqual(result, { rows: null, error: "projection_rejected" });
});

test("a row outside the requested date window rejects the response", async () => {
  const { fetchFn } = captureFetch(
    emptyEnvelope([rowFixture({ Date: "2027-07-01" })]),
  );
  const client = buildSeatsAeroClient("pro_test_key", fetchFn);
  const result = await client.searchAvailability(VALID_REQUEST, "outbound");
  assert.deepEqual(result, { rows: null, error: "projection_rejected" });
});

test("Route.Source disagreeing with Source rejects the response", async () => {
  const fixture = rowFixture();
  (fixture.Route as Record<string, unknown>).Source = "aeroplan";
  const { fetchFn } = captureFetch(emptyEnvelope([fixture]));
  const client = buildSeatsAeroClient("pro_test_key", fetchFn);
  const result = await client.searchAvailability(VALID_REQUEST, "outbound");
  assert.deepEqual(result, { rows: null, error: "projection_rejected" });
});

// ---------------------------------------------------------------------------
// Cabin field semantics
// ---------------------------------------------------------------------------

test("cabin prefix selection reads only the requested cabin", async () => {
  const { fetchFn } = captureFetch(emptyEnvelope([rowFixture()]));
  const client = buildSeatsAeroClient("pro_test_key", fetchFn);
  const result = await client.searchAvailability(
    { ...VALID_REQUEST, cabin: "business" },
    "outbound",
  );
  assert.equal(result.error, null);
  assert.equal(result.rows![0].pointsRequired, 64000);
});

test("cabin available=false with a cost string is skipped, not projected", async () => {
  const { fetchFn } = captureFetch(
    emptyEnvelope([rowFixture({ YAvailable: false })]),
  );
  const client = buildSeatsAeroClient("pro_test_key", fetchFn);
  const result = await client.searchAvailability(VALID_REQUEST, "outbound");
  assert.deepEqual(result, { rows: [], error: null });
});

test("a non-string mileage cost is a rejection, not a skip", async () => {
  const { fetchFn } = captureFetch(
    emptyEnvelope([rowFixture({ YMileageCost: 32500 })]),
  );
  const client = buildSeatsAeroClient("pro_test_key", fetchFn);
  const result = await client.searchAvailability(VALID_REQUEST, "outbound");
  assert.deepEqual(result, { rows: null, error: "projection_rejected" });
});

test("the zero-cost sentinel is skipped, never projected as a price", async () => {
  const { fetchFn } = captureFetch(
    emptyEnvelope([rowFixture({ YMileageCost: "0" })]),
  );
  const client = buildSeatsAeroClient("pro_test_key", fetchFn);
  const result = await client.searchAvailability(VALID_REQUEST, "outbound");
  assert.deepEqual(result, { rows: [], error: null });
});

test("a mileage cost above the maximum bound rejects the response", async () => {
  const { fetchFn } = captureFetch(
    emptyEnvelope([rowFixture({ YMileageCost: "10000001" })]),
  );
  const client = buildSeatsAeroClient("pro_test_key", fetchFn);
  const result = await client.searchAvailability(VALID_REQUEST, "outbound");
  assert.deepEqual(result, { rows: null, error: "projection_rejected" });
});

// ---------------------------------------------------------------------------
// Taxes semantics
// ---------------------------------------------------------------------------

test("taxes project to minor units with their currency", async () => {
  const { fetchFn } = captureFetch(
    emptyEnvelope([rowFixture({ YTotalTaxes: 18560, TaxesCurrency: "USD" })]),
  );
  const client = buildSeatsAeroClient("pro_test_key", fetchFn);
  const result = await client.searchAvailability(VALID_REQUEST, "outbound");
  assert.equal(result.rows![0].taxesMinorUnits, 18560);
  assert.equal(result.rows![0].taxesCurrency, "USD");
});

test("taxes without a currency are dropped to null, not guessed", async () => {
  const { fetchFn } = captureFetch(
    emptyEnvelope([rowFixture({ YTotalTaxes: 18560, TaxesCurrency: null })]),
  );
  const client = buildSeatsAeroClient("pro_test_key", fetchFn);
  const result = await client.searchAvailability(VALID_REQUEST, "outbound");
  assert.equal(result.rows![0].taxesMinorUnits, null);
  assert.equal(result.rows![0].taxesCurrency, null);
});

test("negative or non-integer taxes reject the response", async () => {
  for (const taxes of [-1, 1.5]) {
    const { fetchFn } = captureFetch(
      emptyEnvelope([rowFixture({ YTotalTaxes: taxes })]),
    );
    const client = buildSeatsAeroClient("pro_test_key", fetchFn);
    const result = await client.searchAvailability(VALID_REQUEST, "outbound");
    assert.deepEqual(result, { rows: null, error: "projection_rejected" });
  }
});

test("a lowercase currency rejects the response", async () => {
  const { fetchFn } = captureFetch(
    emptyEnvelope([rowFixture({ YTotalTaxes: 18560, TaxesCurrency: "usd" })]),
  );
  const client = buildSeatsAeroClient("pro_test_key", fetchFn);
  const result = await client.searchAvailability(VALID_REQUEST, "outbound");
  assert.deepEqual(result, { rows: null, error: "projection_rejected" });
});

// ---------------------------------------------------------------------------
// Seats, direct flag, freshness, id
// ---------------------------------------------------------------------------

test("a seat count of zero is treated as untracked and projects to null", async () => {
  const { fetchFn } = captureFetch(
    emptyEnvelope([rowFixture({ YRemainingSeats: 0 })]),
  );
  const client = buildSeatsAeroClient("pro_test_key", fetchFn);
  const result = await client.searchAvailability(VALID_REQUEST, "outbound");
  assert.equal(result.rows![0].remainingSeats, null);
});

test("a negative seat count rejects the response", async () => {
  const { fetchFn } = captureFetch(
    emptyEnvelope([rowFixture({ YRemainingSeats: -1 })]),
  );
  const client = buildSeatsAeroClient("pro_test_key", fetchFn);
  const result = await client.searchAvailability(VALID_REQUEST, "outbound");
  assert.deepEqual(result, { rows: null, error: "projection_rejected" });
});

test("a non-boolean direct flag rejects the response", async () => {
  const { fetchFn } = captureFetch(
    emptyEnvelope([rowFixture({ YDirect: "yes" })]),
  );
  const client = buildSeatsAeroClient("pro_test_key", fetchFn);
  const result = await client.searchAvailability(VALID_REQUEST, "outbound");
  assert.deepEqual(result, { rows: null, error: "projection_rejected" });
});

test("a malformed UpdatedAt rejects the response", async () => {
  const { fetchFn } = captureFetch(
    emptyEnvelope([rowFixture({ UpdatedAt: "not-a-date" })]),
  );
  const client = buildSeatsAeroClient("pro_test_key", fetchFn);
  const result = await client.searchAvailability(VALID_REQUEST, "outbound");
  assert.deepEqual(result, { rows: null, error: "projection_rejected" });
});

test("an over-length row ID rejects the response", async () => {
  const { fetchFn } = captureFetch(
    emptyEnvelope([rowFixture({ ID: "x".repeat(129) })]),
  );
  const client = buildSeatsAeroClient("pro_test_key", fetchFn);
  const result = await client.searchAvailability(VALID_REQUEST, "outbound");
  assert.deepEqual(result, { rows: null, error: "projection_rejected" });
});

// ---------------------------------------------------------------------------
// Envelope strictness
// ---------------------------------------------------------------------------

test("envelope violations reject the projection", () => {
  const rejects: unknown[] = [
    null,
    [],
    "data",
    { data: [] },
    { data: [], count: 0, hasMore: "no" },
    { data: [], count: -1, hasMore: false },
    { data: [], count: 1.5, hasMore: false },
    { data: {}, count: 0, hasMore: false },
    { data: [rowFixture()], count: 0, hasMore: false },
    { data: new Array(1001).fill(null), count: 1001, hasMore: false },
  ];
  for (const body of rejects) {
    const projected = projectSeatsAeroAvailability(
      body,
      VALID_REQUEST,
      "outbound",
    );
    assert.equal(projected, null);
  }
  const counted = projectSeatsAeroAvailability(
    { data: [rowFixture()], count: 1, hasMore: false },
    VALID_REQUEST,
    "outbound",
  );
  assert.equal(Array.isArray(counted), true);
});

test("projection and client never mutate their inputs", async () => {
  const fixture = rowFixture();
  const before = JSON.stringify(fixture);
  const envelope = { data: [fixture], count: 1, hasMore: false };
  const envelopeBefore = JSON.stringify(envelope);
  const request = { ...VALID_REQUEST };
  const requestBefore = JSON.stringify(request);
  const { fetchFn } = captureFetch(envelope);
  const client = buildSeatsAeroClient("pro_test_key", fetchFn);
  await client.searchAvailability(request, "outbound");
  assert.equal(JSON.stringify(fixture), before);
  assert.equal(JSON.stringify(envelope), envelopeBefore);
  assert.equal(JSON.stringify(request), requestBefore);
});

// ---------------------------------------------------------------------------
// Abort support and production factory
// ---------------------------------------------------------------------------

test("an already-aborted signal cannot produce rows", async () => {
  const controller = new AbortController();
  controller.abort();
  const fetchFn = () => Promise.reject(new Error("aborted"));
  const client = buildSeatsAeroClient("pro_test_key", fetchFn);
  const result = await client.searchAvailability(
    VALID_REQUEST,
    "outbound",
    controller.signal,
  );
  assert.deepEqual(result, { rows: null, error: "http_failure" });
});

test("the caller's abort signal is forwarded to the transport", async () => {
  const controller = new AbortController();
  const { calls, fetchFn } = captureFetch(emptyEnvelope([]));
  const client = buildSeatsAeroClient("pro_test_key", fetchFn);
  const result = await client.searchAvailability(
    VALID_REQUEST,
    "outbound",
    controller.signal,
  );
  assert.deepEqual(result, { rows: [], error: null });
  assert.equal(calls.length, 1);
  assert.equal(
    calls[0].init.signal,
    controller.signal,
    "the exact caller signal must reach fetch",
  );
});

test("production factory reads the configured key without exposing it", async () => {
  const previous = process.env.SEATS_AERO_API_KEY;
  process.env.SEATS_AERO_API_KEY = "pro_factory_check";
  try {
    const { calls, fetchFn } = captureFetch(emptyEnvelope([]));
    const client = createSeatsAeroClient(fetchFn);
    const result = await client.searchAvailability(VALID_REQUEST, "outbound");
    assert.deepEqual(result, { rows: [], error: null });
    const headers = calls[0].init.headers as Record<string, string>;
    assert.equal(headers["Partner-Authorization"], "pro_factory_check");
  } finally {
    if (previous === undefined) {
      delete process.env.SEATS_AERO_API_KEY;
    } else {
      process.env.SEATS_AERO_API_KEY = previous;
    }
  }
});
