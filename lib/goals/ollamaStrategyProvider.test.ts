import { test } from "node:test";
import assert from "node:assert/strict";

import type { Goal, RewardAccount } from "./types";
import { OllamaStrategyProvider, StrategyProviderError } from "./ollamaStrategyProvider";
import type {
  PersonalizedStrategy,
  PersonalizedStrategyContext,
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
    awardOptions: [
      {
        id: "award-1",
        sourceId: "src-award",
        programName: "Air France Flying Blue",
        itineraryLabel: "JFK-CDG round trip",
        pointsRequired: 120000,
        cashFees: 200,
        seats: 4,
        cabin: "economy",
        transferFromProgramId: null,
        transferRatio: null,
        centsPerPoint: 1.3,
        availabilityStatus: "available",
      },
    ],
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

function makeValidStrategy(): PersonalizedStrategy {
  return {
    headline: "Book with Air France",
    summary: "You have enough points today.",
    feasibility: "on_track",
    pointsGap: 0,
    recommendedAwardOptionId: "award-1",
    recommendedCardOfferId: null,
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

test("personalized context is sent to Ollama", async () => {
  restoreEnv();

  const context = makeContext();

  const strategy = makeValidStrategy();

  let capturedBody: string | null = null;

  stubFetch(JSON.stringify(strategy), (_url, init) => {
    capturedBody = typeof init.body === "string" ? init.body : null;
  });

  const provider = new OllamaStrategyProvider(
    "http://localhost:11434",
    "test-model"
  );

  const result = await provider.generateStrategy(context);

  assert.ok(capturedBody, "fetch body should be captured");

  const body = JSON.parse(capturedBody as string);

  assert.equal(body.model, "test-model");
  assert.equal(body.messages.length, 2);
  assert.equal(body.messages[0].role, "system");
  assert.equal(body.messages[1].role, "user");

  const sentContext = JSON.parse(body.messages[1].content);

  assert.deepEqual(sentContext.goal, context.goal);
  assert.equal(
    sentContext.awardOptions[0].id,
    "award-1"
  );
  assert.equal(sentContext.cardOffers[0].id, "offer-1");
  assert.equal(sentContext.monthlySpendingByCategory.length, 2);

  assert.equal(result.headline, strategy.headline);
});

test("valid JSON maps successfully", async () => {
  restoreEnv();

  const context = makeContext();

  const strategy = makeValidStrategy();

  stubFetch(JSON.stringify(strategy));

  const provider = new OllamaStrategyProvider(
    "http://localhost:11434",
    "test-model"
  );

  const result = await provider.generateStrategy(context);

  assert.deepEqual(result, strategy);
});

test("malformed JSON is rejected", async () => {
  restoreEnv();

  const context = makeContext();

  stubFetch("this is not json");

  const provider = new OllamaStrategyProvider(
    "http://localhost:11434",
    "test-model"
  );

  await assert.rejects(
    () => provider.generateStrategy(context),
    (error: unknown) => {
      assert.ok(error instanceof StrategyProviderError);
      assert.match((error as Error).message, /did not return valid JSON/);
      return true;
    }
  );
});

test("invented award option ID is rejected", async () => {
  restoreEnv();

  const context = makeContext();

  const strategy = makeValidStrategy();

  strategy.recommendedAwardOptionId = "fabricated-award-id";

  stubFetch(JSON.stringify(strategy));

  const provider = new OllamaStrategyProvider(
    "http://localhost:11434",
    "test-model"
  );

  await assert.rejects(
    () => provider.generateStrategy(context),
    (error: unknown) => {
      assert.ok(error instanceof StrategyProviderError);
      assert.match(
        (error as Error).message,
        /fabricated-award-id/
      );
      assert.match(
        (error as Error).message,
        /not present in context\.awardOptions/
      );
      return true;
    }
  );
});

test("invented card offer ID is rejected", async () => {
  restoreEnv();

  const context = makeContext();

  const strategy = makeValidStrategy();

  strategy.recommendedCardOfferId = "fabricated-offer-id";

  stubFetch(JSON.stringify(strategy));

  const provider = new OllamaStrategyProvider(
    "http://localhost:11434",
    "test-model"
  );

  await assert.rejects(
    () => provider.generateStrategy(context),
    (error: unknown) => {
      assert.ok(error instanceof StrategyProviderError);
      assert.match(
        (error as Error).message,
        /fabricated-offer-id/
      );
      assert.match(
        (error as Error).message,
        /not present in context\.cardOffers/
      );
      return true;
    }
  );
});

test("unknown source ID is rejected", async () => {
  restoreEnv();

  const context = makeContext();

  const strategy = makeValidStrategy();

  strategy.actions[0].sourceIds = ["nonexistent-source"];

  stubFetch(JSON.stringify(strategy));

  const provider = new OllamaStrategyProvider(
    "http://localhost:11434",
    "test-model"
  );

  await assert.rejects(
    () => provider.generateStrategy(context),
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

test("card recommendation is rejected when allowNewCards is false", async () => {
  restoreEnv();

  const context = makeContext({
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

  await assert.rejects(
    () => provider.generateStrategy(context),
    (error: unknown) => {
      assert.ok(error instanceof StrategyProviderError);
      assert.match(
        (error as Error).message,
        /allowNewCards is false/
      );
      return true;
    }
  );
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

  const context = makeContext();

  const strategy = makeValidStrategy();

  (strategy as { feasibility: string }).feasibility = "bogus";

  stubFetch(JSON.stringify(strategy));

  const provider = new OllamaStrategyProvider(
    "http://localhost:11434",
    "test-model"
  );

  await assert.rejects(
    () => provider.generateStrategy(context),
    (error: unknown) => {
      assert.ok(error instanceof StrategyProviderError);
      assert.match((error as Error).message, /invalid feasibility/);
      return true;
    }
  );
});

test("negative pointsGap is rejected", async () => {
  restoreEnv();

  const context = makeContext();

  const strategy = makeValidStrategy();

  strategy.pointsGap = -100;

  stubFetch(JSON.stringify(strategy));

  const provider = new OllamaStrategyProvider(
    "http://localhost:11434",
    "test-model"
  );

  await assert.rejects(
    () => provider.generateStrategy(context),
    (error: unknown) => {
      assert.ok(error instanceof StrategyProviderError);
      assert.match((error as Error).message, /negative pointsGap/);
      return true;
    }
  );
});

test("missing required fields are rejected", async () => {
  restoreEnv();

  const context = makeContext();

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
    () => provider.generateStrategy(context),
    (error: unknown) => {
      assert.ok(error instanceof StrategyProviderError);
      assert.match((error as Error).message, /missing required string field "summary"/);
      return true;
    }
  );
});

test("input context is not mutated", async () => {
  restoreEnv();

  const context = makeContext();

  const before = JSON.stringify(context);

  const strategy = makeValidStrategy();

  stubFetch(JSON.stringify(strategy));

  const provider = new OllamaStrategyProvider(
    "http://localhost:11434",
    "test-model"
  );

  await provider.generateStrategy(context);

  const after = JSON.stringify(context);

  assert.equal(after, before);
});