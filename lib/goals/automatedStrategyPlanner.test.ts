import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  generateAutomatedStrategyFromResearchStages,
  generateHotelResearchStage,
  shouldRunOptionalCardResearch,
  type StagedResearchDependencies,
  type VerifiedStrategyResearchStages,
} from "./automatedStrategyPlanner";
import { ResearchInterpreterError, type ResearchInterpreter } from "./researchInterpreter";
import { buildResearchPlannerInput } from "./researchPlannerInputBuilder";
import { projectHotelPlanningEstimate } from "./hotelPlanningEstimate";
import type { FlightPlanningEstimate } from "./flightPlanningEstimate";
import type { PersonalizedStrategy } from "./strategyTypes";
import {
  buildSavedGoalWebTravelDiscoveryPlan,
  toSavedGoalWebDiscoveryInput,
} from "./webTravelDiscoveryPlanner";
import type { ResearchResponse } from "./researchTypes";
import type { ResearchProvider } from "./researchTypes";
import type { PersonalizedStrategyContext, StrategyAwardOption, StrategySource } from "./strategyTypes";
import { createProviderExecutionGateway, type VerifiedStageQueryExecutor } from "./providerExecutionGateway";
import { startGoalStrategyRunStage, type StrategyResearchStage } from "./strategyRunRepository";
import { signStrategyRunPayload } from "./strategyRunSigning";
import type { StrategyStageFenceRpcExecutor } from "./strategyStageFenceRpcExecutor";

const CATALOG = [{ id: "program-db-id", name: "Chase Ultimate Rewards" }];
const SECRET = "planner-gateway-test-secret-0123456789";
let priorSecret: string | undefined;
before(() => { priorSecret = process.env.STRATEGY_RUN_SIGNING_SECRET; process.env.STRATEGY_RUN_SIGNING_SECRET = SECRET; });
after(() => { if (priorSecret === undefined) delete process.env.STRATEGY_RUN_SIGNING_SECRET; else process.env.STRATEGY_RUN_SIGNING_SECRET = priorSecret; });

function context(): PersonalizedStrategyContext {
  return {
    goal: {
      id: "goal-db-id",
      userId: "user-db-id",
      type: "travel",
      title: "Paris Trip",
      status: "active",
      origin: ["DEN"],
      destinations: ["Paris"],
      earliestDeparture: "2027-04-03",
      latestReturn: "2027-04-30",
      minimumNights: 8,
      maximumNights: 16,
      travelerCount: 2,
      cabinPreference: "economy",
      optimizationPriority: "balanced",
      maximumCashBudget: 2000,
      currency: "USD",
      allowNewCards: false,
      createdAt: "2026-08-01T00:00:00.000Z",
      updatedAt: "2026-08-01T00:00:00.000Z",
    },
    rewardAccounts: [{
      id: "account-db-id",
      userId: "user-db-id",
      rewardProgramId: "program-db-id",
      ownerKey: "owner-key",
      ownerLabel: "Customer Name",
      ownerType: "self",
      balance: 80000,
      balanceAsOf: "2026-08-01T00:00:00.000Z",
      origin: "manual",
      verificationStatus: "verified",
      createdAt: "2026-08-01T00:00:00.000Z",
      updatedAt: "2026-08-01T00:00:00.000Z",
    }],
    walletCards: [],
    monthlySpendingByCategory: [{ category: "dining", monthlyAverage: 900 }],
    awardOptions: [],
    cardOffers: [],
    sources: [{ id: "source-db-id", label: "https://private.example/raw-content", status: "catalog", observedAt: null }],
    generatedAt: "2026-08-01T00:00:00.000Z",
  };
}

function response(query: string): ResearchResponse {
  return { query, results: [], searchedAt: "2026-08-01T00:00:00.000Z" };
}

async function dependencies(
  stage: StrategyResearchStage,
  fail: (query: string) => boolean = () => false,
  interpreterAwardOptions: StrategyAwardOption[] = [],
  interpreterSources: StrategySource[] = [],
  interpreterAssumptions: string[] = [],
  interpreterWarnings: string[] = [],
) {
  const calls: string[] = [];
  const interpretedResearch: ResearchResponse[][] = [];
  const provider: ResearchProvider = {
    async search(query) {
      calls.push(query.query);
      if (fail(query.query)) throw new Error("synthetic failure");
      return response(query.query);
    },
  };
  const expiresAt = new Date(Date.now() + 60_000).toISOString();
  const row = {
    id: `run-${stage}`, goal_id: "goal-db-id", user_id: "user-db-id", signature_version: 1,
    expires_at: expiresAt,
    run_signature: signStrategyRunPayload({ version: 1, runId: `run-${stage}`, goalId: "goal-db-id", userId: "user-db-id", expiresAt, stage: "run", payload: "" }),
    flight_status: stage === "hotel" ? "failed" : "pending", flight_payload: null, flight_signature: null,
    hotel_status: "pending", hotel_payload: null, hotel_signature: null, final_status: "pending",
    created_at: "2026-08-01T00:00:00.000Z", updated_at: "2026-08-01T00:00:00.000Z",
  };
  const client = {
    rpc(name: string) {
      if (name === "prepare_goal_strategy_run_research_stage_start") {
        return Promise.resolve({ data: "prepared", error: null });
      }
      const revision = new Date().toISOString();
      return Promise.resolve({
        data: [{
          attempt_id: "33333333-3333-4333-8333-333333333333",
          deadline_at: new Date(Math.min(Date.now() + 120_000, Date.parse(expiresAt))).toISOString(),
          revision,
        }],
        error: null,
      });
    },
    from: () => ({
      select() { return this; }, eq() { return this; },
      maybeSingle() { return { data: row, error: null }; },
    }),
  } as unknown as SupabaseClient;
  const fenceExecutor: StrategyStageFenceRpcExecutor = {
    async execute(name, parameters) {
      const { data, error } = await client.rpc(name, parameters);
      return { data, error };
    },
  };
  const running = await startGoalStrategyRunStage(row.id, row.goal_id, row.user_id, stage, client, fenceExecutor);
  const executor = createProviderExecutionGateway(running, provider);
  const interpreter: ResearchInterpreter = {
    async interpret(input) {
      interpretedResearch.push(input.research);
      return {
        awardOptions: interpreterAwardOptions,
        cardOffers: [],
        sources: interpreterSources,
        assumptions: interpreterAssumptions,
        warnings: interpreterWarnings,
      };
    },
  };
  return { calls, interpretedResearch, dependencies: { executor, interpreter } satisfies StagedResearchDependencies };
}

function selectedQueries(kind: "hotel", value = context()): string[] {
  return buildSavedGoalWebTravelDiscoveryPlan(
    toSavedGoalWebDiscoveryInput(buildResearchPlannerInput(value, CATALOG)),
  ).queries.filter((query) => query.category === kind).map((query) => query.query);
}

test("initial finalization may perform optional card research", () => {
  assert.equal(shouldRunOptionalCardResearch("initial"), true);
});

test("finalization retry skips planning, searches, and card interpretation", () => {
  assert.equal(shouldRunOptionalCardResearch("retry"), false);
});

for (const [label, stage, kind] of [
  ["hotel", generateHotelResearchStage, "hotel"],
] as const) {
  test(`${label} stage executes each selected saved-goal query once`, async () => {
    const mock = await dependencies(kind);
    const value = context();
    await stage(value, CATALOG, mock.dependencies);

    assert.deepEqual(mock.calls, selectedQueries(kind, value));
    assert.equal(new Set(mock.calls).size, mock.calls.length);
    assert.equal(mock.interpretedResearch[0].length, mock.calls.length);
  });

  test(`${label} stage retains successful siblings when one selected query fails without repeating it`, async () => {
    const planned = selectedQueries(kind);
    const mock = await dependencies(kind, (query) => query === planned[1]);
    await stage(context(), CATALOG, mock.dependencies);

    assert.deepEqual(mock.calls, planned);
    assert.equal(mock.calls.filter((query) => query === planned[1]).length, 1);
    assert.deepEqual(mock.interpretedResearch[0].map((item) => item.query), [planned[0]]);
  });

  test(`${label} stage uses the established safe research failure when every query fails`, async () => {
    const planned = selectedQueries(kind);
    const mock = await dependencies(kind, () => true);

    await assert.rejects(
      stage(context(), CATALOG, mock.dependencies),
      (error: unknown) => error instanceof ResearchInterpreterError,
    );
    assert.deepEqual(mock.calls, planned);
    assert.equal(mock.interpretedResearch.length, 0);
  });
}

test("real sanitized planner input and resulting plan exclude sensitive research data", () => {
  const sanitized = buildResearchPlannerInput(context(), CATALOG);
  const webInput = toSavedGoalWebDiscoveryInput(sanitized);
  const plan = buildSavedGoalWebTravelDiscoveryPlan(webInput);
  const serializedInput = JSON.stringify(webInput);
  const serializedPlan = JSON.stringify(plan);

  for (const forbidden of [
    "goal-db-id", "user-db-id", "account-db-id", "program-db-id", "owner-key",
    "Customer Name", "80000", "dining", "900", "https://private.example/raw-content",
    "raw-content", "provider payload", "signature", "secret",
  ]) {
    assert.ok(!serializedInput.includes(forbidden), `planner input must not expose ${forbidden}`);
    assert.ok(!serializedPlan.includes(forbidden), `plan must not expose ${forbidden}`);
  }
});

test("staged hotel planner has no capability-free execution path", async () => {
  for (const [stage, fake] of [
    [generateHotelResearchStage, async () => []],
  ] as const) {
    let planningTouched = false;
    const untouchedContext = new Proxy(context(), {
      get() {
        planningTouched = true;
        throw new Error("planning must not begin");
      },
    });
    await assert.rejects(
      stage(untouchedContext, CATALOG, { executor: fake as unknown as VerifiedStageQueryExecutor }),
      (error: unknown) => error instanceof ResearchInterpreterError,
    );
    assert.equal(planningTouched, false);
  }
});

const PARIS_HOTEL_SOURCE = { id: "source-hotel-paris", label: "https://example.com/paris-hotel", status: "catalog" as const, observedAt: null };
const SOFIA_HOTEL_SOURCE = { id: "source-hotel-sofia", label: "https://example.com/sofia-hotel", status: "catalog" as const, observedAt: null };

function hotelOption(overrides: Partial<StrategyAwardOption>): StrategyAwardOption {
  return {
    id: "hotel-option-id",
    sourceId: PARIS_HOTEL_SOURCE.id,
    programName: "World of Hyatt",
    redemptionType: "hotel",
    pricingBasis: "per_night",
    itineraryLabel: "Paris hotel",
    pointsRequired: 20000,
    cashFees: 0,
    seats: null,
    cabin: null,
    transferFromProgramId: null,
    transferRatio: null,
    centsPerPoint: null,
    availabilityStatus: "unknown",
    ...overrides,
  };
}

function sofiaOption(): StrategyAwardOption {
  return hotelOption({
    id: "hotel-option-sofia",
    sourceId: SOFIA_HOTEL_SOURCE.id,
    itineraryLabel: "Hyatt Regency Sofia",
    goalMatch: "different_destination",
    goalMismatchReasons: ["destination"],
  });
}

function sofiaOptions(...extra: StrategyAwardOption[]): StrategyAwardOption[] {
  return [sofiaOption(), ...extra];
}

function parisOption(): StrategyAwardOption {
  return hotelOption({ id: "hotel-option-paris", itineraryLabel: "Paris hotel" });
}

test("hotel stage rejects a solely destination-mismatched option and fails safely", async () => {
  const mock = await dependencies("hotel", () => false, sofiaOptions());

  await assert.rejects(
    generateHotelResearchStage(context(), CATALOG, mock.dependencies),
    (error: unknown) => error instanceof ResearchInterpreterError,
  );
  // The rejected property never reaches persistence or presentation: the
  // interpretation failed, so no InterpretedResearch value exists to save.
  assert.equal(mock.interpretedResearch.length, 1);
});

test("hotel stage removes destination-mismatched options while preserving valid siblings", async () => {
  const interpreterWarning = "Hyatt Regency Sofia offers great value this season.";
  const interpreterAssumption = "Assumes the Hyatt Regency Sofia rate is a 1-bedroom suite.";
  const sharedSource = { id: "source-shared", label: "https://example.com/comparison", status: "catalog" as const, observedAt: null };
  const mock = await dependencies(
    "hotel",
    () => false,
    [
      hotelOption({ id: "hotel-option-sofia", sourceId: SOFIA_HOTEL_SOURCE.id, itineraryLabel: "Hyatt Regency Sofia", goalMatch: "different_destination", goalMismatchReasons: ["destination"] }),
      hotelOption({ id: "hotel-option-paris-a", sourceId: PARIS_HOTEL_SOURCE.id, itineraryLabel: "Paris hotel A" }),
      hotelOption({ id: "hotel-option-paris-b", sourceId: sharedSource.id, itineraryLabel: "Paris hotel B" }),
      hotelOption({ id: "hotel-option-london", sourceId: SOFIA_HOTEL_SOURCE.id, itineraryLabel: "London hotel", goalMatch: "general", goalMismatchReasons: ["destination"] }),
    ],
    [SOFIA_HOTEL_SOURCE, PARIS_HOTEL_SOURCE, sharedSource],
    [interpreterAssumption],
    [interpreterWarning],
  );
  const interpreted = await generateHotelResearchStage(context(), CATALOG, mock.dependencies);

  // Retained options keep their original relative order.
  assert.deepEqual(
    interpreted.awardOptions.map((option) => option.id),
    ["hotel-option-paris-a", "hotel-option-paris-b"],
  );
  // The valid siblings keep their source references and validated evidence.
  assert.equal(interpreted.awardOptions[0].sourceId, PARIS_HOTEL_SOURCE.id);
  assert.equal(interpreted.awardOptions[0].programName, "World of Hyatt");
  assert.equal(interpreted.awardOptions[0].pricingBasis, "per_night");
  assert.equal(interpreted.awardOptions[0].pointsRequired, 20000);
  // A source shared by a retained option remains; sources referenced only by
  // rejected options are pruned, in original relative order.
  assert.deepEqual(interpreted.sources.map((source) => source.id), ["source-hotel-paris", "source-shared"]);
  // Model-generated assumptions/warnings cannot be bounded to retained
  // options, so they are replaced by exactly one fixed safe warning.
  assert.deepEqual(interpreted.assumptions, []);
  assert.deepEqual(interpreted.warnings, [
    "Hotel options for a different destination than your goal were omitted from your recommendations.",
  ]);
  // Case-insensitive: neither the property nor the orphan source survives.
  const serialized = JSON.stringify(interpreted).toLowerCase();
  for (const rejected of ["hyatt regency sofia", "sofia", "source-hotel-sofia", "sofia-hotel", "london hotel", interpreterWarning.toLowerCase(), interpreterAssumption.toLowerCase()]) {
    assert.equal(serialized.includes(rejected), false, `filtered result must not contain ${rejected}`);
  }
  assert.equal(serialized.includes("source-hotel-paris"), true);
  assert.equal(serialized.includes("source-shared"), true);
});

test("hotel stage removes every destination-mismatched option when several exist", async () => {
  const secondMismatch = hotelOption({
    id: "hotel-option-london",
    sourceId: SOFIA_HOTEL_SOURCE.id,
    itineraryLabel: "London hotel",
    goalMatch: "general",
    goalMismatchReasons: ["destination"],
  });
  const mock = await dependencies(
    "hotel",
    () => false,
    sofiaOptions(secondMismatch, parisOption()),
    [SOFIA_HOTEL_SOURCE, PARIS_HOTEL_SOURCE],
  );
  const interpreted = await generateHotelResearchStage(context(), CATALOG, mock.dependencies);

  assert.deepEqual(interpreted.awardOptions.map((option) => option.id), ["hotel-option-paris"]);
  // The Sofia-only source is pruned even though a rejected option used it.
  assert.deepEqual(interpreted.sources.map((source) => source.id), ["source-hotel-paris"]);
  const serialized = JSON.stringify(interpreted).toLowerCase();
  assert.equal(serialized.includes("london hotel"), false);
  assert.equal(serialized.includes("hyatt regency sofia"), false);
  assert.equal(serialized.includes("sofia-hotel"), false);
});

test("hotel stage preserves original option and source order around rejected options", async () => {
  const firstSource = { id: "source-first", label: "https://example.com/first", status: "catalog" as const, observedAt: null };
  const lastSource = { id: "source-last", label: "https://example.com/last", status: "catalog" as const, observedAt: null };
  const mismatchSource = { id: "source-mismatch-only", label: "https://example.com/mismatch-only", status: "catalog" as const, observedAt: null };
  const mock = await dependencies(
    "hotel",
    () => false,
    [
      hotelOption({ id: "hotel-option-keep-1", sourceId: firstSource.id, itineraryLabel: "Keep one" }),
      hotelOption({ id: "hotel-option-drop-1", sourceId: mismatchSource.id, itineraryLabel: "Drop one", goalMatch: "different_destination", goalMismatchReasons: ["destination"] }),
      hotelOption({ id: "hotel-option-keep-2", sourceId: PARIS_HOTEL_SOURCE.id, itineraryLabel: "Keep two" }),
      hotelOption({ id: "hotel-option-drop-2", sourceId: SOFIA_HOTEL_SOURCE.id, itineraryLabel: "Drop two", goalMismatchReasons: ["destination"] }),
      hotelOption({ id: "hotel-option-keep-3", sourceId: lastSource.id, itineraryLabel: "Keep three" }),
    ],
    [firstSource, mismatchSource, PARIS_HOTEL_SOURCE, SOFIA_HOTEL_SOURCE, lastSource],
  );
  const interpreted = await generateHotelResearchStage(context(), CATALOG, mock.dependencies);

  assert.deepEqual(
    interpreted.awardOptions.map((option) => option.id),
    ["hotel-option-keep-1", "hotel-option-keep-2", "hotel-option-keep-3"],
  );
  assert.deepEqual(
    interpreted.sources.map((source) => source.id),
    ["source-first", "source-hotel-paris", "source-last"],
  );
});

test("hotel stage preserves an exact matching option unchanged", async () => {
  const assumptions = ["Standard nightly pricing assumption."];
  const warnings = ["Rates observed at research time."];
  const exact = hotelOption({ id: "hotel-option-paris", goalMatch: "exact", goalMismatchReasons: [] });
  const mock = await dependencies("hotel", () => false, [exact], [PARIS_HOTEL_SOURCE], assumptions, warnings);
  const interpreted = await generateHotelResearchStage(context(), CATALOG, mock.dependencies);

  // Nothing was rejected: assumptions, warnings, sources, and options are
  // passed through unchanged.
  assert.deepEqual(interpreted.awardOptions, [exact]);
  assert.deepEqual(interpreted.assumptions, assumptions);
  assert.deepEqual(interpreted.warnings, warnings);
  assert.deepEqual(interpreted.sources, [PARIS_HOTEL_SOURCE]);
});

test("hotel stage preserves general planning-benchmark options without destination mismatch", async () => {
  const assumptions = ["Benchmark planning assumption."];
  const warnings = ["Planning benchmark warning."];
  const general = hotelOption({ id: "hotel-option-general", goalMatch: "general", goalMismatchReasons: [] });
  const mock = await dependencies("hotel", () => false, [general], [PARIS_HOTEL_SOURCE], assumptions, warnings);
  const interpreted = await generateHotelResearchStage(context(), CATALOG, mock.dependencies);

  assert.deepEqual(interpreted.awardOptions, [general]);
  assert.deepEqual(interpreted.assumptions, assumptions);
  assert.deepEqual(interpreted.warnings, warnings);
});

// ---------------------------------------------------------------------------
// Finalized-strategy hotelPlanningEstimate propagation
// ---------------------------------------------------------------------------

function stubOllamaStrategyNarrative(narrative: Record<string, unknown>): void {
  process.env.OLLAMA_BASE_URL = "http://localhost:11434";
  process.env.OLLAMA_STRATEGY_MODEL = "planner-test-model";
  globalThis.fetch = (async () => ({
    ok: true,
    status: 200,
    json: async () => ({ message: { content: JSON.stringify(narrative) } }),
  })) as unknown as typeof fetch;
}

function restoreOllamaStrategyFetch(priorFetch: typeof fetch | undefined, priorBaseUrl: string | undefined, priorModel: string | undefined): void {
  if (priorFetch === undefined) delete (globalThis as { fetch?: typeof fetch }).fetch;
  else globalThis.fetch = priorFetch;
  if (priorBaseUrl === undefined) delete process.env.OLLAMA_BASE_URL;
  else process.env.OLLAMA_BASE_URL = priorBaseUrl;
  if (priorModel === undefined) delete process.env.OLLAMA_STRATEGY_MODEL;
  else process.env.OLLAMA_STRATEGY_MODEL = priorModel;
}

function minimalNarrative(): Record<string, unknown> {
  return {
    headline: "Model headline must be replaced",
    summary: "Model summary must be replaced",
    feasibility: "on_track",
    pointsGap: 42_000,
    recommendedAwardOptionId: "hotel-option-general",
    recommendedCardOfferId: "card-1",
    flightOptions: [],
    hotelOptions: [],
    actions: [],
    alternatives: [],
    assumptions: [],
    warnings: [],
    followUpQuestions: ["Model follow-up"],
    // Hostile: the model must never be able to set the persisted estimates.
    flightPlanningEstimate: { label: "Flight planning estimate", hijacked: true },
    hotelPlanningEstimate: { label: "Hotel planning estimate", hijacked: true },
  };
}

async function finalizeWithStages(stages: VerifiedStrategyResearchStages): Promise<PersonalizedStrategy> {
  // Deterministic provider selection: force the Ollama path so the stubbed
  // fetch is used and no real provider network call can occur. Key values are
  // only saved and restored — never read or printed.
  const priorFetch = globalThis.fetch;
  const priorOpenRouterKey = process.env.OPENROUTER_API_KEY;
  const priorBaseUrl = process.env.OLLAMA_BASE_URL;
  const priorModel = process.env.OLLAMA_STRATEGY_MODEL;
  delete process.env.OPENROUTER_API_KEY;
  stubOllamaStrategyNarrative(minimalNarrative());
  try {
    return await generateAutomatedStrategyFromResearchStages(
      context(),
      [],
      CATALOG,
      stages,
      "retry",
    );
  } finally {
    if (priorOpenRouterKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = priorOpenRouterKey;
    restoreOllamaStrategyFetch(priorFetch, priorBaseUrl, priorModel);
  }
}

const hotelEstimateFixture = projectHotelPlanningEstimate({
  schemaVersion: 1,
  label: "Hotel planning estimate",
  destination: "Paris",
  checkInDate: "2027-04-03",
  checkOutDate: "2027-04-11",
  nights: 8,
  travelers: 2,
  currency: "USD",
  options: [{
    id: "serpapi-hotel-1",
    propertyName: "Example Grand Hotel",
    locationText: null,
    nightlyPrice: 1200,
    nightlyPriceCurrency: "USD",
    totalPrice: 9600,
    totalPriceCurrency: "USD",
    rating: 4.5,
    reviewCount: 214,
    hotelClass: 4,
    neighborhood: null,
    amenities: ["Free Wi-Fi"],
    propertyUrl: "https://example.com/example-grand-hotel",
    imageUrl: null,
    trustStatus: "search_estimate",
  }],
  disclosure: "Search estimates only; not bookable; verify current price and availability before booking",
  evidenceLabel: "Planning estimate",
  verificationLabel: "Not customer-verified",
  availabilityLabel: "Search estimates only; not bookable; verify current price and availability before booking",
});
assert.ok(hotelEstimateFixture, "hotel estimate fixture must be valid");

const flightEstimateFixture: FlightPlanningEstimate = {
  label: "Flight planning estimate" as const,
  origin: "DEN",
  destination: "Paris",
  outboundDate: "2027-04-03",
  returnDate: "2027-04-11",
  travelers: 2,
  cabin: "economy",
  currency: "USD",
  total: 1800,
  priceCoverage: "searched_party_total" as const,
  retrievedAt: "2026-08-01T00:00:00.000Z",
  outboundSegments: [{
    sequence: 1,
    departureAirport: "DEN",
    departureTime: "2027-04-03 08:00",
    arrivalAirport: "CDG",
    arrivalTime: "2027-04-03 22:00",
    marketingCarrier: null,
    marketingFlightNumber: null,
    cabin: "economy",
  }],
  returnSegments: [{
    sequence: 1,
    departureAirport: "CDG",
    departureTime: "2027-04-11 09:00",
    arrivalAirport: "DEN",
    arrivalTime: "2027-04-11 23:00",
    marketingCarrier: null,
    marketingFlightNumber: null,
    cabin: "economy",
  }],
  unknowns: ["offer_expiry"],
  evidenceLabel: "Planning estimate" as const,
  verificationLabel: "Not customer-verified" as const,
  availabilityLabel: "Not live or bookable; verify before booking" as const,
};

const emptyStage = {
  awardOptions: [],
  cardOffers: [],
  sources: [],
  assumptions: [],
  warnings: [],
};

test("finalized strategy copies the verified signed hotel-stage estimate and never model output", async () => {
  const strategy = await finalizeWithStages({
    flight: null,
    hotel: { ...emptyStage, hotelPlanningEstimate: hotelEstimateFixture },
  });

  assert.deepEqual(strategy.hotelPlanningEstimate, hotelEstimateFixture);
  assert.equal(strategy.flightPlanningEstimate, null);
  const serialized = JSON.stringify(strategy);
  // The model narrative's hostile estimate shapes must not survive.
  assert.equal(serialized.includes("hijacked"), false);
  assert.equal(serialized.includes("Model headline"), false);
});

test("finalized strategy keeps flight and hotel estimates independent and absent stages null", async () => {
  const withFlight = await finalizeWithStages({
    flight: { ...emptyStage, flightPlanningEstimate: flightEstimateFixture },
    hotel: null,
  });
  assert.deepEqual(withFlight.flightPlanningEstimate, flightEstimateFixture);
  assert.equal(withFlight.hotelPlanningEstimate, null);

  const withBoth = await finalizeWithStages({
    flight: { ...emptyStage, flightPlanningEstimate: flightEstimateFixture },
    hotel: { ...emptyStage, hotelPlanningEstimate: hotelEstimateFixture },
  });
  assert.deepEqual(withBoth.flightPlanningEstimate, flightEstimateFixture);
  assert.deepEqual(withBoth.hotelPlanningEstimate, hotelEstimateFixture);
});
