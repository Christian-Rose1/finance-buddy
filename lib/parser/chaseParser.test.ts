import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  detectChaseStatementDateContext,
  detectChaseStatementYear,
  isSupportedChaseStatement,
  parseTransactions,
} from "./chaseParser";

describe("Chase statement capability", () => {
  it("recognizes only text with Chase identity and statement structure", () => {
    assert.equal(
      isSupportedChaseStatement(
        "JPMorgan Chase Bank, N.A.\nACCOUNT SUMMARY\nStatement Date 08/25/2026"
      ),
      true
    );
    assert.equal(
      isSupportedChaseStatement(
        "Another Bank\nACCOUNT SUMMARY\nStatement Date 08/25/2026"
      ),
      false
    );
    assert.equal(isSupportedChaseStatement("CHASE REWARDS ADVERTISEMENT"), false);
  });

  it("does not mistake a Chase merchant on another issuer's statement for Chase identity", () => {
    assert.equal(
      isSupportedChaseStatement(
        [
          "AMERICAN EXPRESS",
          "ACCOUNT SUMMARY",
          "Statement Date 08/25/2026",
          "08/20 CHASE TRAVEL 25.00",
        ].join("\n")
      ),
      false
    );
  });

  it("uses the closing year for a cross-year labeled period", () => {
    const text = "Account Period 12/15/2025 - 01/14/2026";
    assert.deepEqual(detectChaseStatementDateContext(text), {
      closingYear: 2026,
      closingMonth: 1,
    });
    assert.equal(
      detectChaseStatementYear(text),
      2026
    );
  });

  it("accepts valid labeled two- and four-digit dates", () => {
    assert.equal(detectChaseStatementYear("Statement Date: 08/25/26"), 2026);
    assert.equal(detectChaseStatementYear("Closing Date 08/25/2026"), 2026);
  });

  it("rejects impossible labeled dates instead of falling back to the year", () => {
    assert.equal(detectChaseStatementYear("Statement Date: 02/29/2025"), null);
    assert.equal(detectChaseStatementYear("Closing Date: 13/01/2026"), null);
  });

  it("does not infer a statement date from an unrelated bare year", () => {
    assert.equal(
      detectChaseStatementDateContext(
        "JPMorgan Chase Bank, N.A.\nACCOUNT SUMMARY\nCopyright 2026"
      ),
      null
    );
  });
});

describe("parseTransactions", () => {
  it("parses strict Chase rows with an optional posting date and dollar sign", () => {
    const transactions = parseTransactions(
      [
        "08/24 08/25 CORNER MARKET $1,234.56",
        "08/25 COFFEE SHOP 4.25",
        "08/26 08/27 RETURN -$3.50",
      ].join("\n")
    );

    assert.deepEqual(
      transactions.map(({ date, merchant, amount }) => ({
        date,
        merchant,
        amount,
      })),
      [
        { date: "08/24", merchant: "CORNER MARKET", amount: 1234.56 },
        { date: "08/25", merchant: "COFFEE SHOP", amount: 4.25 },
        { date: "08/26", merchant: "RETURN", amount: -3.5 },
      ]
    );
  });

  it("accepts the amount ceiling and drops rows above it", () => {
    const transactions = parseTransactions(
      [
        "08/24 MAXIMUM PURCHASE $9,999,999,999.99",
        "08/25 TOO LARGE $10,000,000,000.00",
        "08/26 TOO NEGATIVE -$10,000,000,000.00",
      ].join("\n")
    );

    assert.deepEqual(
      transactions.map(({ merchant, amount }) => ({ merchant, amount })),
      [{ merchant: "MAXIMUM PURCHASE", amount: 9_999_999_999.99 }]
    );
  });

  it("deduplicates exact extracted rows while preserving near-duplicates", () => {
    const transactions = parseTransactions(
      [
        "08/24 CORNER MARKET 4.25",
        "08/24 CORNER MARKET 4.25",
        "08/24 CORNER MARKET 4.26",
        "08/25 CORNER MARKET 4.25",
      ].join("\n")
    );

    assert.deepEqual(
      transactions.map(({ date, amount }) => ({ date, amount })),
      [
        { date: "08/24", amount: 4.25 },
        { date: "08/24", amount: 4.26 },
        { date: "08/25", amount: 4.25 },
      ]
    );
  });

  it("preserves otherwise identical rows when their posting dates differ", () => {
    const transactions = parseTransactions(
      [
        "08/24 08/25 CORNER MARKET 4.25",
        "08/24 08/26 CORNER MARKET 4.25",
      ].join("\n")
    );

    assert.equal(transactions.length, 2);
  });

  it("drops impossible transaction and posting dates", () => {
    const transactions = parseTransactions(
      [
        "02/30 IMPOSSIBLE DATE 10.00",
        "08/24 13/01 BAD POST DATE 11.00",
        "02/29 LEAP-DAY PURCHASE 12.00",
      ].join("\n")
    );

    assert.equal(transactions.length, 1);
    assert.equal(transactions[0].date, "02/29");
  });

  it("does not parse unsupported prose that merely contains an amount", () => {
    assert.deepEqual(
      parseTransactions("August 25 purchase at Corner Market was $12.00"),
      []
    );
  });
});
