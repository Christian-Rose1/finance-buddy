import { test } from "node:test";
import assert from "node:assert/strict";

import type { ResearchPlannerInput } from "./researchPlannerTypes";
import {
  MAX_PLAN_QUERIES,
  MAX_QUERY_LENGTH,
  ResearchPlannerError,
  buildFallbackResearchPlan,
  extractJsonBlock,
  validateResearchPlan,
} from "./researchPlannerCore";

function makeInput(overrides: Partial<ResearchPlannerInput> = {}): ResearchPlannerInput {
  return {
    goal: {
      type: "travel",
      title: "Euro Trip",
      origin: ["DEN"],
      destinations: ["Paris"],
      earliestDeparture: "2027-04-03",
      latestReturn: "2027-04-30",
      minimumNights: 8,
      maximumNights: 16,
      travelerCount: 2,
      cabinPreference: "economy",
      optimizationPriority: "lowest_cash",
      maximumCashBudget: 2000,
      currency: "USD",
      allowNewCards: true,
    },
    rewardAccounts: [
      {
        programName: "Chase Ultimate Rewards",
        balance: 80000,
        ownerType: "self",
        verificationStatus: "verified",
      },
    ],
    walletCards: [
      {
        name: "Chase Sapphire Preferred",
        issuer: "Chase",
        rewardCurrency: "Chase Ultimate Rewards",
      },
    ],
    monthlySpendingByCategory: [
      { category: "dining", monthlyAverage: 800 },
      { category: "groceries", monthlyAverage: 600 },
    ],
    customerRewardPrograms: [
      { id: "prog-1", name: "Chase Ultimate Rewards" },
    ],
    transferPartners: [
      {
        sourceProgramName: "Chase Ultimate Rewards",
        partnerProgramName: "United MileagePlus",
        partnerFamily: "airline_miles",
      },
    ],
    currentDate: "2026-08-24T00:00:00.000Z",
    daysUntilDeparture: 222,
    ...overrides,
  };
}

function validQuery(overrides: Record<string, unknown> = {}) {
  return {
    query: "Chase Ultimate Rewards transfer partner flight Paris 2027",
    includeDomains: ["thepointsguy.com", "chase.com"],
    purpose: "Find flight redemptions to Paris",
    category: "flight",
    searchDepth: "advanced",
    ...overrides,
  };
}

function validPlan(overrides: Record<string, unknown> = {}) {
  return {
    reasoning: "Test reasoning",
    queries: [validQuery()],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// validateResearchPlan
// ---------------------------------------------------------------------------

test("valid plan is parsed correctly", () => {
  const plan = validateResearchPlan(validPlan());

  assert.equal(plan.queries.length, 1);
  assert.equal(plan.reasoning, "Test reasoning");
  assert.equal(plan.queries[0].category, "flight");
  assert.equal(plan.queries[0].searchDepth, "advanced");
  assert.deepEqual(plan.queries[0].includeDomains, [
    "thepointsguy.com",
    "chase.com",
  ]);
  assert.ok(typeof plan.generatedAt === "string");
});

test("plan with more than max queries is rejected", () => {
  const queries = Array.from({ length: MAX_PLAN_QUERIES + 1 }, () =>
    validQuery()
  );

  assert.throws(
    () => validateResearchPlan({ reasoning: "r", queries }),
    (err: unknown) => {
      assert.ok(err instanceof ResearchPlannerError);
      assert.match((err as Error).message, /maximum is/);
      return true;
    }
  );
});

test("plan with untrusted domain is rejected", () => {
  const plan = validPlan({
    queries: [validQuery({ includeDomains: ["evil.example.com"] })],
  });

  assert.throws(
    () => validateResearchPlan(plan),
    (err: unknown) => {
      assert.ok(err instanceof ResearchPlannerError);
      assert.match((err as Error).message, /untrusted domain/);
      return true;
    }
  );
});

test("plan with missing reasoning is rejected", () => {
  assert.throws(
    () => validateResearchPlan({ queries: [validQuery()] }),
    (err: unknown) => {
      assert.ok(err instanceof ResearchPlannerError);
      assert.match((err as Error).message, /reasoning/);
      return true;
    }
  );
});

test("plan with missing queries is rejected", () => {
  assert.throws(
    () => validateResearchPlan({ reasoning: "r" }),
    (err: unknown) => {
      assert.ok(err instanceof ResearchPlannerError);
      assert.match((err as Error).message, /queries/);
      return true;
    }
  );
});

test("plan with empty queries array is rejected", () => {
  assert.throws(
    () => validateResearchPlan({ reasoning: "r", queries: [] }),
    (err: unknown) => {
      assert.ok(err instanceof ResearchPlannerError);
      assert.match((err as Error).message, /no queries/);
      return true;
    }
  );
});

test("plan with invalid category is rejected", () => {
  const plan = validPlan({
    queries: [validQuery({ category: "unknown_category" })],
  });

  assert.throws(
    () => validateResearchPlan(plan),
    (err: unknown) => {
      assert.ok(err instanceof ResearchPlannerError);
      assert.match((err as Error).message, /invalid category/);
      return true;
    }
  );
});

test("plan with empty query string is rejected", () => {
  const plan = validPlan({ queries: [validQuery({ query: "   " })] });

  assert.throws(
    () => validateResearchPlan(plan),
    (err: unknown) => {
      assert.ok(err instanceof ResearchPlannerError);
      assert.match((err as Error).message, /missing required string field "query"/);
      return true;
    }
  );
});

test("plan with query exceeding max length is rejected", () => {
  const plan = validPlan({
    queries: [validQuery({ query: "x".repeat(MAX_QUERY_LENGTH + 1) })],
  });

  assert.throws(
    () => validateResearchPlan(plan),
    (err: unknown) => {
      assert.ok(err instanceof ResearchPlannerError);
      assert.match((err as Error).message, /exceeds/);
      return true;
    }
  );
});

test("plan with empty includeDomains is rejected", () => {
  const plan = validPlan({
    queries: [validQuery({ includeDomains: [] })],
  });

  assert.throws(
    () => validateResearchPlan(plan),
    (err: unknown) => {
      assert.ok(err instanceof ResearchPlannerError);
      assert.match((err as Error).message, /includeDomains/);
      return true;
    }
  );
});

test("plan with missing purpose is rejected", () => {
  const plan = validPlan({ queries: [validQuery({ purpose: "" })] });

  assert.throws(
    () => validateResearchPlan(plan),
    (err: unknown) => {
      assert.ok(err instanceof ResearchPlannerError);
      assert.match((err as Error).message, /purpose/);
      return true;
    }
  );
});

test("non-object plan is rejected", () => {
  assert.throws(() => validateResearchPlan(null), ResearchPlannerError);
  assert.throws(() => validateResearchPlan("string"), ResearchPlannerError);
  assert.throws(() => validateResearchPlan([1, 2]), ResearchPlannerError);
});

test("duplicate domains are deduplicated", () => {
  const plan = validPlan({
    queries: [
      validQuery({
        includeDomains: ["chase.com", "chase.com", "CHASE.com"],
      }),
    ],
  });

  const result = validateResearchPlan(plan);
  assert.deepEqual(result.queries[0].includeDomains, ["chase.com"]);
});

// ---------------------------------------------------------------------------
// extractJsonBlock
// ---------------------------------------------------------------------------

test("extractJsonBlock extracts plain JSON object", () => {
  const raw = '{"reasoning":"r","queries":[]}';
  assert.equal(extractJsonBlock(raw), raw);
});

test("extractJsonBlock extracts JSON wrapped in markdown fences", () => {
  const raw = '```json\n{"a":1}\n```';
  assert.equal(extractJsonBlock(raw), '{"a":1}');
});

test("extractJsonBlock extracts JSON with surrounding commentary", () => {
  const raw = 'Here is the plan: {"a":1} hope that helps!';
  assert.equal(extractJsonBlock(raw), '{"a":1}');
});

test("extractJsonBlock handles braces inside strings", () => {
  const raw = '{"a":"text with { and } inside"}';
  assert.equal(extractJsonBlock(raw), raw);
});

// ---------------------------------------------------------------------------
// buildFallbackResearchPlan
// ---------------------------------------------------------------------------

test("fallback plan produces flight, hotel, and card queries for detailed goal", () => {
  const plan = buildFallbackResearchPlan(makeInput());

  assert.ok(plan.queries.length >= 2);
  assert.ok(plan.queries.some((q) => q.category === "flight"));
  assert.ok(plan.queries.some((q) => q.category === "hotel"));
  assert.ok(plan.queries.some((q) => q.category === "card"));
  assert.match(plan.reasoning, /fallback/i);
  assert.ok(typeof plan.generatedAt === "string");

  for (const q of plan.queries) {
    assert.ok(q.query.length > 0);
    assert.ok(q.includeDomains.length > 0);
    assert.ok(q.purpose.length > 0);
  }
});

test("fallback plan omits card query when allowNewCards is false", () => {
  const input = makeInput();
  input.goal = { ...input.goal, allowNewCards: false };

  const plan = buildFallbackResearchPlan(input);

  assert.ok(!plan.queries.some((q) => q.category === "card"));
});
test("fallback plan produces at least 2 hotel queries for a destination goal", () => {
  const plan = buildFallbackResearchPlan(makeInput());
  const hotelQueries = plan.queries.filter((q) => q.category === "hotel");

  assert.ok(hotelQueries.length >= 2);
});

test("fallback plan second hotel query is destination-generic (no transfer source)", () => {
  const plan = buildFallbackResearchPlan(makeInput());
  const hotelQueries = plan.queries.filter((q) => q.category === "hotel");

  // The last hotel query is the destination-generic benchmark (pushed last).
  const generic = hotelQueries[hotelQueries.length - 1];
  assert.ok(generic);
  assert.match(generic.query, /Paris/i);
  assert.ok(!/Chase/i.test(generic.query));
  assert.ok(!/Ultimate Rewards/i.test(generic.query));
  assert.equal(generic.searchDepth, "basic");
});

test("fallback plan omits second hotel query when destinations are absent", () => {
  const input = makeInput();
  input.goal = { ...input.goal, destinations: [] };

  const plan = buildFallbackResearchPlan(input);
  const hotelQueries = plan.queries.filter((q) => q.category === "hotel");
  assert.equal(hotelQueries.length, 1);
});

test("fallback plan validates successfully through validateResearchPlan", () => {
  const plan = buildFallbackResearchPlan(makeInput());

  // Serializable plan shape — no throw expected.
  const roundTripped = validateResearchPlan(
    JSON.parse(JSON.stringify(plan))
  );
  assert.equal(roundTripped.queries.length, plan.queries.length);
});

test("fallback plan works with minimal input (no accounts, no cards)", () => {
  const plan = buildFallbackResearchPlan(
    makeInput({
      rewardAccounts: [],
      walletCards: [],
      monthlySpendingByCategory: [],
      customerRewardPrograms: [],
      transferPartners: [],
      daysUntilDeparture: null,
    })
  );

  assert.ok(plan.queries.length >= 2);
  assert.ok(plan.queries.some((q) => q.category === "flight"));
  assert.ok(plan.queries.some((q) => q.category === "hotel"));
});

// ---------------------------------------------------------------------------
// createResearchPlanner factory
// ---------------------------------------------------------------------------

test("factory selects FallbackResearchPlanner when OPENROUTER_API_KEY is unset", async () => {
  const originalKey = process.env.OPENROUTER_API_KEY;
  delete process.env.OPENROUTER_API_KEY;

  try {
    const { createResearchPlanner, FallbackResearchPlanner } = await import(
      "./researchPlanner"
    );
    const planner = createResearchPlanner();
    assert.ok(planner instanceof FallbackResearchPlanner);
  } finally {
    if (originalKey !== undefined) {
      process.env.OPENROUTER_API_KEY = originalKey;
    }
  }
});

test("factory selects OpenRouterResearchPlanner when OPENROUTER_API_KEY is set", async () => {
  const originalKey = process.env.OPENROUTER_API_KEY;
  process.env.OPENROUTER_API_KEY = "test-key";

  try {
    const { createResearchPlanner, OpenRouterResearchPlanner } = await import(
      "./researchPlanner"
    );
    const planner = createResearchPlanner();
    assert.ok(planner instanceof OpenRouterResearchPlanner);
  } finally {
    if (originalKey !== undefined) {
      process.env.OPENROUTER_API_KEY = originalKey;
    } else {
      delete process.env.OPENROUTER_API_KEY;
    }
  }
});

test("explicit Ollama selection wins even when OpenRouter is configured", async () => {
  const originalKey = process.env.OPENROUTER_API_KEY;
  const originalProvider = process.env.STRATEGY_RESEARCH_PROVIDER;
  process.env.OPENROUTER_API_KEY = "test-key";
  process.env.STRATEGY_RESEARCH_PROVIDER = "ollama";
  try {
    const { createResearchPlanner, FallbackResearchPlanner } = await import("./researchPlanner");
    assert.ok(createResearchPlanner() instanceof FallbackResearchPlanner);
  } finally {
    if (originalKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = originalKey;
    if (originalProvider === undefined) delete process.env.STRATEGY_RESEARCH_PROVIDER;
    else process.env.STRATEGY_RESEARCH_PROVIDER = originalProvider;
  }
});

test("explicit OpenRouter selection is honored", async () => {
  const originalKey = process.env.OPENROUTER_API_KEY;
  const originalProvider = process.env.STRATEGY_RESEARCH_PROVIDER;
  process.env.OPENROUTER_API_KEY = "test-key";
  process.env.STRATEGY_RESEARCH_PROVIDER = "openrouter";
  try {
    const { createResearchPlanner, OpenRouterResearchPlanner } = await import("./researchPlanner");
    assert.ok(createResearchPlanner() instanceof OpenRouterResearchPlanner);
  } finally {
    if (originalKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = originalKey;
    if (originalProvider === undefined) delete process.env.STRATEGY_RESEARCH_PROVIDER;
    else process.env.STRATEGY_RESEARCH_PROVIDER = originalProvider;
  }
});

test("FallbackResearchPlanner.generateResearchPlan returns a valid plan", async () => {
  const { FallbackResearchPlanner } = await import("./researchPlanner");
  const planner = new FallbackResearchPlanner();
  const plan = await planner.generateResearchPlan(makeInput());

  assert.ok(plan.queries.length >= 2);
  assert.ok(plan.queries.every((q) => q.query.length > 0));
});

test("researchPlanner re-exports validateResearchPlan from core", async () => {
  const { validateResearchPlan: reExported } = await import(
    "./researchPlanner"
  );
  assert.equal(typeof reExported, "function");
});
