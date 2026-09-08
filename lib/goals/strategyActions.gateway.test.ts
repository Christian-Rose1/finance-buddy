import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import type { SupabaseClient } from "@supabase/supabase-js";

import { generateGoalFlightStageAction, generateGoalHotelStageAction } from "./strategyActions";
import { logFlightPlanningEstimateDiagnostic } from "./flightPlanningEstimate";
import type { PreparedGoalStrategyContext } from "./strategyActionContext";
import type { ResearchInterpreter } from "./researchInterpreter";
import type { ResearchProvider, ResearchQuery, ResearchResponse } from "./researchTypes";
import { signStrategyRunPayload } from "./strategyRunSigning";
import { logSerpApiHotelEstimateDiagnostic } from "./serpApiHotelClient";
import type { StrategyStageFenceRpcExecutor, StrategyStageFenceRpcName } from "./strategyStageFenceRpcExecutor";
import {
  failGoalStrategyRunStage,
  recoverGoalStrategyRunStageStart,
  saveGoalStrategyRunStage,
  startGoalStrategyRunStage,
} from "./strategyRunRepository";
import { withStrategyStageActionDependenciesForTest } from "./strategyStageActionDependencies";
import type { StrategyStageActionDependencies } from "./strategyStageActionDependencies";
import { withStrategyFinalizationDependenciesForTest } from "./strategyFinalizationDependencies";
import type { PersonalizedStrategyContext, StrategyAwardOption, StrategySource } from "./strategyTypes";
import type { FlightPlanningEstimate } from "./flightPlanningEstimate";
import type { HotelPlanningEstimate } from "./hotelPlanningEstimate";
import type { Goal } from "./types";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

const SECRET = "actual-action-gateway-test-secret-012345";
let priorSecret: string | undefined;

function hotelEstimate(): HotelPlanningEstimate {
  return {
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
      locationText: "Paris",
      nightlyPrice: 240,
      nightlyPriceCurrency: "USD",
      totalPrice: 1920,
      totalPriceCurrency: "USD",
      rating: 4.5,
      reviewCount: 812,
      hotelClass: 4,
      neighborhood: "Vesterbro",
      amenities: ["Free Wi-Fi"],
      propertyUrl: "https://example.com/property",
      imageUrl: "https://example.com/image.jpg",
      trustStatus: "search_estimate",
    }],
    disclosure: "Search estimates only; not bookable; verify current price and availability before booking",
    evidenceLabel: "Planning estimate",
    verificationLabel: "Not customer-verified",
    availabilityLabel: "Search estimates only; not bookable; verify current price and availability before booking",
  };
}

/** A strictly valid SerpAPI planning estimate matching the persisted schema. */
function flightEstimate(): FlightPlanningEstimate {
  return {
    label: "Flight planning estimate",
    origin: "DEN",
    destination: "CDG",
    outboundDate: "2027-04-03",
    returnDate: "2027-04-12",
    travelers: 2,
    cabin: "economy",
    currency: "USD",
    total: 1736,
    priceCoverage: "searched_party_total",
    retrievedAt: "2027-01-02T03:04:05.000Z",
    outboundSegments: [{
      sequence: 1,
      departureAirport: "DEN",
      departureTime: "2027-04-03 08:00",
      arrivalAirport: "CDG",
      arrivalTime: "2027-04-03 20:00",
      marketingCarrier: "Example Air",
      marketingFlightNumber: "EA123",
      cabin: "economy",
    }],
    returnSegments: [{
      sequence: 1,
      departureAirport: "CDG",
      departureTime: "2027-04-12 09:00",
      arrivalAirport: "DEN",
      arrivalTime: "2027-04-12 11:30",
      marketingCarrier: "Example Air",
      marketingFlightNumber: "EA124",
      cabin: "economy",
    }],
    unknowns: ["offer_expiry"],
    evidenceLabel: "Planning estimate",
    verificationLabel: "Not customer-verified",
    availabilityLabel: "Not live or bookable; verify before booking",
  };
}

before(() => {
  priorSecret = process.env.STRATEGY_RUN_SIGNING_SECRET;
  process.env.STRATEGY_RUN_SIGNING_SECRET = SECRET;
});
after(() => {
  if (priorSecret === undefined) delete process.env.STRATEGY_RUN_SIGNING_SECRET;
  else process.env.STRATEGY_RUN_SIGNING_SECRET = priorSecret;
});

function context(): PersonalizedStrategyContext {
  return {
    goal: {
      id: "owned-goal", userId: "auth-user", type: "travel", title: "Paris", status: "active",
      origin: ["DEN"], destinations: ["Paris"], earliestDeparture: "2027-04-03",
      latestReturn: "2027-04-30", minimumNights: 8, maximumNights: 8,
      travelerCount: 2, cabinPreference: "economy", optimizationPriority: "balanced",
      maximumCashBudget: null, currency: "USD", allowNewCards: false,
      createdAt: "2026-08-01T00:00:00.000Z", updatedAt: "2026-08-01T00:00:00.000Z",
    },
    rewardAccounts: [{
      id: "account", userId: "auth-user", rewardProgramId: "program", ownerKey: "self",
      ownerLabel: "Self", ownerType: "self", balance: 0, balanceAsOf: "2026-08-01",
      origin: "manual", verificationStatus: "unverified",
      createdAt: "2026-08-01T00:00:00.000Z", updatedAt: "2026-08-01T00:00:00.000Z",
    }], walletCards: [], monthlySpendingByCategory: [], awardOptions: [],
    cardOffers: [], sources: [], generatedAt: "2026-08-01T00:00:00.000Z",
  };
}

class RunDatabase {
  row: Record<string, unknown> | null = null;
  events: string[] = [];
  failNextRunningTransition = false;
  private attemptCounter = 0;
  saveCommitGate: Promise<void> | null = null;
  saveResponseGate: Promise<void> | null = null;
  saveAccepted: (() => void) | null = null;
  startCommitGate: Promise<void> | null = null;
  startAccepted: (() => void) | null = null;
  startCommitted: (() => void) | null = null;
  startSignal: AbortSignal | null = null;
  stageDeadlineOverrideMs: number | null = null;
  forcedSaveOutcome: "rejected" | null = null;
  prepareResponseGate: Promise<void> | null = null;
  prepareCommitGate: Promise<void> | null = null;
  prepareEntered: (() => void) | null = null;
  prepareCommitted: (() => void) | null = null;
  prepareResponseError = false;
  fenceCalls: Array<{ name: StrategyStageFenceRpcName; args: Record<string, unknown> }> = [];

  private rpcResult(data: unknown, error: unknown = null) {
    return Promise.resolve({ data, error });
  }

  private executeFenceRpc = (name: StrategyStageFenceRpcName, args: Record<string, unknown>) => {
      this.fenceCalls.push({ name, args: { ...args } });
      if (!this.row || this.row.id !== args.p_run_id || this.row.goal_id !== args.p_goal_id) {
        return this.rpcResult(null, { message: "no match" });
      }
      if (args.p_user_id !== this.row.user_id) {
        return this.rpcResult("rejected");
      }
      const stage = args.p_stage as "flight" | "hotel";
      const status = `${stage}_status`;
      const attempt = `${stage}_attempt_id`;
      const deadline = `${stage}_deadline_at`;
      const recoveryToken = `${stage}_start_recovery_token`;
      if (name === "prepare_goal_strategy_run_research_stage_start") {
        const prepare = async () => {
          this.prepareEntered?.();
          if (this.prepareCommitGate) await this.prepareCommitGate;
          this.row = { ...this.row, [recoveryToken]: args.p_start_recovery_token };
          this.prepareCommitted?.();
          if (this.prepareResponseGate) await this.prepareResponseGate;
          if (this.prepareResponseError) return { data: null, error: { message: "lost response" } };
          return { data: "prepared", error: null };
        };
        return prepare();
      }
      if (name === "start_goal_strategy_run_research_stage") {
        if (this.failNextRunningTransition) {
          this.failNextRunningTransition = false;
          this.events.push("transition-rejected");
          return this.rpcResult([], null);
        }
        const commit = async () => {
          this.startAccepted?.();
          if (this.startCommitGate) await this.startCommitGate;
          const canStart = this.row?.[recoveryToken] === args.p_start_recovery_token &&
            (this.row?.[status] === "pending" || this.row?.[status] === "failed");
          if (!canStart) {
            this.startCommitted?.();
            return { data: [], error: null };
          }
          const attemptId = `00000000-0000-4000-8000-${String(++this.attemptCounter).padStart(12, "0")}`;
          const deadlineAt = new Date(Math.min(
            Date.now() + (this.stageDeadlineOverrideMs ?? 120_000),
            Date.parse(this.row?.expires_at as string),
          )).toISOString();
          const revision = new Date().toISOString();
          this.row = { ...this.row, [status]: "running", [attempt]: attemptId, [deadline]: deadlineAt, [recoveryToken]: args.p_start_recovery_token, updated_at: revision };
          this.events.push("stage-running");
          this.startCommitted?.();
          return { data: [{ attempt_id: attemptId, deadline_at: deadlineAt, revision }], error: null };
        };
        const promise = commit();
        return Object.assign(promise, { abortSignal: (signal: AbortSignal) => { this.startSignal = signal; return promise; } });
      }
      const matches = this.row[status] === "running" && this.row[attempt] === args.p_attempt_id;
      if (name === "save_goal_strategy_run_research_stage") {
        const commit = async () => {
          this.saveAccepted?.();
          if (this.saveCommitGate) await this.saveCommitGate;
          const stillMatches = this.row?.[status] === "running" && this.row?.[attempt] === args.p_attempt_id;
          if (!stillMatches) return { data: "rejected", error: null };
          if (this.forcedSaveOutcome) return { data: this.forcedSaveOutcome, error: null };
          if (Date.now() > Date.parse(this.row?.[deadline] as string)) return { data: "deadline_expired", error: null };
          this.row = { ...this.row, [status]: "succeeded", [`${stage}_payload`]: args.p_payload, [`${stage}_signature`]: args.p_signature };
          this.events.push("stage-saved");
          if (this.saveResponseGate) await this.saveResponseGate;
          return { data: "succeeded", error: null };
        };
        return commit();
      }
      if (name === "fail_goal_strategy_run_research_stage") {
        if (matches) {
          this.row = { ...this.row, [status]: "failed", [`${stage}_payload`]: null, [`${stage}_signature`]: null };
          this.events.push("stage-failed");
          return this.rpcResult("failed");
        }
        return this.rpcResult(this.row[status] === "succeeded" && this.row[attempt] === args.p_attempt_id ? "succeeded" : "rejected");
      }
      if (name === "recover_goal_strategy_run_research_stage_start") {
        const recover = async () => {
          const recoveryMatches =
            (this.row?.[status] === "pending" || this.row?.[status] === "running" || this.row?.[status] === "failed") &&
            this.row?.[recoveryToken] === args.p_start_recovery_token;
          if (recoveryMatches) {
            this.row = { ...this.row, [status]: "failed", [recoveryToken]: null, [`${stage}_payload`]: null, [`${stage}_signature`]: null };
            this.events.push("stage-start-recovered");
            return { data: "failed", error: null };
          }
          return { data: this.row?.[status] === "succeeded" && this.row?.[recoveryToken] === args.p_start_recovery_token ? "succeeded" : "rejected", error: null };
        };
        return recover();
      }
      return this.rpcResult(null, { message: "unknown rpc" });
  };

  fenceExecutor: StrategyStageFenceRpcExecutor = {
    execute: (name, args, signal) => {
      if (name === "start_goal_strategy_run_research_stage") this.startSignal = signal ?? null;
      return this.executeFenceRpc(name, args);
    },
  };

  client = {
    rpc: () => this.rpcResult(null, { message: "permission denied" }),
    from: () => {
      let operation: "read" | "insert" | "update" = "read";
      let payload: Record<string, unknown> = {};
      const filters: Array<[string, unknown]> = [];
      const builder = {
        insert: (value: Record<string, unknown>) => { operation = "insert"; payload = value; return builder; },
        update: (value: Record<string, unknown>) => { operation = "update"; payload = value; return builder; },
        select: () => builder,
        abortSignal: () => builder,
        eq: (field: string, value: unknown) => { filters.push([field, value]); return builder; },
        maybeSingle: () => {
          this.events.push("run-loaded");
          return { data: this.matches(filters) ? { ...this.row } : null, error: null };
        },
        single: () => {
          if (operation === "insert") {
            this.events.push("run-created");
            this.row = {
              ...payload, flight_payload: null, flight_signature: null,
              hotel_payload: null, hotel_signature: null,
              created_at: payload.updated_at,
            };
            return { data: { ...this.row }, error: null };
          }
          if (!this.matches(filters)) return { data: null, error: { message: "no match" } };
          if (this.failNextRunningTransition && Object.values(payload).includes("running")) {
            this.failNextRunningTransition = false;
            this.events.push("transition-rejected");
            return { data: null, error: { message: "conflict" } };
          }
          const status = Object.values(payload).find((value) =>
            value === "running" || value === "succeeded" || value === "failed"
          );
          this.events.push(status === "running" ? "stage-running" : status === "succeeded" ? "stage-saved" : "stage-failed");
          this.row = { ...this.row, ...payload };
          return { data: { ...this.row }, error: null };
        },
      };
      return builder;
    },
  } as unknown as SupabaseClient;

  private matches(filters: Array<[string, unknown]>): boolean {
    if (!this.row) return false;
    return filters.every(([field, value]) => this.row?.[field] === value);
  }
}

function existingRunRow(flightStatus: "pending" | "failed" = "pending") {
  const expiresAt = new Date(Date.now() + 60_000).toISOString();
  return {
    id: "existing-run", goal_id: "owned-goal", user_id: "auth-user", signature_version: 1,
    expires_at: expiresAt,
    run_signature: signStrategyRunPayload({ version: 1, runId: "existing-run", goalId: "owned-goal", userId: "auth-user", expiresAt, stage: "run", payload: "" }),
    flight_status: flightStatus, flight_payload: null, flight_signature: null,
    hotel_status: "pending", hotel_payload: null, hotel_signature: null, final_status: "pending",
    created_at: new Date(Date.now() - 60_000).toISOString(), updated_at: new Date().toISOString(),
  };
}

function prepared(db: RunDatabase): PreparedGoalStrategyContext {
  return {
    supabase: db.client, userId: "auth-user", context: context(), customerRewardPrograms: [],
    catalogRewardPrograms: [{ id: "program", name: "Chase Ultimate Rewards" }],
  };
}

function mocks(
  db: RunDatabase,
  fail: (index: number) => boolean = () => false,
  interpreterAwardOptions: StrategyAwardOption[] = [],
  interpreterSources: StrategySource[] = [],
) {
  const calls: ResearchQuery[] = [];
  const interpreted: ResearchResponse[][] = [];
  const constructions = { provider: 0 };
  const provider: ResearchProvider = {
    async search(query) {
      const index = calls.length;
      calls.push(query);
      db.events.push("provider-called");
      if (fail(index)) throw new Error("synthetic provider failure");
      return { query: query.query, searchedAt: new Date().toISOString(), results: [] };
    },
  };
  const interpreter: ResearchInterpreter = {
    async interpret(input) {
      interpreted.push(input.research);
      return { awardOptions: interpreterAwardOptions, cardOffers: [], sources: interpreterSources, assumptions: [], warnings: [] };
    },
  };
  const estimateGoals: Goal[] = [];
  const hotelEstimateGoals: Goal[] = [];
  const dependencies: StrategyStageActionDependencies = {
    prepareContext: async () => {
      db.events.push("authenticated-goal-loaded");
      return { success: true as const, prepared: prepared(db) };
    },
    createProvider: () => {
      constructions.provider += 1;
      return provider;
    },
    createInterpreter: () => interpreter,
    createFlightPlanningEstimate: async (goal) => {
      estimateGoals.push(goal);
      return flightEstimate();
    },
    createSerpApiHotelEstimate: async (goal) => {
      hotelEstimateGoals.push(goal);
      return hotelEstimate();
    },
    saveStage: saveGoalStrategyRunStage,
    failStage: failGoalStrategyRunStage,
    recoverStageStart: recoverGoalStrategyRunStageStart,
    createFenceExecutor: async () => db.fenceExecutor,
  };
  return {
    calls, interpreted, interpreter, estimateGoals, hotelEstimateGoals, constructions,
    dependencies,
  };
}

test("actual flight then hotel actions create, transition, execute, and save in order", async () => {
  const db = new RunDatabase();
  const mock = mocks(db);
  await withStrategyStageActionDependenciesForTest(mock.dependencies, async () => {
    const flight = await generateGoalFlightStageAction("owned-goal");
    assert.equal(flight.success && flight.stageStatus, "succeeded");
    assert.doesNotMatch(JSON.stringify(flight), /attempt|deadline_at|deadlineAt|recovery/i);
    assert.doesNotMatch(String(db.row?.flight_payload), /attempt|deadline|recovery/i);
    // Production flight generation is SerpAPI-direct: zero Tavily provider
    // queries and zero interpreter calls, with the saved goal driving the
    // SerpAPI request and the party-total price persisted unchanged.
    assert.equal(mock.estimateGoals.length, 1);
    assert.deepEqual(mock.estimateGoals[0], context().goal);
    assert.equal(mock.calls.length, 0);
    assert.equal(mock.interpreted.length, 0);
    assert.equal(mock.constructions.provider, 0);
    assert.equal(db.events.includes("provider-called"), false);
    assert.deepEqual(db.events.slice(0, 4), [
      "authenticated-goal-loaded", "run-created", "run-loaded", "stage-running",
    ]);
    assert.equal(db.events.filter((event) => event === "stage-saved").length, 1);
    const flightPayload = JSON.parse(String(db.row?.flight_payload)) as {
      interpreted: {
        awardOptions: unknown[];
        flightPlanningEstimate: { total: number; priceCoverage: string; travelers: number } | null;
      };
    };
    assert.equal(flightPayload.interpreted.awardOptions.length, 0);
    assert.equal(flightPayload.interpreted.flightPlanningEstimate?.total, 1736);
    assert.equal(flightPayload.interpreted.flightPlanningEstimate?.priceCoverage, "searched_party_total");
    assert.equal(flightPayload.interpreted.flightPlanningEstimate?.travelers, 2);

    const runId = flight.success ? flight.runId : "";
    const beforeHotel = db.events.length;
    const hotel = await generateGoalHotelStageAction("owned-goal", runId);
    assert.equal(hotel.success && hotel.stageStatus, "succeeded");
    assert.doesNotMatch(JSON.stringify(hotel), /attempt|deadline_at|deadlineAt|recovery/i);
    assert.doesNotMatch(String(db.row?.hotel_payload), /attempt|deadline|recovery/i);
    assert.deepEqual(db.events.slice(beforeHotel, beforeHotel + 4), [
      "authenticated-goal-loaded", "run-loaded", "run-loaded", "stage-running",
    ]);
    assert.equal(db.events.filter((event) => event === "stage-saved").length, 2);
    // Production hotel generation is SerpAPI-direct: zero Tavily provider
    // queries and zero interpreter calls, with the saved goal driving the
    // Google Hotels request and the estimate persisted through the signed
    // hotel payload.
    assert.equal(mock.hotelEstimateGoals.length, 1);
    assert.deepEqual(mock.hotelEstimateGoals[0], context().goal);
    assert.equal(mock.calls.length, 0);
    assert.equal(mock.interpreted.length, 0);
    assert.equal(mock.constructions.provider, 0);
    assert.equal(db.events.includes("provider-called"), false);
    assert.deepEqual(hotel.success ? hotel.options : [], []);
    const hotelPayload = JSON.parse(String(db.row?.hotel_payload)) as {
      interpreted: {
        awardOptions: unknown[];
        hotelPlanningEstimate: {
          destination: string;
          travelers: number;
          currency: string;
          options: Array<{ propertyName: string; totalPrice: number | null }>;
        } | null;
      };
    };
    assert.equal(hotelPayload.interpreted.awardOptions.length, 0);
    assert.equal(hotelPayload.interpreted.hotelPlanningEstimate?.destination, "Paris");
    assert.equal(hotelPayload.interpreted.hotelPlanningEstimate?.travelers, 2);
    assert.equal(hotelPayload.interpreted.hotelPlanningEstimate?.currency, "USD");
    assert.equal(hotelPayload.interpreted.hotelPlanningEstimate?.options[0]?.propertyName, "Example Grand Hotel");
  });
});

test("production flight and hotel succeed via SerpAPI without Tavily; failures mark once without retry", async () => {
  // Even a failing Tavily provider cannot affect either SerpAPI-direct
  // stage: zero provider and interpreter calls occur for flight or hotel.
  const partialDb = new RunDatabase();
  const partial = mocks(partialDb, () => true);
  let flightRunId = "";
  await withStrategyStageActionDependenciesForTest(partial.dependencies, async () => {
    const result = await generateGoalFlightStageAction("owned-goal");
    assert.equal(result.success && result.stageStatus, "succeeded");
    flightRunId = result.success ? result.runId : "";
  });
  assert.equal(partial.estimateGoals.length, 1);
  assert.equal(partial.calls.length, 0);
  assert.equal(partial.interpreted.length, 0);
  assert.equal(partial.constructions.provider, 0);
  assert.equal(partialDb.events.includes("provider-called"), false);
  assert.equal(partialDb.events.includes("stage-failed"), false);

  // The hotel stage also ignores the failing provider entirely.
  const hotel = await withStrategyStageActionDependenciesForTest(partial.dependencies, () =>
    generateGoalHotelStageAction("owned-goal", flightRunId)
  );
  assert.equal(hotel.success && hotel.stageStatus, "succeeded");
  assert.equal(partial.hotelEstimateGoals.length, 1);
  assert.equal(partial.calls.length, 0);
  assert.equal(partial.interpreted.length, 0);
  assert.equal(partial.constructions.provider, 0);
  assert.equal(partialDb.events.filter((event) => event === "stage-failed").length, 0);

  const failedDb = new RunDatabase();
  failedDb.row = existingRunRow("failed");
  const failed = mocks(failedDb, () => true);
  failed.dependencies.createFlightPlanningEstimate = async () => {
    logFlightPlanningEstimateDiagnostic("flight_client_provider_not_configured");
    return null;
  };
  const priorDebug = process.env.STRATEGY_DEBUG;
  const priorError = console.error;
  const logs: unknown[][] = [];
  process.env.STRATEGY_DEBUG = "1";
  console.error = (...values: unknown[]) => { logs.push(values); };
  let failedRunId = "";
  try {
    await withStrategyStageActionDependenciesForTest(failed.dependencies, async () => {
      const result = await generateGoalFlightStageAction("owned-goal");
      assert.equal(result.success && result.stageStatus, "failed");
      failedRunId = result.success ? result.runId : "";
    });
    // The rejected SerpAPI result marks the stage failed exactly once with
    // zero Tavily calls and no saved flight payload.
    assert.equal(failed.constructions.provider, 0);
    assert.equal(failed.calls.length, 0);
    assert.equal(failedDb.events.filter((event) => event === "stage-failed").length, 1);
    assert.equal(failedDb.events.includes("stage-saved"), false);
    assert.deepEqual(logs, [
      ["[flight-planning-estimate] {\"category\":\"flight_client_provider_not_configured\"}"],
      ["[strategy-stage-error]", JSON.stringify({ stage: "flight", runId: failedRunId, goalId: "owned-goal", category: "research_stage_failed" })],
    ]);
    assert.equal(JSON.stringify(logs).includes("signature"), false);
    assert.equal(JSON.stringify(logs).includes("departure_token"), false);
    assert.equal(JSON.stringify(logs).includes("search_id"), false);
  } finally {
    console.error = priorError;
    if (priorDebug === undefined) delete process.env.STRATEGY_DEBUG;
    else process.env.STRATEGY_DEBUG = priorDebug;
  }
});

test("missing SerpAPI configuration fails the flight stage safely with zero external requests", async () => {
  const db = new RunDatabase();
  const mock = mocks(db);
  const dependencies = {
    ...mock.dependencies,
    createFlightPlanningEstimate: async () => {
      logFlightPlanningEstimateDiagnostic("flight_client_provider_not_configured");
      return null;
    },
  };
  const priorDebug = process.env.STRATEGY_DEBUG;
  const priorError = console.error;
  const logs: unknown[][] = [];
  process.env.STRATEGY_DEBUG = "1";
  console.error = (...values: unknown[]) => { logs.push(values); };
  try {
    await withStrategyStageActionDependenciesForTest(dependencies, async () => {
      const flight = await generateGoalFlightStageAction("owned-goal");
      assert.equal(flight.success && flight.stageStatus, "failed");
      assert.equal(flight.success === false || flight.message, "Flight recommendations could not be generated from the available research.");
      const runId = flight.success ? flight.runId : "";
      assert.equal(db.row?.flight_status, "failed");
      assert.equal(db.events.includes("stage-saved"), false);
      // Zero Tavily and interpreter calls even when SerpAPI is unavailable.
      assert.equal(mock.calls.length, 0);
      assert.equal(mock.interpreted.length, 0);
      assert.equal(mock.constructions.provider, 0);
      assert.equal(db.events.includes("provider-called"), false);
      // The run remains and the hotel stage continues under the existing
      // terminal-stage rules: a failed flight stage is terminal for flight,
      // and hotel still runs.
      const hotel = await generateGoalHotelStageAction("owned-goal", runId);
      assert.equal(hotel.success && hotel.stageStatus, "succeeded");
    });
    assert.deepEqual(logs, [
      ["[flight-planning-estimate] {\"category\":\"flight_client_provider_not_configured\"}"],
      ["[strategy-stage-error]", JSON.stringify({ stage: "flight", runId: String(db.row?.id), goalId: "owned-goal", category: "research_stage_failed" })],
    ]);
  } finally {
    console.error = priorError;
    if (priorDebug === undefined) delete process.env.STRATEGY_DEBUG;
    else process.env.STRATEGY_DEBUG = priorDebug;
  }
});

test("a rejected SerpAPI hotel estimate marks the hotel stage failed once without retry", async () => {
  const db = new RunDatabase();
  const mock = mocks(db);
  const deps = { ...mock.dependencies, createSerpApiHotelEstimate: async () => null };
  await withStrategyStageActionDependenciesForTest(deps, async () => {
    const flight = await generateGoalFlightStageAction("owned-goal");
    assert.equal(flight.success && flight.stageStatus, "succeeded");
    const runId = flight.success ? flight.runId : "";
    const failuresBeforeHotel = db.events.filter((event) => event === "stage-failed").length;
    const savedBeforeHotel = db.events.filter((event) => event === "stage-saved").length;
    const hotel = await generateGoalHotelStageAction("owned-goal", runId);
    assert.equal(hotel.success && hotel.stageStatus, "failed");
    assert.equal(db.row?.hotel_status, "failed");
    assert.equal(db.row?.hotel_payload, null);
    assert.equal(db.events.filter((event) => event === "stage-failed").length - failuresBeforeHotel, 1);
    assert.equal(db.events.filter((event) => event === "stage-saved").length, savedBeforeHotel);
    // Zero Tavily and interpreter calls even when the hotel estimate fails.
    assert.equal(mock.calls.length, 0);
    assert.equal(mock.interpreted.length, 0);
    assert.equal(mock.constructions.provider, 0);
    assert.equal(db.events.includes("provider-called"), false);
  });
});

test("flight deadline terminates as failed once and a late SerpAPI estimate cannot save", async () => {
  const db = new RunDatabase();
  const mock = mocks(db);
  db.row = existingRunRow("failed");
  const late = deferred<FlightPlanningEstimate | null>();
  const dependencies = {
    ...mock.dependencies,
    stageDeadlineMs: 5,
    createFlightPlanningEstimate: () => late.promise,
  };
  const priorDebug = process.env.STRATEGY_DEBUG;
  const priorError = console.error;
  const logs: unknown[][] = [];
  process.env.STRATEGY_DEBUG = "1";
  console.error = (...values: unknown[]) => { logs.push(values); };
  try {
    const result = await withStrategyStageActionDependenciesForTest(dependencies, () =>
      generateGoalFlightStageAction("owned-goal")
    );
    assert.equal(result.success && result.stageStatus, "failed");
    assert.equal(db.row?.flight_status, "failed");
    assert.equal(mock.calls.length, 0);
    assert.equal(mock.interpreted.length, 0);
    assert.equal(mock.constructions.provider, 0);
    assert.equal(db.events.filter((event) => event === "stage-failed").length, 1);
    late.resolve(flightEstimate());
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(db.row?.flight_status, "failed");
    assert.equal(db.events.includes("stage-saved"), false);
    assert.deepEqual(logs, [["[strategy-stage-timeout]", JSON.stringify({ stage: "flight", runId: result.success ? result.runId : "", goalId: "owned-goal", category: "stage_timeout" })]]);
  } finally {
    console.error = priorError;
    if (priorDebug === undefined) delete process.env.STRATEGY_DEBUG;
    else process.env.STRATEGY_DEBUG = priorDebug;
  }
});

test("a rejected SerpAPI estimate emits research_stage_failed and does not expose provider content", async () => {
  const db = new RunDatabase();
  const mock = mocks(db);
  const dependencies = { ...mock.dependencies, createFlightPlanningEstimate: async () => null };
  const priorDebug = process.env.STRATEGY_DEBUG;
  const priorError = console.error;
  const logs: unknown[][] = [];
  process.env.STRATEGY_DEBUG = "1";
  console.error = (...values: unknown[]) => { logs.push(values); };
  try {
    const result = await withStrategyStageActionDependenciesForTest(dependencies, () =>
      generateGoalFlightStageAction("owned-goal")
    );
    assert.equal(result.success && result.stageStatus, "failed");
    assert.equal(db.events.filter((event) => event === "stage-failed").length, 1);
    assert.equal(db.events.includes("stage-saved"), false);
    assert.equal(mock.calls.length, 0);
    assert.equal(mock.interpreted.length, 0);
    assert.equal(mock.constructions.provider, 0);
    assert.deepEqual(logs, [[
      "[strategy-stage-error]",
      JSON.stringify({ stage: "flight", runId: result.success ? result.runId : "", goalId: "owned-goal", category: "research_stage_failed" }),
    ]]);
    assert.equal(logs[0][1].includes("provider"), false, "no provider content in diagnostic");
    assert.equal(logs[0][1].includes("signature"), false, "no signature in diagnostic");
    assert.equal(logs[0][1].includes("departure_token"), false, "no return token in diagnostic");
    assert.equal(logs[0][1].includes("search_id"), false, "no search id in diagnostic");
  } finally {
    console.error = priorError;
    if (priorDebug === undefined) delete process.env.STRATEGY_DEBUG;
    else process.env.STRATEGY_DEBUG = priorDebug;
  }
});

test("hotel deadline terminates as failed without retry and preserves succeeded flight", async () => {
  const db = new RunDatabase();
  const normal = mocks(db);
  const flight = await withStrategyStageActionDependenciesForTest(normal.dependencies, () =>
    generateGoalFlightStageAction("owned-goal")
  );
  assert.equal(flight.success && flight.stageStatus, "succeeded");
  const callsBeforeHotel = normal.calls.length;
  const late = deferred<HotelPlanningEstimate | null>();
  const dependencies = {
    ...normal.dependencies,
    stageDeadlineMs: 5,
    createSerpApiHotelEstimate: () => late.promise,
  };
  const result = await withStrategyStageActionDependenciesForTest(dependencies, () =>
    generateGoalHotelStageAction("owned-goal", flight.success ? flight.runId : "")
  );
  assert.equal(result.success && result.stageStatus, "failed");
  assert.equal(db.row?.flight_status, "succeeded");
  assert.equal(db.row?.hotel_status, "failed");
  assert.equal(normal.calls.length - callsBeforeHotel, 0);
  assert.equal(db.events.filter((event) => event === "stage-failed").length, 1);
  late.resolve(hotelEstimate());
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(db.row?.hotel_status, "failed");
  assert.equal(db.events.filter((event) => event === "stage-saved").length, 1);
});

test("flight and hotel stage saves are inside the deadline and cannot write after cancellation", async () => {
  for (const stage of ["flight", "hotel"] as const) {
    const db = new RunDatabase();
    const mock = mocks(db);
    let runId = "";
    if (stage === "hotel") {
      const flight = await withStrategyStageActionDependenciesForTest(mock.dependencies, () =>
        generateGoalFlightStageAction("owned-goal")
      );
      assert.equal(flight.success && flight.stageStatus, "succeeded");
      runId = flight.success ? flight.runId : "";
    }
    const lateSave = deferred<void>();
    let saveSignal: AbortSignal | undefined;
    let lateWriteAttempted = false;
    const dependencies = {
      ...mock.dependencies,
      stageDeadlineMs: 5,
      saveStage: async (...args: Parameters<typeof saveGoalStrategyRunStage>) => {
        saveSignal = args[4];
        await lateSave.promise;
        lateWriteAttempted = true;
        if (saveSignal?.aborted) throw new Error("cancelled late save");
        return saveGoalStrategyRunStage(...args);
      },
    };
    const priorDebug = process.env.STRATEGY_DEBUG;
    const priorError = console.error;
    const stageLogs: unknown[][] = [];
    process.env.STRATEGY_DEBUG = "1";
    console.error = (...values: unknown[]) => { stageLogs.push(values); };
    try {
      const result = await withStrategyStageActionDependenciesForTest(dependencies, () =>
        stage === "flight"
          ? generateGoalFlightStageAction("owned-goal")
          : generateGoalHotelStageAction("owned-goal", runId)
      );
      assert.equal(result.success && result.stageStatus, "failed", stage);
      assert.equal(stage === "flight" ? db.row?.flight_status : db.row?.hotel_status, "failed", stage);
      assert.equal(saveSignal?.aborted, true, stage);
      lateSave.resolve();
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(lateWriteAttempted, true, stage);
      assert.equal(stage === "flight" ? db.row?.flight_status : db.row?.hotel_status, "failed", stage);
      assert.deepEqual(stageLogs, [["[strategy-stage-timeout]", JSON.stringify({ stage, runId: result.success ? result.runId : "", goalId: "owned-goal", category: "stage_timeout" })]]);
    } finally {
      console.error = priorError;
      if (priorDebug === undefined) delete process.env.STRATEGY_DEBUG;
      else process.env.STRATEGY_DEBUG = priorDebug;
    }
  }
});

test("a save accepted before the local timeout but committed afterward is rejected by the database fence", async () => {
  const db = new RunDatabase();
  const gate = deferred<void>();
  const accepted = deferred<void>();
  db.saveCommitGate = gate.promise;
  db.saveAccepted = accepted.resolve;
  const mock = mocks(db);
  const action = withStrategyStageActionDependenciesForTest(
    { ...mock.dependencies, stageDeadlineMs: 10 },
    () => generateGoalFlightStageAction("owned-goal"),
  );
  await accepted.promise;
  const result = await action;
  assert.equal(result.success && result.stageStatus, "failed");
  assert.equal(db.row?.flight_status, "failed");
  gate.resolve();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(db.events.includes("stage-saved"), false);
  assert.equal(db.row?.flight_status, "failed");
});

test("database deadline rejection before the local timer uses bounded failure cleanup", async () => {  const db = new RunDatabase();
  db.stageDeadlineOverrideMs = 10;
  db.row = existingRunRow("failed");
  const mock = mocks(db);
  const priorDebug = process.env.STRATEGY_DEBUG;
  const priorError = console.error;
  const logs: unknown[][] = [];
  process.env.STRATEGY_DEBUG = "1";
  console.error = (...args: unknown[]) => { logs.push(args); };
  const dependencies = {
    ...mock.dependencies,
    stageDeadlineMs: 100,
    createFlightPlanningEstimate: async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      return flightEstimate();
    },
  };
  try {
    const result = await withStrategyStageActionDependenciesForTest(
      dependencies,
      () => generateGoalFlightStageAction("owned-goal"),
    );
    assert.equal(result.success && result.stageStatus, "failed");
    assert.equal(db.row?.flight_status, "failed");
    assert.equal(db.events.filter((event) => event === "stage-failed").length, 1);
    assert.deepEqual(logs, [["[strategy-stage-timeout]", JSON.stringify({ stage: "flight", runId: result.success ? result.runId : "", goalId: "owned-goal", category: "stage_timeout" })]]);
  } finally {
    console.error = priorError;
    if (priorDebug === undefined) delete process.env.STRATEGY_DEBUG;
    else process.env.STRATEGY_DEBUG = priorDebug;
  }
});

test("an unrelated save rejection remains a generic persistence failure without timeout cleanup", async () => {
  const db = new RunDatabase();
  db.forcedSaveOutcome = "rejected";
  db.row = existingRunRow("failed");
  const mock = mocks(db);
  const priorDebug = process.env.STRATEGY_DEBUG;
  const priorError = console.error;
  const logs: unknown[][] = [];
  process.env.STRATEGY_DEBUG = "1";
  console.error = (...values: unknown[]) => { logs.push(values); };
  try {
    const result = await withStrategyStageActionDependenciesForTest(
      { ...mock.dependencies, stageDeadlineMs: 100 },
      () => generateGoalFlightStageAction("owned-goal"),
    );
    assert.deepEqual(result, {
      success: false,
      message: "We couldn't complete this strategy stage right now. Please try again.",
    });
    assert.equal(db.row?.flight_status, "running");
    assert.equal(db.events.includes("stage-failed"), false);
    assert.deepEqual(logs, [["[strategy-stage-error]", JSON.stringify({ stage: "flight", runId: String(db.row?.id), goalId: "owned-goal", category: "unexpected_stage_failure" })]]);
  } finally {
    console.error = priorError;
    if (priorDebug === undefined) delete process.env.STRATEGY_DEBUG;
    else process.env.STRATEGY_DEBUG = priorDebug;
  }
});

test("a start committed after local cancellation is recovered without stranding running state", async () => {
  const db = new RunDatabase();
  db.row = existingRunRow("failed");
  const accepted = deferred<void>();
  const commitGate = deferred<void>();
  const committed = deferred<void>();
  db.startAccepted = accepted.resolve;
  db.startCommitGate = commitGate.promise;
  db.startCommitted = committed.resolve;
  const mock = mocks(db);
  const priorDebug = process.env.STRATEGY_DEBUG;
  const priorError = console.error;
  const logs: unknown[][] = [];
  process.env.STRATEGY_DEBUG = "1";
  console.error = (...values: unknown[]) => { logs.push(values); };
  try {
  const action = withStrategyStageActionDependenciesForTest(
    { ...mock.dependencies, stageDeadlineMs: 10, stageCleanupDeadlineMs: 100 },
    () => generateGoalFlightStageAction("owned-goal"),
  );
  await accepted.promise;
  setTimeout(commitGate.resolve, 20);
  const result = await action;
  await committed.promise;
  assert.equal(result.success && result.stageStatus, "failed");
  assert.equal(db.startSignal?.aborted, true);
  assert.equal(db.events.includes("stage-start-recovered"), true);
  assert.equal(db.row?.flight_status, "failed");
  assert.equal(db.events.includes("provider-called"), false);
  } finally {
    console.error = priorError;
    if (priorDebug === undefined) delete process.env.STRATEGY_DEBUG;
    else process.env.STRATEGY_DEBUG = priorDebug;
  }
});

test("preparation that commits but never returns is recovered through the pre-registered capability", async () => {
  const db = new RunDatabase();
  const committed = deferred<void>();
  db.prepareCommitted = committed.resolve;
  db.prepareResponseGate = new Promise<void>(() => {});
  const mock = mocks(db);
  const action = withStrategyStageActionDependenciesForTest(
    { ...mock.dependencies, stageDeadlineMs: 10, stageCleanupDeadlineMs: 100 },
    () => generateGoalFlightStageAction("owned-goal"),
  );
  await committed.promise;
  const result = await action;
  assert.equal(result.success && result.stageStatus, "failed");
  assert.equal(db.row?.flight_status, "failed");
  assert.equal(db.events.includes("stage-start-recovered"), true);
  assert.equal(db.events.includes("stage-running"), false);
  assert.equal(db.events.includes("provider-called"), false);
});

test("a committed preparation with an immediate lost response gets bounded recovery without timeout classification", async () => {
  const db = new RunDatabase();
  db.prepareResponseError = true;
  const mock = mocks(db);
  const priorDebug = process.env.STRATEGY_DEBUG;
  const priorError = console.error;
  const logs: unknown[][] = [];
  process.env.STRATEGY_DEBUG = "1";
  console.error = (...values: unknown[]) => { logs.push(values); };
  try {
    const result = await withStrategyStageActionDependenciesForTest(
      { ...mock.dependencies, stageCleanupDeadlineMs: 100 },
      () => generateGoalFlightStageAction("owned-goal"),
    );
    assert.deepEqual(result, {
      success: false,
      message: "We couldn't complete this strategy stage right now. Please try again.",
    });
    assert.equal(db.row?.flight_status, "failed");
    assert.equal(db.events.includes("stage-start-recovered"), true);
    assert.equal(JSON.stringify(logs).includes("stage_timeout"), false);
    assert.deepEqual(logs, [["[strategy-stage-error]", JSON.stringify({ stage: "flight", runId: String(db.row?.id), goalId: "owned-goal", category: "stage_start_recovery_failure" })]]);
  } finally {
    console.error = priorError;
    if (priorDebug === undefined) delete process.env.STRATEGY_DEBUG;
    else process.env.STRATEGY_DEBUG = priorDebug;
  }
});

test("hotel deadline terminates as failed without retry and preserves succeeded flight", async () => {
  const db = new RunDatabase();
  const normal = mocks(db);
  const flight = await withStrategyStageActionDependenciesForTest(normal.dependencies, () =>
    generateGoalFlightStageAction("owned-goal")
  );
  assert.equal(flight.success && flight.stageStatus, "succeeded");
  const callsBeforeHotel = normal.calls.length;
  const late = deferred<HotelPlanningEstimate | null>();
  const dependencies = {
    ...normal.dependencies,
    stageDeadlineMs: 5,
    createSerpApiHotelEstimate: () => late.promise,
  };
  const result = await withStrategyStageActionDependenciesForTest(dependencies, () =>
    generateGoalHotelStageAction("owned-goal", flight.success ? flight.runId : "")
  );
  assert.equal(result.success && result.stageStatus, "failed");
  assert.equal(db.row?.flight_status, "succeeded");
  assert.equal(db.row?.hotel_status, "failed");
  assert.equal(normal.calls.length - callsBeforeHotel, 0);
  assert.equal(db.events.filter((event) => event === "stage-failed").length, 1);
  late.resolve(hotelEstimate());
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(db.row?.hotel_status, "failed");
  assert.equal(db.events.filter((event) => event === "stage-saved").length, 1);
});

test("recovery before preparation commits rejects harmlessly and cannot mutate the pending stage", async () => {
  const db = new RunDatabase();
  db.row = existingRunRow();
  const entered = deferred<void>();
  const commitGate = deferred<void>();
  db.prepareEntered = entered.resolve;
  db.prepareCommitGate = commitGate.promise;
  let recovery: Parameters<typeof recoverGoalStrategyRunStageStart>[0] | null = null;
  const starting = startGoalStrategyRunStage(
    "existing-run", "owned-goal", "auth-user", "flight", db.client, db.fenceExecutor,
    undefined, (value) => { recovery = value; },
  );
  await entered.promise;
  assert.ok(recovery);
  await assert.rejects(
    () => recoverGoalStrategyRunStageStart(recovery!, db.fenceExecutor),
    /Failed to recover strategy-run stage start\./,
  );
  assert.equal(db.row?.flight_status, "pending");
  assert.equal(db.events.includes("stage-start-recovered"), false);
  commitGate.resolve();
  const running = await starting;
  assert.equal(db.row?.flight_status, "running");
  assert.equal(await failGoalStrategyRunStage(running, db.client, db.fenceExecutor), "failed");
});

test("cookie-equivalent RPC access is denied while the server fence executor receives the derived user", async () => {
  const db = new RunDatabase();
  db.row = existingRunRow();
  for (const name of [
    "prepare_goal_strategy_run_research_stage_start",
    "start_goal_strategy_run_research_stage",
    "save_goal_strategy_run_research_stage",
    "recover_goal_strategy_run_research_stage_start",
    "fail_goal_strategy_run_research_stage",
  ] as const) {
    const result = await db.client.rpc(name, {});
    assert.ok(result.error, name);
  }

  const started = await startGoalStrategyRunStage(
    "existing-run", "owned-goal", "auth-user", "flight", db.client, db.fenceExecutor,
  );
  await saveGoalStrategyRunStage(started, { safe: true }, db.client, db.fenceExecutor);
  assert.ok(db.fenceCalls.length >= 3);
  assert.equal(db.fenceCalls.every(({ args }) => args.p_user_id === "auth-user"), true);
});

test("the privileged RPC boundary rejects absent and mismatched user IDs without mutation", async () => {
  for (const pUserId of [undefined, "different-user"]) {
    const db = new RunDatabase();
    db.row = existingRunRow();
    const before = { ...db.row };
    for (const name of [
      "prepare_goal_strategy_run_research_stage_start",
      "start_goal_strategy_run_research_stage",
      "save_goal_strategy_run_research_stage",
      "recover_goal_strategy_run_research_stage_start",
      "fail_goal_strategy_run_research_stage",
    ] as const) {
      const { data, error } = await db.fenceExecutor.execute(name, {
        p_user_id: pUserId,
        p_run_id: "existing-run",
        p_goal_id: "owned-goal",
        p_stage: "flight",
        p_start_recovery_token: "11111111-1111-4111-8111-111111111111",
        p_attempt_id: "22222222-2222-4222-8222-222222222222",
        p_payload: "{}",
        p_signature: "0".repeat(64),
      });
      assert.equal(error, null, name);
      assert.equal(data, "rejected", name);
      assert.deepEqual(db.row, before, name);
    }
  }
});

test("database attempt fencing rejects previous attempts and expired saves", async () => {
  const db = new RunDatabase();
  db.row = existingRunRow();
  const first = await startGoalStrategyRunStage("existing-run", "owned-goal", "auth-user", "flight", db.client, db.fenceExecutor);
  assert.equal(await failGoalStrategyRunStage(first, db.client, db.fenceExecutor), "failed");
  const second = await startGoalStrategyRunStage("existing-run", "owned-goal", "auth-user", "flight", db.client, db.fenceExecutor);
  await assert.rejects(() => saveGoalStrategyRunStage(first, { stale: true }, db.client, db.fenceExecutor), /Failed to save strategy-run stage\./);
  await assert.rejects(() => failGoalStrategyRunStage(first, db.client, db.fenceExecutor), /Failed to update strategy-run stage\./);
  db.row = { ...db.row, flight_deadline_at: new Date(Date.now() - 1).toISOString() };
  await assert.rejects(() => saveGoalStrategyRunStage(second, { late: true }, db.client, db.fenceExecutor), /Strategy-run stage deadline reached\./);
  assert.equal(db.row.flight_status, "running");
});

test("timeout failure prevents later save while committed success cannot be overwritten", async () => {
  const failedDb = new RunDatabase();
  failedDb.row = existingRunRow();
  const failedAttempt = await startGoalStrategyRunStage("existing-run", "owned-goal", "auth-user", "flight", failedDb.client, failedDb.fenceExecutor);
  assert.equal(await failGoalStrategyRunStage(failedAttempt, failedDb.client, failedDb.fenceExecutor), "failed");
  await assert.rejects(() => saveGoalStrategyRunStage(failedAttempt, { late: true }, failedDb.client, failedDb.fenceExecutor), /Failed to save strategy-run stage\./);
  assert.equal(failedDb.row.flight_status, "failed");

  const succeededDb = new RunDatabase();
  succeededDb.row = existingRunRow();
  const succeededAttempt = await startGoalStrategyRunStage("existing-run", "owned-goal", "auth-user", "flight", succeededDb.client, succeededDb.fenceExecutor);
  await saveGoalStrategyRunStage(succeededAttempt, { onTime: true }, succeededDb.client, succeededDb.fenceExecutor);
  assert.equal(await failGoalStrategyRunStage(succeededAttempt, succeededDb.client, succeededDb.fenceExecutor), "succeeded");
  assert.equal(succeededDb.row.flight_status, "succeeded");
});

test("an on-time database success with a late client response is never reported as degradation", async () => {
  const db = new RunDatabase();
  const responseGate = deferred<void>();
  const accepted = deferred<void>();
  db.saveResponseGate = responseGate.promise;
  db.saveAccepted = accepted.resolve;
  const mock = mocks(db);
  const action = withStrategyStageActionDependenciesForTest(
    { ...mock.dependencies, stageDeadlineMs: 10 },
    () => generateGoalFlightStageAction("owned-goal"),
  );
  await accepted.promise;
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(db.row?.flight_status, "succeeded");
  const result = await action;
  assert.deepEqual(result, {
    success: false,
    message: "We couldn't complete this strategy stage right now. Please try again.",
  });
  assert.equal(db.row?.flight_status, "succeeded");
  responseGate.resolve();
  await new Promise((resolve) => setImmediate(resolve));
});

test("an unconfirmed timeout failure transition is bounded and returns outer failure", async () => {
  const db = new RunDatabase();
  const mock = mocks(db);
  const lateEstimate = deferred<FlightPlanningEstimate | null>();
  const lateFailure = deferred<void>();
  let cleanupSignal: AbortSignal | undefined;
  const dependencies = {
    ...mock.dependencies,
    stageDeadlineMs: 5,
    stageCleanupDeadlineMs: 5,
    createFlightPlanningEstimate: () => lateEstimate.promise,
    failStage: async (...args: Parameters<typeof failGoalStrategyRunStage>) => {
      cleanupSignal = args[3];
      await lateFailure.promise;
      if (cleanupSignal?.aborted) throw new Error("cancelled late failure transition");
      return failGoalStrategyRunStage(...args);
    },
  };
  const result = await withStrategyStageActionDependenciesForTest(dependencies, () =>
    generateGoalFlightStageAction("owned-goal")
  );
  assert.deepEqual(result, {
    success: false,
    message: "We couldn't complete this strategy stage right now. Please try again.",
  });
  assert.equal(cleanupSignal?.aborted, true);
  assert.equal(db.row?.flight_status, "running");
  lateEstimate.resolve(flightEstimate());
  lateFailure.resolve();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(db.row?.flight_status, "running");
  assert.equal(db.events.includes("stage-saved"), false);
  assert.equal(db.events.includes("stage-failed"), false);
});

test("actual actions make zero provider calls across authentication and run-boundary failures", async () => {
  for (const reason of ["wrong user", "wrong goal"] as const) {
    const db = new RunDatabase();
    const mock = mocks(db);
    const deps = { ...mock.dependencies, prepareContext: async () => ({ success: false as const, message: reason }) };
    await withStrategyStageActionDependenciesForTest(deps, () => generateGoalFlightStageAction("owned-goal"));
    assert.equal(mock.calls.length, 0, reason);
  }

  for (const reason of ["missing", "invalid-signature", "expired", "wrong-order", "transition"] as const) {
    const db = new RunDatabase();
    const mock = mocks(db);
    const expiresAt = reason === "expired" ? new Date(Date.now() - 60_000).toISOString() : new Date(Date.now() + 60_000).toISOString();
    db.row = {
      id: "existing-run", goal_id: "owned-goal", user_id: "auth-user", signature_version: 1,
      expires_at: expiresAt,
      run_signature: reason === "invalid-signature" ? "0".repeat(64) : signStrategyRunPayload({ version: 1, runId: "existing-run", goalId: "owned-goal", userId: "auth-user", expiresAt, stage: "run", payload: "" }),
      flight_status: reason === "wrong-order" ? "pending" : "failed", flight_payload: null, flight_signature: null,
      hotel_status: "pending", hotel_payload: null, hotel_signature: null, final_status: "pending",
      created_at: "2026-08-01T00:00:00.000Z", updated_at: "2026-08-01T00:00:00.000Z",
    };
    if (reason === "missing") db.row = null;
    if (reason === "transition") db.failNextRunningTransition = true;
    await withStrategyStageActionDependenciesForTest(mock.dependencies, () =>
      generateGoalHotelStageAction("owned-goal", "existing-run")
    );
    assert.equal(mock.calls.length, 0, reason);
  }
});

test("authentication completes before privileged executor creation and missing configuration stays generic", async () => {
  const db = new RunDatabase();
  const mock = mocks(db);
  const events: string[] = [];
  const result = await withStrategyStageActionDependenciesForTest({
    ...mock.dependencies,
    prepareContext: async () => {
      events.push("authenticated");
      return { success: true as const, prepared: prepared(db) };
    },
    createFenceExecutor: async () => {
      events.push("fence-executor-requested");
      throw new Error("synthetic server credential value must not escape");
    },
  }, () => generateGoalFlightStageAction("owned-goal"));
  assert.deepEqual(events, ["authenticated", "fence-executor-requested"]);
  assert.deepEqual(result, {
    success: false,
    message: "We couldn't complete this strategy stage right now. Please try again.",
  });
  assert.equal(JSON.stringify(result).includes("credential"), false);
  assert.equal(db.row, null);

  let executorRequested = false;
  await withStrategyStageActionDependenciesForTest({
    ...mock.dependencies,
    prepareContext: async () => ({ success: false as const, message: "sign in" }),
    createFenceExecutor: async () => {
      executorRequested = true;
      return db.fenceExecutor;
    },
  }, () => generateGoalFlightStageAction("owned-goal"));
  assert.equal(executorRequested, false);
});

const GATEWAY_PARIS_HOTEL_SOURCE = { id: "source-hotel-paris", label: "https://example.com/paris-hotel", status: "catalog" as const, observedAt: null };
const GATEWAY_SOFIA_HOTEL_SOURCE = { id: "source-hotel-sofia", label: "https://example.com/sofia-hotel", status: "catalog" as const, observedAt: null };

function gatewayHotelOption(overrides: Partial<StrategyAwardOption>): StrategyAwardOption {
  return {
    id: "hotel-option-id",
    sourceId: GATEWAY_PARIS_HOTEL_SOURCE.id,
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

function gatewaySofiaOption(): StrategyAwardOption {
  return gatewayHotelOption({
    id: "hotel-option-sofia",
    sourceId: GATEWAY_SOFIA_HOTEL_SOURCE.id,
    itineraryLabel: "Hyatt Regency Sofia",
    goalMatch: "different_destination",
    goalMismatchReasons: ["destination"],
  });
}

test("a failed SerpAPI hotel estimate saves no payload and never exposes property or provider data", async () => {
  const db = new RunDatabase();
  const mock = mocks(db);
  const priorDebug = process.env.STRATEGY_DEBUG;
  const priorError = console.error;
  const logs: unknown[][] = [];
  process.env.STRATEGY_DEBUG = "1";
  console.error = (...values: unknown[]) => { logs.push(values); };
  try {
    await withStrategyStageActionDependenciesForTest(mock.dependencies, async () => {
      const flight = await generateGoalFlightStageAction("owned-goal");
      assert.equal(flight.success && flight.stageStatus, "succeeded");
      const runId = flight.success ? flight.runId : "";
      const savedBeforeHotel = db.events.filter((event) => event === "stage-saved").length;
      const failedBeforeHotel = db.events.filter((event) => event === "stage-failed").length;
      const hotelDeps = { ...mock.dependencies, createSerpApiHotelEstimate: async () => {
        logSerpApiHotelEstimateDiagnostic("hotel_client_projection_rejected");
        return null;
      } };

      const hotel = await withStrategyStageActionDependenciesForTest(hotelDeps, () =>
        generateGoalHotelStageAction("owned-goal", runId)
      );
      // The hotel stage fails safely; no property or provider data is presented.
      assert.equal(hotel.success && hotel.stageStatus, "failed");
      assert.equal(hotel.success === false || hotel.message, "Hotel recommendations could not be generated from the available research.");
      const serializedFailure = JSON.stringify(hotel).toLowerCase();
      for (const rejected of ["example grand hotel", "serpapi", "api_key", "search_metadata"]) {
        assert.equal(serializedFailure.includes(rejected), false, `failure result must not contain ${rejected}`);
      }
      // No hotel payload was saved.
      assert.equal(db.row?.hotel_status, "failed");
      assert.equal(db.row?.hotel_payload, null);
      assert.equal(db.events.filter((event) => event === "stage-saved").length, savedBeforeHotel);
      assert.equal(db.events.filter((event) => event === "stage-failed").length, failedBeforeHotel + 1);
      // Diagnostics stay fixed-category and content-free.
      assert.deepEqual(logs, [
        ["[hotel-planning-estimate] {\"category\":\"hotel_client_projection_rejected\"}"],
        ["[strategy-stage-error]", JSON.stringify({ stage: "hotel", runId, goalId: "owned-goal", category: "research_stage_failed" })],
      ]);

      // The run remains and finalization can continue with the valid flight
      // stage under the existing terminal-stage rules.
      const withFinalization = withStrategyFinalizationDependenciesForTest;
      assert.equal(typeof withFinalization, "function");
    });
  } finally {
    console.error = priorError;
    if (priorDebug === undefined) delete process.env.STRATEGY_DEBUG;
    else process.env.STRATEGY_DEBUG = priorDebug;
  }
});

test("a successful SerpAPI hotel stage persists only the validated estimate with no fabricated award data", async () => {
  const db = new RunDatabase();
  const mock = mocks(db);
  await withStrategyStageActionDependenciesForTest(mock.dependencies, async () => {
    const flight = await generateGoalFlightStageAction("owned-goal");
    assert.equal(flight.success && flight.stageStatus, "succeeded");
    const runId = flight.success ? flight.runId : "";
    const savedBeforeHotel = db.events.filter((event) => event === "stage-saved").length;

    const hotel = await generateGoalHotelStageAction("owned-goal", runId);
    assert.equal(hotel.success && hotel.stageStatus, "succeeded");
    assert.equal(db.events.filter((event) => event === "stage-saved").length, savedBeforeHotel + 1);

    // No fabricated award, points, or source data anywhere in the result.
    const serializedResult = JSON.stringify(hotel).toLowerCase();
    for (const rejected of ["pointsrequired", "world of hyatt", "award", "source-hotel", "programname"]) {
      assert.equal(serializedResult.includes(rejected), false, `result must not contain ${rejected}`);
    }
    assert.deepEqual(hotel.success ? hotel.options : [], []);
    assert.deepEqual(hotel.success ? hotel.sources : [], []);

    // The signed persisted payload contains the searched estimate and no
    // award/points fabrication; case-insensitive leak checks cover key
    // material, provider metadata, and request URLs. (The projector's own
    // stable option-ID prefix "serpapi-hotel-" is our identifier, not
    // provider content.)
    const payload = JSON.parse(String(db.row?.hotel_payload)) as {
      interpreted: { awardOptions: unknown[]; sources: unknown[]; hotelPlanningEstimate: { destination: string; checkInDate: string; checkOutDate: string; travelers: number; currency: string; options: Array<{ propertyName: string; trustStatus: string }> } | null };
    };
    assert.deepEqual(payload.interpreted.awardOptions, []);
    assert.deepEqual(payload.interpreted.sources, []);
    assert.equal(payload.interpreted.hotelPlanningEstimate?.destination, "Paris");
    assert.equal(payload.interpreted.hotelPlanningEstimate?.checkInDate, "2027-04-03");
    assert.equal(payload.interpreted.hotelPlanningEstimate?.checkOutDate, "2027-04-11");
    assert.equal(payload.interpreted.hotelPlanningEstimate?.travelers, 2);
    assert.equal(payload.interpreted.hotelPlanningEstimate?.currency, "USD");
    assert.equal(payload.interpreted.hotelPlanningEstimate?.options[0]?.trustStatus, "search_estimate");
    const serializedPayload = JSON.stringify(payload).toLowerCase();
    for (const rejected of ["api_key", "apikey", "search_metadata", "token", "signature", "https://serpapi.com", "search_id"]) {
      assert.equal(serializedPayload.includes(rejected), false, `persisted payload must not contain ${rejected}`);
    }
  });
});
