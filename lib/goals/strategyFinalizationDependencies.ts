import { AsyncLocalStorage } from "node:async_hooks";

import { prepareGoalStrategyContext } from "./strategyActionContext";
import { generateAutomatedStrategyFromResearchStages } from "./automatedStrategyPlanner";
import {
  commitGoalStrategyRunFinalization,
  failGoalStrategyRunFinalization,
  getGoalStrategyRun,
  loadVerifiedGoalStrategyRunStage,
  recoverGoalStrategyRunFinalizationStart,
  startGoalStrategyRunFinalization,
} from "./strategyRunRepository";
import type { StrategyStageFenceRpcExecutor } from "./strategyStageFenceRpcExecutor";

export interface StrategyFinalizationDependencies {
  prepareContext: typeof prepareGoalStrategyContext;
  createFenceExecutor: () => Promise<StrategyStageFenceRpcExecutor>;
  getRun: typeof getGoalStrategyRun;
  startFinalization: typeof startGoalStrategyRunFinalization;
  recoverStart: typeof recoverGoalStrategyRunFinalizationStart;
  loadStage: typeof loadVerifiedGoalStrategyRunStage;
  generateStrategy: typeof generateAutomatedStrategyFromResearchStages;
  commitFinalization: typeof commitGoalStrategyRunFinalization;
  failFinalization: typeof failGoalStrategyRunFinalization;
  finalizationDeadlineMs?: number;
  cleanupDeadlineMs?: number;
}

const productionDependencies: StrategyFinalizationDependencies = Object.freeze({
  prepareContext: prepareGoalStrategyContext,
  createFenceExecutor: async () =>
    (await import("./strategyStageFenceRpcExecutor")).createStrategyStageFenceRpcExecutor(),
  getRun: getGoalStrategyRun,
  startFinalization: startGoalStrategyRunFinalization,
  recoverStart: recoverGoalStrategyRunFinalizationStart,
  loadStage: loadVerifiedGoalStrategyRunStage,
  generateStrategy: generateAutomatedStrategyFromResearchStages,
  commitFinalization: commitGoalStrategyRunFinalization,
  failFinalization: failGoalStrategyRunFinalization,
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
