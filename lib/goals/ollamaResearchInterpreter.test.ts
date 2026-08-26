import { test } from "node:test";
import assert from "node:assert/strict";

import type { Goal } from "./types";
import type { ResearchResponse, ResearchResult } from "./researchTypes";
import { OllamaResearchInterpreter, ResearchInterpreterError, type InterpretResearchInput, buildPublicResearchPayload, validateResearchModelContent } from "./ollamaResearchInterpreter";
import type { ResearchInterpreter } from "./researchInterpreter";
import { RESEARCH_OUTPUT_JSON_SCHEMA } from "./researchInterpreter";
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

function makeAwardOptionContent(
  redemptionType: string,
  pricingBasis: string,
  optionId = "award-1",
  sourceUrl = "http://example.com/award"
): string {
  return JSON.stringify({
    awardOptions: [
      {
        id: optionId,
        sourceId: sourceUrl,
        programName: "Test Program",
        redemptionType,
        pricingBasis,
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

  const userContent = body.messages[1].content as string;
  const jsonPart = userContent.split("\n")[0];
  const sentContext = JSON.parse(jsonPart);
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
    rewardPrograms: [{ id: "af-flying-blue", name: "Air France Flying Blue" }],
  });

  const awardOptionJson = JSON.stringify({
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
  assert.equal(awardOption.redemptionType, "flight");
  assert.equal(awardOption.pricingBasis, "round_trip");
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

test("maps valid sourced output with null cashFees and seats", async () => {
  restoreEnv();

  const input = makeInput({
    research: [
      makeResearchResponse("query-1", [
        makeResearchResult(
          "Award chart",
          "http://example.com/award",
          "Air France Flying Blue offers JFK-CDG round trip for 120000 points in economy.",
          0.9,
          "2026-08-20T00:00:00.000Z",
          "official"
        ),
      ]),
    ],
    rewardPrograms: [{ id: "af-flying-blue", name: "Air France Flying Blue" }],
  });

  const awardOptionJson = JSON.stringify({
    awardOptions: [
      {
        id: "award-1",
        sourceId: "http://example.com/award",
        programName: "Air France Flying Blue",
        redemptionType: "flight",
        pricingBasis: "round_trip",
        itineraryLabel: "JFK-CDG round trip",
        pointsRequired: 120000,
        cashFees: null,
        seats: null,
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
  assert.equal(awardOption.pointsRequired, 120000);
  assert.equal(awardOption.cashFees, null);
  assert.equal(awardOption.seats, null);
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
        redemptionType: "flight",
        pricingBasis: "unknown",
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

test("award focus instruction says exact route/date matching is not required and benchmarks must be emitted", async () => {
  restoreEnv();

  const input = makeInput({
    focus: "award_options",
    research: [
      makeResearchResponse("query-1", [
        makeResearchResult("Title", "http://example.com", "Content"),
      ]),
    ],
  });

  const emptyResponse = JSON.stringify({
    awardOptions: [],
    cardOffers: [],
    assumptions: [],
    warnings: [],
  });

  let capturedBody: string | null = null;

  stubFetch(emptyResponse, (_url, init) => {
    capturedBody = typeof init.body === "string" ? init.body : null;
  });

  const interpreter = new OllamaResearchInterpreter(
    "http://localhost:11434",
    "test-model"
  );

  await interpreter.interpret(input);

  assert.ok(capturedBody, "fetch body should be captured");

  const body = JSON.parse(capturedBody as string);
  const userContent = body.messages[1].content as string;

  // Exact route/date matching is not required.
  assert.ok(
    userContent.includes(
      "An award option does NOT require the cited source to match the research"
    ),
    "award instruction should state exact matching is not required"
  );
  assert.ok(
    userContent.includes(
      "query's exact origin, destination, dates, traveler count, cabin, or hotel"
    ),
    "award instruction should enumerate non-required dimensions"
  );

  // General/regional benchmarks must be emitted.
  assert.ok(
    userContent.includes("general U.S.-to-Europe flight pricing"),
    "award instruction should mention general U.S.-to-Europe flight pricing"
  );
  assert.ok(
    userContent.includes("regional route pricing"),
    "award instruction should mention regional route pricing"
  );
  assert.ok(
    /Do not omit a sourced award benchmark merely because it does\s+not match every detail in the research query\./.test(
      userContent
    ),
    "award instruction should forbid omitting non-exact benchmarks"
  );

  // Non-exact benchmarks use unknown availability.
  assert.ok(
    userContent.includes(
      'For a non-exact benchmark: set availabilityStatus="unknown"'
    ),
    "award instruction should require unknown availability for non-exact benchmarks"
  );

  // itineraryLabel cannot be rewritten as the requested itinerary.
  assert.ok(
    userContent.includes(
      "itineraryLabel to describe ONLY the scope the source supports"
    ),
    "award instruction should restrict itineraryLabel to source scope"
  );
  assert.ok(
    /never\s+rewrite it as the customer's exact route, dates, or hotel/.test(
      userContent
    ),
    "award instruction should forbid rewriting itinerary as requested itinerary"
  );

  // Missing optional details remain null.
  assert.ok(
    userContent.includes(
      "Missing itinerary, fees, seats, cabin, transfer details, or valuation"
    ),
    "award instruction should cover missing optional details"
  );
  assert.ok(
    userContent.includes("must be null and must NOT cause the option to be omitted"),
    "award instruction should keep missing optional details null"
  );
});

test("accepts a source-supported general U.S.-to-Europe flight benchmark as one-way unknown-availability", async () => {
  restoreEnv();

  const input = makeInput({
    research: [
      makeResearchResponse(
        "U.S. to Europe award flights",
        [
          makeResearchResult(
            "Award guide: U.S. to Europe",
            "https://example.com/us-europe",
            "Flying Blue award chart starts at 35000 points one way for most U.S.-to-Europe routes in economy.",
            0.9,
            null,
            "official"
          ),
        ]
      ),
    ],
    rewardPrograms: [
      { id: "af-flying-blue", name: "Air France-KLM Flying Blue" },
    ],
  });

  const awardOptionJson = {
    awardOptions: [
      {
        id: "award-1",
        sourceId: "https://example.com/us-europe",
        programName: "Flying Blue",
        redemptionType: "flight",
        pricingBasis: "one_way",
        itineraryLabel: "U.S. to Europe economy one way, starting prices",
        pointsRequired: 35000,
        cashFees: null,
        seats: null,
        cabin: "economy",
        transferFromProgramId: null,
        transferRatio: null,
        centsPerPoint: null,
        availabilityStatus: "unknown",
      },
    ],
    cardOffers: [],
    assumptions: ["General regional benchmark; not the customer's exact route or dates"],
    warnings: [],
  };

  stubFetch(JSON.stringify(awardOptionJson));

  const interpreter = new OllamaResearchInterpreter(
    "http://localhost:11434",
    "test-model"
  );

  const result = await interpreter.interpret(input);

  assert.equal(result.awardOptions.length, 1);
  const awardOption = result.awardOptions[0];
  assert.equal(awardOption.programName, "Air France-KLM Flying Blue");
  assert.equal(awardOption.redemptionType, "flight");
  assert.equal(awardOption.pricingBasis, "one_way");
  assert.equal(awardOption.pointsRequired, 35000);
  assert.equal(awardOption.availabilityStatus, "unknown");
  // itineraryLabel reflects the source's general scope, not JFK-CDG.
  assert.match(awardOption.itineraryLabel ?? "", /U\.S\. to Europe/);
  assert.ok(!(awardOption.itineraryLabel ?? "").includes("JFK"));
});

test("accepts a source-supported hotel per-night benchmark without an exact property or date match", async () => {
  restoreEnv();

  const input = makeInput({
    research: [
      makeResearchResponse(
        "Hotel award nights",
        [
          makeResearchResult(
            "Paris hotel points guide",
            "https://example.com/paris-hotels",
            "Category 6 Hyatt properties in Paris run 25000 points per night.",
            0.85,
            null,
            "general"
          ),
        ]
      ),
    ],
    rewardPrograms: [
      { id: "hyatt", name: "World of Hyatt" },
    ],
  });

  const awardOptionJson = JSON.stringify({
    awardOptions: [
      {
        id: "award-1",
        sourceId: "https://example.com/paris-hotels",
        programName: "World of Hyatt",
        redemptionType: "hotel",
        pricingBasis: "per_night",
        itineraryLabel: "Paris, category 6 hotel nights, per night",
        pointsRequired: 25000,
        cashFees: null,
        seats: null,
        cabin: null,
        transferFromProgramId: null,
        transferRatio: null,
        centsPerPoint: null,
        availabilityStatus: "unknown",
      },
    ],
    cardOffers: [],
    assumptions: ["Per-night pricing is a general destination benchmark, not a specific property or date."],
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
  assert.equal(awardOption.redemptionType, "hotel");
  assert.equal(awardOption.pricingBasis, "per_night");
  assert.equal(awardOption.pointsRequired, 25000);
  assert.equal(awardOption.availabilityStatus, "unknown");
  assert.match(awardOption.itineraryLabel ?? "", /Paris/);
  assert.ok(!(awardOption.itineraryLabel ?? "").includes("June"));
});

test("sourced program plus points price is accepted when all four optional fields are null", async () => {
  restoreEnv();

  const input = makeInput({
    research: [
      makeResearchResponse("query-1", [
        makeResearchResult(
          "Minimal source",
          "http://example.com/min",
          "Flying Blue has award for 75000 points.",
          0.9,
          null,
          "official"
        ),
      ]),
    ],
    rewardPrograms: [{ id: "af-flying-blue", name: "Air France-KLM Flying Blue" }],
  });

  const awardOptionJson = JSON.stringify({
    awardOptions: [
      {
        id: "award-1",
        sourceId: "http://example.com/min",
        programName: "Flying Blue", // Testing both mapped short program name and null optional fields
        redemptionType: "flight",
        pricingBasis: "unknown",
        itineraryLabel: null,
        pointsRequired: 75000,
        cashFees: null,
        seats: null,
        cabin: null,
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
  assert.equal(result.awardOptions.length, 1);
  const awardOption = result.awardOptions[0];
  assert.equal(awardOption.id, "award-1");
  assert.equal(awardOption.programName, "Air France-KLM Flying Blue"); // verifying it got mapped!
  assert.equal(awardOption.itineraryLabel, null);
  assert.equal(awardOption.pointsRequired, 75000);
  assert.equal(awardOption.cashFees, null);
  assert.equal(awardOption.seats, null);
  assert.equal(awardOption.cabin, null);
});

test("unsupported transferRatio normalizes to null without rejecting the option", async () => {
  restoreEnv();

  const input = makeInput({
    research: [
      makeResearchResponse("query-1", [
        makeResearchResult(
          "Transfer ratio check",
          "http://example.com/ratio",
          "Air France Flying Blue has award for 80000 points.",
          0.9,
          null,
          "official"
        ),
      ]),
    ],
    rewardPrograms: [{ id: "af-flying-blue", name: "Air France Flying Blue" }],
  });

  // transferRatio: 1 is not present in the source content.
  const awardOptionJson = JSON.stringify({
    awardOptions: [
      {
        id: "award-1",
        sourceId: "http://example.com/ratio",
        programName: "Air France Flying Blue",
        redemptionType: "flight",
        pricingBasis: "unknown",
        itineraryLabel: null,
        pointsRequired: 80000,
        cashFees: null,
        seats: null,
        cabin: null,
        transferFromProgramId: null,
        transferRatio: 1, // not in the source text!
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

  assert.equal(result.awardOptions.length, 1);
  const awardOption = result.awardOptions[0];
  assert.equal(awardOption.id, "award-1");
  assert.equal(awardOption.pointsRequired, 80000);
  assert.equal(awardOption.transferRatio, null); // normalized, not rejected
});

test("unsupported cashFees normalizes to null without rejecting the option", async () => {
  restoreEnv();

  const input = makeInput({
    research: [
      makeResearchResponse("query-1", [
        makeResearchResult(
          "Optional num check",
          "http://example.com/opt",
          "Air France Flying Blue has award for 80000 points.",
          0.9,
          null,
          "official"
        ),
      ]),
    ],
    rewardPrograms: [{ id: "af-flying-blue", name: "Air France Flying Blue" }],
  });

  const awardOptionJson = JSON.stringify({
    awardOptions: [
      {
        id: "award-1",
        sourceId: "http://example.com/opt",
        programName: "Air France Flying Blue",
        redemptionType: "flight",
        pricingBasis: "unknown",
        itineraryLabel: null,
        pointsRequired: 80000,
        cashFees: 150, // not in the source text!
        seats: null,
        cabin: null,
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

  assert.equal(result.awardOptions.length, 1);
  const awardOption = result.awardOptions[0];
  assert.equal(awardOption.id, "award-1");
  assert.equal(awardOption.pointsRequired, 80000);
  assert.equal(awardOption.cashFees, null); // normalized, not rejected
});

test("negative optional numbers are still rejected", async () => {
  restoreEnv();

  const input = makeInput({
    research: [
      makeResearchResponse("query-1", [
        makeResearchResult(
          "Negative check",
          "http://example.com/neg",
          "Air France Flying Blue has award for 80000 points.",
          0.9,
          null,
          "official"
        ),
      ]),
    ],
    rewardPrograms: [{ id: "af-flying-blue", name: "Air France Flying Blue" }],
  });

  const awardOptionJson = JSON.stringify({
    awardOptions: [
      {
        id: "award-1",
        sourceId: "http://example.com/neg",
        programName: "Air France Flying Blue",
        redemptionType: "flight",
        pricingBasis: "unknown",
        itineraryLabel: null,
        pointsRequired: 80000,
        cashFees: -1, // negative
        seats: null,
        cabin: null,
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
      assert.match((error as Error).message, /cashFees/);
      return true;
    }
  );
});

test("non-numeric optional values are still rejected", async () => {
  restoreEnv();

  const input = makeInput({
    research: [
      makeResearchResponse("query-1", [
        makeResearchResult(
          "Non-numeric check",
          "http://example.com/type",
          "Air France Flying Blue has award for 80000 points.",
          0.9,
          null,
          "official"
        ),
      ]),
    ],
    rewardPrograms: [{ id: "af-flying-blue", name: "Air France Flying Blue" }],
  });

  const awardOptionJson = JSON.stringify({
    awardOptions: [
      {
        id: "award-1",
        sourceId: "http://example.com/type",
        programName: "Air France Flying Blue",
        redemptionType: "flight",
        pricingBasis: "unknown",
        itineraryLabel: null,
        pointsRequired: 80000,
        cashFees: "not-a-number", // wrong type
        seats: null,
        cabin: null,
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
      assert.match((error as Error).message, /cashFees/);
      return true;
    }
  );
});

test("supported optional numbers remain unchanged", async () => {
  restoreEnv();

  const input = makeInput({
    research: [
      makeResearchResponse("query-1", [
        makeResearchResult(
          "Supported optional check",
          "http://example.com/supported",
          "Air France Flying Blue has award for 80000 points with 300 fees. Transfer ratio is 2.",
          0.9,
          null,
          "official"
        ),
      ]),
    ],
    rewardPrograms: [{ id: "af-flying-blue", name: "Air France Flying Blue" }],
  });

  const awardOptionJson = JSON.stringify({
    awardOptions: [
      {
        id: "award-1",
        sourceId: "http://example.com/supported",
        programName: "Air France Flying Blue",
        redemptionType: "flight",
        pricingBasis: "unknown",
        itineraryLabel: null,
        pointsRequired: 80000,
        cashFees: 300,
        seats: null,
        cabin: null,
        transferFromProgramId: null,
        transferRatio: 2,
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

  assert.equal(result.awardOptions.length, 1);
  const awardOption = result.awardOptions[0];
  assert.equal(awardOption.pointsRequired, 80000);
  assert.equal(awardOption.cashFees, 300); // preserved
  assert.equal(awardOption.transferRatio, 2); // preserved
});

test("pointsRequired remains mandatory and source-validated", async () => {
  restoreEnv();

  const input = makeInput({
    research: [
      makeResearchResponse("query-1", [
        makeResearchResult(
          "Points validation check",
          "http://example.com/points",
          "Air France Flying Blue has award for 90000 points.",
          0.9,
          null,
          "official"
        ),
      ]),
    ],
    rewardPrograms: [{ id: "af-flying-blue", name: "Air France Flying Blue" }],
  });

  // pointsRequired missing/null (fails schema validation)
  const awardOptionJson1 = JSON.stringify({
    awardOptions: [
      {
        id: "award-1",
        sourceId: "http://example.com/points",
        programName: "Air France Flying Blue",
        redemptionType: "flight",
        pricingBasis: "unknown",
        itineraryLabel: null,
        pointsRequired: null, // should reject
        cashFees: null,
        seats: null,
        cabin: null,
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
      assert.match((error as Error).message, /pointsRequired/);
      return true;
    }
  );

  // pointsRequired value not in source content (fails source-validation)
  const awardOptionJson2 = JSON.stringify({
    awardOptions: [
      {
        id: "award-1",
        sourceId: "http://example.com/points",
        programName: "Air France Flying Blue",
        redemptionType: "flight",
        pricingBasis: "unknown",
        itineraryLabel: null,
        pointsRequired: 95000, // not in source text!
        cashFees: null,
        seats: null,
        cabin: null,
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
      assert.match((error as Error).message, /pointsRequired/);
      return true;
    }
  );
});

test("award focus request includes only the award instruction", async () => {
  restoreEnv();

  const input = makeInput({
    focus: "award_options",
    research: [
      makeResearchResponse("query-1", [
        makeResearchResult("Title", "http://example.com", "Content"),
      ]),
    ],
  });

  const emptyResponse = JSON.stringify({
    awardOptions: [],
    cardOffers: [],
    assumptions: [],
    warnings: [],
  });

  let capturedBody: string | null = null;

  stubFetch(emptyResponse, (_url, init) => {
    capturedBody = typeof init.body === "string" ? init.body : null;
  });

  const interpreter = new OllamaResearchInterpreter(
    "http://localhost:11434",
    "test-model"
  );

  await interpreter.interpret(input);

  assert.ok(capturedBody, "fetch body should be captured");

  const body = JSON.parse(capturedBody as string);
  assert.equal(body.messages.length, 2);

  const userContent = body.messages[1].content as string;

  // Award instruction must be present
  assert.ok(
    userContent.includes(
      "Research focus is award_options: extract supported award options only; cardOffers must be []."
    ),
    "award focus request should include the award instruction"
  );

  // Card instruction must NOT be present
  assert.ok(
    !userContent.includes(
      "Research focus is card_offers: extract actual credit-card offers only"
    ),
    "award focus request should NOT include the card instruction"
  );
});

test("card focus request includes only the card instruction", async () => {
  restoreEnv();

  const input = makeInput({
    focus: "card_offers",
    research: [
      makeResearchResponse("query-1", [
        makeResearchResult("Title", "http://example.com", "Content"),
      ]),
    ],
  });

  const emptyResponse = JSON.stringify({
    awardOptions: [],
    cardOffers: [],
    assumptions: [],
    warnings: [],
  });

  let capturedBody: string | null = null;

  stubFetch(emptyResponse, (_url, init) => {
    capturedBody = typeof init.body === "string" ? init.body : null;
  });

  const interpreter = new OllamaResearchInterpreter(
    "http://localhost:11434",
    "test-model"
  );

  await interpreter.interpret(input);

  assert.ok(capturedBody, "fetch body should be captured");

  const body = JSON.parse(capturedBody as string);
  assert.equal(body.messages.length, 2);

  const userContent = body.messages[1].content as string;

  // Card instruction must be present
  assert.ok(
    userContent.includes(
      "Research focus is card_offers: extract actual credit-card offers only; awardOptions must be []; a rewards-program name is not a card name."
    ),
    "card focus request should include the card instruction"
  );

  // Award instruction must NOT be present
  assert.ok(
    !userContent.includes(
      "Research focus is award_options: extract supported award options only"
    ),
    "card focus request should NOT include the award instruction"
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
    rewardPrograms: [{ id: "test-program", name: "Test Program" }],
  });

  // Trying to claim 200 points when source only mentions 100
  const awardOptionJson = JSON.stringify({
    awardOptions: [
      {
        id: "award-1",
        sourceId: "http://example.com",
        programName: "Test Program",
        redemptionType: "flight",
        pricingBasis: "unknown",
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
        redemptionType: "flight",
        pricingBasis: "unknown",
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
    rewardPrograms: [{ id: "test-program", name: "Test Program" }],
  });

  // Model should not invent exact values from a range
  const awardOptionJson = JSON.stringify({
    awardOptions: [
      {
        id: "award-1",
        sourceId: "http://example.com",
        programName: "Test Program",
        redemptionType: "flight",
        pricingBasis: "unknown",
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
    rewardPrograms: [{ id: "test-program", name: "Test Program" }],
  });

  const inputCopy = JSON.stringify(input);

  const awardOptionJson = JSON.stringify({
    awardOptions: [
      {
        id: "award-1",
        sourceId: "http://example.com",
        programName: "Test Program",
        redemptionType: "flight",
        pricingBasis: "unknown",
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
    rewardPrograms: [{ id: "test-program", name: "Test Program" }],
  });

  const awardOptionJson = JSON.stringify({
    awardOptions: [
      {
        id: "award-1",
        sourceId: "http://example.com/comma",
        programName: "Test Program",
        redemptionType: "flight",
        pricingBasis: "unknown",
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
    rewardPrograms: [{ id: "test-program", name: "Test Program" }],
  });

  // Try to use substring 60 from 60,000
  const awardOptionJson1 = JSON.stringify({
    awardOptions: [
      {
        id: "award-1",
        sourceId: "http://example.com/comma",
        programName: "Test Program",
        redemptionType: "flight",
        pricingBasis: "unknown",
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
        redemptionType: "flight",
        pricingBasis: "unknown",
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
    rewardPrograms: [{ id: "test-program", name: "Test Program" }],
  });

  const awardOptionJson = JSON.stringify({
    awardOptions: [
      {
        id: "award-1",
        sourceId: "http://example.com/award",
        programName: "Test Program",
        redemptionType: "flight",
        pricingBasis: "unknown",
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

test("buildPublicResearchPayload includes minimal goal constraints without identifiers", () => {
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
        makeResearchResult("Title", "http://example.com", "Content"),
      ]),
    ],
  });

  const payload = JSON.parse(buildPublicResearchPayload(input));

  assert.deepEqual(payload.focus, "award_options");
  assert.deepEqual(
    payload.rewardPrograms,
    rewardPrograms.map((program) => ({ name: program.name }))
  );
  assert.equal(payload.research.length, 1);
  assert.equal(payload.research[0].query, "query-1");

  const serialized = JSON.stringify(payload);
  assert.ok(!serialized.includes("UNIQUE_HONEYMOON_VENICE_2027"));
  assert.ok(serialized.includes("UNIQUE_ORIGIN_AIRPORT"));
  assert.ok(serialized.includes("UNIQUE_DEST_AIRPORT"));
  assert.ok(serialized.includes("2027-07-01"));
  assert.ok(serialized.includes("2027-07-15"));
  assert.ok(!serialized.includes(rewardPrograms[0].id));
});

test("shared validator accepts the existing valid partial award fixture", async () => {
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
    rewardPrograms: [{ id: "af-flying-blue", name: "Air France Flying Blue" }],
  });

  const awardOptionJson = JSON.stringify({
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
    assumptions: ["Points required are based on published award chart"],
    warnings: [],
  });

  const schema = JSON.parse(JSON.stringify(RESEARCH_OUTPUT_JSON_SCHEMA));

  const result = validateResearchModelContent(awardOptionJson, input, "test-model");

  assert.equal(result.awardOptions.length, 1);
  assert.equal(result.awardOptions[0].programName, "Air France Flying Blue");
  assert.equal(result.awardOptions[0].pointsRequired, 120000);
  assert.equal(result.awardOptions[0].redemptionType, "flight");
  assert.equal(result.awardOptions[0].pricingBasis, "round_trip");
  assert.equal(result.cardOffers.length, 0);
  assert.equal(schema.type, "object");
  assert.equal(schema.additionalProperties, false);
});

test("flight + one_way is accepted", async () => {
  restoreEnv();

  const input = makeInput({
    research: [
      makeResearchResponse("query-1", [
        makeResearchResult(
          "Award source",
          "http://example.com/award",
          "Test Program has award for 100 points.",
          0.9,
          null,
          "official"
        ),
      ]),
    ],
    rewardPrograms: [{ id: "test-program", name: "Test Program" }],
  });

  stubFetch(makeAwardOptionContent("flight", "one_way"));

  const interpreter = new OllamaResearchInterpreter(
    "http://localhost:11434",
    "test-model"
  );

  const result = await interpreter.interpret(input);
  assert.equal(result.awardOptions[0].redemptionType, "flight");
  assert.equal(result.awardOptions[0].pricingBasis, "one_way");
});

test("flight + unknown is accepted", async () => {
  restoreEnv();

  const input = makeInput({
    research: [
      makeResearchResponse("query-1", [
        makeResearchResult(
          "Award source",
          "http://example.com/award",
          "Test Program has award for 100 points.",
          0.9,
          null,
          "official"
        ),
      ]),
    ],
    rewardPrograms: [{ id: "test-program", name: "Test Program" }],
  });

  stubFetch(makeAwardOptionContent("flight", "unknown"));

  const interpreter = new OllamaResearchInterpreter(
    "http://localhost:11434",
    "test-model"
  );

  const result = await interpreter.interpret(input);
  assert.equal(result.awardOptions[0].redemptionType, "flight");
  assert.equal(result.awardOptions[0].pricingBasis, "unknown");
});

test("hotel + per_night is accepted", async () => {
  restoreEnv();

  const input = makeInput({
    research: [
      makeResearchResponse("query-1", [
        makeResearchResult(
          "Award source",
          "http://example.com/award",
          "Test Program has award for 100 points.",
          0.9,
          null,
          "official"
        ),
      ]),
    ],
    rewardPrograms: [{ id: "test-program", name: "Test Program" }],
  });

  stubFetch(makeAwardOptionContent("hotel", "per_night"));

  const interpreter = new OllamaResearchInterpreter(
    "http://localhost:11434",
    "test-model"
  );

  const result = await interpreter.interpret(input);
  assert.equal(result.awardOptions[0].redemptionType, "hotel");
  assert.equal(result.awardOptions[0].pricingBasis, "per_night");
});
test("hotel per_night option inside a cited category range is accepted", async () => {
  restoreEnv();

  const input = makeInput({
    research: [
      makeResearchResponse("Hotel award nights", [
        makeResearchResult(
          "Paris hotel points guide",
          "https://example.com/paris-hotels",
          "Category 6 Hyatt properties in Paris cost 8,000 to 15,000 points per night.",
          0.85,
          null,
          "general"
        ),
      ]),
    ],
    rewardPrograms: [{ id: "hyatt", name: "World of Hyatt" }],
  });

  const awardOptionJson = JSON.stringify({
    awardOptions: [
      {
        id: "award-1",
        sourceId: "https://example.com/paris-hotels",
        programName: "World of Hyatt",
        redemptionType: "hotel",
        pricingBasis: "per_night",
        itineraryLabel: "Paris, category 6 hotel nights, per night",
        pointsRequired: 10000, // Within the cited 8,000–15,000 range, not verbatim
        cashFees: null,
        seats: null,
        cabin: null,
        transferFromProgramId: null,
        transferRatio: null,
        centsPerPoint: null,
        availabilityStatus: "unknown",
      },
    ],
    cardOffers: [],
    assumptions: ["Per-night pricing is a general destination benchmark, not a specific property or date."],
    warnings: [],
  });

  stubFetch(awardOptionJson);

  const interpreter = new OllamaResearchInterpreter(
    "http://localhost:11434",
    "test-model"
  );

  const result = await interpreter.interpret(input);
  assert.equal(result.awardOptions.length, 1);
  assert.equal(result.awardOptions[0].pointsRequired, 10000);
  assert.equal(result.awardOptions[0].pricingBasis, "per_night");
});
test("hotel per_night source_explicit with nightCountCovered=1 is accepted without a literal '1' in source", async () => {
  restoreEnv();

  const input = makeInput({
    research: [
      makeResearchResponse("Hotel award nights", [
        makeResearchResult(
          "Paris hotel points guide",
          "https://example.com/paris-hotel-guide",
          "Park Hyatt Paris-Vendôme costs 35,000 to 45,000 points per night.",
          0.85,
          null,
          "specialist"
        ),
      ]),
    ],
    rewardPrograms: [{ id: "hyatt", name: "World of Hyatt" }],
  });

  const awardOptionJson = JSON.stringify({
    awardOptions: [
      {
        id: "award-1",
        sourceId: "https://example.com/paris-hotel-guide",
        programName: "World of Hyatt",
        redemptionType: "hotel",
        pricingBasis: "per_night",
        itineraryLabel: "Paris, category range pricing, per night",
        pointsRequired: 35000,
        cashFees: null,
        seats: null,
        cabin: null,
        transferFromProgramId: null,
        transferRatio: null,
        centsPerPoint: null,
        availabilityStatus: "unknown",
        travelerCountCovered: null,
        nightCountCovered: 1,
        coverageStatus: "source_explicit",
      },
    ],
    cardOffers: [],
    assumptions: [],
    warnings: ["Cited range is 35,000 to 45,000 points per night."],
  });

  stubFetch(awardOptionJson);

  const interpreter = new OllamaResearchInterpreter(
    "http://localhost:11434",
    "test-model"
  );

  const result = await interpreter.interpret(input);
  assert.equal(result.awardOptions.length, 1);
  const option = result.awardOptions[0];
  assert.equal(option.pointsRequired, 35000);
  assert.equal(option.nightCountCovered, 1);
  assert.equal(option.coverageStatus, "source_explicit");
});

test("hotel source_explicit with null nightCountCovered is still rejected", async () => {
  restoreEnv();

  const input = makeInput({
    research: [
      makeResearchResponse("Hotel award nights", [
        makeResearchResult(
          "Paris hotel points guide",
          "https://example.com/paris-hotel-guide",
          "Park Hyatt Paris-Vendôme costs 35,000 to 45,000 points per night.",
          0.85,
          null,
          "specialist"
        ),
      ]),
    ],
    rewardPrograms: [{ id: "hyatt", name: "World of Hyatt" }],
  });

  const awardOptionJson = JSON.stringify({
    awardOptions: [
      {
        id: "award-1",
        sourceId: "https://example.com/paris-hotel-guide",
        programName: "World of Hyatt",
        redemptionType: "hotel",
        pricingBasis: "per_night",
        itineraryLabel: "Park Hyatt Paris-Vendôme, per night",
        pointsRequired: 35000,
        cashFees: null,
        seats: null,
        cabin: null,
        transferFromProgramId: null,
        transferRatio: null,
        centsPerPoint: null,
        availabilityStatus: "unknown",
        travelerCountCovered: null,
        nightCountCovered: null,
        coverageStatus: "source_explicit",
      },
    ],
    cardOffers: [],
    assumptions: [],
    warnings: [],
  });

  stubFetch(awardOptionJson);

  const service = new OllamaResearchInterpreter(
    "http://localhost:11434",
    "test-model"
  );

  await assert.rejects(
    () => service.interpret(input),
    (error: unknown) => {
      assert.ok(error instanceof ResearchInterpreterError);
      assert.match((error as Error).message, /source_explicit.*nightCountCovered is null/);
      return true;
    }
  );
});

test("hotel per_night option outside any cited range is dropped (not whole-stage rejection)", async () => {
  restoreEnv();

  const input = makeInput({
    research: [
      makeResearchResponse("Hotel award nights", [
        makeResearchResult(
          "Paris hotel points guide",
          "https://example.com/paris-hotels",
          "Category 6 Hyatt properties in Paris cost 8,000 to 15,000 points per night.",
          0.85,
          null,
          "general"
        ),
      ]),
    ],
    rewardPrograms: [{ id: "hyatt", name: "World of Hyatt" }],
  });

  const awardOptionJson = JSON.stringify({
    awardOptions: [
      {
        id: "award-1",
        sourceId: "https://example.com/paris-hotels",
        programName: "World of Hyatt",
        redemptionType: "hotel",
        pricingBasis: "per_night",
        itineraryLabel: "Paris, category 6 hotel nights, per night",
        pointsRequired: 50000, // Outside the cited 8,000–15,000 range
        cashFees: null,
        seats: null,
        cabin: null,
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

  const service = new OllamaResearchInterpreter(
    "http://localhost:11434",
    "test-model"
  );

  // Per-option tolerance: an unsupported price should drop only the invalid
  // hotel option and emit a warning, NOT reject the entire stage.
  const result = await service.interpret(input);
  assert.equal(result.awardOptions.length, 0);
  assert.ok(
    result.warnings.some((w) =>
      /Dropped an unverifiable award option.*50000.*not supported by the cited source content/.test(w)
    ),
    `Expected a dropped-option warning, got: ${JSON.stringify(result.warnings)}`
    );
});

test("per-option tolerance keeps valid hotel option when a sibling has unsupported price", async () => {
  restoreEnv();

  const input = makeInput({
    research: [
      makeResearchResponse("Hotel award nights", [
        makeResearchResult(
          "Paris hotel points guide",
          "https://example.com/paris-hotels",
          "Category 6 Hyatt properties in Paris cost 8,000 to 15,000 points per night.",
          0.85,
          null,
          "general"
        ),
      ]),
    ],
    rewardPrograms: [{ id: "hyatt", name: "World of Hyatt" }],
  });

  const awardOptionJson = JSON.stringify({
    awardOptions: [
      {
        id: "award-1",
        sourceId: "https://example.com/paris-hotels",
        programName: "World of Hyatt",
        redemptionType: "hotel",
        pricingBasis: "per_night",
        itineraryLabel: "Paris, category 6 hotel nights, per night",
        pointsRequired: 50000, // Outside cited 8,000–15,000 range — should drop
        cashFees: null,
        seats: null,
        cabin: null,
        transferFromProgramId: null,
        transferRatio: null,
        centsPerPoint: null,
        availabilityStatus: "unknown",
      },
      {
        id: "award-2",
        sourceId: "https://example.com/paris-hotels",
        programName: "World of Hyatt",
        redemptionType: "hotel",
        pricingBasis: "per_night",
        itineraryLabel: "Paris, category 6 hotel nights, per night",
        pointsRequired: 12000, // Inside the cited 8,000–15,000 range — should survive
        cashFees: null,
        seats: null,
        cabin: null,
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

  const service = new OllamaResearchInterpreter(
    "http://localhost:11434",
    "test-model"
  );

  const result = await service.interpret(input);
  assert.equal(result.awardOptions.length, 1);
  assert.equal(result.awardOptions[0].id, "award-2");
  assert.ok(
    result.warnings.some(
      (w) =>
        /Dropped an unverifiable award option.*50000.*not supported by the cited source content/.test(
          w
        )
    ),
    `Expected a dropped-option warning for the invalid hotel option, got: ${JSON.stringify(result.warnings)}`
  );
});

test("structural error on one option still rejects the whole stage", async () => {
  restoreEnv();

  const input = makeInput({
    research: [
      makeResearchResponse("query-1", [
        makeResearchResult(
          "Award source",
          "http://example.com/award",
          "Test Program has award for 100 points.",
          0.9,
          null,
          "official"
        ),
      ]),
    ],
    rewardPrograms: [{ id: "test-program", name: "Test Program" }],
  });

  // One structurally-malformed option (invalid redemptionType) plus one valid
  // one. The structural error must propagate and reject the whole stage.
  const awardOptionJson = JSON.stringify({
    awardOptions: [
      {
        id: "award-1",
        sourceId: "http://example.com/award",
        programName: "Test Program",
        redemptionType: "car", // invalid — structural error, not droppable
        pricingBasis: "unknown",
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
      {
        id: "award-2",
        sourceId: "http://example.com/award",
        programName: "Test Program",
        redemptionType: "flight",
        pricingBasis: "unknown",
        itineraryLabel: "Test trip 2",
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

  const service = new OllamaResearchInterpreter(
    "http://localhost:11434",
    "test-model"
  );

  await assert.rejects(
    () => service.interpret(input),
    (error: unknown) => {
      assert.ok(error instanceof ResearchInterpreterError);
      assert.match((error as Error).message, /invalid redemptionType/);
      return true;
    }
  );
});

test("flight option value inside a cited range is still rejected (no range relaxation for flights)", async () => {
  restoreEnv();

  const input = makeInput({
    research: [
      makeResearchResponse("Flight award pricing", [
        makeResearchResult(
          "Award guide",
          "https://example.com/award-guide",
          "This route typically costs 8,000 to 15,000 points one-way.",
          0.85,
          null,
          "general"
        ),
      ]),
    ],
    rewardPrograms: [{ id: "test-program", name: "Test Program" }],
  });

  const awardOptionJson = JSON.stringify({
    awardOptions: [
      {
        id: "award-1",
        sourceId: "https://example.com/award-guide",
        programName: "Test Program",
        redemptionType: "flight",
        pricingBasis: "one_way",
        itineraryLabel: "Typical one-way benchmark",
        pointsRequired: 10000, // Inside the cited range, but flights require exact match
        cashFees: null,
        seats: null,
        cabin: null,
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

  const service = new OllamaResearchInterpreter(
    "http://localhost:11434",
    "test-model"
  );

  await assert.rejects(
    () => service.interpret(input),
    (error: unknown) => {
      assert.ok(error instanceof ResearchInterpreterError);
      assert.match((error as Error).message, /is not supported by the cited source content/);
      return true;
    }
  );
});

test("hotel + total_stay is accepted", async () => {
  restoreEnv();

  const input = makeInput({
    research: [
      makeResearchResponse("query-1", [
        makeResearchResult(
          "Award source",
          "http://example.com/award",
          "Test Program has award for 100 points.",
          0.9,
          null,
          "official"
        ),
      ]),
    ],
    rewardPrograms: [{ id: "test-program", name: "Test Program" }],
  });

  stubFetch(makeAwardOptionContent("hotel", "total_stay"));

  const interpreter = new OllamaResearchInterpreter(
    "http://localhost:11434",
    "test-model"
  );

  const result = await interpreter.interpret(input);
  assert.equal(result.awardOptions[0].redemptionType, "hotel");
  assert.equal(result.awardOptions[0].pricingBasis, "total_stay");
});

test("hotel + unknown is accepted", async () => {
  restoreEnv();

  const input = makeInput({
    research: [
      makeResearchResponse("query-1", [
        makeResearchResult(
          "Award source",
          "http://example.com/award",
          "Test Program has award for 100 points.",
          0.9,
          null,
          "official"
        ),
      ]),
    ],
    rewardPrograms: [{ id: "test-program", name: "Test Program" }],
  });

  stubFetch(makeAwardOptionContent("hotel", "unknown"));

  const interpreter = new OllamaResearchInterpreter(
    "http://localhost:11434",
    "test-model"
  );

  const result = await interpreter.interpret(input);
  assert.equal(result.awardOptions[0].redemptionType, "hotel");
  assert.equal(result.awardOptions[0].pricingBasis, "unknown");
});

test("invalid redemptionType value is rejected", async () => {
  restoreEnv();

  const input = makeInput({
    research: [
      makeResearchResponse("query-1", [
        makeResearchResult(
          "Award source",
          "http://example.com/award",
          "Test Program has award for 100 points.",
          0.9,
          null,
          "official"
        ),
      ]),
    ],
    rewardPrograms: [{ id: "test-program", name: "Test Program" }],
  });

  stubFetch(makeAwardOptionContent("car", "unknown"));

  const interpreter = new OllamaResearchInterpreter(
    "http://localhost:11434",
    "test-model"
  );

  await assert.rejects(
    () => interpreter.interpret(input),
    (error: unknown) => {
      assert.ok(error instanceof ResearchInterpreterError);
      assert.match((error as Error).message, /invalid redemptionType/);
      return true;
    }
  );
});

test("invalid pricingBasis value is rejected", async () => {
  restoreEnv();

  const input = makeInput({
    research: [
      makeResearchResponse("query-1", [
        makeResearchResult(
          "Award source",
          "http://example.com/award",
          "Test Program has award for 100 points.",
          0.9,
          null,
          "official"
        ),
      ]),
    ],
    rewardPrograms: [{ id: "test-program", name: "Test Program" }],
  });

  stubFetch(makeAwardOptionContent("flight", "per_stay"));

  const interpreter = new OllamaResearchInterpreter(
    "http://localhost:11434",
    "test-model"
  );

  await assert.rejects(
    () => interpreter.interpret(input),
    (error: unknown) => {
      assert.ok(error instanceof ResearchInterpreterError);
      assert.match((error as Error).message, /invalid pricingBasis/);
      return true;
    }
  );
});

test("flight + per_night is rejected", async () => {
  restoreEnv();

  const input = makeInput({
    research: [
      makeResearchResponse("query-1", [
        makeResearchResult(
          "Award source",
          "http://example.com/award",
          "Test Program has award for 100 points.",
          0.9,
          null,
          "official"
        ),
      ]),
    ],
    rewardPrograms: [{ id: "test-program", name: "Test Program" }],
  });

  stubFetch(makeAwardOptionContent("flight", "per_night"));

  const interpreter = new OllamaResearchInterpreter(
    "http://localhost:11434",
    "test-model"
  );

  await assert.rejects(
    () => interpreter.interpret(input),
    (error: unknown) => {
      assert.ok(error instanceof ResearchInterpreterError);
      assert.match((error as Error).message, /is a flight but has pricingBasis/);
      return true;
    }
  );
});

test("hotel + one_way is rejected", async () => {
  restoreEnv();

  const input = makeInput({
    research: [
      makeResearchResponse("query-1", [
        makeResearchResult(
          "Award source",
          "http://example.com/award",
          "Test Program has award for 100 points.",
          0.9,
          null,
          "official"
        ),
      ]),
    ],
    rewardPrograms: [{ id: "test-program", name: "Test Program" }],
  });

  stubFetch(makeAwardOptionContent("hotel", "one_way"));

  const interpreter = new OllamaResearchInterpreter(
    "http://localhost:11434",
    "test-model"
  );

  await assert.rejects(
    () => interpreter.interpret(input),
    (error: unknown) => {
      assert.ok(error instanceof ResearchInterpreterError);
      assert.match((error as Error).message, /is a hotel but has pricingBasis/);
      return true;
    }
  );
});

test("OllamaResearchInterpreter instance satisfies the ResearchInterpreter interface", () => {
  restoreEnv();

  const interpreter: ResearchInterpreter = new OllamaResearchInterpreter(
    "http://localhost:11434",
    "test-model"
  );

  assert.ok(typeof interpreter.interpret === "function");
});

test("card offer with missing/unknown sourceId rejected", async () => {
  restoreEnv();

  const input = makeInput({
    research: [
      makeResearchResponse("query-1", [
        makeResearchResult(
          "Card source",
          "http://example.com/card",
          "Earn 50000 points after spending 3000 dollars in 3 months. Annual fee 95.",
          0.9,
          null,
          "official"
        ),
      ]),
    ],
    rewardPrograms: [{ id: "program-1", name: "Program One" }],
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

test("canonical source ID still works unchanged", async () => {
  restoreEnv();

  const input = makeInput({
    research: [
      makeResearchResponse("query-1", [
        makeResearchResult(
          "Award chart",
          "http://example.com/award",
          "Air France Flying Blue offers JFK-CDG round trip for 120000 points with $200 fees. 4 seats available in economy.",
          0.9,
          null,
          "official"
        ),
      ]),
    ],
    rewardPrograms: [{ id: "af-flying-blue", name: "Air France Flying Blue" }],
  });

  const awardOptionJson = JSON.stringify({
    awardOptions: [
      {
        id: "award-1",
        sourceId: "http://example.com/award", // canonical source ID
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

  stubFetch(awardOptionJson);

  const interpreter = new OllamaResearchInterpreter(
    "http://localhost:11434",
    "test-model"
  );

  const result = await interpreter.interpret(input);

  assert.equal(result.awardOptions.length, 1);
  assert.equal(result.awardOptions[0].sourceId, "http://example.com/award");
});

test("a unique exact source title is accepted and canonicalized to the URL", async () => {
  restoreEnv();

  const input = makeInput({
    research: [
      makeResearchResponse("query-1", [
        makeResearchResult(
          "Award chart",
          "http://example.com/award",
          "Air France Flying Blue offers JFK-CDG round trip for 120000 points with $200 fees. 4 seats available in economy.",
          0.9,
          null,
          "official"
        ),
      ]),
    ],
    rewardPrograms: [{ id: "af-flying-blue", name: "Air France Flying Blue" }],
  });

  const awardOptionJson = JSON.stringify({
    awardOptions: [
      {
        id: "award-1",
        sourceId: "Award chart", // exact title, not the URL
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

  stubFetch(awardOptionJson);

  const interpreter = new OllamaResearchInterpreter(
    "http://localhost:11434",
    "test-model"
  );

  const result = await interpreter.interpret(input);

  assert.equal(result.awardOptions.length, 1);
  // The returned sourceId must be the canonical URL, never the title alias.
  assert.equal(result.awardOptions[0].sourceId, "http://example.com/award");
});

test("numeric validation uses the resolved source content when title alias is used", async () => {
  restoreEnv();

  const input = makeInput({
    research: [
      makeResearchResponse("query-1", [
        makeResearchResult(
          "Award chart",
          "http://example.com/award",
          "Air France Flying Blue offers JFK-CDG round trip for 120000 points with $200 fees. 4 seats available in economy.",
          0.9,
          null,
          "official"
        ),
      ]),
    ],
    rewardPrograms: [{ id: "af-flying-blue", name: "Air France Flying Blue" }],
  });

  // pointsRequired 120000 is in the resolved source content; 999999 is not.
  const awardOptionJson = JSON.stringify({
    awardOptions: [
      {
        id: "award-1",
        sourceId: "Award chart", // title alias resolves to http://example.com/award
        programName: "Air France Flying Blue",
        redemptionType: "flight",
        pricingBasis: "round_trip",
        itineraryLabel: "JFK-CDG round trip",
        pointsRequired: 120000, // present in resolved source content
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

  const result = await interpreter.interpret(input);
  assert.equal(result.awardOptions[0].pointsRequired, 120000);

  // Now use a number NOT in the resolved source content.
  const awardOptionJson2 = JSON.stringify({
    awardOptions: [
      {
        id: "award-2",
        sourceId: "Award chart", // title alias resolves to http://example.com/award
        programName: "Air France Flying Blue",
        redemptionType: "flight",
        pricingBasis: "round_trip",
        itineraryLabel: "JFK-CDG round trip",
        pointsRequired: 999999, // NOT in resolved source content
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

test("surrounding whitespace on the title is trimmed before matching", async () => {
  restoreEnv();

  const input = makeInput({
    research: [
      makeResearchResponse("query-1", [
        makeResearchResult(
          "Award chart",
          "http://example.com/award",
          "Air France Flying Blue offers JFK-CDG round trip for 120000 points with $200 fees. 4 seats available in economy.",
          0.9,
          null,
          "official"
        ),
      ]),
    ],
    rewardPrograms: [{ id: "af-flying-blue", name: "Air France Flying Blue" }],
  });

  const awardOptionJson = JSON.stringify({
    awardOptions: [
      {
        id: "award-1",
        sourceId: "  Award chart  ", // surrounding whitespace
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

  stubFetch(awardOptionJson);

  const interpreter = new OllamaResearchInterpreter(
    "http://localhost:11434",
    "test-model"
  );

  const result = await interpreter.interpret(input);

  assert.equal(result.awardOptions.length, 1);
  assert.equal(result.awardOptions[0].sourceId, "http://example.com/award");
});

test("duplicate title with the same canonical source ID is accepted", async () => {
  restoreEnv();

  const input = makeInput({
    research: [
      makeResearchResponse("query-1", [
        makeResearchResult(
          "Award chart",
          "http://example.com/award",
          "Air France Flying Blue offers JFK-CDG round trip for 120000 points with $200 fees. 4 seats available in economy.",
          0.9,
          null,
          "official"
        ),
        makeResearchResult(
          "Award chart", // same title
          "http://example.com/award", // same canonical source ID
          "Air France Flying Blue offers JFK-CDG round trip for 120000 points with $200 fees. 4 seats available in economy.",
          0.8,
          null,
          "general"
        ),
      ]),
    ],
    rewardPrograms: [{ id: "af-flying-blue", name: "Air France Flying Blue" }],
  });

  const awardOptionJson = JSON.stringify({
    awardOptions: [
      {
        id: "award-1",
        sourceId: "Award chart", // title maps to a single canonical ID
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

  stubFetch(awardOptionJson);

  const interpreter = new OllamaResearchInterpreter(
    "http://localhost:11434",
    "test-model"
  );

  const result = await interpreter.interpret(input);

  assert.equal(result.awardOptions.length, 1);
  assert.equal(result.awardOptions[0].sourceId, "http://example.com/award");
});

test("duplicate title with different canonical source IDs is rejected as ambiguous", async () => {
  restoreEnv();

  const input = makeInput({
    research: [
      makeResearchResponse("query-1", [
        makeResearchResult(
          "Award chart",
          "http://example.com/award-1",
          "Air France Flying Blue offers JFK-CDG round trip for 120000 points with $200 fees. 4 seats available in economy.",
          0.9,
          null,
          "official"
        ),
        makeResearchResult(
          "Award chart", // same title
          "http://example.com/award-2", // different canonical source ID
          "Air France Flying Blue offers JFK-CDG round trip for 120000 points with $200 fees. 4 seats available in economy.",
          0.8,
          null,
          "general"
        ),
      ]),
    ],
    rewardPrograms: [{ id: "af-flying-blue", name: "Air France Flying Blue" }],
  });

  const awardOptionJson = JSON.stringify({
    awardOptions: [
      {
        id: "award-1",
        sourceId: "Award chart", // ambiguous title
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

  stubFetch(awardOptionJson);

  const interpreter = new OllamaResearchInterpreter(
    "http://localhost:11434",
    "test-model"
  );

  await assert.rejects(
    () => interpreter.interpret(input),
    (error: unknown) => {
      assert.ok(error instanceof ResearchInterpreterError);
      assert.match((error as Error).message, /ambiguous source title/);
      return true;
    }
  );
});

test("unknown title is rejected", async () => {
  restoreEnv();

  const input = makeInput({
    research: [
      makeResearchResponse("query-1", [
        makeResearchResult(
          "Award chart",
          "http://example.com/award",
          "Air France Flying Blue offers JFK-CDG round trip for 120000 points with $200 fees. 4 seats available in economy.",
          0.9,
          null,
          "official"
        ),
      ]),
    ],
    rewardPrograms: [{ id: "af-flying-blue", name: "Air France Flying Blue" }],
  });

  const awardOptionJson = JSON.stringify({
    awardOptions: [
      {
        id: "award-1",
        sourceId: "Nonexistent Title", // unknown title
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

test("partial/fuzzy title is rejected", async () => {
  restoreEnv();

  const input = makeInput({
    research: [
      makeResearchResponse("query-1", [
        makeResearchResult(
          "Award chart",
          "http://example.com/award",
          "Air France Flying Blue offers JFK-CDG round trip for 120000 points with $200 fees. 4 seats available in economy.",
          0.9,
          null,
          "official"
        ),
      ]),
    ],
    rewardPrograms: [{ id: "af-flying-blue", name: "Air France Flying Blue" }],
  });

  // "Award" is a partial/fuzzy match of "Award chart" - must be rejected.
  const awardOptionJson = JSON.stringify({
    awardOptions: [
      {
        id: "award-1",
        sourceId: "Award", // partial/fuzzy title
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

test("card offers use the same canonicalization helper", async () => {
  restoreEnv();

  const input = makeInput({
    focus: "card_offers",
    research: [
      makeResearchResponse("query-1", [
        makeResearchResult(
          "Card source",
          "http://example.com/card",
          "Earn 50000 points after spending 3000 dollars in 3 months. Annual fee 95.",
          0.9,
          null,
          "official"
        ),
      ]),
    ],
    rewardPrograms: [{ id: "program-1", name: "Program One" }],
  });

  const cardOfferJson = JSON.stringify({
    awardOptions: [],
    cardOffers: [
      {
        id: "card-1",
        sourceId: "Card source", // title alias, not the URL
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

  const result = await interpreter.interpret(input);

  assert.equal(result.cardOffers.length, 1);
  // The returned sourceId must be the canonical URL, never the title alias.
  assert.equal(result.cardOffers[0].sourceId, "http://example.com/card");
});

test("omitted legacy coverage fields normalize to unknown/null/null", async () => {
  restoreEnv();

  const input = makeInput({
    research: [
      makeResearchResponse("query-1", [
        makeResearchResult(
          "Award source",
          "http://example.com/award",
          "Test Program has award for 100 points.",
          0.9,
          null,
          "official"
        ),
      ]),
    ],
    rewardPrograms: [{ id: "test-program", name: "Test Program" }],
  });

  // No coverage fields at all — legacy fixture
  const awardOptionJson = JSON.stringify({
    awardOptions: [
      {
        id: "award-1",
        sourceId: "http://example.com/award",
        programName: "Test Program",
        redemptionType: "flight",
        pricingBasis: "unknown",
        itineraryLabel: null,
        pointsRequired: 100,
        cashFees: null,
        seats: null,
        cabin: null,
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
  assert.equal(result.awardOptions.length, 1);
  const opt = result.awardOptions[0];
  assert.equal(opt.travelerCountCovered, null);
  assert.equal(opt.nightCountCovered, null);
  assert.equal(opt.coverageStatus, "unknown");
});

test("flight standard single-traveler coverage is accepted", async () => {
  restoreEnv();

  const input = makeInput({
    research: [
      makeResearchResponse("query-1", [
        makeResearchResult(
          "Award source",
          "http://example.com/award",
          "Test Program has award for 100 points.",
          0.9,
          null,
          "official"
        ),
      ]),
    ],
    rewardPrograms: [{ id: "test-program", name: "Test Program" }],
  });

  const awardOptionJson = JSON.stringify({
    awardOptions: [
      {
        id: "award-1",
        sourceId: "http://example.com/award",
        programName: "Test Program",
        redemptionType: "flight",
        pricingBasis: "one_way",
        itineraryLabel: null,
        pointsRequired: 100,
        cashFees: null,
        seats: null,
        cabin: null,
        transferFromProgramId: null,
        transferRatio: null,
        centsPerPoint: null,
        availabilityStatus: "unknown",
        travelerCountCovered: 1,
        nightCountCovered: null,
        coverageStatus: "standard_assumption",
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
  assert.equal(result.awardOptions.length, 1);
  const opt = result.awardOptions[0];
  assert.equal(opt.travelerCountCovered, 1);
  assert.equal(opt.nightCountCovered, null);
  assert.equal(opt.coverageStatus, "standard_assumption");
});

test("source-explicit three-traveler coverage is accepted when source-backed", async () => {
  restoreEnv();

  const input = makeInput({
    research: [
      makeResearchResponse("query-1", [
        makeResearchResult(
          "Award source",
          "http://example.com/award",
          "Test Program has award for 300 points for 3 travelers.",
          0.9,
          null,
          "official"
        ),
      ]),
    ],
    rewardPrograms: [{ id: "test-program", name: "Test Program" }],
  });

  const awardOptionJson = JSON.stringify({
    awardOptions: [
      {
        id: "award-1",
        sourceId: "http://example.com/award",
        programName: "Test Program",
        redemptionType: "flight",
        pricingBasis: "one_way",
        itineraryLabel: null,
        pointsRequired: 300,
        cashFees: null,
        seats: null,
        cabin: null,
        transferFromProgramId: null,
        transferRatio: null,
        centsPerPoint: null,
        availabilityStatus: "unknown",
        travelerCountCovered: 3,
        nightCountCovered: null,
        coverageStatus: "source_explicit",
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
  assert.equal(result.awardOptions.length, 1);
  const opt = result.awardOptions[0];
  assert.equal(opt.travelerCountCovered, 3);
  assert.equal(opt.nightCountCovered, null);
  assert.equal(opt.coverageStatus, "source_explicit");
});

test("hotel per-night standard one-night coverage is accepted", async () => {
  restoreEnv();

  const input = makeInput({
    research: [
      makeResearchResponse("query-1", [
        makeResearchResult(
          "Award source",
          "http://example.com/award",
          "Test Program has hotel award for 100 points.",
          0.9,
          null,
          "official"
        ),
      ]),
    ],
    rewardPrograms: [{ id: "test-program", name: "Test Program" }],
  });

  const awardOptionJson = JSON.stringify({
    awardOptions: [
      {
        id: "award-1",
        sourceId: "http://example.com/award",
        programName: "Test Program",
        redemptionType: "hotel",
        pricingBasis: "per_night",
        itineraryLabel: null,
        pointsRequired: 100,
        cashFees: null,
        seats: null,
        cabin: null,
        transferFromProgramId: null,
        transferRatio: null,
        centsPerPoint: null,
        availabilityStatus: "unknown",
        travelerCountCovered: null,
        nightCountCovered: 1,
        coverageStatus: "standard_assumption",
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
  assert.equal(result.awardOptions.length, 1);
  const opt = result.awardOptions[0];
  assert.equal(opt.travelerCountCovered, null);
  assert.equal(opt.nightCountCovered, 1);
  assert.equal(opt.coverageStatus, "standard_assumption");
});

test("unsupported source-explicit quantity is rejected", async () => {
  restoreEnv();

  const input = makeInput({
    research: [
      makeResearchResponse("query-1", [
        makeResearchResult(
          "Award source",
          "http://example.com/award",
          "Test Program has award for 100 points.",
          0.9,
          null,
          "official"
        ),
      ]),
    ],
    rewardPrograms: [{ id: "test-program", name: "Test Program" }],
  });

  // travelerCountCovered=5 is not in the source content
  const awardOptionJson = JSON.stringify({
    awardOptions: [
      {
        id: "award-1",
        sourceId: "http://example.com/award",
        programName: "Test Program",
        redemptionType: "flight",
        pricingBasis: "one_way",
        itineraryLabel: null,
        pointsRequired: 100,
        cashFees: null,
        seats: null,
        cabin: null,
        transferFromProgramId: null,
        transferRatio: null,
        centsPerPoint: null,
        availabilityStatus: "unknown",
        travelerCountCovered: 5,
        nightCountCovered: null,
        coverageStatus: "source_explicit",
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
      assert.match((error as Error).message, /travelerCountCovered/);
      return true;
    }
  );
});

test("zero, negative, and fractional counts are rejected", async () => {
  restoreEnv();

  const input = makeInput({
    research: [
      makeResearchResponse("query-1", [
        makeResearchResult(
          "Award source",
          "http://example.com/award",
          "Test Program has award for 100 points.",
          0.9,
          null,
          "official"
        ),
      ]),
    ],
    rewardPrograms: [{ id: "test-program", name: "Test Program" }],
  });

  // Zero travelerCountCovered
  const zeroJson = JSON.stringify({
    awardOptions: [
      {
        id: "award-1",
        sourceId: "http://example.com/award",
        programName: "Test Program",
        redemptionType: "flight",
        pricingBasis: "one_way",
        itineraryLabel: null,
        pointsRequired: 100,
        cashFees: null,
        seats: null,
        cabin: null,
        transferFromProgramId: null,
        transferRatio: null,
        centsPerPoint: null,
        availabilityStatus: "unknown",
        travelerCountCovered: 0,
        nightCountCovered: null,
        coverageStatus: "source_explicit",
      },
    ],
    cardOffers: [],
    assumptions: [],
    warnings: [],
  });

  stubFetch(zeroJson);

  const interpreter = new OllamaResearchInterpreter(
    "http://localhost:11434",
    "test-model"
  );

  await assert.rejects(
    () => interpreter.interpret(input),
    (error: unknown) => {
      assert.ok(error instanceof ResearchInterpreterError);
      assert.match((error as Error).message, /positive integer/);
      return true;
    }
  );

  // Negative nightCountCovered
  const negJson = JSON.stringify({
    awardOptions: [
      {
        id: "award-1",
        sourceId: "http://example.com/award",
        programName: "Test Program",
        redemptionType: "hotel",
        pricingBasis: "per_night",
        itineraryLabel: null,
        pointsRequired: 100,
        cashFees: null,
        seats: null,
        cabin: null,
        transferFromProgramId: null,
        transferRatio: null,
        centsPerPoint: null,
        availabilityStatus: "unknown",
        travelerCountCovered: null,
        nightCountCovered: -1,
        coverageStatus: "source_explicit",
      },
    ],
    cardOffers: [],
    assumptions: [],
    warnings: [],
  });

  stubFetch(negJson);

  await assert.rejects(
    () => interpreter.interpret(input),
    (error: unknown) => {
      assert.ok(error instanceof ResearchInterpreterError);
      assert.match((error as Error).message, /positive integer/);
      return true;
    }
  );

  // Fractional travelerCountCovered
  const fracJson = JSON.stringify({
    awardOptions: [
      {
        id: "award-1",
        sourceId: "http://example.com/award",
        programName: "Test Program",
        redemptionType: "flight",
        pricingBasis: "one_way",
        itineraryLabel: null,
        pointsRequired: 100,
        cashFees: null,
        seats: null,
        cabin: null,
        transferFromProgramId: null,
        transferRatio: null,
        centsPerPoint: null,
        availabilityStatus: "unknown",
        travelerCountCovered: 1.5,
        nightCountCovered: null,
        coverageStatus: "source_explicit",
      },
    ],
    cardOffers: [],
    assumptions: [],
    warnings: [],
  });

  stubFetch(fracJson);

  await assert.rejects(
    () => interpreter.interpret(input),
    (error: unknown) => {
      assert.ok(error instanceof ResearchInterpreterError);
      assert.match((error as Error).message, /positive integer/);
      return true;
    }
  );
});

test("flight with nightCountCovered is rejected", async () => {
  restoreEnv();

  const input = makeInput({
    research: [
      makeResearchResponse("query-1", [
        makeResearchResult(
          "Award source",
          "http://example.com/award",
          "Test Program has award for 100 points.",
          0.9,
          null,
          "official"
        ),
      ]),
    ],
    rewardPrograms: [{ id: "test-program", name: "Test Program" }],
  });

  const awardOptionJson = JSON.stringify({
    awardOptions: [
      {
        id: "award-1",
        sourceId: "http://example.com/award",
        programName: "Test Program",
        redemptionType: "flight",
        pricingBasis: "one_way",
        itineraryLabel: null,
        pointsRequired: 100,
        cashFees: null,
        seats: null,
        cabin: null,
        transferFromProgramId: null,
        transferRatio: null,
        centsPerPoint: null,
        availabilityStatus: "unknown",
        travelerCountCovered: null,
        nightCountCovered: 2,
        coverageStatus: "source_explicit",
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
      assert.match((error as Error).message, /flight but has nightCountCovered/);
      return true;
    }
  );
});

test("hotel with travelerCountCovered is rejected", async () => {
  restoreEnv();

  const input = makeInput({
    research: [
      makeResearchResponse("query-1", [
        makeResearchResult(
          "Award source",
          "http://example.com/award",
          "Test Program has hotel award for 100 points.",
          0.9,
          null,
          "official"
        ),
      ]),
    ],
    rewardPrograms: [{ id: "test-program", name: "Test Program" }],
  });

  const awardOptionJson = JSON.stringify({
    awardOptions: [
      {
        id: "award-1",
        sourceId: "http://example.com/award",
        programName: "Test Program",
        redemptionType: "hotel",
        pricingBasis: "per_night",
        itineraryLabel: null,
        pointsRequired: 100,
        cashFees: null,
        seats: null,
        cabin: null,
        transferFromProgramId: null,
        transferRatio: null,
        centsPerPoint: null,
        availabilityStatus: "unknown",
        travelerCountCovered: 2,
        nightCountCovered: null,
        coverageStatus: "source_explicit",
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
      assert.match((error as Error).message, /hotel but has travelerCountCovered/);
      return true;
    }
  );
});

test("unknown status with a non-null count is rejected", async () => {
  restoreEnv();

  const input = makeInput({
    research: [
      makeResearchResponse("query-1", [
        makeResearchResult(
          "Award source",
          "http://example.com/award",
          "Test Program has award for 100 points.",
          0.9,
          null,
          "official"
        ),
      ]),
    ],
    rewardPrograms: [{ id: "test-program", name: "Test Program" }],
  });

  const awardOptionJson = JSON.stringify({
    awardOptions: [
      {
        id: "award-1",
        sourceId: "http://example.com/award",
        programName: "Test Program",
        redemptionType: "flight",
        pricingBasis: "one_way",
        itineraryLabel: null,
        pointsRequired: 100,
        cashFees: null,
        seats: null,
        cabin: null,
        transferFromProgramId: null,
        transferRatio: null,
        centsPerPoint: null,
        availabilityStatus: "unknown",
        travelerCountCovered: 1,
        nightCountCovered: null,
        coverageStatus: "unknown",
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
      assert.match((error as Error).message, /coverageStatus "unknown" but a count is non-null/);
      return true;
    }
  );
});

test("standard-assumption hotel coverage is rejected for total_stay", async () => {
  restoreEnv();

  const input = makeInput({
    research: [
      makeResearchResponse("query-1", [
        makeResearchResult(
          "Award source",
          "http://example.com/award",
          "Test Program has hotel award for 100 points.",
          0.9,
          null,
          "official"
        ),
      ]),
    ],
    rewardPrograms: [{ id: "test-program", name: "Test Program" }],
  });

  const awardOptionJson = JSON.stringify({
    awardOptions: [
      {
        id: "award-1",
        sourceId: "http://example.com/award",
        programName: "Test Program",
        redemptionType: "hotel",
        pricingBasis: "total_stay",
        itineraryLabel: null,
        pointsRequired: 100,
        cashFees: null,
        seats: null,
        cabin: null,
        transferFromProgramId: null,
        transferRatio: null,
        centsPerPoint: null,
        availabilityStatus: "unknown",
        travelerCountCovered: null,
        nightCountCovered: 1,
        coverageStatus: "standard_assumption",
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
      assert.match((error as Error).message, /standard_assumption.*pricingBasis/);
      return true;
    }
  );
});

// --- goal-relevance classification tests ---

test("omitted legacy goal-classification fields normalize to general + []", async () => {
  restoreEnv();

  const input = makeInput({
    research: [
      makeResearchResponse("query-1", [
        makeResearchResult(
          "Award source",
          "http://example.com/award",
          "Test Program has award for 100 points.",
          0.9,
          null,
          "official"
        ),
      ]),
    ],
    rewardPrograms: [{ id: "test-program", name: "Test Program" }],
  });

  // No goalMatch/goalMismatchReasons at all — legacy fixture
  const awardOptionJson = JSON.stringify({
    awardOptions: [
      {
        id: "award-1",
        sourceId: "http://example.com/award",
        programName: "Test Program",
        redemptionType: "flight",
        pricingBasis: "unknown",
        itineraryLabel: null,
        pointsRequired: 100,
        cashFees: null,
        seats: null,
        cabin: null,
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
  assert.equal(result.awardOptions.length, 1);
  const opt = result.awardOptions[0];
  assert.equal(opt.goalMatch, "general");
  assert.deepStrictEqual(opt.goalMismatchReasons, []);
});

test("exact + [] is accepted", async () => {
  restoreEnv();

  const input = makeInput({
    research: [
      makeResearchResponse("query-1", [
        makeResearchResult(
          "Award source",
          "http://example.com/award",
          "Test Program has award for 100 points.",
          0.9,
          null,
          "official"
        ),
      ]),
    ],
    rewardPrograms: [{ id: "test-program", name: "Test Program" }],
  });

  const awardOptionJson = JSON.stringify({
    awardOptions: [
      {
        id: "award-1",
        sourceId: "http://example.com/award",
        programName: "Test Program",
        redemptionType: "flight",
        pricingBasis: "unknown",
        itineraryLabel: null,
        pointsRequired: 100,
        cashFees: null,
        seats: null,
        cabin: null,
        transferFromProgramId: null,
        transferRatio: null,
        centsPerPoint: null,
        availabilityStatus: "unknown",
        goalMatch: "exact",
        goalMismatchReasons: [],
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
  assert.equal(result.awardOptions.length, 1);
  const opt = result.awardOptions[0];
  assert.equal(opt.goalMatch, "exact");
  assert.deepStrictEqual(opt.goalMismatchReasons, []);
});

test("exact with mismatch reasons is rejected", async () => {
  restoreEnv();

  const input = makeInput({
    research: [
      makeResearchResponse("query-1", [
        makeResearchResult(
          "Award source",
          "http://example.com/award",
          "Test Program has award for 100 points.",
          0.9,
          null,
          "official"
        ),
      ]),
    ],
    rewardPrograms: [{ id: "test-program", name: "Test Program" }],
  });

  const awardOptionJson = JSON.stringify({
    awardOptions: [
      {
        id: "award-1",
        sourceId: "http://example.com/award",
        programName: "Test Program",
        redemptionType: "flight",
        pricingBasis: "unknown",
        itineraryLabel: null,
        pointsRequired: 100,
        cashFees: null,
        seats: null,
        cabin: null,
        transferFromProgramId: null,
        transferRatio: null,
        centsPerPoint: null,
        availabilityStatus: "unknown",
        goalMatch: "exact",
        goalMismatchReasons: ["origin"],
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
      assert.match((error as Error).message, /goalMatch "exact" but non-empty goalMismatchReasons/);
      return true;
    }
  );
});

test("partial with origin/dates reasons is accepted", async () => {
  restoreEnv();

  const input = makeInput({
    research: [
      makeResearchResponse("query-1", [
        makeResearchResult(
          "Award source",
          "http://example.com/award",
          "Test Program has award for 100 points.",
          0.9,
          null,
          "official"
        ),
      ]),
    ],
    rewardPrograms: [{ id: "test-program", name: "Test Program" }],
  });

  const awardOptionJson = JSON.stringify({
    awardOptions: [
      {
        id: "award-1",
        sourceId: "http://example.com/award",
        programName: "Test Program",
        redemptionType: "flight",
        pricingBasis: "unknown",
        itineraryLabel: null,
        pointsRequired: 100,
        cashFees: null,
        seats: null,
        cabin: null,
        transferFromProgramId: null,
        transferRatio: null,
        centsPerPoint: null,
        availabilityStatus: "unknown",
        goalMatch: "partial",
        goalMismatchReasons: ["origin", "dates"],
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
  assert.equal(result.awardOptions.length, 1);
  const opt = result.awardOptions[0];
  assert.equal(opt.goalMatch, "partial");
  assert.deepStrictEqual(opt.goalMismatchReasons, ["origin", "dates"]);
});

test("general benchmark is accepted", async () => {
  restoreEnv();

  const input = makeInput({
    research: [
      makeResearchResponse("query-1", [
        makeResearchResult(
          "Award source",
          "http://example.com/award",
          "Test Program has award for 100 points.",
          0.9,
          null,
          "official"
        ),
      ]),
    ],
    rewardPrograms: [{ id: "test-program", name: "Test Program" }],
  });

  const awardOptionJson = JSON.stringify({
    awardOptions: [
      {
        id: "award-1",
        sourceId: "http://example.com/award",
        programName: "Test Program",
        redemptionType: "flight",
        pricingBasis: "unknown",
        itineraryLabel: null,
        pointsRequired: 100,
        cashFees: null,
        seats: null,
        cabin: null,
        transferFromProgramId: null,
        transferRatio: null,
        centsPerPoint: null,
        availabilityStatus: "unknown",
        goalMatch: "general",
        goalMismatchReasons: [],
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
  assert.equal(result.awardOptions.length, 1);
  const opt = result.awardOptions[0];
  assert.equal(opt.goalMatch, "general");
  assert.deepStrictEqual(opt.goalMismatchReasons, []);
});

test("different_destination with destination reason is accepted", async () => {
  restoreEnv();

  const input = makeInput({
    research: [
      makeResearchResponse("query-1", [
        makeResearchResult(
          "Award source",
          "http://example.com/award",
          "Test Program has award for 100 points.",
          0.9,
          null,
          "official"
        ),
      ]),
    ],
    rewardPrograms: [{ id: "test-program", name: "Test Program" }],
  });

  const awardOptionJson = JSON.stringify({
    awardOptions: [
      {
        id: "award-1",
        sourceId: "http://example.com/award",
        programName: "Test Program",
        redemptionType: "flight",
        pricingBasis: "unknown",
        itineraryLabel: null,
        pointsRequired: 100,
        cashFees: null,
        seats: null,
        cabin: null,
        transferFromProgramId: null,
        transferRatio: null,
        centsPerPoint: null,
        availabilityStatus: "unknown",
        goalMatch: "different_destination",
        goalMismatchReasons: ["destination"],
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
  assert.equal(result.awardOptions.length, 1);
  const opt = result.awardOptions[0];
  assert.equal(opt.goalMatch, "different_destination");
  assert.deepStrictEqual(opt.goalMismatchReasons, ["destination"]);
});

test("different_destination without destination reason is rejected", async () => {
  restoreEnv();

  const input = makeInput({
    research: [
      makeResearchResponse("query-1", [
        makeResearchResult(
          "Award source",
          "http://example.com/award",
          "Test Program has award for 100 points.",
          0.9,
          null,
          "official"
        ),
      ]),
    ],
    rewardPrograms: [{ id: "test-program", name: "Test Program" }],
  });

  const awardOptionJson = JSON.stringify({
    awardOptions: [
      {
        id: "award-1",
        sourceId: "http://example.com/award",
        programName: "Test Program",
        redemptionType: "flight",
        pricingBasis: "unknown",
        itineraryLabel: null,
        pointsRequired: 100,
        cashFees: null,
        seats: null,
        cabin: null,
        transferFromProgramId: null,
        transferRatio: null,
        centsPerPoint: null,
        availabilityStatus: "unknown",
        goalMatch: "different_destination",
        goalMismatchReasons: ["origin"],
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
      assert.match((error as Error).message, /different_destination.*does not include "destination"/);
      return true;
    }
  );
});

test("duplicate reasons are rejected", async () => {
  restoreEnv();

  const input = makeInput({
    research: [
      makeResearchResponse("query-1", [
        makeResearchResult(
          "Award source",
          "http://example.com/award",
          "Test Program has award for 100 points.",
          0.9,
          null,
          "official"
        ),
      ]),
    ],
    rewardPrograms: [{ id: "test-program", name: "Test Program" }],
  });

  const awardOptionJson = JSON.stringify({
    awardOptions: [
      {
        id: "award-1",
        sourceId: "http://example.com/award",
        programName: "Test Program",
        redemptionType: "flight",
        pricingBasis: "unknown",
        itineraryLabel: null,
        pointsRequired: 100,
        cashFees: null,
        seats: null,
        cabin: null,
        transferFromProgramId: null,
        transferRatio: null,
        centsPerPoint: null,
        availabilityStatus: "unknown",
        goalMatch: "partial",
        goalMismatchReasons: ["origin", "origin"],
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
      assert.match((error as Error).message, /duplicate goalMismatchReasons value "origin"/);
      return true;
    }
  );
});

test("unknown match value is rejected", async () => {
  restoreEnv();

  const input = makeInput({
    research: [
      makeResearchResponse("query-1", [
        makeResearchResult(
          "Award source",
          "http://example.com/award",
          "Test Program has award for 100 points.",
          0.9,
          null,
          "official"
        ),
      ]),
    ],
    rewardPrograms: [{ id: "test-program", name: "Test Program" }],
  });

  const awardOptionJson = JSON.stringify({
    awardOptions: [
      {
        id: "award-1",
        sourceId: "http://example.com/award",
        programName: "Test Program",
        redemptionType: "flight",
        pricingBasis: "unknown",
        itineraryLabel: null,
        pointsRequired: 100,
        cashFees: null,
        seats: null,
        cabin: null,
        transferFromProgramId: null,
        transferRatio: null,
        centsPerPoint: null,
        availabilityStatus: "unknown",
        goalMatch: "super_exact",
        goalMismatchReasons: [],
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
      assert.match((error as Error).message, /invalid goalMatch "super_exact"/);
      return true;
    }
  );
});

test("unknown mismatch reason value is rejected", async () => {
  restoreEnv();

  const input = makeInput({
    research: [
      makeResearchResponse("query-1", [
        makeResearchResult(
          "Award source",
          "http://example.com/award",
          "Test Program has award for 100 points.",
          0.9,
          null,
          "official"
        ),
      ]),
    ],
    rewardPrograms: [{ id: "test-program", name: "Test Program" }],
  });

  const awardOptionJson = JSON.stringify({
    awardOptions: [
      {
        id: "award-1",
        sourceId: "http://example.com/award",
        programName: "Test Program",
        redemptionType: "flight",
        pricingBasis: "unknown",
        itineraryLabel: null,
        pointsRequired: 100,
        cashFees: null,
        seats: null,
        cabin: null,
        transferFromProgramId: null,
        transferRatio: null,
        centsPerPoint: null,
        availabilityStatus: "unknown",
        goalMatch: "partial",
        goalMismatchReasons: ["airline"],
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
      assert.match((error as Error).message, /unknown goalMismatchReasons value "airline"/);
      return true;
    }
  );
});

test("London benchmark preserved as different_destination for Paris research query", async () => {
  restoreEnv();

  const input = makeInput({
    research: [
      makeResearchResponse("query-1", [
        makeResearchResult(
          "London award chart",
          "http://example.com/london",
          "Test Program has award for 100 points for London flights.",
          0.9,
          null,
          "official"
        ),
      ]),
    ],
    rewardPrograms: [{ id: "test-program", name: "Test Program" }],
  });

  const awardOptionJson = JSON.stringify({
    awardOptions: [
      {
        id: "award-1",
        sourceId: "http://example.com/london",
        programName: "Test Program",
        redemptionType: "flight",
        pricingBasis: "unknown",
        itineraryLabel: "London benchmark",
        pointsRequired: 100,
        cashFees: null,
        seats: null,
        cabin: null,
        transferFromProgramId: null,
        transferRatio: null,
        centsPerPoint: null,
        availabilityStatus: "unknown",
        goalMatch: "different_destination",
        goalMismatchReasons: ["destination"],
      },
    ],
    cardOffers: [],
    assumptions: ["London benchmark for Paris research query"],
    warnings: [],
  });

  stubFetch(awardOptionJson);

  const interpreter = new OllamaResearchInterpreter(
    "http://localhost:11434",
    "test-model"
  );

  const result = await interpreter.interpret(input);
  assert.equal(result.awardOptions.length, 1);
  const opt = result.awardOptions[0];
  assert.equal(opt.goalMatch, "different_destination");
  assert.deepStrictEqual(opt.goalMismatchReasons, ["destination"]);
  assert.equal(opt.itineraryLabel, "London benchmark");
});

test("flight_options accepts a valid flight", async () => {
  restoreEnv();

  const input = makeInput({
    focus: "flight_options",
    research: [
      makeResearchResponse("query-1", [
        makeResearchResult(
          "Award source",
          "http://example.com/award",
          "Test Program has award for 100 points.",
          0.9,
          null,
          "official"
        ),
      ]),
    ],
    rewardPrograms: [{ id: "test-program", name: "Test Program" }],
  });

  stubFetch(makeAwardOptionContent("flight", "one_way"));

  const interpreter = new OllamaResearchInterpreter(
    "http://localhost:11434",
    "test-model"
  );

  const result = await interpreter.interpret(input);
  assert.equal(result.awardOptions.length, 1);
  assert.equal(result.awardOptions[0].redemptionType, "flight");
  assert.equal(result.cardOffers.length, 0);
});

test("flight_options rejects a valid hotel", async () => {
  restoreEnv();

  const input = makeInput({
    focus: "flight_options",
    research: [
      makeResearchResponse("query-1", [
        makeResearchResult(
          "Award source",
          "http://example.com/award",
          "Test Program has award for 100 points.",
          0.9,
          null,
          "official"
        ),
      ]),
    ],
    rewardPrograms: [{ id: "test-program", name: "Test Program" }],
  });

  stubFetch(makeAwardOptionContent("hotel", "per_night"));

  const interpreter = new OllamaResearchInterpreter(
    "http://localhost:11434",
    "test-model"
  );

  await assert.rejects(
    () => interpreter.interpret(input),
    (error: unknown) => {
      assert.ok(error instanceof ResearchInterpreterError);
      assert.match((error as Error).message, /flight_options but .* hotel award option/);
      return true;
    }
  );
});

test("hotel_options accepts a valid hotel", async () => {
  restoreEnv();

  const input = makeInput({
    focus: "hotel_options",
    research: [
      makeResearchResponse("query-1", [
        makeResearchResult(
          "Award source",
          "http://example.com/award",
          "Test Program has award for 100 points.",
          0.9,
          null,
          "official"
        ),
      ]),
    ],
    rewardPrograms: [{ id: "test-program", name: "Test Program" }],
  });

  stubFetch(makeAwardOptionContent("hotel", "per_night"));

  const interpreter = new OllamaResearchInterpreter(
    "http://localhost:11434",
    "test-model"
  );

  const result = await interpreter.interpret(input);
  assert.equal(result.awardOptions.length, 1);
  assert.equal(result.awardOptions[0].redemptionType, "hotel");
  assert.equal(result.cardOffers.length, 0);
});

test("hotel_options rejects a valid flight", async () => {
  restoreEnv();

  const input = makeInput({
    focus: "hotel_options",
    research: [
      makeResearchResponse("query-1", [
        makeResearchResult(
          "Award source",
          "http://example.com/award",
          "Test Program has award for 100 points.",
          0.9,
          null,
          "official"
        ),
      ]),
    ],
    rewardPrograms: [{ id: "test-program", name: "Test Program" }],
  });

  stubFetch(makeAwardOptionContent("flight", "one_way"));

  const interpreter = new OllamaResearchInterpreter(
    "http://localhost:11434",
    "test-model"
  );

  await assert.rejects(
    () => interpreter.interpret(input),
    (error: unknown) => {
      assert.ok(error instanceof ResearchInterpreterError);
      assert.match((error as Error).message, /hotel_options but .* flight award option/);
      return true;
    }
  );
});

test("flight_options rejects nonempty cardOffers", async () => {
  restoreEnv();

  const input = makeInput({
    focus: "flight_options",
    research: [
      makeResearchResponse("query-1", [
        makeResearchResult(
          "Card source",
          "http://example.com/card",
          "Earn 50000 points after spending 3000 dollars in 3 months. Annual fee 95.",
          0.9,
          null,
          "official"
        ),
      ]),
    ],
    rewardPrograms: [{ id: "program-1", name: "Program One" }],
  });

  const cardOfferJson = JSON.stringify({
    awardOptions: [],
    cardOffers: [
      {
        id: "card-1",
        sourceId: "http://example.com/card",
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
      assert.match((error as Error).message, /flight_options but .* card offer/);
      return true;
    }
  );
});

test("hotel_options rejects nonempty cardOffers", async () => {
  restoreEnv();

  const input = makeInput({
    focus: "hotel_options",
    research: [
      makeResearchResponse("query-1", [
        makeResearchResult(
          "Card source",
          "http://example.com/card",
          "Earn 50000 points after spending 3000 dollars in 3 months. Annual fee 95.",
          0.9,
          null,
          "official"
        ),
      ]),
    ],
    rewardPrograms: [{ id: "program-1", name: "Program One" }],
  });

  const cardOfferJson = JSON.stringify({
    awardOptions: [],
    cardOffers: [
      {
        id: "card-1",
        sourceId: "http://example.com/card",
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
      assert.match((error as Error).message, /hotel_options but .* card offer/);
      return true;
    }
  );
});

test("legacy award_options still accepts both flight and hotel fixtures", async () => {
  restoreEnv();

  // Flight fixture
  const inputFlight = makeInput({
    focus: "award_options",
    research: [
      makeResearchResponse("query-1", [
        makeResearchResult(
          "Award source",
          "http://example.com/award",
          "Test Program has award for 100 points.",
          0.9,
          null,
          "official"
        ),
      ]),
    ],
    rewardPrograms: [{ id: "test-program", name: "Test Program" }],
  });

  stubFetch(makeAwardOptionContent("flight", "one_way"));

  const interpreter = new OllamaResearchInterpreter(
    "http://localhost:11434",
    "test-model"
  );

  const flightResult = await interpreter.interpret(inputFlight);
  assert.equal(flightResult.awardOptions.length, 1);
  assert.equal(flightResult.awardOptions[0].redemptionType, "flight");

  // Hotel fixture
  const inputHotel = makeInput({
    focus: "award_options",
    research: [
      makeResearchResponse("query-1", [
        makeResearchResult(
          "Award source",
          "http://example.com/award",
          "Test Program has award for 100 points.",
          0.9,
          null,
          "official"
        ),
      ]),
    ],
    rewardPrograms: [{ id: "test-program", name: "Test Program" }],
  });

  stubFetch(makeAwardOptionContent("hotel", "per_night"));

  const hotelResult = await interpreter.interpret(inputHotel);
  assert.equal(hotelResult.awardOptions.length, 1);
  assert.equal(hotelResult.awardOptions[0].redemptionType, "hotel");
});
