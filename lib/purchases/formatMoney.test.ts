import assert from "node:assert/strict";
import { test } from "node:test";
import { formatMoney } from "./formatMoney";

test("formatMoney preserves known currencies without inventing missing currency", () => {
  assert.equal(formatMoney(12.5, "USD"), "$12.50");
  assert.equal(formatMoney(12.5, "eur"), "€12.50");
  assert.equal(formatMoney(-12.5, null), "-12.50 (currency unknown)");
  assert.equal(formatMoney(12.5, ""), "12.50 (currency unknown)");
});
