import assert from "node:assert/strict";
import { test } from "node:test";

import { shouldRunOptionalCardResearch } from "./automatedStrategyPlanner";

test("initial finalization may perform optional card research", () => {
  assert.equal(shouldRunOptionalCardResearch("initial"), true);
});

test("finalization retry skips planning, searches, and card interpretation", () => {
  assert.equal(shouldRunOptionalCardResearch("retry"), false);
});
