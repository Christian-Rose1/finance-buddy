import assert from "node:assert/strict";
import { test } from "node:test";

import {
  getStrategyActionContextDependencies,
  withStrategyActionContextDependenciesForTest,
} from "./strategyActionContextDependencies";
import {
  getStrategyStageActionDependencies,
  withStrategyStageActionDependenciesForTest,
} from "./strategyStageActionDependencies";

async function proveIsolation<T extends object>(
  getCurrent: () => T,
  runWith: (value: T, operation: () => Promise<void>) => Promise<void>,
): Promise<void> {
  const defaults = getCurrent();
  const first = { ...defaults } as T;
  const second = { ...defaults } as T;
  const nested = { ...defaults } as T;

  await runWith(first, async () => {
    assert.equal(getCurrent(), first);
  });
  assert.equal(getCurrent(), defaults);

  await assert.rejects(
    runWith(first, async () => {
      assert.equal(getCurrent(), first);
      throw new Error("synthetic rejection");
    }),
    /synthetic rejection/,
  );
  assert.equal(getCurrent(), defaults);

  let releaseFirst!: () => void;
  let signalFirstStarted!: () => void;
  const firstStarted = new Promise<void>((resolve) => { signalFirstStarted = resolve; });
  const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
  const firstOperation = runWith(first, async () => {
    signalFirstStarted();
    await firstGate;
    assert.equal(getCurrent(), first);
  });
  await firstStarted;
  const secondOperation = runWith(second, async () => {
    assert.equal(getCurrent(), second);
    releaseFirst();
    await Promise.resolve();
    assert.equal(getCurrent(), second);
  });
  assert.equal(getCurrent(), defaults);
  await Promise.all([firstOperation, secondOperation]);
  assert.equal(getCurrent(), defaults);

  await runWith(first, async () => {
    assert.equal(getCurrent(), first);
    await runWith(nested, async () => {
      assert.equal(getCurrent(), nested);
    });
    assert.equal(getCurrent(), first);
  });
  assert.equal(getCurrent(), defaults);
}

test("stage-action dependencies are request-local across success, rejection, overlap, and nesting", async () => {
  await proveIsolation(getStrategyStageActionDependencies, withStrategyStageActionDependenciesForTest);
});

test("preparation dependencies are request-local across success, rejection, overlap, and nesting", async () => {
  await proveIsolation(getStrategyActionContextDependencies, withStrategyActionContextDependenciesForTest);
});
