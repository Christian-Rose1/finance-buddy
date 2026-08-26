import assert from "node:assert/strict";
import { test } from "node:test";

import {
  generateAutomatedStrategy,
  generateAutomatedStrategyFromResearchStages,
  shouldRunOptionalCardResearch,
} from "./automatedStrategyPlanner";
import { OllamaResearchInterpreter } from "./ollamaResearchInterpreter";
import { OllamaStrategyProvider } from "./ollamaStrategyProvider";
import { TavilyResearchProvider } from "./tavilyResearchProvider";
import type {
  InterpretResearchInput,
  InterpretedResearch,
} from "./researchInterpreter";
import type { ResearchQuery } from "./researchTypes";
import { StrategyProviderError } from "./strategyProviderCore";
import type {
  PersonalizedStrategyContext,
  PersonalizedStrategyNarrative,
  SanitizedStrategyPrompt,
  StrategyAwardOption,
} from "./strategyTypes";

test("initial finalization may perform optional card research", () => {
  assert.equal(shouldRunOptionalCardResearch("initial"), true);
});

test("finalization retry skips planning, searches, and card interpretation", () => {
  assert.equal(shouldRunOptionalCardResearch("retry"), false);
});

test("optional card Tavily failure becomes a warning instead of aborting finalization", async (t) => {
  const previousTavilyKey = process.env.TAVILY_API_KEY;
  const previousProvider = process.env.STRATEGY_RESEARCH_PROVIDER;
  delete process.env.TAVILY_API_KEY;
  process.env.STRATEGY_RESEARCH_PROVIDER = "ollama";
  t.mock.method(
    OllamaStrategyProvider.prototype,
    "generateStrategy",
    async (prompt: SanitizedStrategyPrompt) => modelControlledNarrative(prompt, "insufficient_information", 0)
  );

  try {
    const context = makeContext(100_000);
    context.goal = { ...context.goal, allowNewCards: true };
    const result = await generateAutomatedStrategyFromResearchStages(
      context,
      catalogRewardPrograms,
      catalogRewardPrograms,
      { flight: flightResearch, hotel: hotelResearch },
      "initial"
    );
    assert.ok(result.warnings.some((warning) => /card-offer recommendations were omitted/i.test(warning)));
  } finally {
    if (previousTavilyKey === undefined) delete process.env.TAVILY_API_KEY;
    else process.env.TAVILY_API_KEY = previousTavilyKey;
    if (previousProvider === undefined) delete process.env.STRATEGY_RESEARCH_PROVIDER;
    else process.env.STRATEGY_RESEARCH_PROVIDER = previousProvider;
  }
});

const catalogRewardPrograms = [
  { id: "chase", name: "Chase Ultimate Rewards" },
];

const flightOption: StrategyAwardOption = {
  id: "flight-1",
  sourceId: "source-flight",
  programName: "Flying Blue",
  redemptionType: "flight",
  pricingBasis: "round_trip",
  itineraryLabel: "DEN-CDG planning estimate",
  pointsRequired: 50_000,
  cashFees: null,
  seats: null,
  cabin: "economy",
  transferFromProgramId: "chase",
  transferRatio: 1,
  centsPerPoint: null,
  availabilityStatus: "unknown",
  travelerCountCovered: 1,
  coverageStatus: "source_explicit",
  goalMatch: "partial",
};

const hotelOption: StrategyAwardOption = {
  id: "hotel-1",
  sourceId: "source-hotel",
  programName: "World of Hyatt",
  redemptionType: "hotel",
  pricingBasis: "per_night",
  itineraryLabel: "Paris planning estimate",
  pointsRequired: 25_000,
  cashFees: null,
  seats: null,
  cabin: null,
  transferFromProgramId: "chase",
  transferRatio: 1,
  centsPerPoint: null,
  availabilityStatus: "unknown",
  nightCountCovered: 1,
  coverageStatus: "source_explicit",
  goalMatch: "partial",
};

const flightResearch: InterpretedResearch = {
  awardOptions: [flightOption],
  cardOffers: [],
  sources: [
    {
      id: "source-flight",
      label: "Validated flight source",
      status: "estimated",
      observedAt: "2026-08-26T00:00:00.000Z",
    },
  ],
  assumptions: ["Flight research assumption"],
  warnings: [],
};

const hotelResearch: InterpretedResearch = {
  awardOptions: [hotelOption],
  cardOffers: [],
  sources: [
    {
      id: "source-hotel",
      label: "Validated hotel source",
      status: "estimated",
      observedAt: "2026-08-26T00:00:00.000Z",
    },
  ],
  assumptions: ["Hotel research assumption"],
  warnings: [],
};

const emptyResearch: InterpretedResearch = {
  awardOptions: [],
  cardOffers: [],
  sources: [],
  assumptions: [],
  warnings: [],
};

function makeContext(balance: number): PersonalizedStrategyContext {
  return {
    goal: {
      id: "goal-1",
      userId: "user-1",
      type: "travel",
      title: "Paris trip",
      status: "active",
      origin: ["DEN"],
      destinations: ["CDG"],
      earliestDeparture: "2027-04-03",
      latestReturn: "2027-04-30",
      minimumNights: 3,
      maximumNights: 8,
      travelerCount: 2,
      cabinPreference: "economy",
      optimizationPriority: "balanced",
      maximumCashBudget: null,
      currency: "USD",
      allowNewCards: false,
      createdAt: "2026-08-26T00:00:00.000Z",
      updatedAt: "2026-08-26T00:00:00.000Z",
    },
    rewardAccounts: [
      {
        id: "account-chase",
        userId: "user-1",
        rewardProgramId: "chase",
        ownerKey: "self",
        ownerLabel: "Me",
        ownerType: "self",
        balance,
        balanceAsOf: "2026-08-26",
        origin: "manual",
        verificationStatus: "verified",
        createdAt: "2026-08-26T00:00:00.000Z",
        updatedAt: "2026-08-26T00:00:00.000Z",
      },
    ],
    walletCards: [],
    monthlySpendingByCategory: [],
    awardOptions: [],
    cardOffers: [],
    sources: [],
    generatedAt: "2026-08-26T00:00:00.000Z",
  };
}

function modelControlledNarrative(
  prompt: SanitizedStrategyPrompt,
  feasibility: PersonalizedStrategyNarrative["feasibility"],
  pointsGap: number
): PersonalizedStrategyNarrative {
  return {
    headline: "Provider-authored headline",
    summary: "Provider-authored summary",
    feasibility,
    pointsGap,
    recommendedAwardOptionId: "flight-1",
    recommendedCardOfferId: null,
    flightOptions: prompt.awardOptions.filter(
      (option) => option.redemptionType === "flight"
    ),
    hotelOptions: prompt.awardOptions.filter(
      (option) => option.redemptionType === "hotel"
    ),
    actions: [
      {
        priority: 1,
        title: "Provider-authored action",
        explanation: "Provider-authored explanation",
        deadline: null,
        sourceIds: ["source-flight"],
      },
    ],
    alternatives: [
      {
        title: "Provider-authored alternative",
        tradeoff: "Provider-authored tradeoff",
        sourceIds: ["source-hotel"],
      },
    ],
    assumptions: ["Provider-authored assumption"],
    warnings: ["Provider-authored warning"],
    followUpQuestions: ["Provider-authored question?"],
  };
}

function assertProviderNarrativeWasPreserved(
  result: Awaited<ReturnType<typeof generateAutomatedStrategy>>
): void {
  assert.equal(result.headline, "Provider-authored headline");
  assert.equal(result.summary, "Provider-authored summary");
  assert.equal(result.recommendedAwardOptionId, "flight-1");
  assert.equal(result.actions[0]?.title, "Provider-authored action");
  assert.equal(
    result.alternatives[0]?.title,
    "Provider-authored alternative"
  );
  assert.ok(result.assumptions.includes("Provider-authored assumption"));
  assert.ok(result.assumptions.includes("Flight research assumption"));
  assert.ok(result.assumptions.includes("Hotel research assumption"));
  assert.ok(result.warnings.includes("Provider-authored warning"));
  assert.deepEqual(result.followUpQuestions, ["Provider-authored question?"]);
  assert.deepEqual(result.flightOptions, [flightOption]);
  assert.deepEqual(result.hotelOptions, [hotelOption]);
}

function configureLocalTestProviders(): void {
  delete process.env.OPENROUTER_API_KEY;
  process.env.TAVILY_API_KEY = "test-tavily-key";
  process.env.STRATEGY_RESEARCH_PROVIDER = "ollama";
  process.env.OLLAMA_BASE_URL = "http://ollama.test";
  process.env.OLLAMA_STRATEGY_MODEL = "test-model";
}

test("full planner overrides model-controlled outcome after deterministic scenarios", async (t) => {
  configureLocalTestProviders();

  t.mock.method(
    TavilyResearchProvider.prototype,
    "search",
    async (input: ResearchQuery) => ({
      query: input.query,
      results: [],
      searchedAt: "2026-08-26T00:00:00.000Z",
    })
  );
  t.mock.method(
    OllamaResearchInterpreter.prototype,
    "interpret",
    async (input: InterpretResearchInput) => {
      if (input.focus === "flight_options") return flightResearch;
      if (input.focus === "hotel_options") return hotelResearch;
      return emptyResearch;
    }
  );
  t.mock.method(
    OllamaStrategyProvider.prototype,
    "generateStrategy",
    async (prompt: SanitizedStrategyPrompt) =>
      modelControlledNarrative(prompt, "depends_on_new_card", 999_999)
  );

  const result = await generateAutomatedStrategy(
    makeContext(200_000),
    catalogRewardPrograms,
    catalogRewardPrograms
  );

  assert.equal(result.feasibility, "on_track");
  assert.equal(result.pointsGap, 0);
  assertProviderNarrativeWasPreserved(result);
});

test("staged planner overrides model-controlled outcome after deterministic scenarios", async (t) => {
  configureLocalTestProviders();

  t.mock.method(
    OllamaStrategyProvider.prototype,
    "generateStrategy",
    async (prompt: SanitizedStrategyPrompt) =>
      modelControlledNarrative(prompt, "on_track", 0)
  );

  const result = await generateAutomatedStrategyFromResearchStages(
    makeContext(150_000),
    catalogRewardPrograms,
    catalogRewardPrograms,
    { flight: flightResearch, hotel: hotelResearch },
    "retry"
  );

  assert.equal(result.feasibility, "gap_remaining");
  assert.equal(result.pointsGap, 25_000);
  assertProviderNarrativeWasPreserved(result);
});

test("staged retry overrides the deterministic fallback provider outcome", async (t) => {
  configureLocalTestProviders();

  t.mock.method(
    OllamaStrategyProvider.prototype,
    "generateStrategy",
    async () => {
      throw new StrategyProviderError(
        "Expected provider failure",
        "ollama",
        "test-model"
      );
    }
  );

  const result = await generateAutomatedStrategyFromResearchStages(
    makeContext(200_000),
    catalogRewardPrograms,
    catalogRewardPrograms,
    { flight: flightResearch, hotel: hotelResearch },
    "retry"
  );

  assert.equal(result.feasibility, "on_track");
  assert.equal(result.pointsGap, 0);
  assert.equal(result.headline, "Paris trip: details need verification");
  assert.equal(result.recommendedAwardOptionId, null);
  assert.deepEqual(result.flightOptions, [flightOption]);
  assert.deepEqual(result.hotelOptions, [hotelOption]);
  assert.ok(result.assumptions.includes("Flight research assumption"));
  assert.ok(result.assumptions.includes("Hotel research assumption"));
  assert.ok(
    result.warnings.some((warning) =>
      /generated deterministically/.test(warning)
    )
  );
  assert.ok(
    result.actions.some((action) =>
      /calculated funding scenarios/i.test(action.title)
    )
  );
});
