import assert from "node:assert/strict";
import { test } from "node:test";

import { OpenRouterStrategyProvider } from "./openRouterStrategyProvider";
import type { SanitizedStrategyPrompt } from "./strategyTypes";

const prompt: SanitizedStrategyPrompt = {
  goal: {
    type: "travel",
    title: "Paris trip",
    origin: ["DEN"],
    destinations: ["CDG"],
    earliestDeparture: null,
    latestReturn: null,
    minimumNights: null,
    maximumNights: null,
    travelerCount: 1,
    cabinPreference: "economy",
    optimizationPriority: "balanced",
    maximumCashBudget: null,
    currency: "USD",
    allowNewCards: false,
  },
  pointsInventory: [],
  walletCards: [],
  monthlySpendingByCategory: [],
  awardOptions: [],
  cardOffers: [],
  sources: [],
  generatedAt: "2026-08-25T00:00:00.000Z",
};

const validNarrative = {
  headline: "More information needed",
  summary: "No sourced redemption options are available yet.",
  feasibility: "insufficient_information",
  pointsGap: null,
  recommendedAwardOptionId: null,
  recommendedCardOfferId: null,
  actions: [],
  alternatives: [],
  assumptions: [],
  warnings: [],
  followUpQuestions: ["Which dates work best for your trip?"],
};

test("retries one OpenRouter 429 using a bounded Retry-After delay", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;

  globalThis.fetch = (async () => {
    calls += 1;
    if (calls === 1) {
      return new Response(null, {
        status: 429,
        headers: { "Retry-After": "0" },
      });
    }

    return new Response(
      JSON.stringify({
        choices: [{ message: { content: JSON.stringify(validNarrative) } }],
      }),
      { status: 200 }
    );
  }) as typeof fetch;

  try {
    const provider = new OpenRouterStrategyProvider("test-key", "test-model");
    const result = await provider.generateStrategy(prompt);

    assert.equal(calls, 2);
    assert.equal(result.headline, validNarrative.headline);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("does not retry when Retry-After exceeds the retry cap", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;

  globalThis.fetch = (async () => {
    calls += 1;
    return new Response(null, {
      status: 429,
      headers: { "Retry-After": "60" },
    });
  }) as typeof fetch;

  try {
    const provider = new OpenRouterStrategyProvider("test-key", "test-model");

    await assert.rejects(
      () => provider.generateStrategy(prompt),
      /OpenRouter returned HTTP 429/,
    );
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
