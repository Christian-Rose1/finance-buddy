import assert from "node:assert/strict";
import { test } from "node:test";
import {
  getStrategyFinalizationDependencies,
  withStrategyFinalizationDependenciesForTest,
} from "./strategyFinalizationDependencies";

test("finalization save dependency is request-local and restores defaults", async () => {
  const production = getStrategyFinalizationDependencies();
  const replacement = async (...args: Parameters<typeof production.commitFinalization>) =>
    production.commitFinalization(...args);

  await withStrategyFinalizationDependenciesForTest(
    { ...production, commitFinalization: replacement },
    async () => {
      assert.equal(getStrategyFinalizationDependencies().commitFinalization, replacement);
    },
  );

  assert.equal(getStrategyFinalizationDependencies(), production);
});
