import assert from "node:assert/strict";
import { test } from "node:test";
import { buildSerpApiFlightClient } from "./serpApiFlightClient";
import type { SerpApiFlightClientErrorCategory, SerpApiFlightRequest } from "./serpApiFlightClient";
import type { SerpApiFlightSearchLocation } from "./serpApiFlightSearchLocation";

// ---------------------------------------------------------------------------
// Helpers: realistic SerpApi response fixtures
// ---------------------------------------------------------------------------

function makeFlightEntry(args: {
  depAirport: string;
  depTime: string;
  arrAirport: string;
  arrTime: string;
  airline?: string;
  flightNumber?: string;
  cabin?: string | null;
  operatingCarrier?: string;
}) {
  const result: Record<string, unknown> = {
    departure_airport: { id: args.depAirport, time: args.depTime },
    arrival_airport: { id: args.arrAirport, time: args.arrTime },
    airline: args.airline ?? "Air France",
    flight_number: args.flightNumber ?? "AF007",
    operating_carrier: args.operatingCarrier ?? "Air France",
  };
  if (args.cabin !== undefined) {
    result.travel_class = args.cabin;
  }
  return result;
}

function makeInitialResponse(args?: {
  flights?: ReturnType<typeof makeFlightEntry>[];
  price?: number;
  duration?: number;
  departureToken?: string;
}) {
  return {
    best_flights: [
      {
        flights: args?.flights ?? [
          makeFlightEntry({
            depAirport: "JFK",
            depTime: "2026-09-15 10:30",
            arrAirport: "CDG",
            arrTime: "2026-09-15 22:45",
          }),
        ],
        total_duration: args?.duration ?? 435,
        price: args?.price ?? 868,
        departure_token: args?.departureToken ?? "ABC123token",
      },
    ],
    other_flights: [],
  };
}

function makeReturnResponse(args?: {
  flights?: ReturnType<typeof makeFlightEntry>[];
  price?: number;
  duration?: number;
}) {
  return {
    best_flights: [
      {
        flights: args?.flights ?? [
          makeFlightEntry({
            depAirport: "CDG",
            depTime: "2026-09-22 08:15",
            arrAirport: "JFK",
            arrTime: "2026-09-22 11:00",
          }),
        ],
        total_duration: args?.duration ?? 525,
        price: args?.price ?? 1736,
      },
    ],
    other_flights: [],
  };
}

const AIRPORT_JFK: SerpApiFlightSearchLocation = { searchId: "JFK", kind: "airport", acceptableAirportIds: ["JFK"] };
const AIRPORT_CDG: SerpApiFlightSearchLocation = { searchId: "CDG", kind: "airport", acceptableAirportIds: ["CDG"] };
const PARIS: SerpApiFlightSearchLocation = { searchId: "/m/05qtj", kind: "city", acceptableAirportIds: ["CDG", "ORY"] };
const VALID_REQUEST: SerpApiFlightRequest = {
  origin: AIRPORT_JFK,
  destination: AIRPORT_CDG,
  outboundDate: "2026-09-15",
  returnDate: "2026-09-22",
  travelers: 2,
  cabin: "economy",
  currency: "USD",
};

function mockJsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => body,
  } as Response;
}

function mockFetchSuccess(initialBody: unknown, returnBody: unknown) {
  let callCount = 0;
  return {
    fetch: async (_url: string, _init: RequestInit) => {
      callCount += 1;
      if (callCount === 1) {
        return mockJsonResponse(initialBody);
      }
      return mockJsonResponse(returnBody);
    },
    getCallCount: () => callCount,
  };
}

// ---------------------------------------------------------------------------
// Tests: 16 proof points
// ---------------------------------------------------------------------------

// 1. Exactly two calls on success
test("exactly two fetch calls on success", async () => {
  const { fetch, getCallCount } = mockFetchSuccess(
    makeInitialResponse(),
    makeReturnResponse(),
  );

  const client = buildSerpApiFlightClient("test-api-key", fetch);
  const result = await client.fetchFlight(VALID_REQUEST);

  assert.equal(result.error, null);
  assert.notEqual(result.observation, null);
  assert.equal(getCallCount(), 2);
});

// 2. Exact approved request parameters
test("sends exact approved parameters in the first request", async () => {
  let capturedUrl = "";
  let callCount = 0;
  const fetch = async (url: string, _init: RequestInit) => {
    callCount += 1;
    if (callCount === 1) {
      capturedUrl = url;
      return mockJsonResponse(makeInitialResponse());
    }
    return mockJsonResponse(makeReturnResponse());
  };

  const client = buildSerpApiFlightClient("test-api-key", fetch);
  const result = await client.fetchFlight(VALID_REQUEST);

  assert.equal(result.error, null);
  assert.ok(capturedUrl.includes("engine=google_flights"));
  assert.ok(capturedUrl.includes("type=1"));
  assert.ok(capturedUrl.includes("departure_id=JFK"));
  assert.ok(capturedUrl.includes("arrival_id=CDG"));
  assert.ok(capturedUrl.includes("outbound_date=2026-09-15"));
  assert.ok(capturedUrl.includes("return_date=2026-09-22"));
  assert.ok(capturedUrl.includes("adults=2"));
  assert.ok(capturedUrl.includes("currency=USD"));
  assert.ok(capturedUrl.includes("travel_class=1"));
  assert.ok(capturedUrl.includes("gl=us"));
  assert.ok(capturedUrl.includes("hl=en"));
  assert.ok(capturedUrl.includes("deep_search=true"));
  assert.ok(capturedUrl.includes("api_key=test-api-key"));
  assert.ok(!capturedUrl.includes("departure_token"));
});

// 3. No departure token on the first request
test("omits departure token from the first request", async () => {
  let capturedFirstUrl = "";
  let callCount = 0;
  const fetch = async (url: string, _init: RequestInit) => {
    callCount += 1;
    if (callCount === 1) {
      capturedFirstUrl = url;
      return mockJsonResponse(makeInitialResponse());
    }
    return mockJsonResponse(makeReturnResponse());
  };

  const client = buildSerpApiFlightClient("test-api-key", fetch);
  const result = await client.fetchFlight(VALID_REQUEST);

  assert.equal(result.error, null);
  assert.ok(!capturedFirstUrl.includes("departure_token"));
});

// 4. Selector source index supplies the second request token
test("passes departure token from selector to second request", async () => {
  const token = "DEPARTURE_TOKEN_99";
  let capturedSecondUrl = "";
  let callCount = 0;
  const fetch = async (url: string, _init: RequestInit) => {
    callCount += 1;
    if (callCount === 1) {
      return mockJsonResponse(makeInitialResponse({ departureToken: token }));
    }
    capturedSecondUrl = url;
    return mockJsonResponse(makeReturnResponse());
  };

  const client = buildSerpApiFlightClient("test-api-key", fetch);
  const result = await client.fetchFlight(VALID_REQUEST);

  assert.equal(result.error, null);
  assert.ok(capturedSecondUrl.includes(`departure_token=${encodeURIComponent(token)}`));
});

test("passes a long opaque departure token through the two-request client privately", async () => {
  const token = `opaque-${"x".repeat(270)}`;
  const urls: string[] = [];
  const fetch = async (url: string, _init: RequestInit) => {
    urls.push(url);
    return mockJsonResponse(urls.length === 1
      ? makeInitialResponse({ departureToken: token })
      : makeReturnResponse({ price: 1736 }));
  };

  const result = await buildSerpApiFlightClient("test-api-key", fetch).fetchFlight(VALID_REQUEST);

  assert.equal(token.length > 160 && token.length <= 1024, true);
  assert.equal(urls.length, 2);
  assert.equal(new URL(urls[1]).searchParams.get("departure_token"), token);
  assert.equal(result.error, null);
  assert.deepEqual(result.observation?.price, { amount: 1736, currency: "USD" });
  assert.equal(result.observation?.travelers, 2);
  assert.equal(JSON.stringify(result).includes(token), false);
});

// 5. All four cabin mappings
const cabinMappings: [string, string][] = [
  ["economy", "1"],
  ["premium_economy", "2"],
  ["business", "3"],
  ["first", "4"],
];

for (const [cabin, expectedClass] of cabinMappings) {
  test(`maps cabin '${cabin}' to travel_class=${expectedClass}`, async () => {
    let capturedUrl = "";
    let callCount = 0;
    const fetch = async (url: string, _init: RequestInit) => {
      callCount += 1;
      if (callCount === 1) {
        capturedUrl = url;
        return mockJsonResponse(makeInitialResponse());
      }
      return mockJsonResponse(makeReturnResponse());
    };

    const client = buildSerpApiFlightClient("test-api-key", fetch);
    const result = await client.fetchFlight({ ...VALID_REQUEST, cabin });

    assert.equal(result.error, null);
    assert.ok(capturedUrl.includes(`travel_class=${expectedClass}`));
    assert.equal(callCount, 2);
  });
}

// 6. Invalid request makes zero calls
test("makes zero calls for an invalid request", async () => {
  let callCount = 0;
  const fetch = async () => {
    callCount += 1;
    return mockJsonResponse({});
  };

  const client = buildSerpApiFlightClient("test-api-key", fetch);
  const result = await client.fetchFlight({
    origin: { searchId: "INVALID", kind: "airport", acceptableAirportIds: ["INVALID"] },
    destination: AIRPORT_CDG,
    outboundDate: "2026-09-15",
    returnDate: "2026-09-22",
    travelers: 2,
    cabin: "economy",
    currency: "USD",
  });

  assert.equal(result.observation, null);
  assert.equal(result.error, "invalid_request");
  assert.equal(callCount, 0);
});

test("fails closed for malformed top-level requests without throwing or fetching", async () => {
  let calls = 0;
  const client = buildSerpApiFlightClient("test-api-key", async () => {
    calls += 1;
    return mockJsonResponse(makeInitialResponse());
  });
  for (const input of [null, undefined, [], 1, "request", true, {}, { origin: "JFK" }]) {
    await assert.doesNotReject(async () => {
      assert.deepEqual(await client.fetchFlight(input), { observation: null, error: "invalid_request" });
    });
  }
  assert.equal(calls, 0);
});

test("fails closed when preflight property access throws", async () => {
  let calls = 0;
  const client = buildSerpApiFlightClient("test-api-key", async () => {
    calls += 1;
    return mockJsonResponse(makeInitialResponse());
  });
  const throwingOrigin = { ...VALID_REQUEST } as Record<string, unknown>;
  Object.defineProperty(throwingOrigin, "origin", { get: () => { throw new Error("hostile origin"); } });
  const throwingLocation = {} as Record<string, unknown>;
  Object.defineProperty(throwingLocation, "searchId", { get: () => { throw new Error("hostile location"); } });
  const nestedThrow = { ...VALID_REQUEST, origin: throwingLocation };
  const revocable = Proxy.revocable({ ...VALID_REQUEST }, {});
  revocable.revoke();

  for (const input of [throwingOrigin, nestedThrow, revocable.proxy]) {
    await assert.doesNotReject(async () => {
      assert.deepEqual(await client.fetchFlight(input), { observation: null, error: "invalid_request" });
    });
  }
  assert.equal(calls, 0);
});

test("accepts legacy airport strings and sends their exact request parameters", async () => {
  const urls: string[] = [];
  const { fetch } = mockFetchSuccess(makeInitialResponse(), makeReturnResponse());
  const client = buildSerpApiFlightClient("test-api-key", async (url, init) => {
    urls.push(url);
    return fetch(url, init);
  });
  const result = await client.fetchFlight({ ...VALID_REQUEST, origin: "JFK", destination: "CDG" });
  assert.equal(result.error, null);
  assert.equal(urls.length, 2);
  for (const url of urls) {
    assert.ok(url.includes("departure_id=JFK"));
    assert.ok(url.includes("arrival_id=CDG"));
  }
});

test("rejects raw city identifiers with zero fetches", async () => {
  let calls = 0;
  const client = buildSerpApiFlightClient("test-api-key", async () => {
    calls += 1;
    return mockJsonResponse(makeInitialResponse());
  });
  const result = await client.fetchFlight({ ...VALID_REQUEST, destination: "/m/05qtj" });
  assert.deepEqual(result, { observation: null, error: "invalid_request" });
  assert.equal(calls, 0);
});

test("makes zero calls when API key is empty", async () => {
  let callCount = 0;
  const fetch = async () => {
    callCount += 1;
    return mockJsonResponse({});
  };

  const client = buildSerpApiFlightClient("", fetch);
  const result = await client.fetchFlight(VALID_REQUEST);

  assert.equal(result.observation, null);
  assert.equal(result.error, "provider_not_configured");
  assert.equal(callCount, 0);
});

test("makes zero calls when API key is blank", async () => {
  let callCount = 0;
  const fetch = async () => {
    callCount += 1;
    return mockJsonResponse({});
  };

  const client = buildSerpApiFlightClient("   ", fetch);
  const result = await client.fetchFlight(VALID_REQUEST);

  assert.equal(result.observation, null);
  assert.equal(result.error, "provider_not_configured");
  assert.equal(callCount, 0);
});

// 7. HTTP status failure and thrown fetch never retry
test("returns http_failure and never retries on thrown fetch", async () => {
  let callCount = 0;
  const fetch = async () => {
    callCount += 1;
    throw new Error("network error");
  };

  const client = buildSerpApiFlightClient("test-api-key", fetch);
  const result = await client.fetchFlight(VALID_REQUEST);

  assert.equal(result.observation, null);
  assert.equal(result.error, "http_failure");
  assert.equal(callCount, 1);
});

test("returns http_failure without reading or retrying an initial non-success response", async () => {
  let callCount = 0;
  let jsonCallCount = 0;
  const fetch = async () => {
    callCount += 1;
    return {
      ok: false,
      status: 429,
      json: async () => {
        jsonCallCount += 1;
        return makeInitialResponse();
      },
    } as Response;
  };

  const client = buildSerpApiFlightClient("test-api-key", fetch);
  const result = await client.fetchFlight(VALID_REQUEST);

  assert.deepEqual(result, { observation: null, error: "http_failure" });
  assert.equal(callCount, 1);
  assert.equal(jsonCallCount, 0);
});

test("returns http_failure without reading or retrying a return non-success response", async () => {
  let callCount = 0;
  let returnJsonCallCount = 0;
  const fetch = async () => {
    callCount += 1;
    if (callCount === 1) {
      return mockJsonResponse(makeInitialResponse());
    }
    return {
      ok: false,
      status: 500,
      json: async () => {
        returnJsonCallCount += 1;
        return makeReturnResponse();
      },
    } as Response;
  };

  const client = buildSerpApiFlightClient("test-api-key", fetch);
  const result = await client.fetchFlight(VALID_REQUEST);

  assert.deepEqual(result, { observation: null, error: "http_failure" });
  assert.equal(callCount, 2);
  assert.equal(returnJsonCallCount, 0);
});

// 8. Successful response whose json() throws fails safely
test("returns malformed_initial_response when first json() throws", async () => {
  const fetch = async () =>
    ({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError("Unexpected token");
      },
    }) as unknown as Response;

  const client = buildSerpApiFlightClient("test-api-key", fetch);
  const result = await client.fetchFlight(VALID_REQUEST);

  assert.equal(result.observation, null);
  assert.equal(result.error, "malformed_initial_response");
});

test("returns malformed_return_response when second json() throws", async () => {
  let callCount = 0;
  const fetch = async () => {
    callCount += 1;
    if (callCount === 1) {
      return mockJsonResponse(makeInitialResponse());
    }
    return {
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError("Unexpected token");
      },
    } as unknown as Response;
  };

  const client = buildSerpApiFlightClient("test-api-key", fetch);
  const result = await client.fetchFlight(VALID_REQUEST);

  assert.equal(result.observation, null);
  assert.equal(result.error, "malformed_return_response");
});

// 9. JSON null / malformed initial response maps correctly
test("returns malformed_initial_response when JSON is null", async () => {
  const fetch = async () => mockJsonResponse(null);

  const client = buildSerpApiFlightClient("test-api-key", fetch);
  const result = await client.fetchFlight(VALID_REQUEST);

  assert.equal(result.observation, null);
  assert.equal(result.error, "malformed_initial_response");
});

test("returns malformed_initial_response when JSON is malformed object", async () => {
  const fetch = async () => mockJsonResponse({ wrong_key: true });

  const client = buildSerpApiFlightClient("test-api-key", fetch);
  const result = await client.fetchFlight(VALID_REQUEST);

  assert.equal(result.observation, null);
  assert.equal(result.error, "malformed_initial_response");
});

// 10. No eligible outbound makes no second request
test("makes no second request when no eligible outbound", async () => {
  let callCount = 0;
  const fetch = async () => {
    callCount += 1;
    return mockJsonResponse({ best_flights: [], other_flights: [] });
  };

  const client = buildSerpApiFlightClient("test-api-key", fetch);
  const result = await client.fetchFlight(VALID_REQUEST);

  assert.equal(result.observation, null);
  assert.equal(result.error, "no_eligible_outbound");
  assert.equal(callCount, 1);
});

// 11. Malformed return response maps correctly
test("returns malformed_return_response when return JSON is null", async () => {
  let callCount = 0;
  const fetch = async () => {
    callCount += 1;
    if (callCount === 1) {
      return mockJsonResponse(makeInitialResponse());
    }
    return mockJsonResponse(null);
  };

  const client = buildSerpApiFlightClient("test-api-key", fetch);
  const result = await client.fetchFlight(VALID_REQUEST);

  assert.equal(result.observation, null);
  assert.equal(result.error, "malformed_return_response");
});

// 12. Empty / no-compatible return maps correctly
test("returns no_compatible_return when return has no options", async () => {
  let callCount = 0;
  const fetch = async () => {
    callCount += 1;
    if (callCount === 1) {
      return mockJsonResponse(makeInitialResponse());
    }
    return mockJsonResponse({ best_flights: [], other_flights: [] });
  };

  const client = buildSerpApiFlightClient("test-api-key", fetch);
  const result = await client.fetchFlight(VALID_REQUEST);

  assert.equal(result.observation, null);
  assert.equal(result.error, "no_compatible_return");
});

// 13. Clock is called after both received responses
test("calls clock after both HTTP responses", async () => {
  const { fetch } = mockFetchSuccess(makeInitialResponse(), makeReturnResponse());

  let clockCallCount = 0;
  const clock = () => {
    clockCallCount += 1;
    return new Date("2026-09-15T23:00:00Z");
  };

  const client = buildSerpApiFlightClient("test-api-key", fetch, clock);
  const result = await client.fetchFlight(VALID_REQUEST);

  assert.equal(result.error, null);
  assert.equal(clockCallCount, 2);
});

// 14. Provider timestamps cannot override the injected clock
test("uses clock timestamps, not provider timestamps", async () => {
  const clockTime = new Date("2026-09-15T23:59:59Z");
  const { fetch } = mockFetchSuccess(makeInitialResponse(), makeReturnResponse());

  const clock = () => clockTime;

  const client = buildSerpApiFlightClient("test-api-key", fetch, clock);
  const result = await client.fetchFlight(VALID_REQUEST);

  assert.equal(result.error, null);
  assert.notEqual(result.observation, null);
  assert.equal(result.observation!.retrievedAt, clockTime.toISOString());
  assert.notEqual(result.observation!.retrievedAt, "2026-09-15T00:00:00.000Z");
});

// 15. $1,736, non-live, verification-required output
test("returns $1,736 party total with web_observed_not_live and verificationRequired", async () => {
  const { fetch } = mockFetchSuccess(
    makeInitialResponse(),
    makeReturnResponse({ price: 1736 }),
  );

  const client = buildSerpApiFlightClient("test-api-key", fetch);
  const result = await client.fetchFlight(VALID_REQUEST);

  assert.equal(result.error, null);
  assert.notEqual(result.observation, null);
  assert.deepEqual(result.observation!.price, { amount: 1736, currency: "USD" });
  assert.equal(result.observation!.priceCoverage, "searched_party_total");
  assert.equal(result.observation!.evidenceLevel, "web_observed_not_live");
  assert.equal(result.observation!.verificationRequired, true);
  assert.equal(result.observation!.travelers, 2);
});

// 16. Keys, tokens, URLs, raw metadata, booking tokens, search IDs never serialize
test("never exposes API key, tokens, URLs, raw metadata, or search IDs in result", async () => {
  const sensitiveToken = "SENSITIVE_DEPARTURE_TOKEN_123";
  const sensitiveApiKey = "SECRET_API_KEY_456";

  const { fetch } = mockFetchSuccess(
    makeInitialResponse({ departureToken: sensitiveToken }),
    makeReturnResponse(),
  );

  const client = buildSerpApiFlightClient(sensitiveApiKey, fetch);
  const result = await client.fetchFlight(VALID_REQUEST);

  assert.equal(result.error, null);
  const serialized = JSON.stringify(result);

  assert.ok(!serialized.includes(sensitiveApiKey), "API key must not serialize");
  assert.ok(!serialized.includes(sensitiveToken), "departure token must not serialize");
  assert.ok(!serialized.includes("https://"), "URLs must not serialize");
  assert.ok(!serialized.includes("search_id"), "search ID must not serialize");
  assert.ok(!serialized.includes("booking_token"), "booking token must not serialize");
  assert.ok(!serialized.includes("departure_token"), "departure_token key must not serialize");
  assert.ok(!serialized.includes("airline_logo"), "airline_logo must not serialize");
  assert.ok(!serialized.includes("other_flights"), "other_flights must not serialize");
});

for (const [label, origin, destination] of [
  ["city-to-airport", PARIS, AIRPORT_JFK],
  ["airport-to-city", AIRPORT_JFK, PARIS],
  ["city-to-city", PARIS, { searchId: "/g/new-york", kind: "city", acceptableAirportIds: ["JFK", "EWR"] }],
] as const) {
  test(`uses resolved search IDs and scopes for ${label} in both requests`, async () => {
    const urls: string[] = [];
    const { fetch } = mockFetchSuccess(
      makeInitialResponse({ flights: [makeFlightEntry({ depAirport: origin.acceptableAirportIds[0], depTime: VALID_REQUEST.outboundDate + " 10:30", arrAirport: destination.acceptableAirportIds[0], arrTime: VALID_REQUEST.outboundDate + " 22:45" })] }),
      makeReturnResponse({ flights: [makeFlightEntry({ depAirport: destination.acceptableAirportIds[0], depTime: VALID_REQUEST.returnDate + " 08:15", arrAirport: origin.acceptableAirportIds[0], arrTime: VALID_REQUEST.returnDate + " 11:00" })] }),
    );
    const client = buildSerpApiFlightClient("test-api-key", async (url, init) => {
      urls.push(url);
      return fetch(url, init);
    });
    const result = await client.fetchFlight({ ...VALID_REQUEST, origin, destination });
    assert.equal(result.error, null);
    assert.equal(urls.length, 2);
    for (const url of urls) {
      assert.ok(url.includes(`departure_id=${encodeURIComponent(origin.searchId)}`));
      assert.ok(url.includes(`arrival_id=${encodeURIComponent(destination.searchId)}`));
    }
  });
}

test("rejects malformed and overlapping resolved locations before fetching", async () => {
  let calls = 0;
  const client = buildSerpApiFlightClient("test-api-key", async () => {
    calls += 1;
    return mockJsonResponse(makeInitialResponse());
  });
  const invalidRequests: unknown[] = [
    { ...VALID_REQUEST, origin: { searchId: "/m/city", kind: "city", acceptableAirportIds: ["cdg"] } },
    { ...VALID_REQUEST, origin: { searchId: "/m/city", kind: "city", acceptableAirportIds: [] } },
    { ...VALID_REQUEST, origin: { searchId: "/m/city", kind: "city", acceptableAirportIds: ["CDG", "CDG"] } },
    { ...VALID_REQUEST, origin: { searchId: "/m/city", kind: "city", acceptableAirportIds: Array(13).fill("CDG") } },
    { ...VALID_REQUEST, origin: { searchId: "JFK", kind: "airport", acceptableAirportIds: ["JFK", "EWR"] } },
    { ...VALID_REQUEST, origin: PARIS, destination: { searchId: "/g/other", kind: "city", acceptableAirportIds: ["CDG"] } },
  ];
  for (const invalid of invalidRequests) {
    assert.deepEqual(await client.fetchFlight(invalid), { observation: null, error: "invalid_request" });
  }
  assert.equal(calls, 0);
});

test("accepts a city outbound endpoint only when the reversed return is also scoped", async () => {
  const { fetch } = mockFetchSuccess(
    makeInitialResponse({ flights: [makeFlightEntry({ depAirport: "JFK", depTime: "2026-09-15 10:30", arrAirport: "CDG", arrTime: "2026-09-15 22:45" })] }),
    makeReturnResponse({ flights: [makeFlightEntry({ depAirport: "CDG", depTime: "2026-09-22 08:15", arrAirport: "JFK", arrTime: "2026-09-22 11:00" })] }),
  );
  const result = await buildSerpApiFlightClient("test-api-key", fetch).fetchFlight({ ...VALID_REQUEST, destination: PARIS });
  assert.equal(result.error, null);
  assert.equal(result.observation?.origin, "JFK");
  assert.equal(result.observation?.destination, "CDG");
  assert.equal(result.observation?.price.amount, 1736);
});

for (const airport of ["CDG", "ORY"]) {
  test(`accepts ${airport} as a city-scoped endpoint and rejects an out-of-scope endpoint`, async () => {
    const { fetch } = mockFetchSuccess(
      makeInitialResponse({ flights: [makeFlightEntry({ depAirport: "JFK", depTime: "2026-09-15 10:30", arrAirport: airport, arrTime: "2026-09-15 22:45" })] }),
      makeReturnResponse({ flights: [makeFlightEntry({ depAirport: airport, depTime: "2026-09-22 08:15", arrAirport: "JFK", arrTime: "2026-09-22 11:00" })] }),
    );
    const result = await buildSerpApiFlightClient("test-api-key", fetch).fetchFlight({ ...VALID_REQUEST, destination: PARIS });
    assert.equal(result.error, null);

    const outOfScope = await buildSerpApiFlightClient("test-api-key", mockFetchSuccess(
      makeInitialResponse({ flights: [makeFlightEntry({ depAirport: "JFK", depTime: "2026-09-15 10:30", arrAirport: "LHR", arrTime: "2026-09-15 22:45" })] }),
      makeReturnResponse(),
    ).fetch).fetchFlight({ ...VALID_REQUEST, destination: PARIS });
    assert.equal(outOfScope.error, "no_eligible_outbound");
  });
}

test("uses a private location snapshot when caller locations mutate during the initial request", async () => {
  const origin = { searchId: "/m/new-york", kind: "city" as const, acceptableAirportIds: ["JFK", "EWR"] };
  const destination = { searchId: "/g/paris", kind: "city" as const, acceptableAirportIds: ["CDG", "ORY"] };
  const token = "PRIVATE_DEPARTURE_TOKEN";
  const mutatedSearchId = "/m/mutated-city";
  const mutatedAirport = "LHR";
  const urls: string[] = [];
  let calls = 0;
  const fetch = async (url: string) => {
    urls.push(url);
    calls += 1;
    if (calls === 1) {
      origin.searchId = mutatedSearchId;
      origin.acceptableAirportIds.splice(0, origin.acceptableAirportIds.length, mutatedAirport);
      destination.searchId = "/g/mutated-destination";
      destination.acceptableAirportIds.splice(0, destination.acceptableAirportIds.length, mutatedAirport);
      return mockJsonResponse(makeInitialResponse({
        departureToken: token,
        flights: [makeFlightEntry({ depAirport: "JFK", depTime: "2026-09-15 10:30", arrAirport: "CDG", arrTime: "2026-09-15 22:45" })],
      }));
    }
    return mockJsonResponse(makeReturnResponse({
      flights: [makeFlightEntry({ depAirport: "CDG", depTime: "2026-09-22 08:15", arrAirport: "JFK", arrTime: "2026-09-22 11:00" })],
    }));
  };

  const result = await buildSerpApiFlightClient("test-api-key", fetch).fetchFlight({
    ...VALID_REQUEST,
    origin,
    destination,
  });

  assert.equal(result.error, null);
  assert.equal(calls, 2);
  assert.ok(urls[1].includes("departure_id=%2Fm%2Fnew-york"));
  assert.ok(urls[1].includes("arrival_id=%2Fg%2Fparis"));
  assert.ok(!urls[1].includes(encodeURIComponent(mutatedSearchId)));
  assert.equal(result.observation?.origin, "JFK");
  assert.equal(result.observation?.destination, "CDG");
  const serialized = JSON.stringify(result);
  for (const sensitive of [mutatedSearchId, mutatedAirport, token, "https://", "departure_token", "other_flights"]) {
    assert.ok(!serialized.includes(sensitive));
  }
});
