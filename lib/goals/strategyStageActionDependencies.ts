import { AsyncLocalStorage } from "node:async_hooks";

import { prepareGoalStrategyContext } from "./strategyActionContext";
import { createResearchInterpreter } from "./researchInterpreterFactory";
import type { ResearchInterpreter } from "./researchInterpreter";
import type { ResearchProvider } from "./researchTypes";
import { TavilyResearchProvider } from "./tavilyResearchProvider";
import { buildFlightPlanningEstimate } from "./flightPlanningEstimate";
import type { FlightPlanningEstimate } from "./flightPlanningEstimate";

export interface StrategyStageActionDependencies {
  prepareContext: typeof prepareGoalStrategyContext;
  createProvider: () => ResearchProvider;
  createInterpreter: () => ResearchInterpreter;
  createFlightPlanningEstimate?: (goal: Parameters<typeof buildFlightPlanningEstimate>[0]) => Promise<FlightPlanningEstimate | null>;
}

const productionDependencies: StrategyStageActionDependencies = Object.freeze({
  prepareContext: prepareGoalStrategyContext,
  createProvider: () => new TavilyResearchProvider(),
  createInterpreter: createResearchInterpreter,
  createFlightPlanningEstimate: buildFlightPlanningEstimate,
});

const testOverrides = new AsyncLocalStorage<StrategyStageActionDependencies>();

export function getStrategyStageActionDependencies(): StrategyStageActionDependencies {
  return testOverrides.getStore() ?? productionDependencies;
}

/**
 * Request-local test seam. It is not part of either browser-facing action
 * signature; production calls use the frozen defaults above.
 */
export function withStrategyStageActionDependenciesForTest<T>(
  dependencies: StrategyStageActionDependencies,
  operation: () => Promise<T>,
): Promise<T> {
  return testOverrides.run(Object.freeze(dependencies), operation);
}
