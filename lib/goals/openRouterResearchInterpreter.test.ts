import { test } from "node:test";
import assert from "node:assert/strict";

import type { Goal } from "./types";
import type { ResearchResponse, ResearchResult } from "./researchTypes";
import {
  OpenRouterResearchInterpreter,
} from "./openRouterResearchInterpreter";
import {
  ResearchInterpreterError,
  RESEARCH_OUTPUT_JSON_SCHEMA,
  type InterpretResearchInput,
} from "./researchInterpreter";

const ORIGINAL_ENV = { ...process.env };

function restoreEnv(): void {
  process.env = { ...ORIGINAL_ENV };
}

const goal: Goal = {
  id: "goal-1",
  userId: "user-1",
  type: "travel",
  title: "Trip to Europe",
  status: "active",
  origin: ["JFK"],
  destinations: ["CDG"],
  earliestDeparture: "2027-06-01",
  latestReturn: "2027-06-15",
  minimumNights: 10,
  maximumNights: 14,
  travelerCount: 2,
  cabinPreference: "economy",
  optimizationPriority: "balanced",
  maximumCashBudget: 500,
  currency: "USD",
  allowNewCards: true,
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-01T00:00:00.000Z",
};

const rewardPrograms = [
  { id: "program-1", name: "Program One" },
  { id: "program-2", name: "Program Two" },
];

function makeResearchResult(
  title: string,
  url: string,
  content: string,
  score: number | null = null,
  publishedDate: string | null = null,
  sourceTier: "official" | "specialist" | "general" = "general"
): ResearchResult {
  return {
    title,
    url,
    content,
    score,
    publishedDate,
    sourceTier,
  };
}

function makeResearchResponse(
  query: string,
  results: ResearchResult[],
  searchedAt: string = new Date().toISOString()
): ResearchResponse {
  return {
    query,
    results,
    searchedAt,
  };
}

function makeInput(
  overrides: Partial<InterpretResearchInput> = {}
): InterpretResearchInput {
  return {
    goal,
    rewardPrograms,
    research: [],
    focus: "award_options",
    ...overrides,
  };
}

interface FetchCall {
  url: string;
  init: RequestInit;
}

function stubFetch(
  onFetch: (url: string, init: RequestInit) => Promise<Response> | Response
): void {
  const mockFetch = async (url: string, init: RequestInit) => {
    return await onFetch(url, init);
  };

  globalThis.fetch = mockFetch as typeof fetch;
}

function okJsonResponse(
  model: string,
  content: string,
  status = 200
): Response {
  return {
    ok: true,
    status,
    json: async () => ({
      model,
      choices: [{ message: { content } }],
    }),
  } as unknown as Response;
}

const VALID_MODEL_CONTENT = JSON.stringify({
  awardOptions: [
    {
      id: "award-1",
      sourceId: "http://example.com/award",
      programName: "Air France Flying Blue",
      redemptionType: "flight",
      pricingBasis: "round_trip",
      itineraryLabel: "JFK-CDG round trip",
      pointsRequired: 120000,
      cashFees: 200,
      seats: 4,
      cabin: "economy",
      transferFromProgramId: null,
      transferRatio: null,
      centsPerPoint: null,
      availabilityStatus: "unknown",
    },
  ],
  cardOffers: [],
  assumptions: [],
  warnings: [],
});

test("successful request posts to OpenRouter and validates content", async () => {
  restoreEnv();
  process.env.OPENROUTER_API_KEY = "test-key";
  process.env.OPENROUTER_RESEARCH_MODEL = "test/research-model";

  const input = makeInput({
    goal: {
      ...goal,
      title: "UNIQUE_HONEYMOON_VENICE_2027",
      origin: ["UNIQUE_ORIGIN_AIRPORT"],
      destinations: ["UNIQUE_DEST_AIRPORT"],
      earliestDeparture: "2027-07-01",
      latestReturn: "2027-07-15",
    },
    research: [
      makeResearchResponse("query-1", [
        makeResearchResult(
          "Award chart",
          "http://example.com/award",
          "Air France Flying Blue offers JFK-CDG round trip for 120000 points with $200 fees. 4 seats available in economy.",
          0.9,
          "2026-08-20T00:00:00.000Z",
          "official"
        ),
      ]),
    ],
    rewardPrograms: [{ id: "af-flying-blue", name: "Air France Flying Blue" }],
  });

  let capturedCall: FetchCall | null = null;

  stubFetch((url, init) => {
    capturedCall = { url, init };
    return okJsonResponse("test/response-model", VALID_MODEL_CONTENT);
  });

  const interpreter = new OpenRouterResearchInterpreter();
  const result = await interpreter.interpret(input);

  if (capturedCall === null) {
    assert.fail("fetch should be called");
  }
  const call: FetchCall = capturedCall;
  assert.equal(call.url, "https://openrouter.ai/api/v1/chat/completions");
  assert.equal(call.init.method, "POST");

  const headers = call.init.headers as Record<string, string>;
  assert.equal(headers.Authorization, "Bearer test-key");
  assert.equal(headers["Content-Type"], "application/json");

  const body = JSON.parse(call.init.body as string);
  assert.equal(body.model, "test/research-model");
  assert.equal(body.temperature, 0);
  assert.equal(body.provider.require_parameters, true);
  assert.equal(body.response_format.type, "json_schema");
  assert.equal(body.response_format.json_schema.name, "finance_buddy_research");
  assert.equal(body.response_format.json_schema.strict, true);
  assert.deepEqual(
    body.response_format.json_schema.schema,
    JSON.parse(JSON.stringify(RESEARCH_OUTPUT_JSON_SCHEMA))
  );

  assert.equal(body.messages.length, 2);
  assert.equal(body.messages[0].role, "system");
  assert.ok(
    body.messages[0].content.includes(
      "You are a strict research interpreter. You convert supplied"
    )
  );
  assert.ok(
    body.messages[0].content.includes(
      "Research focus is award_options: extract supported award options only"
    )
  );

  const userPayload = JSON.parse(body.messages[1].content);
  assert.equal(userPayload.focus, "award_options");
  assert.deepEqual(userPayload.rewardPrograms, [
    { name: "Air France Flying Blue" },
  ]);
  assert.equal(userPayload.goal.travelerCount, 2);
  assert.equal(userPayload.goal.minimumNights, 10);
  assert.equal(userPayload.research.length, 1);
  assert.equal(userPayload.research[0].requestRef, "research-1");
  assert.equal(userPayload.research[0].results[0].excerpt.length > 0, true);

  const serializedUser = JSON.stringify(userPayload);
  assert.ok(!serializedUser.includes("UNIQUE_HONEYMOON_VENICE_2027"));
  assert.ok(serializedUser.includes("UNIQUE_ORIGIN_AIRPORT"));
  assert.ok(serializedUser.includes("UNIQUE_DEST_AIRPORT"));
  assert.ok(serializedUser.includes("2027-07-01"));
  assert.ok(serializedUser.includes("2027-07-15"));
  assert.ok(!serializedUser.includes("query-1"));

  assert.equal(result.awardOptions.length, 1);
  assert.equal(result.awardOptions[0].programName, "Air France Flying Blue");
  assert.equal(result.awardOptions[0].pointsRequired, 120000);
});

test("missing API key fails before fetch", async () => {
  restoreEnv();
  delete process.env.OPENROUTER_API_KEY;
  delete process.env.OPENROUTER_RESEARCH_MODEL;

  let fetchCalled = false;
  stubFetch(() => {
    fetchCalled = true;
    return okJsonResponse("test/response-model", VALID_MODEL_CONTENT);
  });

  assert.throws(
    () => new OpenRouterResearchInterpreter(),
    (error: unknown) => {
      assert.ok(error instanceof ResearchInterpreterError);
      assert.equal((error as ResearchInterpreterError).provider, "openrouter");
      assert.match((error as Error).message, /OPENROUTER_API_KEY environment variable is required/);
      return true;
    }
  );

  assert.equal(fetchCalled, false);
});

test("blank API key fails before fetch", async () => {
  restoreEnv();
  process.env.OPENROUTER_API_KEY = "   ";
  delete process.env.OPENROUTER_RESEARCH_MODEL;

  let fetchCalled = false;
  stubFetch(() => {
    fetchCalled = true;
    return okJsonResponse("test/response-model", VALID_MODEL_CONTENT);
  });

  assert.throws(
    () => new OpenRouterResearchInterpreter(),
    (error: unknown) => {
      assert.ok(error instanceof ResearchInterpreterError);
      assert.match((error as Error).message, /OPENROUTER_API_KEY environment variable is required/);
      return true;
    }
  );

  assert.equal(fetchCalled, false);
});

test("non-2xx response becomes a safe ResearchInterpreterError", async () => {
  restoreEnv();
  process.env.OPENROUTER_API_KEY = "test-key";
  process.env.OPENROUTER_RESEARCH_MODEL = "test/research-model";

  const input = makeInput();

  stubFetch(() => {
    return {
      ok: false,
      status: 429,
      json: async () => ({ error: "secret response body" }),
    } as unknown as Response;
  });

  const interpreter = new OpenRouterResearchInterpreter();

  await assert.rejects(
    () => interpreter.interpret(input),
    (error: unknown) => {
      assert.ok(error instanceof ResearchInterpreterError);
      assert.match((error as Error).message, /HTTP 429/);
      assert.ok(!(error as Error).message.includes("secret response body"));
      return true;
    }
  );
});

test("missing choices[0].message.content is rejected", async () => {
  restoreEnv();
  process.env.OPENROUTER_API_KEY = "test-key";
  process.env.OPENROUTER_RESEARCH_MODEL = "test/research-model";

  const input = makeInput();

  stubFetch(() => {
    return {
      ok: true,
      status: 200,
      json: async () => ({ model: "test/response-model", choices: [] }),
    } as unknown as Response;
  });

  const interpreter = new OpenRouterResearchInterpreter();

  await assert.rejects(
    () => interpreter.interpret(input),
    (error: unknown) => {
      assert.ok(error instanceof ResearchInterpreterError);
      assert.match((error as Error).message, /missing the model text output/);
      return true;
    }
  );
});

test("shared validation errors remain ResearchInterpreterError instances", async () => {
  restoreEnv();
  process.env.OPENROUTER_API_KEY = "test-key";
  process.env.OPENROUTER_RESEARCH_MODEL = "test/research-model";

  const input = makeInput({
    research: [
      makeResearchResponse("query-1", [
        makeResearchResult("Title", "http://example.com", "Content"),
      ]),
    ],
  });

  const invalidContent = JSON.stringify({
    awardOptions: [
      {
        id: "award-1",
        sourceId: "http://unknown.com",
        programName: "Test Program",
        redemptionType: "flight",
        pricingBasis: "round_trip",
        itineraryLabel: "JFK-CDG round trip",
        pointsRequired: 120000,
        cashFees: 200,
        seats: 4,
        cabin: "economy",
        transferFromProgramId: null,
        transferRatio: null,
        centsPerPoint: null,
        availabilityStatus: "unknown",
      },
    ],
    cardOffers: [],
    assumptions: [],
    warnings: [],
  });

  stubFetch(() => okJsonResponse("test/response-model", invalidContent));

  const interpreter = new OpenRouterResearchInterpreter();

  await assert.rejects(
    () => interpreter.interpret(input),
    (error: unknown) => {
      assert.ok(error instanceof ResearchInterpreterError);
      assert.match((error as Error).message, /references unknown source/);
      return true;
    }
  );
});
