import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildDeterministicStrategyNarrative,
  StrategyProviderWithFallback,
} from "./deterministicStrategyProvider";
import { StrategyProviderError } from "./strategyProviderCore";
import { createStrategyProvider } from "./strategyProviderFactory";
import type {
  PersonalizedStrategyNarrative,
  SanitizedStrategyPrompt,
  StrategyProvider,
} from "./strategyTypes";

const ORIGINAL_ENV = { ...process.env };
const ORIGINAL_FETCH = globalThis.fetch;
const ORIGINAL_CONSOLE_WARN = console.warn;

const flightOption = {
  id: "flight-1",
  sourceId: "source-flight",
  programName: "Supplied Air Program",
  redemptionType: "flight" as const,
  pricingBasis: "round_trip" as const,
  itineraryLabel: "DEN-CDG planning example",
  pointsRequired: 70000,
  cashFees: null,
  seats: null,
  cabin: "economy",
  transferFromProgramId: null,
  transferRatio: null,
  centsPerPoint: null,
  availabilityStatus: "unknown" as const,
  travelerCountCovered: 1,
  coverageStatus: "source_explicit" as const,
  goalMatch: "partial" as const,
};

const hotelOption = {
  id: "hotel-1",
  sourceId: "source-hotel",
  programName: "Supplied Hotel Program",
  redemptionType: "hotel" as const,
  pricingBasis: "per_night" as const,
  itineraryLabel: "Paris planning example",
  pointsRequired: 30000,
  cashFees: null,
  seats: null,
  cabin: null,
  transferFromProgramId: null,
  transferRatio: null,
  centsPerPoint: null,
  availabilityStatus: "unknown" as const,
  nightCountCovered: 1,
  coverageStatus: "source_explicit" as const,
  goalMatch: "general" as const,
};

const prompt: SanitizedStrategyPrompt = {
  goal: {
    type: "travel",
    title: "Paris trip",
    origin: ["DEN"],
    destinations: ["CDG"],
    earliestDeparture: "2027-04-03",
    latestReturn: "2027-04-30",
    minimumNights: 8,
    maximumNights: 16,
    travelerCount: 2,
    cabinPreference: "economy",
    optimizationPriority: "balanced",
    maximumCashBudget: null,
    currency: "USD",
    allowNewCards: true,
  },
  pointsInventory: [
    {
      programName: "Supplied Points Program",
      ownerType: "self",
      balance: 80000,
      verificationStatus: "verified",
      origin: "manual",
    },
  ],
  walletCards: [
    {
      name: "Supplied Card",
      issuer: "Supplied Issuer",
      rewardCurrency: "supplied_points",
    },
  ],
  monthlySpendingByCategory: [],
  awardOptions: [flightOption, hotelOption],
  cardOffers: [
    {
      id: "offer-1",
      sourceId: "source-offer",
      cardName: "Supplied Offer Card",
      issuer: "Supplied Issuer",
      welcomeBonusPoints: 50000,
      spendingRequirement: 3000,
      spendingDeadlineMonths: 3,
      annualFee: 95,
      destinationProgramId: null,
    },
  ],
  sources: [
    {
      id: "source-flight",
      label: "Supplied flight source",
      status: "estimated",
      observedAt: "2026-08-20T00:00:00.000Z",
    },
    {
      id: "source-hotel",
      label: "Supplied hotel source",
      status: "estimated",
      observedAt: "2026-08-20T00:00:00.000Z",
    },
    {
      id: "source-offer",
      label: "Supplied offer source",
      status: "catalog",
      observedAt: null,
    },
  ],
  generatedAt: "2026-08-26T00:00:00.000Z",
};

const primaryNarrative: PersonalizedStrategyNarrative = {
  headline: "Primary provider result",
  summary: "The configured provider completed normally.",
  feasibility: "on_track",
  pointsGap: 0,
  recommendedAwardOptionId: "flight-1",
  recommendedCardOfferId: null,
  flightOptions: [flightOption],
  hotelOptions: [hotelOption],
  actions: [],
  alternatives: [],
  assumptions: [],
  warnings: [],
  followUpQuestions: [],
};

function restoreRuntime(): void {
  process.env = { ...ORIGINAL_ENV };
  globalThis.fetch = ORIGINAL_FETCH;
  console.warn = ORIGINAL_CONSOLE_WARN;
}

test("preserves the primary provider result when generation succeeds", async () => {
  let fallbackCalls = 0;
  const primary: StrategyProvider = {
    async generateStrategy() {
      return primaryNarrative;
    },
  };
  const fallback: StrategyProvider = {
    async generateStrategy() {
      fallbackCalls += 1;
      throw new Error("Fallback should not run.");
    },
  };
  const provider = new StrategyProviderWithFallback(primary, fallback);

  const result = await provider.generateStrategy(prompt);

  assert.strictEqual(result, primaryNarrative);
  assert.equal(fallbackCalls, 0);
});

test("does not hide unexpected non-provider failures", async () => {
  const unexpectedError = new TypeError("unexpected application defect");
  let fallbackCalls = 0;
  const primary: StrategyProvider = {
    async generateStrategy() {
      throw unexpectedError;
    },
  };
  const fallback: StrategyProvider = {
    async generateStrategy() {
      fallbackCalls += 1;
      return primaryNarrative;
    },
  };
  const provider = new StrategyProviderWithFallback(primary, fallback);

  await assert.rejects(
    () => provider.generateStrategy(prompt),
    (error: unknown) => {
      assert.strictEqual(error, unexpectedError);
      return true;
    }
  );
  assert.equal(fallbackCalls, 0);
});

test("falls back only after OpenRouter exhausts its bounded 429 attempts", async () => {
  restoreRuntime();
  process.env.OPENROUTER_API_KEY = "test-key";
  process.env.OPENROUTER_STRATEGY_MODEL = "test-model";
  delete process.env.STRATEGY_DEBUG;

  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    return new Response(null, {
      status: 429,
      headers: { "Retry-After": "0" },
    });
  }) as typeof fetch;

  try {
    const result = await createStrategyProvider().generateStrategy(prompt);

    assert.equal(calls, 2);
    assert.equal(result.feasibility, "insufficient_information");
    assert.equal(result.pointsGap, null);
    assert.equal(result.recommendedAwardOptionId, null);
    assert.deepEqual(result.flightOptions, [flightOption]);
    assert.deepEqual(result.hotelOptions, [hotelOption]);
    assert.ok(
      result.warnings.some((warning) =>
        /generated deterministically/.test(warning)
      )
    );
  } finally {
    restoreRuntime();
  }
});

test("falls back after OpenRouter exhausts malformed-output attempts without logging details", async () => {
  restoreRuntime();
  process.env.OPENROUTER_API_KEY = "test-key";
  process.env.OPENROUTER_STRATEGY_MODEL = "test-model";
  process.env.STRATEGY_DEBUG = "1";

  const privateProviderBody = "private malformed provider body";
  const logs: string[][] = [];
  let calls = 0;
  console.warn = (...args: unknown[]) => {
    logs.push(args.map(String));
  };
  globalThis.fetch = (async () => {
    calls += 1;
    return new Response(
      JSON.stringify({
        choices: [{ message: { content: privateProviderBody } }],
      }),
      { status: 200 }
    );
  }) as typeof fetch;

  try {
    const result = await createStrategyProvider().generateStrategy(prompt);

    assert.equal(calls, 2);
    assert.equal(result.feasibility, "insufficient_information");
    assert.deepEqual(result.flightOptions, [flightOption]);
    assert.deepEqual(result.hotelOptions, [hotelOption]);
    assert.deepEqual(logs, [["[strategy-provider-fallback]"]]);
    assert.doesNotMatch(JSON.stringify(logs), /private malformed/);
    assert.doesNotMatch(JSON.stringify(result), /private malformed/);
  } finally {
    restoreRuntime();
  }
});

test("falls back when Ollama returns malformed model output", async () => {
  restoreRuntime();
  delete process.env.OPENROUTER_API_KEY;
  process.env.OLLAMA_BASE_URL = "http://localhost:11434";
  process.env.OLLAMA_STRATEGY_MODEL = "test-model";
  delete process.env.STRATEGY_DEBUG;

  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({ message: { content: "not valid JSON" } }),
      { status: 200 }
    )) as typeof fetch;

  try {
    const result = await createStrategyProvider().generateStrategy(prompt);

    assert.equal(result.feasibility, "insufficient_information");
    assert.equal(result.actions.length, 4);
    assert.ok(
      result.warnings.some((warning) =>
        /generated deterministically/.test(warning)
      )
    );
  } finally {
    restoreRuntime();
  }
});

test("falls back on an Ollama network failure without logging error details", async () => {
  restoreRuntime();
  delete process.env.OPENROUTER_API_KEY;
  process.env.OLLAMA_BASE_URL = "http://localhost:11434";
  process.env.OLLAMA_STRATEGY_MODEL = "test-model";
  process.env.STRATEGY_DEBUG = "1";

  const privateNetworkError = "private network and customer details";
  const logs: string[][] = [];
  let calls = 0;
  console.warn = (...args: unknown[]) => {
    logs.push(args.map(String));
  };
  globalThis.fetch = (async () => {
    calls += 1;
    throw new Error(privateNetworkError);
  }) as typeof fetch;

  try {
    const result = await createStrategyProvider().generateStrategy(prompt);

    assert.equal(calls, 1);
    assert.equal(result.feasibility, "insufficient_information");
    assert.deepEqual(result.flightOptions, [flightOption]);
    assert.deepEqual(result.hotelOptions, [hotelOption]);
    assert.deepEqual(logs, [["[strategy-provider-fallback]"]]);
    assert.doesNotMatch(JSON.stringify(logs), /private network/);
    assert.doesNotMatch(JSON.stringify(result), /private network/);
  } finally {
    restoreRuntime();
  }
});

test("falls back when the configured local provider cannot be constructed", async () => {
  restoreRuntime();
  delete process.env.OPENROUTER_API_KEY;
  delete process.env.OLLAMA_BASE_URL;
  delete process.env.OLLAMA_STRATEGY_MODEL;
  delete process.env.STRATEGY_DEBUG;

  try {
    const provider = createStrategyProvider();
    const result = await provider.generateStrategy(prompt);

    assert.equal(result.feasibility, "insufficient_information");
    assert.ok(result.warnings.some((warning) => /narrative provider/.test(warning)));
  } finally {
    restoreRuntime();
  }
});

test("builds an explicit evidence-gathering plan when research is absent", () => {
  const emptyPrompt: SanitizedStrategyPrompt = {
    ...prompt,
    goal: {
      ...prompt.goal,
      earliestDeparture: null,
      latestReturn: null,
    },
    pointsInventory: [],
    awardOptions: [],
    cardOffers: [],
    sources: [],
  };

  const result = buildDeterministicStrategyNarrative(emptyPrompt);

  assert.equal(result.feasibility, "insufficient_information");
  assert.deepEqual(result.flightOptions, []);
  assert.deepEqual(result.hotelOptions, []);
  assert.deepEqual(
    result.actions.map((action) => action.title),
    [
      "Collect current flight evidence",
      "Collect current hotel evidence",
      "Add reward-account balances",
    ]
  );
  assert.ok(result.actions.every((action) => action.sourceIds.length === 0));
  assert.ok(result.followUpQuestions.length >= 4);
});

test("omits all card-offer output when new cards are disallowed", () => {
  const noNewCardsPrompt: SanitizedStrategyPrompt = {
    ...prompt,
    goal: {
      ...prompt.goal,
      allowNewCards: false,
    },
  };

  const result = buildDeterministicStrategyNarrative(noNewCardsPrompt);
  const serializedResult = JSON.stringify(result);

  assert.equal(result.recommendedCardOfferId, null);
  assert.ok(result.actions.every((action) => !/card offer/i.test(action.title)));
  assert.ok(
    result.actions.every(
      (action) => !action.sourceIds.includes("source-offer")
    )
  );
  assert.doesNotMatch(serializedResult, /offer-1|source-offer|Supplied Offer Card/);
});

test("fallback logs no provider or customer details and invents no claims", async () => {
  restoreRuntime();
  process.env.STRATEGY_DEBUG = "1";

  const privatePrompt = {
    ...prompt,
    internalUserId: "private-user-id",
    ownerLabel: "private-owner-label",
    rawTransactions: ["private-transaction"],
  } as SanitizedStrategyPrompt & Record<string, unknown>;
  const before = JSON.stringify(privatePrompt);
  const privateProviderError = "private-provider-error";
  const logs: string[][] = [];

  console.warn = (...args: unknown[]) => {
    logs.push(args.map(String));
  };

  const primary: StrategyProvider = {
    async generateStrategy() {
      throw new StrategyProviderError(
        privateProviderError,
        "private-provider-body",
        "private-model",
        500,
        "private-customer-payload"
      );
    },
  };

  try {
    const result = await new StrategyProviderWithFallback(primary)
      .generateStrategy(privatePrompt);
    const serializedResult = JSON.stringify(result);
    const suppliedSourceIds = new Set(prompt.sources.map((source) => source.id));

    assert.deepEqual(logs, [["[strategy-provider-fallback]"]]);
    assert.doesNotMatch(JSON.stringify(logs), /private-/);
    assert.doesNotMatch(
      serializedResult,
      /private-user-id|private-owner-label|private-transaction|private-provider-error/
    );
    assert.equal(JSON.stringify(privatePrompt), before);
    assert.equal(result.recommendedAwardOptionId, null);
    assert.equal(result.recommendedCardOfferId, null);
    assert.equal(result.pointsGap, null);
    assert.deepEqual(result.assumptions, []);
    assert.ok(result.actions.every((action) => action.deadline === null));
    assert.ok(
      result.actions.every((action) =>
        action.sourceIds.every((sourceId) => suppliedSourceIds.has(sourceId))
      )
    );
    assert.equal(
      result.flightOptions[0].pointsRequired,
      flightOption.pointsRequired
    );
    assert.equal(
      result.flightOptions[0].availabilityStatus,
      flightOption.availabilityStatus
    );
    assert.equal(
      result.hotelOptions[0].pointsRequired,
      hotelOption.pointsRequired
    );
  } finally {
    restoreRuntime();
  }
});
