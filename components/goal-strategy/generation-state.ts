import type {
  PersonalizedStrategy,
  StrategyAwardOption,
} from "@/lib/goals/strategyTypes";

export type ClientGenerationStage = "idle" | "flight" | "hotel" | "final";
export type ClientStageStatus = "idle" | "loading" | "succeeded" | "failed";

export interface GoalStrategyGenerationState {
  isGenerating: boolean;
  currentStage: ClientGenerationStage;
  runId: string | null;
  flightStatus: ClientStageStatus;
  flightOptions: StrategyAwardOption[];
  flightMessage: string | null;
  hotelStatus: ClientStageStatus;
  hotelOptions: StrategyAwardOption[];
  hotelMessage: string | null;
  finalStatus: ClientStageStatus;
  canRetryFinalization: boolean;
  error: string | null;
  saveMessage: string | null;
  isSaved: boolean;
  strategy: PersonalizedStrategy | null;
}

export type GoalStrategyGenerationAction =
  | { type: "generation-started" }
  | { type: "flight-hard-failed"; message: string }
  | { type: "flight-soft-failed"; runId: string; message: string }
  | {
      type: "flight-succeeded";
      runId: string;
      options: StrategyAwardOption[];
    }
  | { type: "hotel-started" }
  | { type: "hotel-hard-failed"; message: string }
  | { type: "hotel-soft-failed"; message: string }
  | { type: "hotel-succeeded"; options: StrategyAwardOption[] }
  | { type: "final-started" }
  | { type: "final-retry-started" }
  | {
      type: "final-succeeded";
      strategy: PersonalizedStrategy;
      saved: boolean;
      saveMessage: string | null;
    }
  | { type: "final-failed"; message: string; retryable: boolean }
  | {
      type: "client-stage-failed";
      stage: Exclude<ClientGenerationStage, "idle">;
      message: string;
    }
  | { type: "generation-finished" };

export function createGoalStrategyGenerationState(
  initialStrategy: PersonalizedStrategy | null
): GoalStrategyGenerationState {
  return {
    isGenerating: false,
    currentStage: "idle",
    runId: null,
    flightStatus: "idle",
    flightOptions: [],
    flightMessage: null,
    hotelStatus: "idle",
    hotelOptions: [],
    hotelMessage: null,
    finalStatus: "idle",
    canRetryFinalization: false,
    error: null,
    saveMessage: null,
    isSaved: initialStrategy !== null,
    strategy: initialStrategy,
  };
}

export function goalStrategyGenerationReducer(
  state: GoalStrategyGenerationState,
  action: GoalStrategyGenerationAction
): GoalStrategyGenerationState {
  switch (action.type) {
    case "generation-started":
      return {
        ...state,
        isGenerating: true,
        currentStage: "flight",
        runId: null,
        flightStatus: "loading",
        flightOptions: [],
        flightMessage: null,
        hotelStatus: "idle",
        hotelOptions: [],
        hotelMessage: null,
        finalStatus: "idle",
        canRetryFinalization: false,
        error: null,
        saveMessage: null,
      };
    case "flight-hard-failed":
      return {
        ...state,
        flightStatus: "failed",
        flightMessage: action.message,
      };
    case "flight-soft-failed":
      return {
        ...state,
        runId: action.runId,
        flightStatus: "failed",
        flightMessage: action.message,
      };
    case "flight-succeeded":
      return {
        ...state,
        runId: action.runId,
        flightStatus: "succeeded",
        flightOptions: action.options,
      };
    case "hotel-started":
      return {
        ...state,
        currentStage: "hotel",
        hotelStatus: "loading",
      };
    case "hotel-hard-failed":
    case "hotel-soft-failed":
      return {
        ...state,
        hotelStatus: "failed",
        hotelMessage: action.message,
      };
    case "hotel-succeeded":
      return {
        ...state,
        hotelStatus: "succeeded",
        hotelOptions: action.options,
      };
    case "final-started":
      return {
        ...state,
        currentStage: "final",
        finalStatus: "loading",
      };
    case "final-retry-started":
      return {
        ...state,
        isGenerating: true,
        currentStage: "final",
        finalStatus: "loading",
        error: null,
        saveMessage: null,
      };
    case "final-succeeded":
      return {
        ...state,
        strategy: action.strategy,
        isSaved: action.saved,
        saveMessage: action.saveMessage,
        finalStatus: "succeeded",
        runId: null,
        flightStatus: "idle",
        flightOptions: [],
        flightMessage: null,
        hotelStatus: "idle",
        hotelOptions: [],
        hotelMessage: null,
        canRetryFinalization: false,
      };
    case "final-failed":
      return {
        ...state,
        finalStatus: "failed",
        error: action.message,
        canRetryFinalization: action.retryable,
        runId: action.retryable ? state.runId : null,
      };
    case "client-stage-failed":
      if (action.stage === "flight") {
        return {
          ...state,
          flightStatus: "failed",
          flightMessage: action.message,
        };
      }
      if (action.stage === "hotel") {
        return {
          ...state,
          hotelStatus: "failed",
          hotelMessage: action.message,
        };
      }
      return {
        ...state,
        finalStatus: "failed",
        error: action.message,
        canRetryFinalization: true,
      };
    case "generation-finished":
      return { ...state, isGenerating: false };
  }
}

