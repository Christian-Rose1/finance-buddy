import assert from "node:assert/strict";
import { test } from "node:test";
import {
  formatPersistedStrategyTimestamp,
  normalizePersistedStrategyTimestamp,
  transitionStrategyTimestamp,
} from "./customerSafeStrategyTimestamp";

test("normalizes valid persisted timestamps to canonical ISO", () => {
  assert.equal(
    normalizePersistedStrategyTimestamp("2027-01-02T03:04:05-05:00"),
    "2027-01-02T08:04:05.000Z",
  );
});

test("rejects missing, empty, malformed, and non-string timestamps", () => {
  for (const value of [undefined, null, "", "   ", "not-a-date", 123, {}, []]) {
    assert.equal(normalizePersistedStrategyTimestamp(value), null);
  }
});

test("refresh start and failure preserve the current timestamp", () => {
  const current = "2027-01-02T03:04:05.000Z";
  assert.equal(transitionStrategyTimestamp(current, { type: "refresh_started" }), current);
  assert.equal(transitionStrategyTimestamp(current, { type: "refresh_failed" }), current);
});

test("formats persisted timestamps with deterministic UTC grammar and boundary handling", () => {
  const cases = [
    ["2026-08-26T21:47:00.000Z", "Aug 26, 2026 at 9:47 PM UTC"],
    ["2026-01-01T00:00:00.000Z", "Jan 1, 2026 at 12:00 AM UTC"],
    ["2026-06-15T12:00:00.000Z", "Jun 15, 2026 at 12:00 PM UTC"],
    ["2026-03-02T01:05:00.000Z", "Mar 2, 2026 at 1:05 AM UTC"],
    ["2026-12-31T23:59:00.000Z", "Dec 31, 2026 at 11:59 PM UTC"],
  ] as const;
  for (const [input, label] of cases) {
    assert.deepEqual(formatPersistedStrategyTimestamp(input), { iso: input, label });
  }
  for (const value of [null, undefined, "invalid", ""]) {
    assert.equal(formatPersistedStrategyTimestamp(value), null);
  }
});

test("successful finalization replaces the timestamp only with persisted valid data", () => {
  const current = "2027-01-01T00:00:00.000Z";
  assert.equal(
    transitionStrategyTimestamp(current, {
      type: "finalization_succeeded",
      generatedAt: "2027-01-03T04:05:06+00:00",
    }),
    "2027-01-03T04:05:06.000Z",
  );
  for (const generatedAt of [undefined, null, "", "invalid"]) {
    assert.equal(
      transitionStrategyTimestamp(current, { type: "finalization_succeeded", generatedAt }),
      null,
    );
  }
});
