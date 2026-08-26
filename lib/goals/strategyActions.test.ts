import assert from "node:assert/strict";
import test from "node:test";
import { isStrategyRevisionStale } from "./strategyRevision";

test("stale-run protection compares the saved strategy to the run revision", () => {
  const runCreatedAt = "2026-08-26T10:00:00.000Z";
  const newerRunGeneratedAt = "2026-08-26T11:00:00.000Z";
  const olderRunContextGeneratedAt = "2026-08-26T09:00:00.000Z";

  assert.equal(
    isStrategyRevisionStale(newerRunGeneratedAt, runCreatedAt),
    true
  );
  assert.equal(
    isStrategyRevisionStale(newerRunGeneratedAt, olderRunContextGeneratedAt),
    true
  );
});
