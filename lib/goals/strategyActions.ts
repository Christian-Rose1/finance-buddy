"use server";

/**
 * Server actions for personalized goal strategy generation.
 *
 * Security:
 * - The authenticated user is resolved exclusively from the cookie-aware
 *   server Supabase client. No userId is ever accepted from the client.
 * - The goal is loaded with an ownership check (getGoalForUser).
 * - A fully validated generated strategy is persisted as the latest saved
 *   strategy for the goal. A save failure never discards the generated
 *   strategy and never changes a previously saved strategy.
 */

import { prepareGoalStrategyContext } from "./strategyActionContext";
import {
  generateAutomatedStrategyFromResearchStages,
  type StrategyStageFinalizationMode,
} from "./automatedStrategyPlanner";
import { ResearchInterpreterError } from "./researchInterpreter";
import type { InterpretedResearch } from "./researchInterpreter";
import {
  createGoalStrategyRun,
  getGoalStrategyRun,
  startGoalStrategyRunStage,
  loadVerifiedGoalStrategyRunStage,
  failGoalStrategyRunStage,
  recoverGoalStrategyRunStageStart,
  saveGoalStrategyRunStage,
  type VerifiedRunningResearchStage,
  type RecoverableResearchStageStart,
  type VerifiedFinalizationAttempt,
  type RecoverableFinalizationStart,
  StrategyRunStageSaveDeadlineError,
  StrategyRunFinalizationDeadlineError,
} from "./strategyRunRepository";
import {
  buildStrategyRunStagePayload,
  validateStrategyRunStagePayload,
} from "./strategyRunPayload";
import type {
  PersonalizedStrategy,
  StrategyAwardOption,
  StrategySource,
} from "./strategyTypes";
import { toClientSafeResearch, toClientSafeStrategy } from "./travelEvidence";
import { getStrategyStageActionDependencies } from "./strategyStageActionDependencies";
import { getStrategyFinalizationDependencies } from "./strategyFinalizationDependencies";
import { getStrategyDeletionDependencies } from "./strategyDeletionDependencies";
import type { ResearchInterpreter } from "./researchInterpreter";
import { buildFlightPlanningEstimate, logFlightPlanningEstimateDiagnostic } from "./flightPlanningEstimate";
import type { FlightPlanningEstimate } from "./flightPlanningEstimate";
import type { HotelPlanningEstimate } from "./hotelPlanningEstimate";
import { logSerpApiHotelEstimateDiagnostic } from "./serpApiHotelClient";
import type { Goal } from "./types";
import {
  runWithStrategyResearchStageDeadline,
  runWithStrategyResearchStageCleanupDeadline,
  StrategyResearchStageDeadlineError,
} from "./strategyStageDeadline";
import {
  runWithStrategyFinalizationDeadline,
  runWithStrategyFinalizationCleanupDeadline,
  StrategyFinalizationDeadlineError,
} from "./strategyFinalizationDeadline";

export type GenerateGoalStrategyResult =
  | {
      success: true;
      strategy: PersonalizedStrategy;
      saved: boolean;
      generatedAt: string;
      saveMessage: string | null;
    }
  | { success: false; message: string; retryable?: boolean };

export type GoalResearchStageResult =
  | {
      success: true;
      runId: string;
      expiresAt: string;
      stage: "flight" | "hotel";
      stageStatus: "succeeded";
      options: StrategyAwardOption[];
      sources: StrategySource[];
      assumptions: string[];
      warnings: string[];
      message: null;
    }
  | {
      success: true;
      runId: string;
      expiresAt: string;
      stage: "flight" | "hotel";
      stageStatus: "failed";
      options: [];
      sources: [];
      assumptions: [];
      warnings: [];
      message: string;
    }
  | {
      success: false;
      message: string;
    };

export type DeleteGoalStrategyResult =
  | { success: true }
  | { success: false; message: string };

const DELETE_STRATEGY_FAILURE_MESSAGE =
  "We couldn't delete your strategy right now. Your saved plan is unchanged.";

/**
 * Delete only the signed-in customer's saved strategy. The browser supplies
 * no user ID, run authority, recovery token, or strategy data.
 */
export async function deleteGoalStrategyAction(
  goalId: string,
): Promise<DeleteGoalStrategyResult> {
  if (typeof goalId !== "string" || goalId.trim().length === 0) {
    return { success: false, message: DELETE_STRATEGY_FAILURE_MESSAGE };
  }
  try {
    const dependencies = getStrategyDeletionDependencies();
    const supabase = await dependencies.createServerClient();
    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData.user) {
      return { success: false, message: DELETE_STRATEGY_FAILURE_MESSAGE };
    }

    // Privileged execution is created only after cookie-aware authentication;
    // ownership is always the server-derived session user.
    const fenceExecutor = await dependencies.createFenceExecutor();
    await dependencies.deleteStrategy(goalId, userData.user.id, fenceExecutor);
    return { success: true };
  } catch {
    return { success: false, message: DELETE_STRATEGY_FAILURE_MESSAGE };
  }
}

const FLIGHT_STAGE_FAILED_MESSAGE =
  "Flight recommendations could not be generated from the available research.";
const HOTEL_STAGE_FAILED_MESSAGE =
  "Hotel recommendations could not be generated from the available research.";
const STRATEGY_RUN_UNAVAILABLE_MESSAGE =
  "This strategy run is no longer available. Rebuild your complete strategy to try again.";

/**
 * Generate the signed flight research stage for a goal, creating a new
 * signed strategy run in the process.
 *
 * Returns only safe, validated redemption data. Payload text, signatures,
 * userId, balances, wallet data, purchases, context, and catalogs are never
 * returned.
 */

export async function generateGoalFlightStageAction(
  goalId: string
): Promise<GoalResearchStageResult> {
  const deadlineState: { handler: null | (() => Promise<GoalResearchStageResult>) } = { handler: null };
  const uncertainStartState: { cleanup: null | (() => Promise<void>) } = { cleanup: null };
  let createdRunId: string | null = null;
  let createdGoalId: string | null = null;
  try {
    const dependencies = getStrategyStageActionDependencies();
    const preparedResult = await dependencies.prepareContext(goalId);

    if (!preparedResult.success) {
      return { success: false, message: preparedResult.message };
    }

    const {
      supabase,
      userId,
      context,
    } = preparedResult.prepared;

    const fenceExecutor = await dependencies.createFenceExecutor();

    const run = await createGoalStrategyRun(goalId, userId, supabase);
    const runId = run.id;
    createdRunId = runId;
    createdGoalId = run.goalId;
    const expiresAt = run.expiresAt;
    const outcome = await runWithStrategyResearchStageDeadline(async (signal) => {
      // The production flight stage is SerpAPI-direct: the authenticated
      // planning-estimate path is the only flight result source. The stage
      // authority is minted directly through the repository fence, so no
      // Tavily provider, research interpreter, or provider-backed execution
      // gateway is ever constructed or called for flight.
      const runningStage = await startGoalStrategyRunStage(
        runId,
        goalId,
        userId,
        "flight",
        supabase,
        fenceExecutor,
        signal,
        (recovery) => {
          uncertainStartState.cleanup = () => boundedUncertainStartRecovery(
            recovery, fenceExecutor, dependencies,
          );
          deadlineState.handler = () => terminalDeadlineFailure(
            "flight", runId, goalId, expiresAt, null, recovery, supabase, fenceExecutor, dependencies,
          );
        },
      );
      uncertainStartState.cleanup = null;
      deadlineState.handler = () => terminalDeadlineFailure(
        "flight", runId, goalId, expiresAt, runningStage, null, supabase, fenceExecutor, dependencies,
      );

      const estimateOutcome = await runFlightStageSerpApiEstimate(
        runningStage,
        dependencies,
        supabase,
        fenceExecutor,
        context.goal,
        runId,
        goalId,
        signal,
      );

      if (estimateOutcome.kind === "failed") return { kind: "failed" as const };
      if (signal.aborted) throw new StrategyResearchStageDeadlineError();
      const envelope = buildStrategyRunStagePayload("flight", {
        awardOptions: [],
        cardOffers: [],
        sources: [],
        assumptions: [],
        warnings: [],
        flightPlanningEstimate: estimateOutcome.estimate,
      });
      if (signal.aborted) throw new StrategyResearchStageDeadlineError();
      await dependencies.saveStage(runningStage, envelope, supabase, fenceExecutor, signal);
      if (signal.aborted) throw new StrategyResearchStageDeadlineError();
      return { kind: "succeeded" as const, envelope };
    }, dependencies.stageDeadlineMs);

    if (outcome.kind === "failed") {
      return {
        success: true,
        runId,
        expiresAt,
        stage: "flight",
        stageStatus: "failed",
        options: [],
        sources: [],
        assumptions: [],
        warnings: [],
        message: FLIGHT_STAGE_FAILED_MESSAGE,
      };
    }

    const envelope = outcome.envelope;

    return {
      success: true,
      runId,
      expiresAt,
      stage: "flight",
      stageStatus: "succeeded",
      options: toClientSafeResearch(envelope.interpreted.awardOptions),
      sources: [],
      assumptions: envelope.interpreted.assumptions,
      warnings: envelope.interpreted.warnings,
      message: null,
    };
  } catch (error) {
    if (
      error instanceof StrategyResearchStageDeadlineError ||
      error instanceof StrategyRunStageSaveDeadlineError
    ) {
      return deadlineState.handler ? await deadlineState.handler() : genericStageFailure("flight", createdRunId, createdGoalId);
    }
    if (uncertainStartState.cleanup) {
      await uncertainStartState.cleanup();
      if (process.env.STRATEGY_DEBUG === "1") {
        console.error("[strategy-stage-error]", JSON.stringify({ stage: "flight", runId: createdRunId, goalId: createdGoalId, category: "stage_start_recovery_failure" }));
      }
      return safeOuterStageFailure();
    }
    return genericStageFailure("flight", createdRunId, createdGoalId);
  }
}

/**
 * Generate the signed hotel research stage for an existing owned, unexpired
 * strategy run whose flight stage has completed.
 */
export async function generateGoalHotelStageAction(
  goalId: string,
  runId: string
): Promise<GoalResearchStageResult> {
  const deadlineState: { handler: null | (() => Promise<GoalResearchStageResult>) } = { handler: null };
  const uncertainStartState: { cleanup: null | (() => Promise<void>) } = { cleanup: null };
  try {
    if (typeof runId !== "string" || runId.trim().length === 0) {
      return { success: false, message: "A valid strategy run is required." };
    }

    const dependencies = getStrategyStageActionDependencies();
    const preparedResult = await dependencies.prepareContext(goalId);

    if (!preparedResult.success) {
      return { success: false, message: preparedResult.message };
    }

    const {
      supabase,
      userId,
      context,
    } = preparedResult.prepared;

    const fenceExecutor = await dependencies.createFenceExecutor();

    const run = await getGoalStrategyRun(runId, goalId, userId, supabase);
    if (!run) {
      return { success: false, message: "We couldn't find that strategy run." };
    }

    if (run.flightStatus !== "succeeded" && run.flightStatus !== "failed") {
      return {
        success: false,
        message: "The flight research stage is not complete.",
      };
    }
    const outcome = await runWithStrategyResearchStageDeadline(async (signal) => {
      // The production hotel stage is SerpAPI-direct: the authenticated saved
      // goal drives a single Google Hotels request through the strict client,
      // and no Tavily provider, research interpreter, or provider-backed
      // execution gateway is ever constructed or called for hotels.
      const runningStage = await startGoalStrategyRunStage(
        runId,
        goalId,
        userId,
        "hotel",
        supabase,
        fenceExecutor,
        signal,
        (recovery) => {
          uncertainStartState.cleanup = () => boundedUncertainStartRecovery(
            recovery, fenceExecutor, dependencies,
          );
          deadlineState.handler = () => terminalDeadlineFailure(
            "hotel", runId, goalId, run.expiresAt, null, recovery, supabase, fenceExecutor, dependencies,
          );
        },
      );
      uncertainStartState.cleanup = null;
      deadlineState.handler = () => terminalDeadlineFailure(
        "hotel", runId, goalId, run.expiresAt, runningStage, null, supabase, fenceExecutor, dependencies,
      );

      const estimateOutcome = await runHotelStageSerpApiEstimate(
        runningStage,
        dependencies,
        supabase,
        fenceExecutor,
        context.goal,
        runId,
        goalId,
        signal,
      );

      if (estimateOutcome.kind === "failed") return { kind: "failed" as const };
      if (signal.aborted) throw new StrategyResearchStageDeadlineError();
      const envelope = buildStrategyRunStagePayload("hotel", {
        awardOptions: [],
        cardOffers: [],
        sources: [],
        assumptions: [],
        warnings: [],
        hotelPlanningEstimate: estimateOutcome.estimate,
      });
      if (signal.aborted) throw new StrategyResearchStageDeadlineError();
      await dependencies.saveStage(runningStage, envelope, supabase, fenceExecutor, signal);
      if (signal.aborted) throw new StrategyResearchStageDeadlineError();
      return { kind: "succeeded" as const, envelope };
    }, dependencies.stageDeadlineMs);

    if (outcome.kind === "failed") {
      return {
        success: true,
        runId,
        expiresAt: run.expiresAt,
        stage: "hotel" as const,
        stageStatus: "failed" as const,
        options: [],
        sources: [],
        assumptions: [],
        warnings: [],
        message: HOTEL_STAGE_FAILED_MESSAGE,
      };
    }

    const envelope = outcome.envelope;

    return {
      success: true,
      runId,
      expiresAt: run.expiresAt,
      stage: "hotel" as const,
      stageStatus: "succeeded" as const,
      options: [],
      sources: [],
      assumptions: envelope.interpreted.assumptions,
      warnings: envelope.interpreted.warnings,
      message: null,
    };
  } catch (error) {
    if (
      error instanceof StrategyResearchStageDeadlineError ||
      error instanceof StrategyRunStageSaveDeadlineError
    ) {
      return deadlineState.handler ? await deadlineState.handler() : genericStageFailure("hotel", runId, goalId);
    }
    if (uncertainStartState.cleanup) {
      await uncertainStartState.cleanup();
      if (process.env.STRATEGY_DEBUG === "1") {
        console.error("[strategy-stage-error]", JSON.stringify({ stage: "hotel", runId, goalId, category: "stage_start_recovery_failure" }));
      }
      return safeOuterStageFailure();
    }
    return genericStageFailure("hotel", runId, goalId);
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

type StageResearchResult =
  | { kind: "succeeded"; value: InterpretedResearch }
  | { kind: "failed" };

async function boundedUncertainStartRecovery(
  recovery: RecoverableResearchStageStart,
  fenceExecutor: Parameters<typeof recoverGoalStrategyRunStageStart>[1],
  dependencies: ReturnType<typeof getStrategyStageActionDependencies>,
): Promise<void> {
  try {
    await runWithStrategyResearchStageCleanupDeadline(
      (signal) => dependencies.recoverStageStart(recovery, fenceExecutor, signal),
      dependencies.stageCleanupDeadlineMs,
    );
  } catch {
    // Lost-response recovery is best-effort and never exposes RPC details.
  }
}

async function terminalDeadlineFailure(
  stage: "flight" | "hotel",
  runId: string,
  goalId: string | null,
  expiresAt: string,
  runningStage: VerifiedRunningResearchStage | null,
  recoverableStart: RecoverableResearchStageStart | null,
  supabase: Parameters<typeof failGoalStrategyRunStage>[1],
  fenceExecutor: Parameters<typeof failGoalStrategyRunStage>[2],
  dependencies: ReturnType<typeof getStrategyStageActionDependencies>,
): Promise<GoalResearchStageResult> {
  if (process.env.STRATEGY_DEBUG === "1") {
    console.error("[strategy-stage-timeout]", JSON.stringify({ stage, runId, goalId, category: "stage_timeout" }));
  }
  try {
    const outcome = await runWithStrategyResearchStageCleanupDeadline(
      (signal) => runningStage
        ? dependencies.failStage(runningStage, supabase, fenceExecutor, signal)
        : recoverableStart
          ? dependencies.recoverStageStart(recoverableStart, fenceExecutor, signal)
          : Promise.reject(new Error("Stage cleanup unavailable.")),
      dependencies.stageCleanupDeadlineMs,
    );
    if (outcome === "succeeded") return safeOuterStageFailure();
  } catch {
    if (process.env.STRATEGY_DEBUG === "1") {
      console.error("[strategy-stage-error]", JSON.stringify({ stage, runId, goalId, category: "stage_start_recovery_failure" }));
    }
    return safeOuterStageFailure();
  }
  return {
    success: true,
    runId,
    expiresAt,
    stage,
    stageStatus: "failed",
    options: [],
    sources: [],
    assumptions: [],
    warnings: [],
    message: stage === "flight" ? FLIGHT_STAGE_FAILED_MESSAGE : HOTEL_STAGE_FAILED_MESSAGE,
  };
}

function safeOuterStageFailure(): GoalResearchStageResult {
  return {
    success: false,
    message: "We couldn't complete this strategy stage right now. Please try again.",
  };
}

/**
 * Runs the flight stage directly through the authenticated SerpAPI
 * planning-estimate path using only the saved goal's own inputs and the
 * resolved search-location contracts. Tavily research and the flight
 * research interpreter intentionally never run for production flight
 * generation. A missing, malformed, unavailable, or rejected SerpAPI result
 * marks the stage failed once, saves no flight payload, and never exposes
 * provider internals. The caught error is never exposed.
 */
async function runFlightStageSerpApiEstimate(
  runningStage: VerifiedRunningResearchStage,
  dependencies: ReturnType<typeof getStrategyStageActionDependencies>,
  supabase: Parameters<typeof saveGoalStrategyRunStage>[2],
  fenceExecutor: Parameters<typeof saveGoalStrategyRunStage>[3],
  goal: Parameters<typeof buildFlightPlanningEstimate>[0],
  runId: string,
  goalId: string,
  signal: AbortSignal,
): Promise<{ kind: "succeeded"; estimate: FlightPlanningEstimate } | { kind: "failed" }> {
  if (signal.aborted) throw new StrategyResearchStageDeadlineError();
  let estimate: FlightPlanningEstimate | null = null;
  try {
    estimate = dependencies.createFlightPlanningEstimate
      ? await dependencies.createFlightPlanningEstimate(goal)
      : null;
  } catch {
    logFlightPlanningEstimateDiagnostic("unexpected_estimate_dependency_failure");
    estimate = null;
  }
  if (signal.aborted) throw new StrategyResearchStageDeadlineError();
  if (!estimate) {
    try {
      await failGoalStrategyRunStage(runningStage, supabase, fenceExecutor);
    } catch {
      if (process.env.STRATEGY_DEBUG === "1") {
        console.error("[strategy-stage-error]", JSON.stringify({ stage: "flight", runId, goalId, category: "stage_marking_failed" }));
      }
    }
    if (process.env.STRATEGY_DEBUG === "1") {
      console.error("[strategy-stage-error]", JSON.stringify({
        stage: "flight", runId, goalId, category: "research_stage_failed",
      }));
    }
    return { kind: "failed" };
  }
  return { kind: "succeeded", estimate };
}

/**
 * Runs the hotel stage directly through the authenticated SerpAPI Google
 * Hotels path using only the saved goal's own inputs. Tavily research and the
 * research interpreter intentionally never run for production hotel
 * generation. A missing, malformed, unavailable, or rejected SerpAPI result
 * marks the stage failed once, saves no hotel payload, and never exposes
 * provider internals. The caught error is never exposed.
 */
async function runHotelStageSerpApiEstimate(
  runningStage: VerifiedRunningResearchStage,
  dependencies: ReturnType<typeof getStrategyStageActionDependencies>,
  supabase: Parameters<typeof saveGoalStrategyRunStage>[2],
  fenceExecutor: Parameters<typeof saveGoalStrategyRunStage>[3],
  goal: Goal,
  runId: string,
  goalId: string,
  signal: AbortSignal,
): Promise<{ kind: "succeeded"; estimate: HotelPlanningEstimate } | { kind: "failed" }> {
  if (signal.aborted) throw new StrategyResearchStageDeadlineError();
  let estimate: HotelPlanningEstimate | null = null;
  try {
    estimate = await dependencies.createSerpApiHotelEstimate(goal);
  } catch {
    logSerpApiHotelEstimateDiagnostic("unexpected_hotel_estimate_failure");
    estimate = null;
  }
  if (signal.aborted) throw new StrategyResearchStageDeadlineError();
  if (!estimate) {
    try {
      await failGoalStrategyRunStage(runningStage, supabase, fenceExecutor);
    } catch {
      if (process.env.STRATEGY_DEBUG === "1") {
        console.error("[strategy-stage-error]", JSON.stringify({ stage: "hotel", runId, goalId, category: "stage_marking_failed" }));
      }
    }
    if (process.env.STRATEGY_DEBUG === "1") {
      console.error("[strategy-stage-error]", JSON.stringify({
        stage: "hotel", runId, goalId, category: "research_stage_failed",
      }));
    }
    return { kind: "failed" };
  }
  return { kind: "succeeded", estimate };
}

/**
 * Generic outer failure boundary for stage actions. Emits only a fixed
 * allowlisted stage/category diagnostic under STRATEGY_DEBUG: no error names,
 * messages, identifiers, provider details, payloads, prompts, sources,
 * customer data, signatures, or complete errors. Specialized provider
 * diagnostics elsewhere retain their already-reviewed fixed categories and
 * status fields.
 *
 * Allowed flight diagnostic categories for this file:
 * - stage_timeout
 * - research_stage_failed
 * - stage_marking_failed
 * - stage_start_recovery_failure
 * - unexpected_stage_failure
 */
function genericStageFailure(
  stage: "flight" | "hotel",
  runId: string | null,
  goalId: string | null,
): GoalResearchStageResult {
  if (process.env.STRATEGY_DEBUG === "1") {
    console.error("[strategy-stage-error]", JSON.stringify({ stage, runId, goalId, category: "unexpected_stage_failure" }));
  }
  return safeOuterStageFailure();
}

/**
 * Finalize a signed staged run: generate and save the complete
 * PersonalizedStrategy from verified flight/hotel research stages.
 *
 * Only goalId and runId are accepted from the caller. All research data is
 * loaded from the signed run; no stage options, interpreted research, payload
 * strings, signatures, statuses, or sources are accepted from the browser.
 */
export async function finalizeGoalStrategyRunAction(
  goalId: string,
  runId: string
): Promise<GenerateGoalStrategyResult> {
  if (typeof runId !== "string" || runId.trim().length === 0) {
    return {
      success: false,
      message: STRATEGY_RUN_UNAVAILABLE_MESSAGE,
      retryable: false,
    };
  }

  const dependencies = getStrategyFinalizationDependencies();
  let recovery: RecoverableFinalizationStart | null = null;
  let attempt: VerifiedFinalizationAttempt | null = null;
  let fenceExecutor: Awaited<ReturnType<typeof dependencies.createFenceExecutor>> | null = null;
  try {
    const preparedResult = await dependencies.prepareContext(goalId);
    if (!preparedResult.success) {
      return { success: false, message: preparedResult.message };
    }

    const {
      supabase,
      userId,
      context,
      customerRewardPrograms,
      catalogRewardPrograms,
    } = preparedResult.prepared;

    let run: Awaited<ReturnType<typeof getGoalStrategyRun>>;
    try {
      run = await dependencies.getRun(runId, goalId, userId, supabase);
    } catch {
      return {
        success: false,
        message: STRATEGY_RUN_UNAVAILABLE_MESSAGE,
        retryable: false,
      };
    }
    if (!run) {
      return {
        success: false,
        message: STRATEGY_RUN_UNAVAILABLE_MESSAGE,
        retryable: false,
      };
    }

    const flightTerminal =
      run.flightStatus === "succeeded" || run.flightStatus === "failed";
    const hotelTerminal =
      run.hotelStatus === "succeeded" || run.hotelStatus === "failed";
    if (!flightTerminal || !hotelTerminal) {
      return {
        success: false,
        message: "Flight and hotel research must finish before building the plan.",
        retryable: false,
      };
    }

    const finalizationMode: StrategyStageFinalizationMode =
      run.finalStatus === "failed" ? "retry" : "initial";

    try {
      // Authentication and owned-goal preparation have completed before the
      // privileged, allowlisted executor is created. The single local deadline
      // includes start (whose database deadline begins at commit) and every
      // operation through the atomic final commit.
      fenceExecutor = await dependencies.createFenceExecutor();
      const committed = await runWithStrategyFinalizationDeadline(async (signal) => {
        attempt = await dependencies.startFinalization(
          runId, goalId, userId, supabase, fenceExecutor!, signal,
          (value) => { recovery = value; },
        );
        recovery = null;
        const flight = await loadVerifiedFinalStage(
          runId, goalId, userId, supabase, "flight", run.flightStatus,
          dependencies.loadStage,
        );
        if (signal.aborted) throw new StrategyFinalizationDeadlineError();
        const hotel = await loadVerifiedFinalStage(
          runId, goalId, userId, supabase, "hotel", run.hotelStatus,
          dependencies.loadStage,
        );
        if (signal.aborted) throw new StrategyFinalizationDeadlineError();
        const strategy = await dependencies.generateStrategy(
          context, customerRewardPrograms, catalogRewardPrograms,
          { flight, hotel }, finalizationMode, signal,
        );
        if (signal.aborted) throw new StrategyFinalizationDeadlineError();
        return dependencies.commitFinalization(
          attempt!, strategy, context.generatedAt, fenceExecutor!, signal,
        );
      }, dependencies.finalizationDeadlineMs);

      return {
        success: true,
        strategy: committed.strategy,
        saved: true,
        saveMessage: null,
        generatedAt: committed.generatedAt,
      };
    } catch (error) {
      const deadlineFailure = error instanceof StrategyFinalizationDeadlineError ||
        error instanceof StrategyRunFinalizationDeadlineError;
      if (deadlineFailure && process.env.STRATEGY_DEBUG === "1") {
        console.error("[strategy-finalization-timeout]", JSON.stringify({ category: "finalization_timeout" }));
      }
      if (!attempt && recovery && fenceExecutor) {
        await boundedFinalizationStartRecovery(recovery, fenceExecutor, dependencies);
        return finalizeGenericFailure(error);
      }
      const cleanup = await boundedFinalizationFailure(attempt, fenceExecutor, dependencies);
      // A success committed before cleanup acquired the row remains authoritative.
      // The current request still returns the generic safe shape; a reload reads it.
      if (cleanup !== "failed") return finalizeGenericFailure();
      return finalizeGenericFailure(error);
    }
  } catch {
    return finalizeGenericFailure();
  }
}

// ---------------------------------------------------------------------------
// Finalization helpers
// ---------------------------------------------------------------------------

/**
 * Load and validate a verified final stage. A non-succeeded stage resolves to
 * null; a succeeded stage must load a non-null, valid payload.
 */
async function loadVerifiedFinalStage(
  runId: string,
  goalId: string,
  userId: string,
  supabase: Parameters<typeof loadVerifiedGoalStrategyRunStage>[4],
  stage: "flight" | "hotel",
  status: string,
  loader: ReturnType<typeof getStrategyFinalizationDependencies>["loadStage"],
): Promise<InterpretedResearch | null> {
  if (status !== "succeeded") {
    return null;
  }

  const value = await loader(runId, goalId, userId, stage, supabase);
  if (value === null) {
    throw new Error("Invalid strategy-run stage payload.");
  }

  return validateStrategyRunStagePayload(value, stage).interpreted;
}

/**
 * Best-effort transition a finalized run's final status to "failed".
 */
async function boundedFinalizationFailure(
  attempt: VerifiedFinalizationAttempt | null,
  executor: Awaited<ReturnType<ReturnType<typeof getStrategyFinalizationDependencies>["createFenceExecutor"]>> | null,
  dependencies: ReturnType<typeof getStrategyFinalizationDependencies>,
): Promise<"failed" | "succeeded" | "unconfirmed"> {
  if (!attempt || !executor) return "unconfirmed";
  try {
    return await runWithStrategyFinalizationCleanupDeadline(
      (signal) => dependencies.failFinalization(attempt, executor, signal),
      dependencies.cleanupDeadlineMs,
    );
  } catch {
    return "unconfirmed";
  }
}

async function boundedFinalizationStartRecovery(
  recovery: RecoverableFinalizationStart,
  executor: Awaited<ReturnType<ReturnType<typeof getStrategyFinalizationDependencies>["createFenceExecutor"]>>,
  dependencies: ReturnType<typeof getStrategyFinalizationDependencies>,
): Promise<void> {
  try {
    await runWithStrategyFinalizationCleanupDeadline(
      (signal) => dependencies.recoverStart(recovery, executor, signal),
      dependencies.cleanupDeadlineMs,
    );
  } catch {}
}

/**
 * Generic outer failure boundary for the finalize action. Logs only error name
 * and message under STRATEGY_DEBUG, never error details/customer data.
 */
function finalizeGenericFailure(_error?: unknown): GenerateGoalStrategyResult {
  if (process.env.STRATEGY_DEBUG === "1") {
    console.error("[strategy-finalize-error]", JSON.stringify({ category: "unexpected_finalization_failure" }));
  }
  return {
    success: false,
    retryable: true,
    message: "We couldn't build your strategy right now. Please try again in a moment.",
  };
}
