import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { calculateSavingsOpportunities } from "./savings";
import type { ReceiptExtraction, ReceiptItem } from "./types";

function makeItem(overrides: Partial<ReceiptItem> = {}): ReceiptItem {
  return {
    name: "Ordinary item",
    quantity: 1,
    unit_price: 20,
    total: 20,
    discount: null,
    category: "Other",
    confidence: 0.95,
    ...overrides,
  };
}

function makeReceipt(
  overrides: Partial<ReceiptExtraction> = {}
): ReceiptExtraction {
  return {
    merchant: "Example Merchant",
    transaction_date: "2026-08-26",
    currency: "USD",
    items: [makeItem()],
    subtotal: 20,
    tax: 1.6,
    tip: null,
    discount: null,
    total: 21.6,
    confidence: 0.95,
    source: "receipt-test",
    ...overrides,
  };
}

describe("calculateSavingsOpportunities", () => {
  it("exposes the receipt-level discount as already saved", () => {
    const result = calculateSavingsOpportunities(
      makeReceipt({ discount: 4.25 })
    );

    assert.deepEqual(result, {
      alreadySaved: 4.25,
      moneyFound: 0,
      opportunities: [],
      cardOptimization: null,
    });
  });

  it("preserves an evidenced zero receipt-level discount", () => {
    const result = calculateSavingsOpportunities(
      makeReceipt({ discount: 0 })
    );

    assert.deepEqual(result, {
      alreadySaved: 0,
      moneyFound: 0,
      opportunities: [],
      cardOptimization: null,
    });
  });

  it("preserves an unknown receipt-level discount as null", () => {
    const result = calculateSavingsOpportunities(
      makeReceipt({ discount: null })
    );

    assert.deepEqual(result, {
      alreadySaved: null,
      moneyFound: 0,
      opportunities: [],
      cardOptimization: null,
    });
  });

  it("does not turn development-offer-shaped items into savings", () => {
    const result = calculateSavingsOpportunities(
      makeReceipt({
        discount: 0,
        items: [
          makeItem({
            name: "Coffee beans",
            total: 50,
            category: "Grocery",
          }),
          makeItem({
            name: "Wireless headphones",
            total: 100,
            category: "Electronics",
          }),
        ],
        subtotal: 150,
        total: 150,
      })
    );

    assert.equal(result.alreadySaved, 0);
    assert.equal(result.moneyFound, 0);
    assert.deepEqual(result.opportunities, []);
    assert.equal(result.cardOptimization, null);
  });

  it("does not infer a receipt-level discount from item discounts", () => {
    const result = calculateSavingsOpportunities(
      makeReceipt({
        discount: 1.5,
        items: [makeItem({ discount: 3 })],
      })
    );

    assert.deepEqual(result, {
      alreadySaved: 1.5,
      moneyFound: 0,
      opportunities: [],
      cardOptimization: null,
    });
  });
});
