import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ParsedTransaction } from "./chaseParser";
import {
  StatementTransactionConversionError,
  toStatementTransaction,
} from "./toStatementTransaction";

function transaction(overrides: Partial<ParsedTransaction> = {}): ParsedTransaction {
  return {
    date: "08/25",
    merchant: "CORNER MARKET",
    amount: 12.34,
    category: "Groceries",
    rawLine: "08/25 CORNER MARKET 12.34",
    ...overrides,
  };
}

describe("toStatementTransaction", () => {
  it("constructs a calendar-valid ISO date and stable year-specific id", () => {
    const first = toStatementTransaction(transaction(), 2026);
    const repeated = toStatementTransaction(transaction(), 2026);
    const nextYear = toStatementTransaction(transaction(), 2027);

    assert.equal(first.date, "2026-08-25");
    assert.equal(first.id, repeated.id);
    assert.notEqual(first.id, nextYear.id);
  });

  it("rejects leap day in a non-leap statement year", () => {
    assert.throws(
      () => toStatementTransaction(transaction({ date: "02/29" }), 2025),
      StatementTransactionConversionError
    );
  });

  it("assigns late-year transactions to the prior year on a January close", () => {
    const december = toStatementTransaction(
      transaction({ date: "12/29" }),
      2026,
      1
    );
    const january = toStatementTransaction(
      transaction({ date: "01/02" }),
      2026,
      1
    );

    assert.equal(december.date, "2025-12-29");
    assert.equal(january.date, "2026-01-02");
  });

  it("rejects invalid years and blank merchants", () => {
    assert.throws(
      () => toStatementTransaction(transaction(), 1999),
      StatementTransactionConversionError
    );
    assert.throws(
      () => toStatementTransaction(transaction({ merchant: "   " }), 2026),
      StatementTransactionConversionError
    );
    assert.throws(
      () => toStatementTransaction(transaction(), 2026, 13),
      StatementTransactionConversionError
    );
  });
});
