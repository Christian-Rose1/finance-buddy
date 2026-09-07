import type { SupabaseClient } from "@supabase/supabase-js";

import {
  createProviderExecutionGateway,
  type VerifiedStageQueryExecutor,
} from "./providerExecutionGateway";
import type { ResearchProvider } from "./researchTypes";
import type { StrategyStageFenceRpcExecutor } from "./strategyStageFenceRpcExecutor";
import {
  startGoalStrategyRunStage,
  type RecoverableResearchStageStart,
  type StrategyResearchStage,
  type VerifiedRunningResearchStage,
} from "./strategyRunRepository";

export interface StartedVerifiedResearchStageExecution {
  executor: VerifiedStageQueryExecutor;
  runningStage: VerifiedRunningResearchStage;
}

/**
 * Authenticated action-path composition: the repository transition must mint
 * stage authority before a provider-backed query executor can exist.
 */
export async function startVerifiedResearchStageExecution(
  runId: string,
  goalId: string,
  userId: string,
  stage: StrategyResearchStage,
  provider: ResearchProvider,
  client: SupabaseClient,
  fenceExecutor: StrategyStageFenceRpcExecutor,
  signal?: AbortSignal,
  onRecoveryReady?: (recovery: RecoverableResearchStageStart) => void,
): Promise<StartedVerifiedResearchStageExecution> {
  const runningStage = await startGoalStrategyRunStage(
    runId,
    goalId,
    userId,
    stage,
    client,
    fenceExecutor,
    signal,
    onRecoveryReady,
  );
  return Object.freeze({
    executor: createProviderExecutionGateway(runningStage, provider, signal),
    runningStage,
  });
}
