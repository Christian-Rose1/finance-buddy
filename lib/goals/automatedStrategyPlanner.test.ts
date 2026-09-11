import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  generateAutomatedStrategyFromResearchStages,
  generateHotelResearchStage,
  shouldRunOptionalCardResearch,
  type StagedResearchDependencies,
  type StrategyRewardProgram,
  type VerifiedStrategyResearchStages,
} from "./automatedStrategyPlanner";
import { ResearchInterpreterError, type ResearchInterpreter } from "./researchInterpreter";
import { buildResearchPlannerInput } from "./researchPlannerInputBuilder";
import { projectHotelPlanningEstimate } from "./hotelPlanningEstimate";
import type { FlightPlanningEstimate } from "./flightPlanningEstimate";
import type { EarningRule } from "@/lib/rewards/catalogTypes";
import type {
  AirportRegionEntry,
  AwardPriceBenchmark,
  VerifiedTransferPartner,
} from "@/lib/rewards/awardBenchmarks";
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

/**
 * Sets a narrative-provider environment in which any provider invocation
 * throws. Finalization must never construct or call a narrative provider, so
 * both provider-construction-side configuration and the network boundary
 * itself fail loudly if the old behavior regresses.
 *
 * The Seats.aero URL is routed separately: it throws unless the current test
 * installs an explicit responder via `installSeatsAeroResponder`, so an
 * accidental observed-price call can never reach the network either.
 */
let seatsAeroResponder: ((url: string, init: RequestInit) => Promise<Response>) | null = null;

function installSeatsAeroResponder(
  responder: ((url: string, init: RequestInit) => Promise<Response>) | null,
): void {
  seatsAeroResponder = responder;
}

function stubNarrativeProviderThrowsIfInvoked(): void {
  process.env.OLLAMA_BASE_URL = "http://localhost:11434";
  process.env.OLLAMA_STRATEGY_MODEL = "planner-test-model";
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const target = typeof url === "string" ? url : url instanceof URL ? url.toString() : url.url;
    if (target.startsWith("https://seats.aero/")) {
      const responder = seatsAeroResponder;
      if (responder === null) {
        throw new Error("seats.aero must not be called without an explicit test responder");
      }
      return responder(target, init ?? {});
    }
    throw new Error("narrative provider must not be invoked during finalization");
  }) as unknown as typeof fetch;
}

function restoreOllamaStrategyFetch(priorFetch: typeof fetch | undefined, priorBaseUrl: string | undefined, priorModel: string | undefined): void {
  if (priorFetch === undefined) delete (globalThis as { fetch?: typeof fetch }).fetch;
  else globalThis.fetch = priorFetch;
  if (priorBaseUrl === undefined) delete process.env.OLLAMA_BASE_URL;
  else process.env.OLLAMA_BASE_URL = priorBaseUrl;
  if (priorModel === undefined) delete process.env.OLLAMA_STRATEGY_MODEL;
  else process.env.OLLAMA_STRATEGY_MODEL = priorModel;
}

async function finalizeWithStages(
  stages: VerifiedStrategyResearchStages,
  mode: "initial" | "retry" = "retry",
  strategyContext: PersonalizedStrategyContext = context(),
  catalog: StrategyRewardProgram[] = CATALOG,
  signal?: AbortSignal,
): Promise<PersonalizedStrategy> {
  // Deterministic selection of the (throwing) Ollama path: the key values are
  // only saved and restored — never read or printed.
  const priorFetch = globalThis.fetch;
  const priorOpenRouterKey = process.env.OPENROUTER_API_KEY;
  const priorBaseUrl = process.env.OLLAMA_BASE_URL;
  const priorModel = process.env.OLLAMA_STRATEGY_MODEL;
  delete process.env.OPENROUTER_API_KEY;
  stubNarrativeProviderThrowsIfInvoked();
  try {
    return await generateAutomatedStrategyFromResearchStages(
      strategyContext,
      [],
      catalog,
      stages,
      mode,
      signal,
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

test("finalized strategy copies the verified signed hotel-stage estimate with a deterministic narrative", async () => {
  const strategy = await finalizeWithStages({
    flight: null,
    hotel: { ...emptyStage, hotelPlanningEstimate: hotelEstimateFixture },
  });

  assert.deepEqual(strategy.hotelPlanningEstimate, hotelEstimateFixture);
  assert.equal(strategy.flightPlanningEstimate, null);
  // The narrative is server-owned fixed copy, not model prose.
  const serialized = JSON.stringify(strategy);
  assert.equal(serialized.includes("hijacked"), false);
  assert.equal(serialized.includes("Model headline"), false);
  assert.equal(strategy.followUpQuestions.length, 0);
  assert.equal(strategy.feasibility, "insufficient_information");
  assert.equal(strategy.pointsGap, null);
  assert.equal(strategy.recommendedAwardOptionId, null);
  assert.equal(strategy.recommendedCardOfferId, null);
  assert.deepEqual(strategy.actions, []);
  assert.deepEqual(strategy.alternatives, []);
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

test("finalization attaches the deterministic earn plan built from card-attributed spending", async () => {
  const earningRule: EarningRule = {
    id: "rule-db-id",
    cardProductId: "product-db-id",
    type: "earning_rate",
    eligibleCategory: "food:dining",
    eligibleMerchant: null,
    excludedMerchants: [],
    rewardCurrency: "points",
    rewardValue: 3,
    percentage: null,
    fixedValue: null,
    explanation: "3x points on dining",
    source: "development_fixture",
    lastVerifiedAt: "2026-08-16T10:50:00Z",
    active: true,
    metadata: null,
  };
  const attributedContext: PersonalizedStrategyContext = {
    ...context(),
    walletCards: [{
      id: "card-db-id",
      name: "Sapphire Preferred",
      issuer: "Chase",
      rewardCurrency: "points",
      cardProductId: "product-db-id",
    }],
    earningRules: [earningRule],
    walletCardProgramIds: { "card-db-id": "program-db-id" },
    monthlySpendingByCategoryCard: [
      { cardId: "card-db-id", category: "food:dining", monthlyAverage: 100 },
    ],
  };
  const flightStage = { ...emptyStage, flightPlanningEstimate: flightEstimateFixture };
  const strategy = await finalizeWithStages(
    { flight: flightStage, hotel: null },
    "retry",
    attributedContext,
  );

  assert.ok(strategy.earnPlan);
  assert.equal(strategy.earnPlan.accounts.length, 1);
  const account = strategy.earnPlan.accounts[0];
  assert.ok(account);
  assert.equal(account.programName, "Chase Ultimate Rewards");
  assert.equal(account.monthlyPoints, 300);
  assert.deepEqual(account.cardNames, ["Sapphire Preferred"]);
  // The searched party-total and the goal's budget produce the cash gap.
  assert.deepEqual(strategy.earnPlan.cashGap, {
    currency: "USD",
    tripTotal: 1800,
    cashBudget: 2000,
    remaining: 200,
  });

  // Fail-closed: no attributed spending, no plan (never a fallback).
  const withoutAttribution = await finalizeWithStages(
    { flight: flightStage, hotel: null },
    "retry",
    context(),
  );
  assert.equal(withoutAttribution.earnPlan, null);
});

// ---------------------------------------------------------------------------
// Deterministic finalization without a narrative provider
// ---------------------------------------------------------------------------

function flightAwardOption(): StrategyAwardOption {
  return {
    id: "flight-option-id",
    sourceId: "source-flight",
    programName: "Chase Ultimate Rewards",
    redemptionType: "flight",
    pricingBasis: "round_trip",
    itineraryLabel: "DEN → CDG round trip",
    pointsRequired: 60000,
    cashFees: 11.2,
    seats: null,
    cabin: "economy",
    transferFromProgramId: null,
    transferRatio: null,
    centsPerPoint: null,
    availabilityStatus: "unknown",
  };
}

function hotelAwardOption(): StrategyAwardOption {
  return hotelOption({ id: "hotel-option-final" });
}

function flightStage(): VerifiedStrategyResearchStages["flight"] {
  return {
    ...emptyStage,
    awardOptions: [flightAwardOption()],
    sources: [{ id: "source-flight", label: "https://example.com/flight", status: "catalog" as const, observedAt: null }],
    flightPlanningEstimate: flightEstimateFixture,
  };
}

function hotelStage(): VerifiedStrategyResearchStages["hotel"] {
  return {
    ...emptyStage,
    awardOptions: [hotelAwardOption()],
    sources: [PARIS_HOTEL_SOURCE],
    hotelPlanningEstimate: hotelEstimateFixture,
  };
}

for (const [label, stages] of [
  ["both", { flight: flightStage(), hotel: hotelStage() }],
  ["flight-only", { flight: flightStage(), hotel: null }],
  ["hotel-only", { flight: null, hotel: hotelStage() }],
  ["neither", { flight: null, hotel: null }],
] as const) {
  test(`initial finalization succeeds without a narrative provider (${label} stages)`, async () => {
    const strategy = await finalizeWithStages(stages, "initial");

    // Server-owned narrative copy. Validated stage options are planning
    // benchmarks (the exact-cash/customer-verified lanes are empty by design),
    // so every lane combination here receives the benchmark variant.
    assert.equal(strategy.headline, "Planning benchmarks found");
    assert.equal(strategy.feasibility, "insufficient_information");
    assert.equal(strategy.pointsGap, null);
    assert.deepEqual(strategy.actions, []);
    assert.deepEqual(strategy.alternatives, []);
    assert.deepEqual(strategy.followUpQuestions, []);

    // Structured lanes survive; estimates come only from the verified stages.
    assert.equal(strategy.flightOptions.length, stages.flight ? 1 : 0);
    assert.equal(strategy.hotelOptions.length, stages.hotel ? 1 : 0);
    assert.deepEqual(strategy.flightPlanningEstimate, stages.flight?.flightPlanningEstimate ?? null);
    assert.deepEqual(strategy.hotelPlanningEstimate, stages.hotel?.hotelPlanningEstimate ?? null);

    // Omitted-lane warnings and stage notes are preserved.
    if (!stages.flight) {
      assert.ok(strategy.warnings.some((warning) => warning.startsWith("Flight recommendations were omitted")));
    }
    if (!stages.hotel) {
      assert.ok(strategy.warnings.some((warning) => warning.startsWith("Hotel recommendations were omitted")));
    }

    // Deterministic points inventory and allocations remain attached.
    assert.equal(strategy.pointsInventory.length, 1);
    assert.ok(strategy.allocationScenarios.length > 0);
  });

  test(`retry finalization succeeds without a narrative provider (${label} stages)`, async () => {
    const strategy = await finalizeWithStages(stages, "retry");

    assert.equal(strategy.feasibility, "insufficient_information");
    assert.deepEqual(strategy.followUpQuestions, []);
    assert.equal(strategy.flightOptions.length, stages.flight ? 1 : 0);
    assert.equal(strategy.hotelOptions.length, stages.hotel ? 1 : 0);
    assert.equal(strategy.pointsInventory.length, 1);
    assert.ok(strategy.allocationScenarios.length > 0);
  });
}

test("finalized strategy never invokes a narrative provider on any mode", async () => {
  for (const mode of ["initial", "retry"] as const) {
    const strategy = await finalizeWithStages(
      { flight: flightStage(), hotel: hotelStage() },
      mode,
    );
    // The throwing fetch stub would have rejected finalization if any
    // provider request had been attempted.
    assert.ok(strategy.headline.length > 0);
    assert.ok(strategy.summary.length > 0);
  }
});

test("finalization excludes missing-source options and deduplicates each lane by first occurrence", async () => {
  const firstFlight = { ...flightAwardOption(), evidenceLevel: "planning_benchmark" as const };
  const duplicateFlight = { ...firstFlight, itineraryLabel: "Duplicate later occurrence" };
  // An ineligible option placed BEFORE an eligible option with the SAME id:
  // if deduplication ran before source filtering, this orphan would consume
  // the shared id and the eligible option would be dropped. Filtering first
  // removes the orphan, so the eligible option must survive with exact fields.
  const orphanWithSameId = {
    ...firstFlight,
    sourceId: "source-not-provided",
    itineraryLabel: "Orphan same id placed first",
  };
  const missingSourceFlight = {
    ...firstFlight,
    id: "flight-orphan",
    sourceId: "source-not-provided",
    itineraryLabel: "Missing source option",
  };
  const secondFlight = { ...firstFlight, id: "flight-second", itineraryLabel: "Second distinct flight" };
  const hotelWithFlightId = hotelOption({ id: firstFlight.id, itineraryLabel: "Hotel sharing the flight id" });
  const hotelSecond = hotelOption({ id: "hotel-second", itineraryLabel: "Second hotel" });

  const strategy = await finalizeWithStages(
    {
      flight: {
        ...emptyStage,
        awardOptions: [orphanWithSameId, firstFlight, duplicateFlight, missingSourceFlight, secondFlight],
        sources: [{ id: "source-flight", label: "https://example.com/flight", status: "catalog" as const, observedAt: null }],
        flightPlanningEstimate: flightEstimateFixture,
      },
      hotel: {
        ...emptyStage,
        awardOptions: [hotelWithFlightId, hotelSecond],
        sources: [PARIS_HOTEL_SOURCE],
        hotelPlanningEstimate: hotelEstimateFixture,
      },
    },
    "retry",
  );

  // A missing-source option is excluded before lane construction: it appears
  // nowhere in the persisted strategy, not even as a dedup survivor.
  const serialized = JSON.stringify(strategy);
  assert.equal(serialized.includes("flight-orphan"), false);
  assert.equal(serialized.includes("Missing source option"), false);
  assert.equal(serialized.includes("source-not-provided"), false);

  // Source filtering precedes deduplication: the ineligible option placed
  // before the eligible same-id option could not consume that id. The
  // eligible option survives as the first lane entry by reference, so its
  // exact fields are proven without any copied-fixture ambiguity.
  assert.equal(serialized.includes("Orphan same id placed first"), false);
  assert.equal(strategy.flightOptions.length, 2);
  assert.equal(strategy.flightOptions[0], firstFlight);
  assert.deepEqual(strategy.flightOptions, [firstFlight, secondFlight]);
  assert.equal(serialized.includes("Duplicate later occurrence"), false);
  assert.equal(strategy.flightOptions[0].evidenceLevel, "planning_benchmark");
  assert.equal(strategy.flightOptions[0].programName, "Chase Ultimate Rewards");
  assert.equal(strategy.flightOptions[0].pointsRequired, 60000);

  // Deduplication is per-lane: the same id may remain in separate flight and
  // hotel lists.
  assert.deepEqual(strategy.hotelOptions, [hotelWithFlightId, hotelSecond]);
  assert.equal(strategy.flightOptions.some((option) => option.id === firstFlight.id), true);
  assert.equal(strategy.hotelOptions.some((option) => option.id === firstFlight.id), true);
});

// ---------------------------------------------------------------------------
// R2: deterministic award benchmarks (Route A) — planner integration
// ---------------------------------------------------------------------------

const BENCHMARK_PROGRAMS = [
  { id: "program-db-id", name: "Chase Ultimate Rewards" },
  { id: "program-aeroplan", name: "Air Canada Aeroplan" },
];

function benchmarkRow(
  overrides: Partial<AwardPriceBenchmark> = {},
): AwardPriceBenchmark {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    rewardProgramId: "program-aeroplan",
    redemptionType: "flight",
    originRegion: "us_domestic",
    destinationRegion: "transatlantic_europe",
    cabin: "economy",
    pricingBasis: "round_trip",
    pointsRequired: 60000,
    cashFees: 80,
    currency: "USD",
    travelerCountCovered: 1,
    nightCountCovered: null,
    validFrom: null,
    validUntil: null,
    source: "Published award chart (fixture)",
    lastVerifiedAt: "2026-08-01T00:00:00.000Z",
    active: true,
    ...overrides,
  };
}

function regionEntriesFixture(): AirportRegionEntry[] {
  return [
    { iataCode: "DEN", region: "us_domestic", source: "fixture", lastVerifiedAt: "2026-08-01T00:00:00Z" },
    { iataCode: "CDG", region: "transatlantic_europe", source: "fixture", lastVerifiedAt: "2026-08-01T00:00:00Z" },
  ];
}

// The production flight estimate resolves real IATA codes; the benchmark
// join consumes them. (The plain fixture's "Paris" destination intentionally
// exercises the fail-closed no-code path.)
const resolvedEstimateFixture: FlightPlanningEstimate = {
  ...flightEstimateFixture,
  destination: "CDG",
};

function benchmarkContext(
  overrides: Partial<PersonalizedStrategyContext> = {},
): PersonalizedStrategyContext {
  return {
    ...context(),
    awardPriceBenchmarks: [benchmarkRow()],
    airportRegionEntries: regionEntriesFixture(),
    verifiedTransferPartners: [
      {
        id: "22222222-2222-4222-8222-222222222222",
        fromProgramId: "program-db-id",
        toProgramId: "program-aeroplan",
        destinationPointsPerSourcePoint: 1,
        source: "Partner documentation (fixture)",
        lastVerifiedAt: "2026-08-01T00:00:00.000Z",
      },
    ],
    ...overrides,
  };
}

test("verified benchmark rows become flight options with a benchmark source and transfer funding", async () => {
  const strategy = await finalizeWithStages(
    { flight: { ...emptyStage, flightPlanningEstimate: resolvedEstimateFixture }, hotel: null },
    "retry",
    benchmarkContext(),
    BENCHMARK_PROGRAMS,
  );

  const benchmarkOption = strategy.flightOptions.find(
    (option) => option.id === "award-benchmark-11111111-1111-4111-8111-111111111111",
  );
  assert.ok(benchmarkOption, "benchmark-derived option must appear in flightOptions");
  assert.equal(benchmarkOption.programName, "Air Canada Aeroplan");
  assert.equal(benchmarkOption.evidenceLevel, "planning_benchmark");
  assert.equal(benchmarkOption.availabilityStatus, "unknown");
  assert.equal(benchmarkOption.centsPerPoint, null);
  assert.equal(benchmarkOption.pointsRequired, 60000);
  assert.equal(benchmarkOption.cashFees, 80);
  assert.equal(benchmarkOption.travelerCountCovered, 1);

  // The benchmark option is linked to a benchmark source id that also exists
  // in the assembled strategy's source-eligible set (it survived filtering).
  assert.ok(benchmarkOption.sourceId.startsWith("award-benchmark-"));

  // Transfer funding: 60,000 destination points at 1:1 from the customer's
  // 80,000-point Chase account — 120,000 planned for 2 travelers against an
  // 80,000 balance, so the deterministic status is honestly "gap".
  const flightFirst = strategy.allocationScenarios.find((s) => s.kind === "flight_first");
  assert.ok(flightFirst);
  assert.equal(flightFirst.status, "gap");
  assert.equal(flightFirst.flightPointsRequired, 120000); // 60,000 × 2 travelers
  const allocation = flightFirst.allocations[0];
  assert.ok(allocation);
  assert.equal(allocation.fundingMethod, "transfer_source");
  assert.equal(allocation.plannedPoints, 120000);
  assert.equal(allocation.availablePoints, 80000);
  assert.equal(allocation.pointsGap, 40000);
  assert.equal(
    flightFirst.assumptions.some((line) =>
      line.includes("verified transfer partner") && line.includes("rounded up"),
    ),
    true,
  );
});

test("benchmarks fail closed without a resolved airport code", async () => {
  // The default estimate fixture has destination "Paris" (not IATA) — the
  // benchmark join must yield nothing rather than guessing a region.
  const strategy = await finalizeWithStages(
    { flight: { ...emptyStage, flightPlanningEstimate: flightEstimateFixture }, hotel: null },
    "retry",
    { ...context(), awardPriceBenchmarks: [benchmarkRow()], airportRegionEntries: regionEntriesFixture() },
    BENCHMARK_PROGRAMS,
  );
  assert.equal(
    strategy.flightOptions.some((option) => option.id.startsWith("award-benchmark-")),
    false,
  );
});

test("no benchmark catalog rows produce no benchmark options and no transfer assumptions", async () => {
  const strategy = await finalizeWithStages(
    { flight: { ...emptyStage, flightPlanningEstimate: resolvedEstimateFixture }, hotel: null },
    "retry",
    { ...context(), airportRegionEntries: regionEntriesFixture() },
    BENCHMARK_PROGRAMS,
  );
  assert.equal(
    strategy.flightOptions.some((option) => option.id.startsWith("award-benchmark-")),
    false,
  );
  assert.equal(
    strategy.allocationScenarios.some((scenario) =>
      scenario.assumptions.some((line) => line.includes("verified transfer partner")),
    ),
    false,
  );
});

test("unverified benchmark rows never become options", async () => {
  const strategy = await finalizeWithStages(
    { flight: { ...emptyStage, flightPlanningEstimate: resolvedEstimateFixture }, hotel: null },
    "retry",
    benchmarkContext({
      awardPriceBenchmarks: [benchmarkRow({ lastVerifiedAt: null })],
    }),
    BENCHMARK_PROGRAMS,
  );
  assert.equal(
    strategy.flightOptions.some((option) => option.id.startsWith("award-benchmark-")),
    false,
  );
});

test("flexible cabin never selects cabin-specific benchmark rows", async () => {
  const strategy = await finalizeWithStages(
    { flight: { ...emptyStage, flightPlanningEstimate: resolvedEstimateFixture }, hotel: null },
    "retry",
    benchmarkContext({
      goal: { ...context().goal, cabinPreference: "flexible" },
    }),
    BENCHMARK_PROGRAMS,
  );
  assert.equal(
    strategy.flightOptions.some((option) => option.id.startsWith("award-benchmark-")),
    false,
  );
});

test("expired benchmark rows never become options", async () => {
  const strategy = await finalizeWithStages(
    { flight: { ...emptyStage, flightPlanningEstimate: resolvedEstimateFixture }, hotel: null },
    "retry",
    benchmarkContext({
      awardPriceBenchmarks: [benchmarkRow({ validUntil: "2026-07-01T00:00:00Z" })],
    }),
    BENCHMARK_PROGRAMS,
  );
  assert.equal(
    strategy.flightOptions.some((option) => option.id.startsWith("award-benchmark-")),
    false,
  );
});

test("server-only catalogRewardProgramId never reaches client-safe strategy output", async () => {
  const strategy = await finalizeWithStages(
    { flight: { ...emptyStage, flightPlanningEstimate: resolvedEstimateFixture }, hotel: null },
    "retry",
    benchmarkContext(),
    BENCHMARK_PROGRAMS,
  );
  // The client-safe projection must strip the server-only field entirely.
  const { toClientSafeStrategy } = await import("./travelEvidence");
  const safe = toClientSafeStrategy(strategy);
  assert.equal(JSON.stringify(safe).includes("catalogRewardProgramId"), false);
});

// ---------------------------------------------------------------------------
// Observed award prices (Seats.aero cached search lane)
// ---------------------------------------------------------------------------

const OBSERVED_PROGRAMS = [
  { id: "program-db-id", name: "Chase Ultimate Rewards" },
  { id: "program-aeroplan", name: "Air Canada Aeroplan" },
  { id: "program-united", name: "United MileagePlus" },
];

function seatsAeroRowFixture(overrides: Record<string, unknown> = {}) {
  return {
    ID: "observed-row-1",
    Route: {
      ID: "route-1",
      OriginAirport: "DEN",
      OriginRegion: "North America",
      DestinationAirport: "CDG",
      DestinationRegion: "Europe",
      NumDaysOut: 215,
      Distance: 4900,
      Source: "united",
    },
    Date: "2027-04-03",
    ParsedDate: "2027-04-03T00:00:00Z",
    YAvailable: true,
    WAvailable: false,
    JAvailable: true,
    FAvailable: false,
    YMileageCost: "41000",
    WMileageCost: null,
    JMileageCost: "115000",
    FMileageCost: null,
    YRemainingSeats: 4,
    WRemainingSeats: 0,
    JRemainingSeats: 2,
    FRemainingSeats: 0,
    YAirlines: "UA",
    WAirlines: "",
    JAirlines: "LH",
    FAirlines: "",
    YDirect: true,
    WDirect: false,
    JDirect: false,
    FDirect: false,
    Source: "united",
    CreatedAt: "2026-09-01T08:37:32.218426Z",
    UpdatedAt: "2026-08-02T13:52:23.343425Z",
    AvailabilityTrips: null,
    ...overrides,
  };
}

function seatsAeroEnvelope(rows: unknown[]) {
  return { data: rows, count: rows.length, hasMore: false, cursor: null };
}

function observedAvailabilityResponse(rows: unknown[]): Response {
  return {
    ok: true,
    status: 200,
    json: async () => seatsAeroEnvelope(rows),
  } as unknown as Response;
}

/**
 * Sets a Seats.aero key for the duration of one test and restores the
 * previous environment afterwards. The value is synthetic and the global
 * fetch stub routes all provider URLs, so no network access can occur.
 */
function withSeatsAeroKey(run: () => Promise<void>): () => Promise<void> {
  return async () => {
    const prior = process.env.SEATS_AERO_API_KEY;
    process.env.SEATS_AERO_API_KEY = "pro_planner_test_key";
    try {
      await run();
    } finally {
      if (prior === undefined) delete process.env.SEATS_AERO_API_KEY;
      else process.env.SEATS_AERO_API_KEY = prior;
    }
  };
}

test("observed availability rows become fundable flight options with observed-price evidence", async () => {
  await withSeatsAeroKey(async () => {
    installSeatsAeroResponder(async (url) => {
      assert.ok(url.includes("origin_airport="), "request must carry the corridor");
      // Outbound and return calls both serve the same observed row shape.
      return observedAvailabilityResponse([seatsAeroRowFixture()]);
    });
    try {
      const strategy = await finalizeWithStages(
        { flight: { ...emptyStage, flightPlanningEstimate: resolvedEstimateFixture }, hotel: null },
        "retry",
        benchmarkContext({ verifiedTransferPartners: [] }),
        OBSERVED_PROGRAMS,
      );

      const observed = strategy.flightOptions.find((option) =>
        option.id.startsWith("award-observed-"),
      );
      assert.ok(observed, "observed-price option must appear in flightOptions");
      assert.equal(observed.programName, "United MileagePlus");
      // Round-trip goal: outbound + return rows sum to the observed total.
      assert.equal(observed.pointsRequired, 82000);
      assert.equal(observed.pricingBasis, "round_trip");
      assert.equal(observed.evidenceLevel, "web_observed_not_live");
      assert.equal(observed.availabilityStatus, "available");
      assert.equal(observed.cabin, "economy");
      assert.equal(observed.catalogRewardProgramId, "program-united");
      // The observed source survived eligibility filtering with its fixed label.
      // (The assembled strategy mirrors sources at runtime; the persisted
      // interface omits them, so read through a typed view.)
      const strategySources =
        (strategy as unknown as { sources?: StrategySource[] }).sources ?? [];
      const source = strategySources.find((item) => item.id === observed.sourceId);
      assert.ok(source, "observed source must survive source filtering");
      assert.equal(source.status, "live");
      assert.ok(source.label.includes("Observed award price"));
      assert.equal(source.label.includes("https://"), false, "no URL may leak into source labels");
    } finally {
      installSeatsAeroResponder(null);
    }
  });
});

test("without a configured Seats.aero key no observed option appears and no fetch occurs", async () => {
  const prior = process.env.SEATS_AERO_API_KEY;
  delete process.env.SEATS_AERO_API_KEY;
  let fetchAttempts = 0;
  installSeatsAeroResponder(async () => {
    fetchAttempts += 1;
    return observedAvailabilityResponse([]);
  });
  try {
    const strategy = await finalizeWithStages(
      { flight: { ...emptyStage, flightPlanningEstimate: resolvedEstimateFixture }, hotel: null },
      "retry",
      benchmarkContext(),
      OBSERVED_PROGRAMS,
    );
    assert.equal(
      strategy.flightOptions.some((option) => option.id.startsWith("award-observed-")),
      false,
    );
    assert.equal(fetchAttempts, 0, "missing key must prevent every fetch");
  } finally {
    installSeatsAeroResponder(null);
    if (prior === undefined) delete process.env.SEATS_AERO_API_KEY;
    else process.env.SEATS_AERO_API_KEY = prior;
  }
});

test("provider failure in the observed lane contributes no options and keeps benchmarks", async () => {
  await withSeatsAeroKey(async () => {
    installSeatsAeroResponder(async () => {
      return { ok: false, status: 429, json: async () => ({}) } as unknown as Response;
    });
    try {
      const strategy = await finalizeWithStages(
        { flight: { ...emptyStage, flightPlanningEstimate: resolvedEstimateFixture }, hotel: null },
        "retry",
        benchmarkContext(),
        BENCHMARK_PROGRAMS,
      );
      assert.equal(
        strategy.flightOptions.some((option) => option.id.startsWith("award-observed-")),
        false,
      );
      // The benchmark floor remains intact.
      assert.ok(
        strategy.flightOptions.some((option) => option.id.startsWith("award-benchmark-")),
      );
    } finally {
      installSeatsAeroResponder(null);
    }
  });
});

test("observed options supersede the same-basis benchmark and keep different-basis benchmarks", async () => {
  await withSeatsAeroKey(async () => {
    installSeatsAeroResponder(async () =>
      observedAvailabilityResponse([seatsAeroRowFixture()]),
    );
    try {
      const strategy = await finalizeWithStages(
        { flight: { ...emptyStage, flightPlanningEstimate: resolvedEstimateFixture }, hotel: null },
        "retry",
        benchmarkContext(),
        BENCHMARK_PROGRAMS,
      );
      // The benchmark fixture is Aeroplan (no observed row) → retained.
      assert.ok(
        strategy.flightOptions.some((option) => option.id.startsWith("award-benchmark-")),
        "different-program benchmark must be retained",
      );

      // Now with a United benchmark that matches the observed program and
      // basis: the observed option must supersede it.
      const unitedBenchmark = benchmarkRow({
        id: "33333333-3333-4333-8333-333333333333",
        rewardProgramId: "program-united",
      });
      const strategy2 = await finalizeWithStages(
        { flight: { ...emptyStage, flightPlanningEstimate: resolvedEstimateFixture }, hotel: null },
        "retry",
        benchmarkContext({ awardPriceBenchmarks: [unitedBenchmark] }),
        BENCHMARK_PROGRAMS_WITH_UNITED,
      );
      assert.equal(
        strategy2.flightOptions.some(
          (option) =>
            option.id.startsWith("award-benchmark-") && option.programName === "United MileagePlus",
        ),
        false,
        "same-basis benchmark must be superseded by the observed option",
      );
      assert.ok(
        strategy2.flightOptions.some((option) => option.id.startsWith("award-observed-")),
      );
    } finally {
      installSeatsAeroResponder(null);
    }
  });
});

const BENCHMARK_PROGRAMS_WITH_UNITED = [
  { id: "program-db-id", name: "Chase Ultimate Rewards" },
  { id: "program-aeroplan", name: "Air Canada Aeroplan" },
  { id: "program-united", name: "United MileagePlus" },
];

test("flexible-cabin goals and unresolved airports skip the observed lane entirely", async () => {
  await withSeatsAeroKey(async () => {
    let fetchAttempts = 0;
    installSeatsAeroResponder(async () => {
      fetchAttempts += 1;
      return observedAvailabilityResponse([]);
    });
    try {
      // flexible cabin → no observed search.
      const flexibleStrategy = await finalizeWithStages(
        { flight: { ...emptyStage, flightPlanningEstimate: resolvedEstimateFixture }, hotel: null },
        "retry",
        { ...benchmarkContext(), goal: { ...context().goal, cabinPreference: "flexible" } },
        OBSERVED_PROGRAMS,
      );
      assert.equal(
        flexibleStrategy.flightOptions.some((option) => option.id.startsWith("award-observed-")),
        false,
      );

      // Non-IATA destination → no observed search.
      const unresolvedStrategy = await finalizeWithStages(
        { flight: { ...emptyStage, flightPlanningEstimate: flightEstimateFixture }, hotel: null },
        "retry",
        benchmarkContext(),
        OBSERVED_PROGRAMS,
      );
      assert.equal(
        unresolvedStrategy.flightOptions.some((option) => option.id.startsWith("award-observed-")),
        false,
      );
      assert.equal(fetchAttempts, 0, "skipped lanes must not fetch");
    } finally {
      installSeatsAeroResponder(null);
    }
  });
});

test("hostile observed responses reject the lane without breaking the plan", async () => {
  await withSeatsAeroKey(async () => {
    installSeatsAeroResponder(async () =>
      observedAvailabilityResponse([
        seatsAeroRowFixture({ Route: { Source: "united", OriginAirport: "JFK", DestinationAirport: "LHR" } }),
      ]),
    );
    try {
      const strategy = await finalizeWithStages(
        { flight: { ...emptyStage, flightPlanningEstimate: resolvedEstimateFixture }, hotel: null },
        "retry",
        benchmarkContext(),
        OBSERVED_PROGRAMS,
      );
      assert.equal(
        strategy.flightOptions.some((option) => option.id.startsWith("award-observed-")),
        false,
      );
      assert.ok(strategy.allocationScenarios.length > 0, "plan assembly must complete");
    } finally {
      installSeatsAeroResponder(null);
    }
  });
});

test("observed options feed the deterministic allocation engine", async () => {
  await withSeatsAeroKey(async () => {
    installSeatsAeroResponder(async () =>
      observedAvailabilityResponse([seatsAeroRowFixture()]),
    );
    try {
      const strategy = await finalizeWithStages(
        { flight: { ...emptyStage, flightPlanningEstimate: resolvedEstimateFixture }, hotel: null },
        "retry",
        benchmarkContext({ verifiedTransferPartners: [] }),
        OBSERVED_PROGRAMS,
      );
      const flightFirst = strategy.allocationScenarios.find((s) => s.kind === "flight_first");
      assert.ok(flightFirst);
      // 41,000 × 2 travelers from the observed rows.
      assert.equal(flightFirst.flightPointsRequired, 82000);
      assert.notEqual(flightFirst.status, "insufficient_information");
    } finally {
      installSeatsAeroResponder(null);
    }
  });
});

test("the finalization deadline signal reaches the observed-price transport", async () => {
  await withSeatsAeroKey(async () => {
    let observedSignal: AbortSignal | null = null;
    installSeatsAeroResponder(async (_url, init) => {
      observedSignal = init.signal ?? null;
      return observedAvailabilityResponse([]);
    });
    try {
      const controller = new AbortController();
      await finalizeWithStages(
        { flight: { ...emptyStage, flightPlanningEstimate: resolvedEstimateFixture }, hotel: null },
        "retry",
        benchmarkContext(),
        OBSERVED_PROGRAMS,
        controller.signal,
      );
      // Production threads the runWithStrategyFinalizationDeadline signal into
      // the planner; the observed lane must forward it to the transport so a
      // deadline abort cancels in-flight seats.aero work.
      assert.ok(observedSignal, "observed lane must receive an abort signal");
      assert.equal((observedSignal as AbortSignal | null) === controller.signal, true);
      assert.equal((observedSignal as AbortSignal).aborted, false);
    } finally {
      installSeatsAeroResponder(null);
    }
  });
});
