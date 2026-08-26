import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseCsvStatement } from "./csvStatementParser";

function csv(value: string): Buffer {
  return Buffer.from(value, "utf8");
}

describe("issuer-neutral CSV compatibility", () => {
  it("parses a Chase-shaped export and ignores Type and Memo", () => {
    const transactions = parseCsvStatement(
      csv(
        "Transaction Date,Post Date,Description,Category,Type,Amount,Memo\n" +
          '08/20/2026,08/21/2026,"Corner Market, Inc.",Groceries,Sale,-12.50,"Card purchase, confirmed"\n'
      )
    );

    assert.equal(transactions.length, 1);
    assert.equal(transactions[0].date, "2026-08-20");
    assert.equal(transactions[0].merchant, "Corner Market, Inc.");
    assert.equal(transactions[0].amount, 12.5);
    assert.equal(transactions[0].category, "Groceries");
    assert.equal(transactions[0].currency, null);
  });

  it("parses an Amex-shaped export with Transaction Description", () => {
    const transactions = parseCsvStatement(
      csv(
        "Date,Transaction Description,Card Member,Account #,Amount\n" +
          "08/20/2026,Neighborhood Cafe,A PATEL,-1005,18.75\n"
      )
    );

    assert.equal(transactions.length, 1);
    assert.equal(transactions[0].merchant, "Neighborhood Cafe");
    assert.equal(transactions[0].amount, 18.75);
    assert.equal(transactions[0].currency, null);
  });

  it("parses a Capital One-shaped debit and credit export", () => {
    const transactions = parseCsvStatement(
      csv(
        "Transaction Date,Posted Date,Card No.,Description,Category,Debit,Credit\n" +
          "08/20/2026,08/21/2026,1234,Coffee Shop,Dining,7.25,\n" +
          "08/22/2026,08/23/2026,1234,Merchant Refund,Dining,,3.00\n"
      )
    );

    assert.deepEqual(
      transactions.map(({ date, merchant, amount, category }) => ({
        date,
        merchant,
        amount,
        category,
      })),
      [
        {
          date: "2026-08-20",
          merchant: "Coffee Shop",
          amount: 7.25,
          category: "Dining",
        },
        {
          date: "2026-08-22",
          merchant: "Merchant Refund",
          amount: -3,
          category: "Dining",
        },
      ]
    );
  });

  it("uses Posted Date as the transaction date for a Bank of America-shaped export", () => {
    const transactions = parseCsvStatement(
      csv(
        "Posted Date,Reference Number,Payee,Address,Amount\n" +
          '08/20/2026,ABC123,"Book Store, LLC","1 Main St, Denver",(32.00)\n'
      )
    );

    assert.equal(transactions.length, 1);
    assert.equal(transactions[0].date, "2026-08-20");
    assert.equal(transactions[0].merchant, "Book Store, LLC");
    assert.equal(transactions[0].amount, -32);
    assert.equal(transactions[0].currency, null);
  });

  it("ignores only unique unused columns", () => {
    const transactions = parseCsvStatement(
      csv(
        "Date,Merchant,Amount,Reference Number,Member Name,Address\n" +
          "08/20/2026,Cafe,4.25,REF-1,A PATEL,Denver\n"
      )
    );
    assert.equal(transactions.length, 1);

    assert.throws(() =>
      parseCsvStatement(
        csv(
          "Date,Merchant,Amount,Memo,memo\n" +
            "08/20/2026,Cafe,4.25,first,second\n"
        )
      )
    );
  });
});
