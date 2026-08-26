import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  detectStatementFileFormat,
  parseStatementFile,
  StatementFormatError,
} from "./statementParser";

describe("statement format dispatch", () => {
  it("accepts issuer-neutral CSV without Chase branding", async () => {
    const parsed = await parseStatementFile({
      data: Buffer.from(
        "Date,Description,Amount,Currency\n08/20/2026,Independent Bank Cafe,-7.50,USD\n"
      ),
      mimeType: "text/csv",
      filename: "independent-bank.csv",
    });

    assert.equal(parsed.format, "csv");
    assert.equal(parsed.transactions[0].merchant, "Independent Bank Cafe");
    assert.equal(parsed.transactions[0].amount, -7.5);
  });

  it("dispatches common CSV MIME types and extension-only uploads", () => {
    assert.equal(detectStatementFileFormat("text/csv", "statement.csv"), "csv");
    assert.equal(
      detectStatementFileFormat("application/vnd.ms-excel", "statement.csv"),
      "csv"
    );
    assert.equal(detectStatementFileFormat("", "statement.CSV"), "csv");
    assert.equal(
      detectStatementFileFormat("application/pdf", "statement.pdf"),
      "chase_pdf"
    );
  });

  it("retains hardened Chase PDF parsing through the dispatcher", async () => {
    const parsed = await parseStatementFile(
      {
        data: Buffer.from("%PDF-1.7 mocked"),
        mimeType: "application/pdf",
        filename: "statement.pdf",
      },
      {
        extractPdfText: async () =>
          [
            "JPMorgan Chase Bank, N.A.",
            "ACCOUNT SUMMARY",
            "Statement Date 08/25/2026",
            "08/20 08/21 CORNER MARKET 7.50",
          ].join("\n"),
      }
    );

    assert.equal(parsed.format, "chase_pdf");
    assert.equal(parsed.transactions.length, 1);
    assert.equal(parsed.transactions[0].date, "2026-08-20");
  });

  it("rejects unsupported and MIME-extension-conflicting files", async () => {
    const inputs = [
      { mimeType: "application/json", filename: "statement.json" },
      { mimeType: "application/pdf", filename: "statement.csv" },
      { mimeType: "text/csv", filename: "statement.pdf" },
      { mimeType: "application/vnd.ms-excel", filename: "statement.xls" },
    ];

    for (const input of inputs) {
      await assert.rejects(
        () =>
          parseStatementFile({
            data: Buffer.from("unsupported"),
            ...input,
          }),
        (error: unknown) => {
          assert.ok(error instanceof StatementFormatError);
          assert.equal(error.code, "unsupported_file");
          return true;
        }
      );
    }
  });
});
