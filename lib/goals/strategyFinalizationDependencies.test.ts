import assert from "node:assert/strict";
import { test } from "node:test";
import { saveLatestStrategy } from "./strategyRepository";
import {
  getStrategyFinalizationDependencies,
  withStrategyFinalizationDependenciesForTest,
} from "./strategyFinalizationDependencies";

test("finalization save dependency is request-local and restores defaults", async () => {
  const production = getStrategyFinalizationDependencies().saveLatestStrategy;
  const replacement = async (...args: Parameters<typeof saveLatestStrategy>) =>
    saveLatestStrategy(...args);

  await withStrategyFinalizationDependenciesForTest(
    { saveLatestStrategy: replacement },
    async () => {
      assert.equal(getStrategyFinalizationDependencies().saveLatestStrategy, replacement);
    },
  );

  assert.equal(getStrategyFinalizationDependencies().saveLatestStrategy, production);
});
