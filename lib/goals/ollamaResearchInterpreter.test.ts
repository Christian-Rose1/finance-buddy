import { test } from "node:test";
import assert from "node:assert/strict";

import type { Goal } from "./types";
import type { ResearchResponse, ResearchResult } from "./researchTypes";
import { OllamaResearchInterpreter, ResearchInterpreterError, type InterpretResearchInput } from "./ollamaResearchInterpreter";
import type {
  StrategyAwardOption,
  StrategyCardOffer,
  StrategySource,
} from "./strategyTypes";

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

const rewardPrograms = ["program-1", "program-2"];

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
    ...overrides,
  };
}

function stubFetch(
  content: string,
  onCalled?: (url: string, init: RequestInit) => void
): void {
  const mockFetch = async (url: string, init: RequestInit) => {
    onCalled?.(url, init);

    return {
      ok: true,
      status: 200,
      json: async () => ({
        message: {
          content,
        },
      }),
    } as unknown as Response;
  };

  globalThis.fetch = mockFetch as typeof fetch;
}

test("sends goal, programs, and research evidence to Ollama", async () => {
  restoreEnv();

  const input = makeInput({
    research: [
      makeResearchResponse("query-1", [
        makeResearchResult("Title 1", "http://example.com/1", "Content 1"),
      ]),
    ],
  });

  let capturedBody: string | null = null;

  stubFetch(JSON.stringify({
    awardOptions: [],
    cardOffers: [],
    assumptions: [],
    warnings: [],
  }), (_url, init) => {
    capturedBody = typeof init.body === "string" ? init.body : null;
  });

  const interpreter = new OllamaResearchInterpreter(
    "http://localhost:11434",
    "test-model"
  );

  await interpreter.interpret(input);

  assert.ok(capturedBody, "fetch body should be captured");

  const body = JSON.parse(capturedBody as string);

  assert.equal(body.model, "test-model");
  assert.equal(body.messages.length, 2);
  assert.equal(body.messages[0].role, "system");
  assert.equal(body.messages[1].role, "user");

  const sentContext = JSON.parse(body.messages[1].content);
  assert.deepEqual(sentContext.goal, goal);
  assert.deepEqual(sentContext.rewardPrograms, rewardPrograms);
  assert.equal(sentContext.sources.length, 1);
  assert.equal(sentContext.sources[0].id, "http://example.com/1");
  assert.equal(sentContext.sources[0].label, "Title 1");
  assert.equal(sentContext.sources[0].url, "http://example.com/1");
  assert.equal(sentContext.sources[0].content, "Content 1");
});

test("maps valid sourced output", async () => {
  restoreEnv();

  const input = makeInput({
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
    rewardPrograms: ["Air France Flying Blue"],
  });

  const awardOptionJson = JSON.stringify({
    awardOptions: [
      {
        id: "award-1",
        sourceId: "http://example.com/award",
        programName: "Air France Flying Blue",
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
    assumptions: ["Points required are based on published award chart"],
    warnings: [],
  });

  stubFetch(awardOptionJson);

  const interpreter = new OllamaResearchInterpreter(
    "http://localhost:11434",
    "test-model"
  );

  const result = await interpreter.interpret(input);

  assert.equal(result.awardOptions.length, 1);
  const awardOption = result.awardOptions[0];
  assert.equal(awardOption.id, "award-1");
  assert.equal(awardOption.sourceId, "http://example.com/award");
  assert.equal(awardOption.programName, "Air France Flying Blue");
  assert.equal(awardOption.itineraryLabel, "JFK-CDG round trip");
  assert.equal(awardOption.pointsRequired, 120000);
  assert.equal(awardOption.cashFees, 200);
  assert.equal(awardOption.seats, 4);
  assert.equal(awardOption.cabin, "economy");
  assert.equal(awardOption.transferFromProgramId, null);
  assert.equal(awardOption.transferRatio, null);
  assert.equal(awardOption.centsPerPoint, null);
  assert.equal(awardOption.availabilityStatus, "unknown");
  assert.equal(result.assumptions.length, 1);
  assert.equal(result.assumptions[0], "Points required are based on published award chart");
  assert.equal(result.warnings.length, 0);
  assert.equal(result.sources.length, 1);
  assert.equal(result.sources[0].id, "http://example.com/award");
  assert.equal(result.sources[0].label, "Award chart");
  assert.equal(result.sources[0].observedAt, "2026-08-20T00:00:00.000Z");
});

test("rejects malformed JSON", async () => {
  restoreEnv();

  const input = makeInput({
    research: [
      makeResearchResponse("query-1", [
        makeResearchResult("Title", "http://example.com", "Content"),
      ]),
    ],
  });

  stubFetch("this is not json");

  const interpreter = new OllamaResearchInterpreter(
    "http://localhost:11434",
    "test-model"
  );

  await assert.rejects(
    () => interpreter.interpret(input),
    (error: unknown) => {
      assert.ok(error instanceof ResearchInterpreterError);
      assert.match((error as Error).message, /did not return valid JSON/);
      return true;
    }
  );
});

test("rejects unknown source IDs", async () => {
  restoreEnv();

  const input = makeInput({
    research: [
      makeResearchResponse("query-1", [
        makeResearchResult("Title", "http://example.com", "Content"),
      ]),
    ],
  });

  const awardOptionJson = JSON.stringify({
    awardOptions: [
      {
        id: "award-1",
        sourceId: "http://unknown.com", // Unknown source
        programName: "Test Program",
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

  stubFetch(awardOptionJson);

  const interpreter = new OllamaResearchInterpreter(
    "http://localhost:11434",
    "test-model"
  );

  await assert.rejects(
    () => interpreter.interpret(input),
    (error: unknown) => {
      assert.ok(error instanceof ResearchInterpreterError);
      assert.match((error as Error).message, /references unknown source/);
      return true;
    }
  );
});

test("rejects unknown program IDs", async () => {
  restoreEnv();

  const input = makeInput({
    research: [
      makeResearchResponse("query-1", [
        makeResearchResult("Title", "http://example.com", "Content"),
      ]),
    ],
  });

  const awardOptionJson = JSON.stringify({
    awardOptions: [
      {
        id: "award-1",
        sourceId: "http://example.com",
        programName: "Unknown Program", // Unknown program
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

  stubFetch(awardOptionJson);

  const interpreter = new OllamaResearchInterpreter(
    "http://localhost:11434",
    "test-model"
  );

  await assert.rejects(
    () => interpreter.interpret(input),
    (error: unknown) => {
      assert.ok(error instanceof ResearchInterpreterError);
      assert.match((error as Error).message, /references program/);
      return true;
    }
  );
});

test("rejects unsupported/invented numeric claims", async () => {
  restoreEnv();

  const input = makeInput({
    research: [
      makeResearchResponse("query-1", [
        makeResearchResult(
          "Content with 100 points",
          "http://example.com",
          "The award costs 100 points.",
          0.9,
          null,
          "official"
        ),
      ]),
    ],
    rewardPrograms: ["Test Program"],
  });

  // Trying to claim 200 points when source only mentions 100
  const awardOptionJson = JSON.stringify({
    awardOptions: [
      {
        id: "award-1",
        sourceId: "http://example.com",
        programName: "Test Program",
        itineraryLabel: "Test trip",
        pointsRequired: 200, // Not in source content
        cashFees: 0,
        seats: 1,
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

  stubFetch(awardOptionJson);

  const interpreter = new OllamaResearchInterpreter(
    "http://localhost:11434",
    "test-model"
  );

  await assert.rejects(
    () => interpreter.interpret(input),
    (error: unknown) => {
      assert.ok(error instanceof ResearchInterpreterError);
      assert.match((error as Error).message, /is not supported by the cited source content/);
      return true;
    }
  );
});

test("rejects unsourced award options", async () => {
  restoreEnv();

  const input = makeInput({
    research: [
      makeResearchResponse("query-1", [
        makeResearchResult("Title", "http://example.com", "Content"),
      ]),
    ],
  });

  const awardOptionJson = JSON.stringify({
    awardOptions: [
      {
        id: "award-1",
        sourceId: "", // Empty source ID
        programName: "Test Program",
        itineraryLabel: "Test trip",
        pointsRequired: 100,
        cashFees: 0,
        seats: 1,
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

  stubFetch(awardOptionJson);

  const interpreter = new OllamaResearchInterpreter(
    "http://localhost:11434",
    "test-model"
  );

  await assert.rejects(
    () => interpreter.interpret(input),
    (error: unknown) => {
      assert.ok(error instanceof ResearchInterpreterError);
      assert.match((error as Error).message, /references unknown source/);
      return true;
    }
  );
});

test("rejects card offers when allowNewCards=false", async () => {
  restoreEnv();

  const input = makeInput({
    goal: {
      ...goal,
      allowNewCards: false,
    },
    research: [
      makeResearchResponse("query-1", [
        makeResearchResult("Title", "http://example.com", "Content"),
      ]),
    ],
  });

  const cardOfferJson = JSON.stringify({
    awardOptions: [],
    cardOffers: [
      {
        id: "card-1",
        sourceId: "http://example.com",
        cardName: "Test Card",
        issuer: "Test Bank",
        welcomeBonusPoints: 50000,
        spendingRequirement: 3000,
        spendingDeadlineMonths: 3,
        annualFee: 95,
        destinationProgramId: "program-1",
      },
    ],
    assumptions: [],
    warnings: [],
  });

  stubFetch(cardOfferJson);

  const interpreter = new OllamaResearchInterpreter(
    "http://localhost:11434",
    "test-model"
  );

  await assert.rejects(
    () => interpreter.interpret(input),
    (error: unknown) => {
      assert.ok(error instanceof ResearchInterpreterError);
      assert.match((error as Error).message, /goal.allowNewCards is false/);
      return true;
    }
  );
});

test("preserves ranges/incomplete information without inventing exact values", async () => {
  restoreEnv();

  const input = makeInput({
    research: [
      makeResearchResponse(
        "query-1",
        [
          makeResearchResult(
            "Range content",
            "http://example.com",
            "The award costs between 100000 and 150000 points.",
            0.8,
            null,
            "official"
          ),
        ],
        "2026-08-20T00:00:00.000Z"
      ),
    ],
    rewardPrograms: ["Test Program"],
  });

  // Model should not invent exact values from a range
  const awardOptionJson = JSON.stringify({
    awardOptions: [
      {
        id: "award-1",
        sourceId: "http://example.com",
        programName: "Test Program",
        itineraryLabel: "Test trip",
        pointsRequired: 125000, // Exact value not in source (should be rejected)
        cashFees: 0,
        seats: 1,
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

  stubFetch(awardOptionJson);

  const interpreter = new OllamaResearchInterpreter(
    "http://localhost:11434",
    "test-model"
  );

  await assert.rejects(
    () => interpreter.interpret(input),
    (error: unknown) => {
      assert.ok(error instanceof ResearchInterpreterError);
      assert.match((error as Error).message, /is not supported by the cited source content/);
      return true;
    }
  );
});

test("does not mutate input", async () => {
  restoreEnv();

  const input = makeInput({
    research: [
      makeResearchResponse("query-1", [
        makeResearchResult("Title", "http://example.com", "The award costs 100 points. 1 seats available in economy. 0 fees."),
      ]),
    ],
    rewardPrograms: ["Test Program"],
  });

  const inputCopy = JSON.stringify(input);

  const awardOptionJson = JSON.stringify({
    awardOptions: [
      {
        id: "award-1",
        sourceId: "http://example.com",
        programName: "Test Program",
        itineraryLabel: "Test trip",
        pointsRequired: 100,
        cashFees: 0,
        seats: 1,
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

  stubFetch(awardOptionJson);

  const interpreter = new OllamaResearchInterpreter(
    "http://localhost:11434",
    "test-model"
  );

  await interpreter.interpret(input);

  assert.equal(JSON.stringify(input), inputCopy);
});

test("missing Ollama configuration returns a safe error", async () => {
  restoreEnv();
  delete process.env.OLLAMA_BASE_URL;
  delete process.env.OLLAMA_STRATEGY_MODEL;

  const input = makeInput({
    research: [
      makeResearchResponse("query-1", [
        makeResearchResult("Title", "http://example.com", "Content"),
      ]),
    ],
  });

  assert.throws(
    () => new OllamaResearchInterpreter(),
    (error: unknown) => {
      assert.ok(error instanceof ResearchInterpreterError);
      assert.match((error as Error).message, /OLLAMA_BASE_URL environment variable is required/);
      return true;
    }
  );

  restoreEnv();
  process.env.OLLAMA_BASE_URL = "http://localhost:11434";
  delete process.env.OLLAMA_STRATEGY_MODEL;

  assert.throws(
    () => new OllamaResearchInterpreter(),
    (error: unknown) => {
      assert.ok(error instanceof ResearchInterpreterError);
      assert.match((error as Error).message, /OLLAMA_STRATEGY_MODEL environment variable is required/);
      return true;
    }
  );
});

test("comma-formatted exact number accepted", async () => {
  restoreEnv();

  const input = makeInput({
    research: [
      makeResearchResponse("query-1", [
        makeResearchResult(
          "Comma source",
          "http://example.com/comma",
          "The bonus points offer is 60,000 points. 1 seats available. 0 cash fees.",
          0.9,
          null,
          "official"
        ),
      ]),
    ],
    rewardPrograms: ["Test Program"],
  });

  const awardOptionJson = JSON.stringify({
    awardOptions: [
      {
        id: "award-1",
        sourceId: "http://example.com/comma",
        programName: "Test Program",
        itineraryLabel: "Test trip",
        pointsRequired: 60000,
        cashFees: 0,
        seats: 1,
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

  stubFetch(awardOptionJson);

  const interpreter = new OllamaResearchInterpreter(
    "http://localhost:11434",
    "test-model"
  );

  const result = await interpreter.interpret(input);
  assert.equal(result.awardOptions[0].pointsRequired, 60000);
});

test("numeric substring rejected", async () => {
  restoreEnv();

  const input = makeInput({
    research: [
      makeResearchResponse("query-1", [
        makeResearchResult(
          "Comma source",
          "http://example.com/comma",
          "The bonus points offer is 60,000 points. Also 1,500 cash.",
          0.9,
          null,
          "official"
        ),
      ]),
    ],
    rewardPrograms: ["Test Program"],
  });

  // Try to use substring 60 from 60,000
  const awardOptionJson1 = JSON.stringify({
    awardOptions: [
      {
        id: "award-1",
        sourceId: "http://example.com/comma",
        programName: "Test Program",
        itineraryLabel: "Test trip",
        pointsRequired: 60,
        cashFees: 0,
        seats: 1,
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

  stubFetch(awardOptionJson1);

  const interpreter = new OllamaResearchInterpreter(
    "http://localhost:11434",
    "test-model"
  );

  await assert.rejects(
    () => interpreter.interpret(input),
    (error: unknown) => {
      assert.ok(error instanceof ResearchInterpreterError);
      assert.match((error as Error).message, /is not supported by the cited source content/);
      return true;
    }
  );

  // Try to use substring 500 from 1,500
  const awardOptionJson2 = JSON.stringify({
    awardOptions: [
      {
        id: "award-2",
        sourceId: "http://example.com/comma",
        programName: "Test Program",
        itineraryLabel: "Test trip",
        pointsRequired: 500,
        cashFees: 0,
        seats: 1,
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

  stubFetch(awardOptionJson2);

  await assert.rejects(
    () => interpreter.interpret(input),
    (error: unknown) => {
      assert.ok(error instanceof ResearchInterpreterError);
      assert.match((error as Error).message, /is not supported by the cited source content/);
      return true;
    }
  );
});

test("availabilityStatus=available rejected", async () => {
  restoreEnv();

  const input = makeInput({
    research: [
      makeResearchResponse("query-1", [
        makeResearchResult(
          "Award source",
          "http://example.com/award",
          "Air France has 100 points. 1 seats available. 0 cash fees.",
          0.9,
          null,
          "official"
        ),
      ]),
    ],
    rewardPrograms: ["Test Program"],
  });

  const awardOptionJson = JSON.stringify({
    awardOptions: [
      {
        id: "award-1",
        sourceId: "http://example.com/award",
        programName: "Test Program",
        itineraryLabel: "Test trip",
        pointsRequired: 100,
        cashFees: 0,
        seats: 1,
        cabin: "economy",
        transferFromProgramId: null,
        transferRatio: null,
        centsPerPoint: null,
        availabilityStatus: "available", // forbidden!
      },
    ],
    cardOffers: [],
    assumptions: [],
    warnings: [],
  });

  stubFetch(awardOptionJson);

  const interpreter = new OllamaResearchInterpreter(
    "http://localhost:11434",
    "test-model"
  );

  await assert.rejects(
    () => interpreter.interpret(input),
    (error: unknown) => {
      assert.ok(error instanceof ResearchInterpreterError);
      assert.match((error as Error).message, /availabilityStatus "available", which is rejected/);
      return true;
    }
  );
});

test("card offer with missing/unknown sourceId rejected", async () => {
  restoreEnv();

  const input = makeInput({
    research: [
      makeResearchResponse("query-1", [
        makeResearchResult(
          "Card source",
          "http://example.com/card",
          "Earn 50000 points after spending 3000 dollars. Annual fee 95.",
          0.9,
          null,
          "official"
        ),
      ]),
    ],
    rewardPrograms: ["program-1"],
  });

  // missing/unknown sourceId
  const cardOfferJson = JSON.stringify({
    awardOptions: [],
    cardOffers: [
      {
        id: "card-1",
        sourceId: "http://unknown-source.com", // unknown!
        cardName: "Test Card",
        issuer: "Test Bank",
        welcomeBonusPoints: 50000,
        spendingRequirement: 3000,
        spendingDeadlineMonths: 3,
        annualFee: 95,
        destinationProgramId: "program-1",
      },
    ],
    assumptions: [],
    warnings: [],
  });

  stubFetch(cardOfferJson);

  const interpreter = new OllamaResearchInterpreter(
    "http://localhost:11434",
    "test-model"
  );

  await assert.rejects(
    () => interpreter.interpret(input),
    (error: unknown) => {
      assert.ok(error instanceof ResearchInterpreterError);
      assert.match((error as Error).message, /references unknown source/);
      return true;
    }
  );
});
