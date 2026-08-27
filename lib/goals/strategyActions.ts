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
  generateFlightResearchStage,
  generateHotelResearchStage,
} from "./automatedStrategyPlanner";
import { ResearchInterpreterError } from "./researchInterpreter";
import type { InterpretedResearch } from "./researchInterpreter";
import {
  createGoalStrategyRun,
  deleteGoalStrategyRun,
  getGoalStrategyRun,
  loadVerifiedGoalStrategyRunStage,
  failGoalStrategyRunStage,
  saveGoalStrategyRunStage,
  updateGoalStrategyRunFinalStatus,
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
import type { VerifiedStageQueryExecutor } from "./providerExecutionGateway";
import { startVerifiedResearchStageExecution } from "./authenticatedStageExecution";
import { getStrategyStageActionDependencies } from "./strategyStageActionDependencies";
import { getStrategyFinalizationDependencies } from "./strategyFinalizationDependencies";
import { persistFinalizedStrategy } from "./finalizedStrategyPersistence";
import type { ResearchInterpreter } from "./researchInterpreter";

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
      customerRewardPrograms,
      catalogRewardPrograms,
    } = preparedResult.prepared;

    const run = await createGoalStrategyRun(goalId, userId, supabase);
    const runId = run.id;
    const expiresAt = run.expiresAt;

    const executor = await startVerifiedResearchStageExecution(
      runId,
      goalId,
      userId,
      "flight",
      dependencies.createProvider(),
      supabase,
    );

    const interpreted = await runFlightStageResearch(
      runId,
      goalId,
      userId,
      executor,
      dependencies.createInterpreter(),
      supabase,
      context,
      catalogRewardPrograms
    );

    if (interpreted.kind === "failed") {
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

    const envelope = buildStrategyRunStagePayload("flight", interpreted.value);
    await saveGoalStrategyRunStage(runId, goalId, userId, "flight", envelope, supabase);

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
  } catch {
    return genericStageFailure("flight");
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
      catalogRewardPrograms,
    } = preparedResult.prepared;

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

    const executor = await startVerifiedResearchStageExecution(
      runId,
      goalId,
      userId,
      "hotel",
      dependencies.createProvider(),
      supabase,
    );

    const interpreted = await runHotelStageResearch(
      runId,
      goalId,
      userId,
      executor,
      dependencies.createInterpreter(),
      supabase,
      context,
      catalogRewardPrograms
    );

    if (interpreted.kind === "failed") {
      return {
        success: true,
        runId,
        expiresAt: run.expiresAt,
        stage: "hotel",
        stageStatus: "failed",
        options: [],
        sources: [],
        assumptions: [],
        warnings: [],
        message: HOTEL_STAGE_FAILED_MESSAGE,
      };
    }

    const envelope = buildStrategyRunStagePayload("hotel", interpreted.value);
    await saveGoalStrategyRunStage(runId, goalId, userId, "hotel", envelope, supabase);

    return {
      success: true,
      runId,
      expiresAt: run.expiresAt,
      stage: "hotel",
      stageStatus: "succeeded",
      options: toClientSafeResearch(envelope.interpreted.awardOptions),
      sources: [],
      assumptions: envelope.interpreted.assumptions,
      warnings: envelope.interpreted.warnings,
      message: null,
    };
  } catch {
    return genericStageFailure("hotel");
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

type StageResearchResult =
  | { kind: "succeeded"; value: Awaited<ReturnType<typeof generateFlightResearchStage>> }
  | { kind: "failed" };

/**
 * Runs the flight research stage, isolating ResearchInterpreterError as a
 * non-fatal stage failure. The caught error is never exposed.
 */
async function runFlightStageResearch(
  runId: string,
  goalId: string,
  userId: string,
  executor: VerifiedStageQueryExecutor,
  interpreter: ResearchInterpreter,
  supabase: Parameters<typeof saveGoalStrategyRunStage>[5],
  context: Parameters<typeof generateFlightResearchStage>[0],
  catalogRewardPrograms: Parameters<typeof generateFlightResearchStage>[1]
): Promise<StageResearchResult> {
  try {
    const interpreted = await generateFlightResearchStage(
      context,
      catalogRewardPrograms,
      { executor, interpreter },
    );
    return { kind: "succeeded", value: interpreted };
  } catch (err) {
    if (err instanceof ResearchInterpreterError) {
      try {
        await failGoalStrategyRunStage(runId, goalId, userId, "flight", supabase);
      } catch {
        // Best-effort: do not expose a marking-failed error.
      }
      return { kind: "failed" };
    }
    throw err;
  }
}

/**
 * Runs the hotel research stage, isolating ResearchInterpreterError as a
 * non-fatal stage failure. The caught error is never exposed.
 */
async function runHotelStageResearch(
  runId: string,
  goalId: string,
  userId: string,
  executor: VerifiedStageQueryExecutor,
  interpreter: ResearchInterpreter,
  supabase: Parameters<typeof saveGoalStrategyRunStage>[5],
  context: Parameters<typeof generateHotelResearchStage>[0],
  catalogRewardPrograms: Parameters<typeof generateHotelResearchStage>[1]
): Promise<StageResearchResult> {
  try {
    const interpreted = await generateHotelResearchStage(
      context,
      catalogRewardPrograms,
      { executor, interpreter },
    );
    return { kind: "succeeded", value: interpreted };
  } catch (err) {
    if (err instanceof ResearchInterpreterError) {
      try {
        await failGoalStrategyRunStage(runId, goalId, userId, "hotel", supabase);
      } catch {
        // Best-effort: do not expose a marking-failed error.
      }
      return { kind: "failed" };
    }
    throw err;
  }
}

/**
 * Generic outer failure boundary for stage actions. Emits only a fixed
 * allowlisted stage/category diagnostic under STRATEGY_DEBUG: no error names,
 * messages, identifiers, provider details, payloads, prompts, sources,
 * customer data, signatures, or complete errors. Specialized provider
 * diagnostics elsewhere retain their already-reviewed fixed categories and
 * status fields.
 */
function genericStageFailure(stage: "flight" | "hotel"): GoalResearchStageResult {
  if (process.env.STRATEGY_DEBUG === "1") {
    console.error("[strategy-stage-error]", JSON.stringify({ stage, category: "unexpected_stage_failure" }));
  }
  return {
    success: false,
    message: "We couldn't complete this strategy stage right now. Please try again.",
  };
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

  try {
    const preparedResult = await prepareGoalStrategyContext(goalId);
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
      run = await getGoalStrategyRun(runId, goalId, userId, supabase);
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

    // Finalization begins. Supports retry from a previously failed run.
    try {
      await updateGoalStrategyRunFinalStatus(runId, goalId, userId, "running", supabase);
    } catch {
      return {
        success: false,
        message: STRATEGY_RUN_UNAVAILABLE_MESSAGE,
        retryable: false,
      };
    }

    // Everything after finalization starts is guarded by an inner failure
    // boundary so a best-effort mark-failed can be attempted.
    try {
      const flight = await loadVerifiedFinalStage(
        runId,
        goalId,
        userId,
        supabase,
        "flight",
        run.flightStatus
      );
      const hotel = await loadVerifiedFinalStage(
        runId,
        goalId,
        userId,
        supabase,
        "hotel",
        run.hotelStatus
      );

      const strategy = await generateAutomatedStrategyFromResearchStages(
        context,
        customerRewardPrograms,
        catalogRewardPrograms,
        { flight, hotel },
        finalizationMode
      );

      // Save the complete strategy. A save failure keeps the run for retry
      // and never overwrites/deletes a previous saved strategy.
      let savedStrategy: Awaited<ReturnType<typeof persistFinalizedStrategy>>;
      try {
        const persisted = await persistFinalizedStrategy(
          goalId,
          userId,
          strategy,
          context.generatedAt,
          getStrategyFinalizationDependencies().saveLatestStrategy,
        );
        savedStrategy = persisted;
      } catch (saveError) {
        await bestEffortMarkFinalFailed(runId, goalId, userId, supabase);
        const safeSaveMessage =
          saveError instanceof Error
            ? `${saveError.name}: ${saveError.message}`
            : "Unknown error";
        if (process.env.STRATEGY_DEBUG === "1") {
          console.error("[strategy-save-error]", safeSaveMessage);
        }
        return {
          success: false,
          retryable: true,
          message:
            "We couldn't save your strategy right now. Try finishing it again in a moment.",
        };
      }

      // Save succeeded. Best-effort lifecycle cleanup must not discard or
      // misreport the successfully saved strategy.
      try {
        await updateGoalStrategyRunFinalStatus(runId, goalId, userId, "succeeded", supabase);
      } catch (cleanupError) {
        logFinalCleanupError(cleanupError);
      }
      try {
        await deleteGoalStrategyRun(runId, goalId, userId, supabase);
      } catch (cleanupError) {
        logFinalCleanupError(cleanupError);
      }

      return {
        success: true,
        strategy: savedStrategy.strategy,
        saved: true,
        saveMessage: null,
        generatedAt: savedStrategy.generatedAt,
      };
    } catch (error) {
      await bestEffortMarkFinalFailed(runId, goalId, userId, supabase);
      return finalizeGenericFailure(error);
    }
  } catch (error) {
    return finalizeGenericFailure(error);
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
  status: string
): Promise<InterpretedResearch | null> {
  if (status !== "succeeded") {
    return null;
  }

  const value = await loadVerifiedGoalStrategyRunStage(runId, goalId, userId, stage, supabase);
  if (value === null) {
    throw new Error("Invalid strategy-run stage payload.");
  }

  return validateStrategyRunStagePayload(value, stage).interpreted;
}

/**
 * Best-effort transition a finalized run's final status to "failed".
 */
async function bestEffortMarkFinalFailed(
  runId: string,
  goalId: string,
  userId: string,
  supabase: Parameters<typeof updateGoalStrategyRunFinalStatus>[4]
): Promise<void> {
  try {
    await updateGoalStrategyRunFinalStatus(runId, goalId, userId, "failed", supabase);
  } catch {
    // Best-effort: a cleanup failure must not be exposed or misreported.
  }
}

/**
 * Log a safe, STRATEGY_DEBUG-only lifecycle cleanup error.
 */
function logFinalCleanupError(error: unknown): void {
  if (process.env.STRATEGY_DEBUG === "1") {
    const safeMessage =
      error instanceof Error
        ? `${error.name}: ${error.message}`
        : "Unknown error";
    console.error("[strategy-run-cleanup-error]", safeMessage);
  }
}

/**
 * Generic outer failure boundary for the finalize action. Logs only error name
 * and message under STRATEGY_DEBUG, never error details/customer data.
 */
function finalizeGenericFailure(error: unknown): GenerateGoalStrategyResult {
  const safeMessage =
    error instanceof Error
      ? `${error.name}: ${error.message}`
      : "Unknown error";
  if (process.env.STRATEGY_DEBUG === "1") {
    console.error("[strategy-finalize-error]", safeMessage);
  }
  return {
    success: false,
    retryable: true,
    message: "We couldn't build your strategy right now. Please try again in a moment.",
  };
}
