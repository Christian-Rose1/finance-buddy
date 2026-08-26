import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { purchaseFromStatement } from "./fromStatement";
import type { StatementTransaction } from "./statementTypes";

const transaction: StatementTransaction = {
  id: "stx-123",
  date: "2026-08-01",
  merchant: "Example Merchant",
  amount: 42.5,
  currency: null,
  cardId: null,
  category: "Dining",
  confidence: 1,
};

describe("purchaseFromStatement", () => {
  it("uses the supplied import source and preserves storage provenance", () => {
    const purchase = purchaseFromStatement(transaction, undefined, {
      sourceId: "sha256:digest:stx-123",
      storage: {
        bucket: "statements",
        path: "user-1/statement.pdf",
      },
    });

    assert.equal(purchase.evidence[0].sourceId, "sha256:digest:stx-123");
    assert.deepEqual(purchase.evidence[0].metadata, {
      bucket: "statements",
      path: "user-1/statement.pdf",
    });
  });

  it("keeps parsed statement evidence unverified", () => {
    const purchase = purchaseFromStatement(transaction);

    assert.equal(purchase.evidence[0].verified, false);
    assert.equal(
      purchase.provenance?.merchant.verificationStatus,
      "unverified"
    );
  });

  it("preserves a CSV-supplied category as evidence provenance", () => {
    const purchase = purchaseFromStatement({ ...transaction, categorySource: "statement" });
    assert.equal(purchase.provenance?.category.origin, "evidence");
    assert.equal(purchase.provenance?.category.method, "statement-parser");
    assert.equal(purchase.provenance?.category.evidenceIds[0], purchase.evidence[0].id);
  });
});
