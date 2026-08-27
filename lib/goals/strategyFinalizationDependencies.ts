import { AsyncLocalStorage } from "node:async_hooks";

import { saveLatestStrategy } from "./strategyRepository";

export interface StrategyFinalizationDependencies {
  saveLatestStrategy: typeof saveLatestStrategy;
}

const productionDependencies: StrategyFinalizationDependencies = Object.freeze({
  saveLatestStrategy,
});

const testOverrides = new AsyncLocalStorage<StrategyFinalizationDependencies>();

export function getStrategyFinalizationDependencies(): StrategyFinalizationDependencies {
  return testOverrides.getStore() ?? productionDependencies;
}

export function withStrategyFinalizationDependenciesForTest<T>(
  dependencies: StrategyFinalizationDependencies,
  operation: () => Promise<T>,
): Promise<T> {
  return testOverrides.run(Object.freeze(dependencies), operation);
}
