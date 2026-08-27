import assert from "node:assert/strict";
import { test } from "node:test";
import { getStrategyFinalizationDependencies, withStrategyFinalizationDependenciesForTest } from "./strategyFinalizationDependencies";

test("finalization save dependency restores its production default", async () => {
  const production = getStrategyFinalizationDependencies().saveLatestStrategy;
  const replacement = production;
  await withStrategyFinalizationDependenciesForTest(
    { saveLatestStrategy: replacement },
    async () => assert.equal(getStrategyFinalizationDependencies().saveLatestStrategy, replacement),
  );
  assert.equal(getStrategyFinalizationDependencies().saveLatestStrategy, production);
});
