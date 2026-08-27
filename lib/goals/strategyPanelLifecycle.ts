import type { PersonalizedStrategy, StrategyAwardOption } from "./strategyTypes";

/**
 * Customer-safe run-lifecycle state model for the goal strategy panel.
 *
 * The panel coordinates one staged run at a time: flight research, hotel
 * research, then finalization. A stage server action returning
 * `success: true` always means the signed stage reached a valid terminal
 * state and returned a runId; `stageStatus: "failed"` is a valid terminal
 * degraded stage whose lane produced no usable interpreted options. Only an
 * action-level failure (`success: false` or a transport exception) stops the
 * client workflow. Finalization runs once both stages returned valid terminal
 * action results; the finalization action remains authoritative about whether
 * a useful plan can be produced and whether a failure is retryable.
 *
 * This module owns the explicit run state, every terminal transition, and the
 * allowlisted customer-facing wording, so arbitrary action, provider, or
 * exception text can never reach the customer. It is pure: no React, server,
 * provider, or persistence dependencies.
 */

export type StrategyPanelStage = "idle" | "flight" | "hotel" | "final";

/** Server-returned terminal status of a completed research stage action. */
export type StrategyPanelStageStatus = "succeeded" | "failed";

/**
 * Terminal failure categories. "flight_action_failed" and
 * "hotel_action_failed" are outer action failures that stop the client
 * workflow; they are deliberately distinct from a valid terminal degraded
 * stage, which never produces a failure notice. The final categories follow
 * the finalization action's authoritative retryability verdict.
 */
export type StrategyPanelFailureKind =
  | "flight_action_failed"
  | "hotel_action_failed"
  | "final_retryable"
  | "final_non_retryable";

export interface StrategyPanelRunState {
  /** True only while an attempt is executing. Progress is visible only during this. */
  isGenerating: boolean;
  /** True only while a retained-run finalization retry is executing. */
  isFinalizationRetry: boolean;
  /** Active stage while generating; always reset to idle once an attempt stops. */
  stage: StrategyPanelStage;
  /** Server-returned terminal status once the stage action completed; null before. */
  flightStageStatus: StrategyPanelStageStatus | null;
  hotelStageStatus: StrategyPanelStageStatus | null;
  /** Safe options from successful lanes; degraded lanes retain none. */
  flightOptions: StrategyAwardOption[];
  hotelOptions: StrategyAwardOption[];
  /** Signed run retained for a finalization-only retry; null otherwise. */
  runId: string | null;
  failure: StrategyPanelFailureKind | null;
}

export type StrategyPanelRunEvent =
  | { type: "run_started" }
  | {
      type: "flight_stage_completed";
      runId: string;
      stageStatus: StrategyPanelStageStatus;
      options: StrategyAwardOption[];
    }
  | { type: "flight_action_failed" }
  | {
      type: "hotel_stage_completed";
      stageStatus: StrategyPanelStageStatus;
      options: StrategyAwardOption[];
    }
  | { type: "hotel_action_failed" }
  | { type: "retry_started" }
  | { type: "finalization_succeeded"; strategy: PersonalizedStrategy; generatedAt: string }
  | { type: "finalization_failed"; retryable: boolean }
  | { type: "finalization_transport_exception" };

export interface StrategyPanelTransitionResult {
  state: StrategyPanelRunState;
  /**
   * Server-generated strategy data to persist into component state, present
   * only for a successful finalization. Every failure returns null, so the
   * previous saved strategy and timestamp always survive.
   */
  strategyUpdate: { strategy: PersonalizedStrategy; generatedAt: string } | null;
}

export function createInitialStrategyPanelRunState(): StrategyPanelRunState {
  return {
    isGenerating: false,
    isFinalizationRetry: false,
    stage: "idle",
    flightStageStatus: null,
    hotelStageStatus: null,
    flightOptions: [],
    hotelOptions: [],
    runId: null,
    failure: null,
  };
}

/**
 * Retry is offered only for a reusable finalization run: a run the client
 * still references, whose finalization explicitly failed as retryable, and
 * while no attempt is executing.
 */
export function isStrategyRetryAvailable(state: StrategyPanelRunState): boolean {
  return !state.isGenerating && state.runId !== null && state.failure === "final_retryable";
}

function safeOptions(options: StrategyAwardOption[]): StrategyAwardOption[] {
  return Array.isArray(options) ? options : [];
}

/**
 * Only a successful lane may contribute previews; a degraded stage lane
 * produced no usable interpreted options.
 */
function laneOptions(
  stageStatus: StrategyPanelStageStatus,
  options: StrategyAwardOption[],
): StrategyAwardOption[] {
  return stageStatus === "succeeded" ? safeOptions(options) : [];
}

/** Terminal state after a failure: activity stops and transient run state clears. */
function actionFailureState(failure: StrategyPanelFailureKind): StrategyPanelRunState {
  return {
    isGenerating: false,
    isFinalizationRetry: false,
    stage: "idle",
    flightStageStatus: null,
    hotelStageStatus: null,
    flightOptions: [],
    hotelOptions: [],
    runId: null,
    failure,
  };
}

/**
 * Terminal state after a finalization failure. The run is retained only when
 * the result explicitly reports retryable and the client still holds its
 * runId; otherwise the client run reference and transient previews clear.
 */
function finalizationFailureState(
  state: StrategyPanelRunState,
  retryable: boolean,
): StrategyPanelTransitionResult {
  if (retryable && state.runId !== null) {
    return {
      state: {
        ...state,
        isGenerating: false,
        isFinalizationRetry: false,
        stage: "idle",
        failure: "final_retryable",
      },
      strategyUpdate: null,
    };
  }
  return {
    state: actionFailureState("final_non_retryable"),
    strategyUpdate: null,
  };
}

export function transitionStrategyPanelRun(
  state: StrategyPanelRunState,
  event: StrategyPanelRunEvent,
): StrategyPanelTransitionResult {
  switch (event.type) {
    case "run_started": {
      if (state.isGenerating) return { state, strategyUpdate: null };
      return {
        state: {
          isGenerating: true,
          isFinalizationRetry: false,
          stage: "flight",
          flightStageStatus: null,
          hotelStageStatus: null,
          flightOptions: [],
          hotelOptions: [],
          runId: null,
          failure: null,
        },
        strategyUpdate: null,
      };
    }
    case "flight_stage_completed": {
      // A degraded flight stage is a valid terminal stage: retain the runId,
      // record the status, keep no options for the degraded lane, and
      // continue to hotel research without a failure notice.
      if (!state.isGenerating || state.stage !== "flight") {
        return { state, strategyUpdate: null };
      }
      return {
        state: {
          ...state,
          stage: "hotel",
          flightStageStatus: event.stageStatus,
          flightOptions: laneOptions(event.stageStatus, event.options),
          runId: event.runId,
          failure: null,
        },
        strategyUpdate: null,
      };
    }
    case "flight_action_failed": {
      if (!state.isGenerating || state.stage !== "flight") {
        return { state, strategyUpdate: null };
      }
      return { state: actionFailureState("flight_action_failed"), strategyUpdate: null };
    }
    case "hotel_stage_completed": {
      // A degraded hotel stage is a valid terminal stage: continue to
      // finalization; the finalization action decides what is producible.
      if (!state.isGenerating || state.stage !== "hotel") {
        return { state, strategyUpdate: null };
      }
      return {
        state: {
          ...state,
          stage: "final",
          hotelStageStatus: event.stageStatus,
          hotelOptions: laneOptions(event.stageStatus, event.options),
          failure: null,
        },
        strategyUpdate: null,
      };
    }
    case "hotel_action_failed": {
      if (!state.isGenerating || state.stage !== "hotel") {
        return { state, strategyUpdate: null };
      }
      return { state: actionFailureState("hotel_action_failed"), strategyUpdate: null };
    }
    case "retry_started": {
      if (state.isGenerating || state.runId === null || state.failure !== "final_retryable") {
        return { state, strategyUpdate: null };
      }
      // Stale error state is cleared and retry is temporarily unavailable
      // until a result explicitly restores it. No flight or hotel stage or
      // action transition can occur while the stage is "final".
      return {
        state: { ...state, isGenerating: true, isFinalizationRetry: true, stage: "final", failure: null },
        strategyUpdate: null,
      };
    }
    case "finalization_succeeded": {
      if (!state.isGenerating || state.stage !== "final") {
        return { state, strategyUpdate: null };
      }
      return {
        state: {
          isGenerating: false,
          isFinalizationRetry: false,
          stage: "idle",
          flightStageStatus: null,
          hotelStageStatus: null,
          flightOptions: [],
          hotelOptions: [],
          runId: null,
          failure: null,
        },
        strategyUpdate: { strategy: event.strategy, generatedAt: event.generatedAt },
      };
    }
    case "finalization_failed": {
      if (!state.isGenerating || state.stage !== "final") {
        return { state, strategyUpdate: null };
      }
      return finalizationFailureState(state, event.retryable);
    }
    case "finalization_transport_exception": {
      if (!state.isGenerating || state.stage !== "final") {
        return { state, strategyUpdate: null };
      }
      // Conservative safe state for an unexpected transport exception. The
      // reusable run is retained because the existing server-validation
      // design demonstrably makes a repeated finalization attempt safe: the
      // run permits only failed→running, stages load from verified
      // server-side payloads, research is never rerun, the saved strategy is
      // never replaced unless persistence succeeds, and an expired, missing,
      // or stuck-running run returns an explicit non-retryable result that
      // clears the client run reference.
      return finalizationFailureState(state, true);
    }
  }
}

// ---------------------------------------------------------------------------
// Allowlisted customer-safe presentation
// ---------------------------------------------------------------------------

const STAGE_PROGRESS_LABELS: Record<Exclude<StrategyPanelStage, "final">, string | null> = {
  idle: null,
  flight: "Updating flight research",
  hotel: "Updating hotel research",
};

function getFinalStageProgressLabel(hasSavedStrategy: boolean): string {
  return hasSavedStrategy ? "Finishing your updated plan" : "Finishing your plan";
}

export function getStrategyStageProgressLabel(
  stage: StrategyPanelStage,
  hasSavedStrategy: boolean,
): string | null {
  if (stage === "final") return getFinalStageProgressLabel(hasSavedStrategy);
  return STAGE_PROGRESS_LABELS[stage] ?? null;
}

export interface StrategyProgressPresentation {
  heading: string;
  description: string;
  stageLabel: string | null;
}

/**
 * Active progress exists only while an attempt is executing; a null result
 * means no active progress is shown.
 */
export function buildStrategyProgressPresentation(
  state: StrategyPanelRunState,
  hasSavedStrategy: boolean,
): StrategyProgressPresentation | null {
  if (!state.isGenerating) return null;
  return {
    heading: hasSavedStrategy ? "Refreshing your plan" : "Building your plan",
    description: hasSavedStrategy
      ? "Refreshing your planning research. This may take a few minutes. Check current availability before acting."
      : "Building your planning research. This may take a few minutes. Check current availability before acting.",
    stageLabel: getStrategyStageProgressLabel(state.stage, hasSavedStrategy),
  };
}

const FAILURE_MESSAGES: Record<StrategyPanelFailureKind, Record<"saved" | "first_build", string>> = {
  flight_action_failed: {
    saved: "We couldn’t update the flight research. Your saved plan is unchanged.",
    first_build: "We couldn’t complete the flight research. Try building the plan again.",
  },
  hotel_action_failed: {
    saved: "We couldn’t update the hotel research. Your saved plan is unchanged.",
    first_build: "We couldn’t complete the hotel research. Try building the plan again.",
  },
  final_retryable: {
    saved: "The research finished, but we couldn’t finish the updated plan. Try finishing again—flight and hotel research will not be repeated.",
    first_build: "The research finished, but we couldn’t finish your plan. Try finishing again—flight and hotel research will not be repeated.",
  },
  final_non_retryable: {
    saved: "This refresh can’t be continued. Your saved plan is unchanged.",
    first_build: "This plan couldn’t be completed. Build it again when you’re ready.",
  },
};

/** Fixed allowlisted failure wording; never forwards action/provider/exception text. */
export function buildStrategyFailureMessage(
  failure: StrategyPanelFailureKind,
  hasSavedStrategy: boolean,
): string {
  return FAILURE_MESSAGES[failure][hasSavedStrategy ? "saved" : "first_build"];
}

export type StrategyPreviewMode = "active" | "retained" | "hidden";

export interface StrategyPreviewPresentation {
  mode: StrategyPreviewMode;
  /** Non-null only for retained previews; never labeled as active work. */
  heading: string | null;
}

export const RETAINED_RESEARCH_HEADING = "Research completed so far";

/**
 * First-build staged previews:
 * - active while the first build is running (shown inside active progress);
 * - retained under a non-active heading only while their reusable run remains;
 * - hidden for saved-strategy refreshes and after the run becomes unusable.
 * Only successful lanes with actual safe options render; a degraded lane
 * retains no options and is never labeled as having succeeded.
 */
export function buildStrategyPreviewPresentation(
  state: StrategyPanelRunState,
  hasSavedStrategy: boolean,
): StrategyPreviewPresentation {
  if (hasSavedStrategy) return { mode: "hidden", heading: null };
  if (state.isGenerating) {
    if (state.isFinalizationRetry && state.runId !== null) {
      return { mode: "retained", heading: RETAINED_RESEARCH_HEADING };
    }
    return { mode: "active", heading: null };
  }
  if (state.failure === "final_retryable" && state.runId !== null) {
    return { mode: "retained", heading: RETAINED_RESEARCH_HEADING };
  }
  return { mode: "hidden", heading: null };
}
