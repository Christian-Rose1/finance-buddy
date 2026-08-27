import type { SupabaseClient } from "@supabase/supabase-js";

import {
  createProviderExecutionGateway,
  type VerifiedStageQueryExecutor,
} from "./providerExecutionGateway";
import type { ResearchProvider } from "./researchTypes";
import {
  startGoalStrategyRunStage,
  type StrategyResearchStage,
} from "./strategyRunRepository";

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
  client?: SupabaseClient,
): Promise<VerifiedStageQueryExecutor> {
  const runningStage = await startGoalStrategyRunStage(
    runId,
    goalId,
    userId,
    stage,
    client,
  );
  return createProviderExecutionGateway(runningStage, provider);
}
