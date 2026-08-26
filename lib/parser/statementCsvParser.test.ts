/**
 * Focused tests for the generic statement CSV parser.
 *
 * Run: npx tsx --test lib/parser/statementCsvParser.test.ts
 *
 * The parser auto-detects columns from the header row. These tests pin its
 * behavior against the two verified real-world formats — the Chase activity
 * export and the Apple Card transactions export — plus the generic
 * behaviors shared by any format (dates, amounts, BOM, errors).
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseStatementCsvTransactions } from "./statementCsvParser";
import { toStatementTransaction } from "./toStatementTransaction";

// Chase "Download activity" export shape (real header).
const CHASE_CSV = [
  "Details,Posting Date,Description,Amount,Type,Balance,Check or Slip #",
  "DEBIT,08/01/2026,STARBUCKS STORE 318 SEATTLE WA,-5.65,Sale,-4877.77,",
  'DEBIT,08/03/2026,"SQ * COFFEE SHOP, INC. SAN FRANCISCO CA",-12.34,Sale,-4890.11,',
  "CREDIT,08/05/2026,RETURN - WHOLEFDS MKT 10234,8.99,Credit,-4881.12,",
  "CREDIT,08/02/2026,AUTOPAY PAYMENT - THANK YOU,500.00,Payment,-4377.77,",
  "DEBIT,08/04/2026,LATE FEE,-29.00,Fee,-4919.11,",
  "DEBIT,08/06/2026,INTEREST CHARGED,-1.23,Interest,-4920.34,",
  "DEBIT,08/07/2026,UBER TRIP HELP.UBER.COM CA,-9.99,Pending Sale,-4930.33,",
].join("\n");

// Apple Card transactions export shape (real header and row semantics:
// purchases positive, refunds negative, payments/Daily-Cash/ACH skipped).
const APPLE_CARD_CSV = [
  "Transaction Date,Clearing Date,Description,Merchant,Category,Type,Amount (USD),Purchased By",
  "08/20/2026,08/21/2026,STARBUCKS,Starbucks,Restaurants,Purchase,5.65,Cameron Rosenberger",
  "08/19/2026,08/20/2026,WHOLE FOODS MKT 10234,Whole Foods,Grocery,Purchase,42.10,Cameron Rosenberger",
  "08/18/2026,08/19/2026,RETURN STARBUCKS,Starbucks,Restaurants,Credit,-5.65,Cameron Rosenberger",
  "08/17/2026,08/18/2026,ACH DEPOSIT INTERNET TRANSFER FROM ACCOUNT ENDING IN 6081,Ach Deposit Internet Transfer,Payment,Payment,-500.00,Cameron Rosenberger",
  "06/23/2026,06/24/2026,DAILY CASH ADJUSTMENT,Daily Cash Adjustment,Debit,Debit,0.81,Cameron Rosenberger",
  "09/30/2025,10/01/2025,INTEREST CHARGE,Interest Charge,Interest,Interest,0.85,Cameron Rosenberger",
  "05/05/2026,05/06/2026,ACH DEPOSIT INTERNET TRANSFER FROM ACCOUNT ENDING IN 6081,Ach Deposit Internet Transfer,Other,Other,1831.70,Cameron Rosenberger",
  "12/28/2025,12/29/2025,UBER TRIP HELP.UBER.COM CA,Uber,Transportation,Purchase,9.99,Cameron Rosenberger",
].join("\n");

describe("parseStatementCsvTransactions — Chase activity export", () => {
  it("1. parses Sale rows using the Details column for sign", () => {
    const transactions = parseStatementCsvTransactions(CHASE_CSV);
    const starbucks = transactions.find((tx) =>
      tx.merchant.startsWith("STARBUCKS")
    );

    assert.ok(starbucks);
    assert.equal(starbucks.date, "08/01");
    assert.equal(starbucks.year, 2026);
    assert.equal(starbucks.amount, 5.65);
    assert.equal(starbucks.category, "Dining");
  });

  it("2. skips payment, fee, and interest rows via the Type column", () => {
    const transactions = parseStatementCsvTransactions(CHASE_CSV);
    const merchants = transactions.map((tx) => tx.merchant);

    assert.equal(transactions.length, 4);
    for (const noise of ["AUTOPAY", "LATE FEE", "INTEREST CHARGED"]) {
      assert.ok(
        !merchants.some((merchant) => merchant.includes(noise)),
        `expected ${noise} to be filtered`
      );
    }
  });

  it("3. keeps refunds/credits as negative amounts", () => {
    const transactions = parseStatementCsvTransactions(CHASE_CSV);
    const refund = transactions.find((tx) => tx.merchant.startsWith("RETURN"));

    assert.ok(refund);
    assert.equal(refund.amount, -8.99);
  });

  it("4. handles quoted descriptions containing commas", () => {
    const transactions = parseStatementCsvTransactions(CHASE_CSV);
    const square = transactions.find((tx) => tx.merchant.startsWith("SQ *"));

    assert.ok(square);
    assert.equal(square.merchant, "SQ * COFFEE SHOP, INC. SAN FRANCISCO CA");
    assert.equal(square.amount, 12.34);
  });

  it("5. keeps Pending Sale rows", () => {
    const transactions = parseStatementCsvTransactions(CHASE_CSV);
    const uber = transactions.find((tx) => tx.merchant.startsWith("UBER"));

    assert.ok(uber);
    assert.equal(uber.amount, 9.99);
    assert.equal(uber.category, "Travel / Transportation");
  });
});

describe("parseStatementCsvTransactions — Apple Card export", () => {
  it("6. parses Purchase rows with the Merchant column and Amount (USD)", () => {
    const transactions = parseStatementCsvTransactions(APPLE_CARD_CSV);
    const starbucks = transactions.find(
      (tx) => tx.merchant === "Starbucks" && tx.amount > 0
    );

    assert.ok(starbucks);
    assert.equal(starbucks.date, "08/20");
    assert.equal(starbucks.year, 2026);
    assert.equal(starbucks.amount, 5.65);
    assert.equal(starbucks.category, "Dining");
  });

  it("7. skips Payment, Debit, Interest, and Other rows", () => {
    const transactions = parseStatementCsvTransactions(APPLE_CARD_CSV);
    const merchants = transactions.map((tx) => tx.merchant);

    // Kept: 2 purchases + 1 credit + 1 purchase from 2025.
    assert.equal(transactions.length, 4);
    for (const noise of ["Ach Deposit", "Daily Cash", "Interest Charge"]) {
      assert.ok(
        !merchants.some((merchant) => merchant.includes(noise)),
        `expected ${noise} to be filtered`
      );
    }
  });

  it("8. keeps Credit rows as negative amounts", () => {
    const transactions = parseStatementCsvTransactions(APPLE_CARD_CSV);
    const refund = transactions.find((tx) => tx.merchant === "Starbucks" && tx.amount < 0);

    assert.ok(refund);
    assert.equal(refund.amount, -5.65);
  });

  it("9. supports exports spanning multiple years", () => {
    const transactions = parseStatementCsvTransactions(APPLE_CARD_CSV);
    const uber = transactions.find((tx) => tx.merchant === "Uber");

    assert.ok(uber);
    assert.equal(uber.year, 2025);
    assert.equal(uber.date, "12/28");
  });
});

describe("parseStatementCsvTransactions — generic behaviors", () => {
  it("10. throws for an empty file", () => {
    assert.throws(() => parseStatementCsvTransactions(""), /empty/i);
  });

  it("11. throws a clear error when required columns are missing", () => {
    assert.throws(
      () => parseStatementCsvTransactions("foo,bar,baz\n1,2,3\n"),
      /Unrecognized CSV format/
    );
  });

  it("12. strips a UTF-8 BOM before parsing", () => {
    const transactions = parseStatementCsvTransactions("\uFEFF" + CHASE_CSV);
    assert.equal(transactions.length, 4);
  });

  it("13. supports 2-digit years", () => {
    const twoDigitYear = [
      "Details,Posting Date,Description,Amount,Type,Balance,Check or Slip #",
      "DEBIT,12/31/26,TARGET STORES T-9999,-10.00,Sale,-10.00,",
    ].join("\n");

    const transactions = parseStatementCsvTransactions(twoDigitYear);
    assert.equal(transactions.length, 1);
    assert.equal(transactions[0].year, 2026);
    assert.equal(transactions[0].date, "12/31");
  });

  it("14. supports YYYY-MM-DD dates", () => {
    const isoDates = [
      "Date,Description,Amount",
      "2026-01-05,SAFEWAY 1234,25.50",
    ].join("\n");

    const transactions = parseStatementCsvTransactions(isoDates);
    assert.equal(transactions.length, 1);
    assert.equal(transactions[0].date, "01/05");
    assert.equal(transactions[0].year, 2026);
  });

  it("15. takes amounts as-is when no DEBIT/CREDIT indicator column exists", () => {
    // Without an explicit indicator, exports are assumed to already follow
    // the statement convention (purchases positive, refunds negative).
    const noIndicator = [
      "Posting Date,Description,Amount,Type",
      "08/01/2026,SAFEWAY 1234,25.50,Sale",
    ].join("\n");

    const transactions = parseStatementCsvTransactions(noIndicator);
    assert.equal(transactions.length, 1);
    assert.equal(transactions[0].amount, 25.5);
    assert.equal(transactions[0].category, "Groceries");
  });

  it("16. keeps every row when no Type column exists", () => {
    const noType = [
      "Posting Date,Description,Amount",
      "08/01/2026,SAFEWAY 1234,25.50",
      "08/02/2026,STARBUCKS,5.65",
    ].join("\n");

    const transactions = parseStatementCsvTransactions(noType);
    assert.equal(transactions.length, 2);
  });
});

describe("toStatementTransaction with CSV rows", () => {
  it("builds an ISO date from the row's own year", () => {
    const [transaction] = parseStatementCsvTransactions(CHASE_CSV);
    const statement = toStatementTransaction(transaction, transaction.year);

    assert.equal(statement.date, "2026-08-01");
    assert.equal(statement.merchant, "STARBUCKS STORE 318 SEATTLE WA");
    assert.equal(statement.amount, 5.65);
    assert.equal(statement.confidence, 1);
  });

  it("produces the same stable id as the PDF path for the same transaction", () => {
    const [csvTransaction] = parseStatementCsvTransactions(CHASE_CSV);
    const fromCsv = toStatementTransaction(csvTransaction, csvTransaction.year);

    // The same transaction as it would be parsed from a PDF statement line:
    // MM/DD date plus the statement year detected from the document.
    const fromPdf = toStatementTransaction(
      {
        date: "08/01",
        merchant: "STARBUCKS STORE 318 SEATTLE WA",
        amount: 5.65,
        category: "Dining",
        rawLine: "08/01 STARBUCKS STORE 318 SEATTLE WA 5.65",
      },
      2026
    );

    assert.equal(fromCsv.id, fromPdf.id);
    assert.equal(fromCsv.date, fromPdf.date);
  });
});
