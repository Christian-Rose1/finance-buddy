import { AsyncLocalStorage } from "node:async_hooks";

import { createServerClient } from "../supabase-server";
import { deleteOwnedGoalStrategy } from "./strategyRunRepository";
import type { StrategyStageFenceRpcExecutor } from "./strategyStageFenceRpcExecutor";

export interface StrategyDeletionDependencies {
  createServerClient: typeof createServerClient;
  createFenceExecutor: () => Promise<StrategyStageFenceRpcExecutor>;
  deleteStrategy: typeof deleteOwnedGoalStrategy;
}

const productionDependencies: StrategyDeletionDependencies = Object.freeze({
  createServerClient,
  createFenceExecutor: async () =>
    (await import("./strategyStageFenceRpcExecutor")).createStrategyStageFenceRpcExecutor(),
  deleteStrategy: deleteOwnedGoalStrategy,
});

const testOverrides = new AsyncLocalStorage<StrategyDeletionDependencies>();

export function getStrategyDeletionDependencies(): StrategyDeletionDependencies {
  return testOverrides.getStore() ?? productionDependencies;
}

export function withStrategyDeletionDependenciesForTest<T>(
  dependencies: StrategyDeletionDependencies,
  operation: () => Promise<T>,
): Promise<T> {
  return testOverrides.run(Object.freeze(dependencies), operation);
}
