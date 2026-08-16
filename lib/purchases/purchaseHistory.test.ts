/**
 * Focused tests for the Purchase History browsing helpers.
 *
 * Run with: npx tsx --test lib/purchases/purchaseHistory.test.ts
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Purchase } from "@/lib/purchases/types";
import {
  PURCHASE_HISTORY_PAGE_SIZE,
  filterPurchases,
  getDistinctCategories,
  getVisiblePurchases,
} from "./purchaseHistory";

function makePurchase(overrides: Partial<Purchase> = {}): Purchase {
  return {
    id: "purchase-1",
    merchant: "Merchant",
    date: "2026-01-01",
    amount: 100,
    currency: "USD",
    category: null,
    source: "receipt",
    sourceConfidence: 1,
    cardId: null,
    items: [],
    discount: null,
    tax: null,
    tip: null,
    fees: null,
    evidence: [],
    metadata: null,
    ...overrides,
  };
}

describe("filterPurchases", () => {
  const purchases = [
    makePurchase({ id: "p1", merchant: "Clementines LOHI Denver CO", category: "Dining", source: "statement" }),
    makePurchase({ id: "p2", merchant: "Walmart Supercenter", category: "Groceries", source: "receipt" }),
    makePurchase({ id: "p3", merchant: "United Airlines", category: "Travel / Transportation", source: "statement" }),
    makePurchase({ id: "p4", merchant: "Clementines LOHI Denver CO", category: "Dining", source: "receipt" }),
  ];

  it("returns all purchases when no filters are applied", () => {
    const result = filterPurchases(purchases, { search: "", category: "", source: "all" });
    assert.equal(result.length, 4);
  });

  it("filters by merchant search (case-insensitive substring)", () => {
    const result = filterPurchases(purchases, { search: "clementines", category: "", source: "all" });
    assert.deepEqual(result.map((p) => p.id), ["p1", "p4"]);
  });

  it("trims surrounding whitespace from the search term", () => {
    const result = filterPurchases(purchases, { search: "  walmart  ", category: "", source: "all" });
    assert.deepEqual(result.map((p) => p.id), ["p2"]);
  });

  it("filters by exact persisted/legacy category value", () => {
    const result = filterPurchases(purchases, { search: "", category: "Dining", source: "all" });
    assert.deepEqual(result.map((p) => p.id), ["p1", "p4"]);
  });

  it("filters by source", () => {
    const result = filterPurchases(purchases, { search: "", category: "", source: "receipt" });
    assert.deepEqual(result.map((p) => p.id), ["p2", "p4"]);
  });

  it("combines search, category, and source filters", () => {
    const result = filterPurchases(purchases, { search: "clementines", category: "Dining", source: "receipt" });
    assert.deepEqual(result.map((p) => p.id), ["p4"]);
  });

  it("returns an empty list when nothing matches", () => {
    const result = filterPurchases(purchases, { search: "nonexistent merchant", category: "", source: "all" });
    assert.deepEqual(result, []);
  });

  it("preserves the original (newest-first) order", () => {
    const result = filterPurchases(purchases, { search: "", category: "", source: "all" });
    assert.deepEqual(result.map((p) => p.id), ["p1", "p2", "p3", "p4"]);
  });
});

describe("getDistinctCategories", () => {
  it("returns sorted distinct non-null categories", () => {
    const purchases = [
      makePurchase({ category: "Dining" }),
      makePurchase({ category: "Groceries" }),
      makePurchase({ category: "Dining" }),
      makePurchase({ category: null }),
      makePurchase({ category: "Travel / Transportation" }),
    ];
    assert.deepEqual(getDistinctCategories(purchases), ["Dining", "Groceries", "Travel / Transportation"]);
  });

  it("returns an empty array when there are no categories", () => {
    assert.deepEqual(getDistinctCategories([]), []);
    assert.deepEqual(getDistinctCategories([makePurchase({ category: null })]), []);
  });
});

describe("getVisiblePurchases", () => {
  const purchases = Array.from({ length: 25 }, (_, i) => makePurchase({ id: `p${i}` }));

  it("returns the first visibleCount purchases", () => {
    const result = getVisiblePurchases(purchases, PURCHASE_HISTORY_PAGE_SIZE);
    assert.equal(result.length, PURCHASE_HISTORY_PAGE_SIZE);
    assert.equal(result[0].id, "p0");
    assert.equal(result[PURCHASE_HISTORY_PAGE_SIZE - 1].id, "p9");
  });

  it("returns all purchases when visibleCount exceeds the list length", () => {
    const result = getVisiblePurchases(purchases, 100);
    assert.equal(result.length, 25);
  });

  it("returns an empty list for a non-positive visibleCount", () => {
    assert.deepEqual(getVisiblePurchases(purchases, 0), []);
    assert.deepEqual(getVisiblePurchases(purchases, -5), []);
  });
});