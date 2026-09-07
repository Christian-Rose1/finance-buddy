import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import type { SupabaseClient } from "@supabase/supabase-js";

import { generateGoalFlightStageAction, generateGoalHotelStageAction } from "./strategyActions";
import type { PreparedGoalStrategyContext } from "./strategyActionContext";
import { ResearchInterpreterError } from "./researchInterpreter";
import type { ResearchInterpreter } from "./researchInterpreter";
import type { ResearchProvider, ResearchQuery, ResearchResponse } from "./researchTypes";
import { signStrategyRunPayload } from "./strategyRunSigning";
import type { StrategyStageFenceRpcExecutor, StrategyStageFenceRpcName } from "./strategyStageFenceRpcExecutor";
import {
  failGoalStrategyRunStage,
  recoverGoalStrategyRunStageStart,
  saveGoalStrategyRunStage,
  startGoalStrategyRunStage,
} from "./strategyRunRepository";
import { withStrategyStageActionDependenciesForTest } from "./strategyStageActionDependencies";
import { withStrategyFinalizationDependenciesForTest } from "./strategyFinalizationDependencies";
import type { PersonalizedStrategyContext } from "./strategyTypes";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

const SECRET = "actual-action-gateway-test-secret-012345";
let priorSecret: string | undefined;

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

function mocks(db: RunDatabase, fail: (index: number) => boolean = () => false) {
  const calls: ResearchQuery[] = [];
  const interpreted: ResearchResponse[][] = [];
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
      return { awardOptions: [], cardOffers: [], sources: [], assumptions: [], warnings: [] };
    },
  };
  return {
    calls, interpreted, interpreter,
    dependencies: {
      prepareContext: async () => {
        db.events.push("authenticated-goal-loaded");
        return { success: true as const, prepared: prepared(db) };
      },
      createProvider: () => provider,
      createInterpreter: () => interpreter,
      saveStage: saveGoalStrategyRunStage,
      failStage: failGoalStrategyRunStage,
      recoverStageStart: recoverGoalStrategyRunStageStart,
      createFenceExecutor: async () => db.fenceExecutor,
    },
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
    assert.deepEqual(db.events.slice(0, 5), [
      "authenticated-goal-loaded", "run-created", "run-loaded", "stage-running", "provider-called",
    ]);
    assert.equal(db.events.filter((event) => event === "stage-saved").length, 1);
    assert.equal(new Set(mock.calls.map((call) => call.query)).size, mock.calls.length);

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
  });
});

test("actual action partial failures retain siblings; all failures mark once without retry", async () => {
  const partialDb = new RunDatabase();
  const partial = mocks(partialDb, (index) => index === 1);
  await withStrategyStageActionDependenciesForTest(partial.dependencies, async () => {
    const result = await generateGoalFlightStageAction("owned-goal");
    assert.equal(result.success && result.stageStatus, "succeeded");
  });
  assert.equal(partial.calls.length, 2);
  assert.equal(partial.interpreted[0]?.length, 1);
  assert.equal(partialDb.events.includes("stage-failed"), false);

  const failedDb = new RunDatabase();
  failedDb.row = existingRunRow("failed");
  const failed = mocks(failedDb, () => true);
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
    assert.equal(failed.calls.length, 2);
    assert.equal(failedDb.events.filter((event) => event === "stage-failed").length, 1);
    assert.equal(failedDb.events.includes("stage-saved"), false);
    assert.deepEqual(logs, [[
      "[strategy-stage-error]",
      JSON.stringify({ stage: "flight", runId: failedRunId, goalId: "owned-goal", category: "research_stage_failed" }),
    ]]);
    assert.equal(logs[0][1].includes("provider"), false);
    assert.equal(logs[0][1].includes("signature"), false);
  } finally {
    console.error = priorError;
    if (priorDebug === undefined) delete process.env.STRATEGY_DEBUG;
    else process.env.STRATEGY_DEBUG = priorDebug;
  }
});

test("rejected planning estimate remains best-effort after successful flight research", async () => {
  const db = new RunDatabase();
  const mock = mocks(db);
  const dependencies = {
    ...mock.dependencies,
    createFlightPlanningEstimate: async () => { throw new Error("synthetic estimate failure"); },
  };
  const priorDebug = process.env.STRATEGY_DEBUG;
  const priorError = console.error;
  const logs: unknown[][] = [];
  process.env.STRATEGY_DEBUG = "1";
  console.error = (...values: unknown[]) => { logs.push(values); };
  try {
    await withStrategyStageActionDependenciesForTest(dependencies, async () => {
      const flight = await generateGoalFlightStageAction("owned-goal");
      assert.equal(flight.success, true);
      assert.equal(flight.success && flight.stageStatus, "succeeded");
      assert.equal(db.row?.flight_status, "succeeded");
      assert.equal(db.row?.final_status, "pending");
      const payload = JSON.parse(db.row?.flight_payload as string) as { interpreted: { flightPlanningEstimate: unknown } };
      assert.equal(payload.interpreted.flightPlanningEstimate, null);
      const runId = flight.success ? flight.runId : "";
      const hotel = await generateGoalHotelStageAction("owned-goal", runId);
      assert.equal(hotel.success && hotel.stageStatus, "succeeded");
    });
  } finally {
    console.error = priorError;
    if (priorDebug === undefined) delete process.env.STRATEGY_DEBUG;
    else process.env.STRATEGY_DEBUG = priorDebug;
  }
  assert.deepEqual(logs, [["[flight-planning-estimate] {\"category\":\"unexpected_estimate_dependency_failure\"}"]]);
});

test("actual hotel all-query failure marks failed once without retry", async () => {
  const db = new RunDatabase();
  let fail = false;
  const mock = mocks(db, () => fail);
  await withStrategyStageActionDependenciesForTest(mock.dependencies, async () => {
    const flight = await generateGoalFlightStageAction("owned-goal");
    assert.equal(flight.success && flight.stageStatus, "succeeded");
    const runId = flight.success ? flight.runId : "";
    const callsBeforeHotel = mock.calls.length;
    const failuresBeforeHotel = db.events.filter((event) => event === "stage-failed").length;
    fail = true;
    const hotel = await generateGoalHotelStageAction("owned-goal", runId);
    assert.equal(hotel.success && hotel.stageStatus, "failed");
    assert.equal(mock.calls.length - callsBeforeHotel, 2);
    assert.equal(db.events.filter((event) => event === "stage-failed").length - failuresBeforeHotel, 1);
  });
});

test("flight deadline terminates as failed once and late interpretation cannot save", async () => {
  const db = new RunDatabase();
  const mock = mocks(db);
  db.row = existingRunRow("failed");
  const late = deferred<Awaited<ReturnType<ResearchInterpreter["interpret"]>>>();
  const dependencies = {
    ...mock.dependencies,
    stageDeadlineMs: 5,
    createInterpreter: () => ({ interpret: () => late.promise }),
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
    assert.equal(mock.calls.length, 2);
    assert.equal(db.events.filter((event) => event === "stage-failed").length, 1);
    late.resolve({ awardOptions: [], cardOffers: [], sources: [], assumptions: [], warnings: [] });
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

test("flight interpreter failure emits research_stage_failed and does not expose provider content", async () => {
  const db = new RunDatabase();
  const mock = mocks(db);
  const interpreter = mock.interpreter;
  const original = interpreter.interpret;
  interpreter.interpret = async (...args: Parameters<typeof original>) => {
    const result = await original(...args);
    if (result.awardOptions.length === 0) throw new ResearchInterpreterError("synthetic interpreter failure", "test-provider", "test-model");
    return result;
  };
  const dependencies = { ...mock.dependencies, createInterpreter: () => interpreter };
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
    assert.deepEqual(logs, [[
      "[strategy-stage-error]",
      JSON.stringify({ stage: "flight", runId: result.success ? result.runId : "", goalId: "owned-goal", category: "research_stage_failed" }),
    ]]);
    assert.equal(logs[0][1].includes("provider"), false, "no provider content in diagnostic");
    assert.equal(logs[0][1].includes("signature"), false, "no signature in diagnostic");
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
  const late = deferred<Awaited<ReturnType<ResearchInterpreter["interpret"]>>>();
  const dependencies = {
    ...normal.dependencies,
    stageDeadlineMs: 5,
    createInterpreter: () => ({ interpret: () => late.promise }),
  };
  const result = await withStrategyStageActionDependenciesForTest(dependencies, () =>
    generateGoalHotelStageAction("owned-goal", flight.success ? flight.runId : "")
  );
  assert.equal(result.success && result.stageStatus, "failed");
  assert.equal(db.row?.flight_status, "succeeded");
  assert.equal(db.row?.hotel_status, "failed");
  assert.equal(normal.calls.length - callsBeforeHotel, 2);
  assert.equal(db.events.filter((event) => event === "stage-failed").length, 1);
  late.resolve({ awardOptions: [], cardOffers: [], sources: [], assumptions: [], warnings: [] });
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
    createInterpreter: () => ({
      async interpret() {
        await new Promise((resolve) => setTimeout(resolve, 20));
        return { awardOptions: [], cardOffers: [], sources: [], assumptions: [], warnings: [] };
      },
    }),
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
  const late = deferred<Awaited<ReturnType<ResearchInterpreter["interpret"]>>>();
  const dependencies = {
    ...normal.dependencies,
    stageDeadlineMs: 5,
    createInterpreter: () => ({ interpret: () => late.promise }),
  };
  const result = await withStrategyStageActionDependenciesForTest(dependencies, () =>
    generateGoalHotelStageAction("owned-goal", flight.success ? flight.runId : "")
  );
  assert.equal(result.success && result.stageStatus, "failed");
  assert.equal(db.row?.flight_status, "succeeded");
  assert.equal(db.row?.hotel_status, "failed");
  assert.equal(normal.calls.length - callsBeforeHotel, 2);
  assert.equal(db.events.filter((event) => event === "stage-failed").length, 1);
  late.resolve({ awardOptions: [], cardOffers: [], sources: [], assumptions: [], warnings: [] });
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
  const lateInterpretation = deferred<Awaited<ReturnType<ResearchInterpreter["interpret"]>>>();
  const lateFailure = deferred<void>();
  let cleanupSignal: AbortSignal | undefined;
  const dependencies = {
    ...mock.dependencies,
    stageDeadlineMs: 5,
    stageCleanupDeadlineMs: 5,
    createInterpreter: () => ({ interpret: () => lateInterpretation.promise }),
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
  lateInterpretation.resolve({ awardOptions: [], cardOffers: [], sources: [], assumptions: [], warnings: [] });
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
