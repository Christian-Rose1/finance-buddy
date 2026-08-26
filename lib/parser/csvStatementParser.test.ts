import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CsvStatementParseError,
  parseCsvStatement,
} from "./csvStatementParser";

function csv(value: string): Buffer {
  return Buffer.from(value, "utf8");
}

function assertCsvError(
  code: CsvStatementParseError["code"]
): (error: unknown) => boolean {
  return (error) => {
    assert.ok(error instanceof CsvStatementParseError);
    assert.equal(error.code, code);
    return true;
  };
}

describe("parseCsvStatement", () => {
  it("parses BOM, CRLF, common aliases, and quoted commas", () => {
    const transactions = parseCsvStatement(
      csv(
        '\uFEFFTransaction Date,Posting Date,Merchant,Amount,Currency,Category\r\n' +
          '08/20/2026,08/21/2026,"Corner Market, Inc.","-$1,234.56",usd,"Food, Dining"\r\n'
      )
    );

    assert.deepEqual(transactions, [
      {
        id: transactions[0].id,
        date: "2026-08-20",
        merchant: "Corner Market, Inc.",
        amount: -1234.56,
        currency: "USD",
        cardId: null,
        category: "Food, Dining",
        categorySource: "statement",
        confidence: 1,
      },
    ]);
    assert.match(transactions[0].id, /^stx-[0-9a-f]+$/);
  });

  it("accepts Date, Post Date, and Description aliases with ISO dates", () => {
    const transactions = parseCsvStatement(
      csv("Date,Post Date,Description,Amount\n2026-08-20,2026-08-21,Cafe,+12.50\n")
    );

    assert.equal(transactions[0].date, "2026-08-20");
    assert.equal(transactions[0].merchant, "Cafe");
    assert.equal(transactions[0].amount, 12.5);
    assert.equal(transactions[0].currency, null);
    assert.equal(transactions[0].category, null);
  });

  it("maps debit to positive and credit to negative", () => {
    const transactions = parseCsvStatement(
      csv(
        "Date,Description,Debit,Credit\n" +
          "08/20/2026,Purchase,25.10,\n" +
          "08/21/2026,Refund,,10.00\n"
      )
    );

    assert.deepEqual(
      transactions.map(({ merchant, amount }) => ({ merchant, amount })),
      [
        { merchant: "Purchase", amount: 25.1 },
        { merchant: "Refund", amount: -10 },
      ]
    );
  });

  it("normalizes issuer transaction types without losing refunds", () => {
    const transactions = parseCsvStatement(csv(
      "Date,Description,Type,Amount,Category\n" +
      "08/20/2026,Purchase,Sale,-25.00,Dining\n" +
      "08/21/2026,Refund,Refund,10.00,Dining\n"
    ));
    assert.deepEqual(transactions.map((tx) => tx.amount), [25, -10]);
    assert.equal(transactions[0].categorySource, "statement");
  });

  it("preserves repeated CSV records and gives them stable row identities", () => {
    const input = csv(
      "Date,Merchant,Amount\n" +
        "08/20/2026,Cafe,-4.25\n" +
        "08/20/2026,Cafe,-4.25\n"
    );
    const first = parseCsvStatement(input);
    const second = parseCsvStatement(input);

    assert.equal(first.length, 2);
    assert.notEqual(first[0].id, first[1].id);
    assert.deepEqual(
      first.map((transaction) => transaction.id),
      second.map((transaction) => transaction.id)
    );
  });

  it("includes posting date in identity", () => {
    const transactions = parseCsvStatement(
      csv(
        "Date,Posting Date,Merchant,Amount\n" +
          "08/20/2026,08/21/2026,Cafe,-4.25\n" +
          "08/20/2026,08/22/2026,Cafe,-4.25\n"
      )
    );

    assert.notEqual(transactions[0].id, transactions[1].id);
  });

  it("rejects duplicate normalized and duplicate-role headers", () => {
    assert.throws(
      () => parseCsvStatement(csv("Date, date,Merchant,Amount\n08/20/2026,08/20/2026,Cafe,1.00")),
      assertCsvError("invalid_headers")
    );
    assert.throws(
      () =>
        parseCsvStatement(
          csv(
            "Date,Transaction Date,Merchant,Amount\n08/20/2026,08/20/2026,Cafe,1.00"
          )
        ),
      assertCsvError("invalid_headers")
    );
  });

  it("rejects missing and ambiguous header schemas", () => {
    const invalidHeaders = [
      "Date,Amount\n08/20/2026,1.00",
      "Date,Merchant,Debit\n08/20/2026,Cafe,1.00",
      "Date,Merchant,Amount,Debit,Credit\n08/20/2026,Cafe,1.00,,",
    ];

    for (const value of invalidHeaders) {
      assert.throws(
        () => parseCsvStatement(csv(value)),
        assertCsvError("invalid_headers")
      );
    }
  });

  it("rejects malformed and empty rows", () => {
    assert.throws(
      () => parseCsvStatement(csv('Date,Merchant,Amount\n08/20/2026,"Cafe,1.00')),
      assertCsvError("invalid_csv")
    );
    assert.throws(
      () =>
        parseCsvStatement(
          csv("Date,Merchant,Amount\n08/20/2026,Cafe,1.00\n,,\n")
        ),
      assertCsvError("invalid_row")
    );
  });

  it("requires full calendar-valid transaction and posting dates", () => {
    const invalidDates = [
      "Date,Merchant,Amount\n08/20,Cafe,1.00",
      "Date,Merchant,Amount\n02/29/2025,Cafe,1.00",
      "Date,Posting Date,Merchant,Amount\n08/20/2026,13/01/2026,Cafe,1.00",
    ];

    for (const value of invalidDates) {
      assert.throws(
        () => parseCsvStatement(csv(value)),
        assertCsvError("invalid_row")
      );
    }
  });

  it("rejects ambiguous split amounts and invalid or oversized numbers", () => {
    const invalidAmounts = [
      "Date,Merchant,Debit,Credit\n08/20/2026,Cafe,1.00,2.00",
      "Date,Merchant,Debit,Credit\n08/20/2026,Cafe,,",
      "Date,Merchant,Debit,Credit\n08/20/2026,Cafe,-1.00,",
      "Date,Merchant,Amount\n08/20/2026,Cafe,Infinity",
      "Date,Merchant,Amount\n08/20/2026,Cafe,10000000000.00",
    ];

    for (const value of invalidAmounts) {
      assert.throws(
        () => parseCsvStatement(csv(value)),
        assertCsvError("invalid_row")
      );
    }
  });

  it("rejects unknown currency codes", () => {
    assert.throws(
      () =>
        parseCsvStatement(
          csv("Date,Merchant,Amount,Currency\n08/20/2026,Cafe,1.00,ZZZ")
        ),
      assertCsvError("invalid_row")
    );
  });

  it("rejects a dollar-prefixed amount paired with a non-dollar currency", () => {
    assert.throws(
      () =>
        parseCsvStatement(
          csv("Date,Merchant,Amount,Currency\n08/20/2026,Cafe,$1.00,EUR")
        ),
      assertCsvError("invalid_row")
    );
  });
});
