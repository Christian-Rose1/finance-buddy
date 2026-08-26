import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { validateReceiptExtraction } from "./schema";

function receipt(transactionDate: string | null) {
  return {
    merchant: "Example Market",
    transaction_date: transactionDate,
    currency: "USD",
    items: [
      {
        name: "Coffee",
        quantity: 1,
        unit_price: 4.5,
        total: 4.5,
        discount: null,
        category: "Dining",
        confidence: 0.9,
      },
    ],
    subtotal: 4.5,
    tax: 0,
    tip: null,
    discount: null,
    total: 4.5,
    confidence: 0.9,
    source: "test",
  };
}

describe("validateReceiptExtraction", () => {
  it("accepts leap day only in a leap year", () => {
    assert.equal(validateReceiptExtraction(receipt("2024-02-29")).success, true);
    assert.equal(validateReceiptExtraction(receipt("2026-02-29")).success, false);
  });

  it("rejects impossible calendar dates", () => {
    assert.equal(validateReceiptExtraction(receipt("2026-04-31")).success, false);
    assert.equal(validateReceiptExtraction(receipt("2026-13-01")).success, false);
  });

  it("rejects unknown nested item fields", () => {
    const value = receipt("2026-08-26");
    value.items[0] = {
      ...value.items[0],
      forged: "not allowed",
    } as typeof value.items[number];

    const result = validateReceiptExtraction(value);
    assert.equal(result.success, false);
    if (!result.success) {
      assert.equal(result.error.path, "items[0]");
    }
  });
});
