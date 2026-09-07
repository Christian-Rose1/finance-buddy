import assert from "node:assert/strict";
import { test } from "node:test";

import {
  StrategyResearchStageDeadlineError,
  runWithStrategyResearchStageCleanupDeadline,
  runWithStrategyResearchStageDeadline,
} from "./strategyStageDeadline";

test("a completed operation clears its timer without later aborting its signal", async () => {
  let signal: AbortSignal | undefined;
  const result = await runWithStrategyResearchStageDeadline(async (currentSignal) => {
    signal = currentSignal;
    return "done";
  }, 5);
  assert.equal(result, "done");
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(signal?.aborted, false);
});

test("deadline and cleanup helpers abort and safely observe late rejection", async () => {
  for (const run of [
    runWithStrategyResearchStageDeadline,
    runWithStrategyResearchStageCleanupDeadline,
  ]) {
    let rejectLate!: (error: Error) => void;
    let signal: AbortSignal | undefined;
    const late = new Promise<never>((_resolve, reject) => { rejectLate = reject; });
    await assert.rejects(
      run((currentSignal) => {
        signal = currentSignal;
        return late;
      }, 5),
      StrategyResearchStageDeadlineError,
    );
    assert.equal(signal?.aborted, true);
    rejectLate(new Error("late private failure"));
    await new Promise((resolve) => setImmediate(resolve));
  }
});
