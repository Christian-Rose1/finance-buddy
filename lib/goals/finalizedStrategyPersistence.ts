import type { GenerateGoalStrategyResult } from "./strategyActions";
import type { saveLatestStrategy, SavedGoalStrategy } from "./strategyRepository";
import type { PersonalizedStrategy } from "./strategyTypes";

export type FinalizedStrategyPersistenceResult = Pick<
  Extract<GenerateGoalStrategyResult, { success: true }>,
  "strategy" | "generatedAt"
>;

export async function persistFinalizedStrategy(
  goalId: string,
  userId: string,
  strategy: PersonalizedStrategy,
  generatedAt: string,
  save: typeof saveLatestStrategy,
): Promise<FinalizedStrategyPersistenceResult> {
  const saved: SavedGoalStrategy = await save(
    goalId,
    userId,
    strategy,
    generatedAt,
  );

  return {
    strategy: saved.strategy,
    generatedAt: saved.generatedAt,
  };
}
