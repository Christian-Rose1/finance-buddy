import { test } from "node:test";
import assert from "node:assert/strict";

import type { Goal, RewardAccount } from "./types";
import { OllamaStrategyProvider, StrategyProviderError } from "./ollamaStrategyProvider";
import type {
  PersonalizedStrategyNarrative,
  PersonalizedStrategyContext,
  SanitizedStrategyPrompt,
} from "./strategyTypes";
import { buildSanitizedStrategyPayload } from "./sanitizedStrategyPayload";

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

const rewardAccounts: RewardAccount[] = [
  {
    id: "ra-1",
    userId: "user-1",
    rewardProgramId: "program-1",
    ownerKey: "self",
    ownerLabel: "Me",
    ownerType: "self",
    balance: 100000,
    balanceAsOf: "2026-08-01",
    origin: "manual",
    verificationStatus: "verified",
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
  },
];

const validFlightOption = {
  id: "award-1",
  sourceId: "src-award",
  programName: "Air France Flying Blue",
  redemptionType: "flight" as const,
  pricingBasis: "round_trip" as const,
  itineraryLabel: "JFK-CDG round trip",
  pointsRequired: 120000,
  cashFees: 200,
  seats: 4,
  cabin: "economy",
  transferFromProgramId: null,
  transferRatio: null,
  centsPerPoint: 1.3,
  availabilityStatus: "available" as const,
};

const validHotelOption = {
  id: "award-2",
  sourceId: "src-award",
  programName: "Hilton Honors",
  redemptionType: "hotel" as const,
  pricingBasis: "per_night" as const,
  itineraryLabel: "Hilton Paris Opera",
  pointsRequired: 60000,
  cashFees: 50,
  seats: null,
  cabin: null,
  transferFromProgramId: null,
  transferRatio: null,
  centsPerPoint: null,
  availabilityStatus: "unknown" as const,
};

const catalogRewardPrograms = [
  { id: "program-1", name: "Chase Ultimate Rewards" },
];

function makeContext(overrides: Partial<PersonalizedStrategyContext> = {}): PersonalizedStrategyContext {
  return {
    goal,
    rewardAccounts,
    walletCards: [
      {
        id: "wc-1",
        name: "Chase Sapphire Preferred",
        issuer: "Chase",
        rewardCurrency: "ultimate_rewards",
        cardProductId: "csp",
      },
    ],
    monthlySpendingByCategory: [
      { category: "dining", monthlyAverage: 300 },
      { category: "travel", monthlyAverage: 150 },
    ],
    awardOptions: [validFlightOption],
    cardOffers: [
      {
        id: "offer-1",
        sourceId: "src-offer",
        cardName: "Chase Sapphire Preferred",
        issuer: "Chase",
        welcomeBonusPoints: 60000,
        spendingRequirement: 4000,
        spendingDeadlineMonths: 3,
        annualFee: 95,
        destinationProgramId: "program-1",
      },
    ],
    sources: [
      {
        id: "src-award",
        label: "Air France award search",
        status: "live",
        observedAt: "2026-08-20T00:00:00.000Z",
      },
      {
        id: "src-offer",
        label: "Chase card offer terms",
        status: "catalog",
        observedAt: null,
      },
    ],
    generatedAt: "2026-08-20T12:00:00.000Z",
    ...overrides,
  };
}

function makeSanitizedPrompt(
  overrides: Partial<PersonalizedStrategyContext> = {}
): SanitizedStrategyPrompt {
  return buildSanitizedStrategyPayload(
    makeContext(overrides),
    catalogRewardPrograms
  );
}

function makeValidStrategy(): PersonalizedStrategyNarrative {
  return {
    headline: "Book with Air France",
    summary: "You have enough points today.",
    feasibility: "on_track",
    pointsGap: 0,
    recommendedAwardOptionId: "award-1",
    recommendedCardOfferId: null,
    flightOptions: [validFlightOption],
    hotelOptions: [],
    actions: [
      {
        priority: 1,
        title: "Book now",
        explanation: "Award is available today.",
        deadline: null,
        sourceIds: ["src-award"],
      },
    ],
    alternatives: [
      {
        title: "Wait for more seats",
        tradeoff: "Availability may change.",
        sourceIds: ["src-award"],
      },
    ],
    assumptions: ["Balances are current as of the as-of date."],
    warnings: ["Award availability can change."],
    followUpQuestions: [],
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

test("sanitized prompt is sent to Ollama", async () => {
  restoreEnv();

  const prompt = makeSanitizedPrompt();

  const strategy = makeValidStrategy();

  let capturedBody: string | null = null;

  stubFetch(JSON.stringify(strategy), (_url, init) => {
    capturedBody = typeof init.body === "string" ? init.body : null;
  });

  const provider = new OllamaStrategyProvider(
    "http://localhost:11434",
    "test-model"
  );

  const result = await provider.generateStrategy(prompt);

  assert.ok(capturedBody, "fetch body should be captured");

  const body = JSON.parse(capturedBody as string);

  assert.equal(body.model, "test-model");
  assert.equal(body.messages.length, 2);
  assert.equal(body.messages[0].role, "system");
  assert.equal(body.messages[1].role, "user");

  const sentPrompt = JSON.parse(body.messages[1].content);

  // Verify the sent payload is sanitized (no internal IDs).
  assert.ok(!("id" in sentPrompt.goal), "goal.id must not be sent");
  assert.ok(!("userId" in sentPrompt.goal), "goal.userId must not be sent");
  assert.equal(sentPrompt.goal.title, "Trip to Europe");
  assert.equal(sentPrompt.awardOptions[0].id, "award-1");
  assert.equal(sentPrompt.cardOffers[0].id, "offer-1");
  assert.equal(sentPrompt.monthlySpendingByCategory.length, 2);

  assert.equal(result.headline, strategy.headline);
});

test("valid JSON maps successfully", async () => {
  restoreEnv();

  const prompt = makeSanitizedPrompt();

  const strategy = makeValidStrategy();

  stubFetch(JSON.stringify(strategy));

  const provider = new OllamaStrategyProvider(
    "http://localhost:11434",
    "test-model"
  );

  const result = await provider.generateStrategy(prompt);

  assert.deepEqual(result, strategy);
});

test("malformed JSON is rejected", async () => {
  restoreEnv();

  const prompt = makeSanitizedPrompt();

  stubFetch("this is not json");

  const provider = new OllamaStrategyProvider(
    "http://localhost:11434",
    "test-model"
  );

  await assert.rejects(
    () => provider.generateStrategy(prompt),
    (error: unknown) => {
      assert.ok(error instanceof StrategyProviderError);
      assert.match((error as Error).message, /did not return valid JSON/);
      return true;
    }
  );
});

test("invented award option ID is cleared with a warning (not rejected)", async () => {
  restoreEnv();

  const prompt = makeSanitizedPrompt();

  const strategy = makeValidStrategy();

  strategy.recommendedAwardOptionId = "fabricated-award-id";

  stubFetch(JSON.stringify(strategy));

  const provider = new OllamaStrategyProvider(
    "http://localhost:11434",
    "test-model"
  );

  const result = await provider.generateStrategy(prompt);
  assert.equal(result.recommendedAwardOptionId, null);
  assert.ok(result.warnings.some((w) => /fabricated-award-id/.test(w)));
});

test("invented card offer ID is cleared with a warning (not rejected)", async () => {
  restoreEnv();

  const prompt = makeSanitizedPrompt();

  const strategy = makeValidStrategy();

  strategy.recommendedCardOfferId = "fabricated-offer-id";

  stubFetch(JSON.stringify(strategy));

  const provider = new OllamaStrategyProvider(
    "http://localhost:11434",
    "test-model"
  );

  const result = await provider.generateStrategy(prompt);
  assert.equal(result.recommendedCardOfferId, null);
  assert.ok(result.warnings.some((w) => /fabricated-offer-id/.test(w)));
});

test("unknown source ID is rejected", async () => {
  restoreEnv();

  const prompt = makeSanitizedPrompt();

  const strategy = makeValidStrategy();

  strategy.actions[0].sourceIds = ["nonexistent-source"];

  stubFetch(JSON.stringify(strategy));

  const provider = new OllamaStrategyProvider(
    "http://localhost:11434",
    "test-model"
  );

  await assert.rejects(
    () => provider.generateStrategy(prompt),
    (error: unknown) => {
      assert.ok(error instanceof StrategyProviderError);
      assert.match((error as Error).message, /nonexistent-source/);
      assert.match(
        (error as Error).message,
        /not present in context\.sources/
      );
      return true;
    }
  );
});

test("card recommendation is cleared when allowNewCards is false", async () => {
  restoreEnv();

  const prompt = makeSanitizedPrompt({
    goal: {
      ...goal,
      allowNewCards: false,
    },
  });

  const strategy = makeValidStrategy();

  strategy.recommendedCardOfferId = "offer-1";

  stubFetch(JSON.stringify(strategy));

  const provider = new OllamaStrategyProvider(
    "http://localhost:11434",
    "test-model"
  );

  const result = await provider.generateStrategy(prompt);
  assert.equal(result.recommendedCardOfferId, null);
  assert.ok(result.warnings.some((w) => /allowNewCards is false/.test(w)));
});

test("missing configuration is rejected", async () => {
  restoreEnv();

  delete process.env.OLLAMA_BASE_URL;
  delete process.env.OLLAMA_STRATEGY_MODEL;

  assert.throws(
    () => new OllamaStrategyProvider(),
    (error: unknown) => {
      assert.ok(error instanceof StrategyProviderError);
      assert.match(
        (error as Error).message,
        /OLLAMA_BASE_URL environment variable is required/
      );
      return true;
    }
  );

  restoreEnv();

  process.env.OLLAMA_BASE_URL = "http://localhost:11434";
  delete process.env.OLLAMA_STRATEGY_MODEL;

  assert.throws(
    () => new OllamaStrategyProvider(),
    (error: unknown) => {
      assert.ok(error instanceof StrategyProviderError);
      assert.match(
        (error as Error).message,
        /OLLAMA_STRATEGY_MODEL environment variable is required/
      );
      return true;
    }
  );
});

test("invalid feasibility is rejected", async () => {
  restoreEnv();

  const prompt = makeSanitizedPrompt();

  const strategy = makeValidStrategy();

  (strategy as { feasibility: string }).feasibility = "bogus";

  stubFetch(JSON.stringify(strategy));

  const provider = new OllamaStrategyProvider(
    "http://localhost:11434",
    "test-model"
  );

  await assert.rejects(
    () => provider.generateStrategy(prompt),
    (error: unknown) => {
      assert.ok(error instanceof StrategyProviderError);
      assert.match((error as Error).message, /invalid feasibility/);
      return true;
    }
  );
});

test("negative pointsGap is rejected", async () => {
  restoreEnv();

  const prompt = makeSanitizedPrompt();

  const strategy = makeValidStrategy();

  strategy.pointsGap = -100;

  stubFetch(JSON.stringify(strategy));

  const provider = new OllamaStrategyProvider(
    "http://localhost:11434",
    "test-model"
  );

  await assert.rejects(
    () => provider.generateStrategy(prompt),
    (error: unknown) => {
      assert.ok(error instanceof StrategyProviderError);
      assert.match((error as Error).message, /negative pointsGap/);
      return true;
    }
  );
});

test("missing required fields are rejected", async () => {
  restoreEnv();

  const prompt = makeSanitizedPrompt();

  stubFetch(
    JSON.stringify({
      headline: "no summary present",
    })
  );

  const provider = new OllamaStrategyProvider(
    "http://localhost:11434",
    "test-model"
  );

  await assert.rejects(
    () => provider.generateStrategy(prompt),
    (error: unknown) => {
      assert.ok(error instanceof StrategyProviderError);
      assert.match((error as Error).message, /missing required string field "summary"/);
      return true;
    }
  );
});

test("input prompt is not mutated", async () => {
  restoreEnv();

  const prompt = makeSanitizedPrompt();

  const before = JSON.stringify(prompt);

  const strategy = makeValidStrategy();

  stubFetch(JSON.stringify(strategy));

  const provider = new OllamaStrategyProvider(
    "http://localhost:11434",
    "test-model"
  );

  await provider.generateStrategy(prompt);

  const after = JSON.stringify(prompt);

  assert.equal(after, before);
});

test("one validated flight is returned in flightOptions", async () => {
  restoreEnv();

  const prompt = makeSanitizedPrompt();

  const strategy = makeValidStrategy();

  stubFetch(JSON.stringify(strategy));

  const provider = new OllamaStrategyProvider(
    "http://localhost:11434",
    "test-model"
  );

  const result = await provider.generateStrategy(prompt);

  assert.equal(result.flightOptions.length, 1);
  assert.equal(result.flightOptions[0].id, "award-1");
  assert.equal(result.flightOptions[0].redemptionType, "flight");
});

test("one validated hotel is returned in hotelOptions", async () => {
  restoreEnv();

  const prompt = makeSanitizedPrompt({
    awardOptions: [validFlightOption, validHotelOption],
  });

  const strategy = makeValidStrategy();

  stubFetch(JSON.stringify(strategy));

  const provider = new OllamaStrategyProvider(
    "http://localhost:11434",
    "test-model"
  );

  const result = await provider.generateStrategy(prompt);

  assert.equal(result.hotelOptions.length, 1);
  assert.equal(result.hotelOptions[0].id, "award-2");
  assert.equal(result.hotelOptions[0].redemptionType, "hotel");
});

test("duplicate IDs are deduplicated", async () => {
  restoreEnv();

  const prompt = makeSanitizedPrompt({
    awardOptions: [
      validFlightOption,
      validFlightOption,
      validHotelOption,
      validHotelOption,
    ],
  });

  const strategy = makeValidStrategy();

  stubFetch(JSON.stringify(strategy));

  const provider = new OllamaStrategyProvider(
    "http://localhost:11434",
    "test-model"
  );

  const result = await provider.generateStrategy(prompt);

  assert.equal(result.flightOptions.length, 1);
  assert.equal(result.hotelOptions.length, 1);
});

test("original order is preserved when deduplicating", async () => {
  restoreEnv();

  const flightB = { ...validFlightOption, id: "flight-b", pointsRequired: 101 };
  const flightA = { ...validFlightOption, id: "flight-a", pointsRequired: 102 };

  const prompt = makeSanitizedPrompt({
    awardOptions: [flightB, validFlightOption, flightA, validFlightOption],
  });

  const strategy = makeValidStrategy();

  stubFetch(JSON.stringify(strategy));

  const provider = new OllamaStrategyProvider(
    "http://localhost:11434",
    "test-model"
  );

  const result = await provider.generateStrategy(prompt);

  // First-seen order: flight-b, then award-1, then flight-a. Duplicates removed.
  assert.deepEqual(
    result.flightOptions.map((o) => o.id),
    ["flight-b", "award-1", "flight-a"]
  );
});

test("empty context options produce two empty arrays", async () => {
  restoreEnv();

  const prompt = makeSanitizedPrompt({ awardOptions: [] });

  // No award option exists in the context, so the strategy must not
  // reference one (the provider's existing validation enforces this).
  const strategy = {
    ...makeValidStrategy(),
    recommendedAwardOptionId: null,
  };

  stubFetch(JSON.stringify(strategy));

  const provider = new OllamaStrategyProvider(
    "http://localhost:11434",
    "test-model"
  );

  const result = await provider.generateStrategy(prompt);

  assert.deepEqual(result.flightOptions, []);
  assert.deepEqual(result.hotelOptions, []);
});

test("model-supplied fake option arrays cannot enter the returned strategy", async () => {
  restoreEnv();

  const prompt = makeSanitizedPrompt();

  const strategy = makeValidStrategy();

  // The model attempts to inject fabricated options via fields the provider
  // must never read.
  (strategy as unknown as Record<string, unknown>).flightOptions = [
    {
      id: "fake-flight",
      sourceId: "fake-src",
      programName: "Fake Airline",
      redemptionType: "flight",
      pricingBasis: "one_way",
      itineraryLabel: "FAKE ROUTE",
      pointsRequired: 1,
      cashFees: null,
      seats: null,
      cabin: null,
      transferFromProgramId: null,
      transferRatio: null,
      centsPerPoint: null,
      availabilityStatus: "unknown",
    },
  ];
  (strategy as unknown as Record<string, unknown>).hotelOptions = [
    {
      id: "fake-hotel",
      sourceId: "fake-src",
      programName: "Fake Hotel",
      redemptionType: "hotel",
      pricingBasis: "per_night",
      itineraryLabel: "FAKE STAY",
      pointsRequired: 1,
      cashFees: null,
      seats: null,
      cabin: null,
      transferFromProgramId: null,
      transferRatio: null,
      centsPerPoint: null,
      availabilityStatus: "unknown",
    },
  ];

  stubFetch(JSON.stringify(strategy));

  const provider = new OllamaStrategyProvider(
    "http://localhost:11434",
    "test-model"
  );

  const result = await provider.generateStrategy(prompt);

  // Only the validated context option may appear; fake ids must not.
  assert.equal(result.flightOptions.length, 1);
  assert.equal(result.flightOptions[0].id, "award-1");
  assert.equal(result.hotelOptions.length, 0);
  assert.equal(
    result.flightOptions.some((o) => o.id === "fake-flight"),
    false
  );
});

test("existing narrative fields remain unchanged", async () => {
  restoreEnv();

  const prompt = makeSanitizedPrompt({
    awardOptions: [validFlightOption, validHotelOption],
  });

  const strategy = makeValidStrategy();

  stubFetch(JSON.stringify(strategy));

  const provider = new OllamaStrategyProvider(
    "http://localhost:11434",
    "test-model"
  );

  const result = await provider.generateStrategy(prompt);

  assert.equal(result.headline, "Book with Air France");
  assert.equal(result.summary, "You have enough points today.");
  assert.equal(result.feasibility, "on_track");
  assert.equal(result.pointsGap, 0);
  assert.equal(result.recommendedAwardOptionId, "award-1");
  assert.equal(result.recommendedCardOfferId, null);
  assert.equal(result.actions.length, 1);
  assert.equal(result.alternatives.length, 1);
  assert.deepEqual(result.assumptions, ["Balances are current as of the as-of date."]);
  assert.deepEqual(result.warnings, ["Award availability can change."]);
  assert.deepEqual(result.followUpQuestions, []);
});