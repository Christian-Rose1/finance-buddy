import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createReceiptImportDraftPayload,
  createStatementImportDraftPayload,
  purchasesFromImportDraft,
  validateImportDraftPayload,
} from "./payload";
import type { ReceiptExtraction } from "@/lib/receipts/types";
import type { StatementTransaction } from "@/lib/purchases/statementTypes";

const userId = "11111111-1111-4111-8111-111111111111";
const digest = "a".repeat(64);

const receipt: ReceiptExtraction = {
  merchant: "Example Market",
  transaction_date: "2026-08-26",
  currency: "USD",
  items: [],
  subtotal: 20,
  tax: 1.6,
  tip: null,
  discount: null,
  total: 21.6,
  confidence: 0.9,
  source: "ollama",
};

const transaction: StatementTransaction = {
  id: "stx-abc123",
  date: "2026-08-20",
  merchant: "Example Cafe",
  amount: 14.25,
  currency: null,
  cardId: null,
  category: "Dining",
  confidence: 1,
};

describe("import draft payloads", () => {
  it("rebuilds a receipt purchase with the content-derived source key", () => {
    const payload = createReceiptImportDraftPayload({
      receipt,
      sourceId: `sha256:${digest}`,
      storagePath: `${userId}/receipt.png`,
    });

    const validated = validateImportDraftPayload("receipt", payload, userId);
    const purchases = purchasesFromImportDraft(validated);

    assert.equal(purchases.length, 1);
    assert.equal(purchases[0].evidence[0].sourceId, `sha256:${digest}`);
    assert.deepEqual(purchases[0].evidence[0].metadata, {
      bucket: "receipts",
      path: `${userId}/receipt.png`,
    });
  });

  it("rebuilds statement purchases with stable per-transaction source keys", () => {
    const payload = createStatementImportDraftPayload({
      transactions: [transaction],
      statementDigest: digest,
      storagePath: `${userId}/statement.pdf`,
    });

    const validated = validateImportDraftPayload("statement", payload, userId);
    const purchases = purchasesFromImportDraft(validated);

    assert.equal(purchases.length, 1);
    assert.equal(
      purchases[0].evidence[0].sourceId,
      `sha256:${digest}:${transaction.id}`
    );
    assert.deepEqual(purchases[0].evidence[0].metadata, {
      bucket: "statements",
      path: `${userId}/statement.pdf`,
    });
  });

  it("rejects storage provenance owned by another customer", () => {
    const payload = createReceiptImportDraftPayload({
      receipt,
      sourceId: `sha256:${digest}`,
      storagePath: "22222222-2222-4222-8222-222222222222/receipt.png",
    });

    assert.throws(
      () => validateImportDraftPayload("receipt", payload, userId),
      /Import draft payload is invalid/
    );
  });

  it("rejects duplicate statement transaction ids", () => {
    const payload = createStatementImportDraftPayload({
      transactions: [transaction, { ...transaction }],
      statementDigest: digest,
      storagePath: null,
    });

    assert.throws(
      () => validateImportDraftPayload("statement", payload, userId),
      /Import draft payload is invalid/
    );
  });

  it("rejects unrecognized client purchase data", () => {
    const payload = {
      ...createReceiptImportDraftPayload({
        receipt,
        sourceId: `sha256:${digest}`,
        storagePath: null,
      }),
      purchases: [{ amount: 1 }],
    };

    assert.throws(
      () => validateImportDraftPayload("receipt", payload, userId),
      /Import draft payload is invalid/
    );
  });

  it("rejects unrecognized nested receipt item fields", () => {
    const payload = {
      version: 1,
      kind: "receipt",
      receipt: {
        ...receipt,
        items: [
          {
            name: "Coffee",
            quantity: 1,
            unit_price: 4.5,
            total: 4.5,
            discount: null,
            category: "Dining",
            confidence: 0.9,
            forgedField: "must not survive validation",
          },
        ],
      },
      sourceId: `sha256:${digest}`,
      storagePath: null,
    };

    assert.throws(
      () => validateImportDraftPayload("receipt", payload, userId),
      /Import draft payload is invalid/
    );
  });

  it("rejects calendar-invalid statement dates", () => {
    const payload = createStatementImportDraftPayload({
      transactions: [{ ...transaction, date: "2026-99-99" }],
      statementDigest: digest,
      storagePath: null,
    });

    assert.throws(
      () => validateImportDraftPayload("statement", payload, userId),
      /Import draft payload is invalid/
    );
  });
});
