import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { summarizeSpending } from "./spendingSummary";
import type { Purchase } from "./types";

function purchase(
  amount: number | null,
  currency: string | null,
  category: string | null
): Purchase {
  return {
    id: crypto.randomUUID(),
    merchant: "Merchant",
    date: "2026-08-01",
    amount,
    currency,
    category,
    source: "statement",
    sourceConfidence: 1,
    cardId: null,
    items: [],
    discount: null,
    tax: null,
    tip: null,
    fees: null,
    evidence: [],
    metadata: null,
  };
}

describe("summarizeSpending", () => {
  it("returns no total when there are no finite purchase amounts", () => {
    assert.deepEqual(summarizeSpending([purchase(null, "USD", "Dining")]), {
      status: "empty",
      currency: null,
      total: null,
      categoryTotals: [],
    });
  });

  it("aggregates totals and categories only for one known currency", () => {
    assert.deepEqual(
      summarizeSpending([
        purchase(20, "usd", "Dining"),
        purchase(30, "USD", "Dining"),
        purchase(15, "USD", "Travel"),
      ]),
      {
        status: "single_currency",
        currency: "USD",
        total: 65,
        categoryTotals: [
          { category: "Dining", total: 50 },
          { category: "Travel", total: 15 },
        ],
      }
    );
  });

  it("refuses to combine different currencies", () => {
    const result = summarizeSpending([
      purchase(20, "USD", "Dining"),
      purchase(20, "EUR", "Dining"),
    ]);

    assert.equal(result.status, "mixed_currency");
    assert.equal(result.total, null);
    assert.deepEqual(result.categoryTotals, []);
  });

  it("refuses to aggregate when an included purchase has unknown currency", () => {
    const result = summarizeSpending([
      purchase(20, "USD", "Dining"),
      purchase(20, null, "Travel"),
    ]);

    assert.equal(result.status, "unknown_currency");
    assert.equal(result.total, null);
    assert.deepEqual(result.categoryTotals, []);
  });
});
