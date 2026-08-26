"use client";

import { useReducer } from "react";
import {
  finalizeGoalStrategyRunAction,
  generateGoalFlightStageAction,
  generateGoalHotelStageAction,
} from "@/lib/goals/strategyActions";
import type { PersonalizedStrategy } from "@/lib/goals/strategyTypes";
import {
  createGoalStrategyGenerationState,
  goalStrategyGenerationReducer,
  type ClientGenerationStage,
} from "./generation-state";

const CLIENT_ERROR_MESSAGE =
  "We couldn't build your strategy right now. Please try again in a moment.";

function logClientError(error: unknown): void {
  if (process.env.NODE_ENV !== "development") return;

  console.error(
    "[strategy-client-error]",
    error instanceof Error ? `${error.name}: ${error.message}` : "Unknown error"
  );
}

export function useGoalStrategyGeneration(
  goalId: string,
  initialStrategy: PersonalizedStrategy | null
) {
  const [state, dispatch] = useReducer(
    goalStrategyGenerationReducer,
    createGoalStrategyGenerationState(initialStrategy)
  );

  async function generate(): Promise<void> {
    if (state.isGenerating) return;

    dispatch({ type: "generation-started" });
    let activeStage: Exclude<ClientGenerationStage, "idle"> = "flight";

    try {
      const flightResult = await generateGoalFlightStageAction(goalId);

      if (!flightResult.success) {
        dispatch({
          type: "flight-hard-failed",
          message: flightResult.message,
        });
        return;
      }

      if (flightResult.stageStatus === "failed") {
        dispatch({
          type: "flight-soft-failed",
          runId: flightResult.runId,
          message: flightResult.message,
        });
      } else {
        dispatch({
          type: "flight-succeeded",
          runId: flightResult.runId,
          options: flightResult.options,
        });
      }

      activeStage = "hotel";
      dispatch({ type: "hotel-started" });

      const hotelResult = await generateGoalHotelStageAction(
        goalId,
        flightResult.runId
      );

      if (!hotelResult.success) {
        dispatch({
          type: "hotel-hard-failed",
          message: hotelResult.message,
        });
        return;
      }

      if (hotelResult.stageStatus === "failed") {
        dispatch({
          type: "hotel-soft-failed",
          message: hotelResult.message,
        });
      } else {
        dispatch({
          type: "hotel-succeeded",
          options: hotelResult.options,
        });
      }

      activeStage = "final";
      dispatch({ type: "final-started" });

      const finalResult = await finalizeGoalStrategyRunAction(
        goalId,
        flightResult.runId
      );

      if (finalResult.success) {
        dispatch({
          type: "final-succeeded",
          strategy: finalResult.strategy,
          saved: finalResult.saved,
          saveMessage: finalResult.saveMessage,
        });
      } else {
        dispatch({
          type: "final-failed",
          message: finalResult.message,
          retryable: finalResult.retryable !== false,
        });
      }
    } catch (error) {
      logClientError(error);
      dispatch({
        type: "client-stage-failed",
        stage: activeStage,
        message: CLIENT_ERROR_MESSAGE,
      });
    } finally {
      dispatch({ type: "generation-finished" });
    }
  }

  async function retryFinalization(): Promise<void> {
    if (
      state.isGenerating ||
      !state.runId ||
      !state.canRetryFinalization
    ) {
      return;
    }

    dispatch({ type: "final-retry-started" });

    try {
      const finalResult = await finalizeGoalStrategyRunAction(
        goalId,
        state.runId
      );

      if (finalResult.success) {
        dispatch({
          type: "final-succeeded",
          strategy: finalResult.strategy,
          saved: finalResult.saved,
          saveMessage: finalResult.saveMessage,
        });
      } else {
        dispatch({
          type: "final-failed",
          message: finalResult.message,
          retryable: finalResult.retryable !== false,
        });
      }
    } catch (error) {
      logClientError(error);
      dispatch({
        type: "client-stage-failed",
        stage: "final",
        message: CLIENT_ERROR_MESSAGE,
      });
    } finally {
      dispatch({ type: "generation-finished" });
    }
  }

  return { ...state, generate, retryFinalization };
}

