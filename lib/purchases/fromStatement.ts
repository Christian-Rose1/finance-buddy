import type { Purchase, PurchaseEvidence } from "@/lib/purchases/types";
import type { StatementTransaction } from "@/lib/purchases/statementTypes";
import {
  createEvidenceProvenance,
  createInferredProvenance,
  type PurchaseFieldProvenance,
} from "@/lib/purchases/provenance";

/**
 * Converts a statement transaction into the canonical Purchase model.
 *
 * A statement-based purchase has no item-level detail (items = []).
 * The transaction itself becomes a single PurchaseEvidence entry.
 * Field-level provenance is populated to track how each value was
 * produced.
 */
export interface PurchaseFromStatementOptions {
  /** Stable identifier for this transaction within its source statement. */
  sourceId?: string;
  /** Storage bucket/path metadata for the uploaded statement object. */
  storage?: { bucket: string; path: string };
}

export function purchaseFromStatement(
  transaction: StatementTransaction,
  id?: string,
  options?: PurchaseFromStatementOptions
): Purchase {
  const purchaseId =
    id || `purchase-statement-${transaction.id}`;
  const evidenceSourceId = options?.sourceId ?? transaction.id;
  const evidenceId = `evidence-${evidenceSourceId}`;
  const evidenceMetadata = options?.storage
    ? { bucket: options.storage.bucket, path: options.storage.path }
    : null;

  const evidence: PurchaseEvidence[] = [
    {
      id: evidenceId,
      type: "statement",
      sourceId: evidenceSourceId,
      sourceName: transaction.merchant,
      confidence: transaction.confidence,
      verified: false,
      metadata: evidenceMetadata,
    },
  ];

  // Build field-level provenance.
  // The statement parser is deterministic, but deterministic parsing ≠
  // verification: all evidence-backed values default to "unverified".
  const provenance: Record<string, PurchaseFieldProvenance> = {
    merchant: createEvidenceProvenance(
      "merchant",
      [evidenceId],
      transaction.confidence,
      "statement-parser"
    ),
    date: createEvidenceProvenance(
      "date",
      [evidenceId],
      transaction.confidence,
      "statement-parser"
    ),
    amount: createEvidenceProvenance(
      "amount",
      [evidenceId],
      transaction.confidence,
      "statement-parser"
    ),
    source: createEvidenceProvenance(
      "source",
      [evidenceId],
      transaction.confidence,
      "statement-parser"
    ),
    sourceConfidence: createEvidenceProvenance(
      "sourceConfidence",
      [evidenceId],
      transaction.confidence,
      "statement-parser"
    ),
  };

  // Currency and cardId: include only when non-null.
  // The parser hard-codes these to null; the absence is not supported
  // by the source, so we omit provenance for null values.
  if (transaction.currency !== null) {
    provenance.currency = createEvidenceProvenance(
      "currency",
      [evidenceId],
      transaction.confidence,
      "statement-parser"
    );
  }
  if (transaction.cardId !== null) {
    provenance.cardId = createEvidenceProvenance(
      "cardId",
      [evidenceId],
      transaction.confidence,
      "statement-parser"
    );
  }

  // Category is parser-derived (a deterministic rule applied to the
  // merchant name), not directly read from the statement line.
  if (transaction.category !== null) {
    provenance.category = transaction.categorySource === "statement"
      ? createEvidenceProvenance(
          "category", [evidenceId], transaction.confidence, "statement-parser"
        )
      : createInferredProvenance(
      "category",
      [evidenceId],
      1,
      "deterministic-category-rule"
    );
  }

  return {
    id: purchaseId,
    merchant: transaction.merchant,
    date: transaction.date,
    amount: transaction.amount,
    currency: transaction.currency,
    category: transaction.category,
    source: "statement",
    sourceConfidence: transaction.confidence,
    cardId: transaction.cardId,
    items: [],
    discount: null,
    tax: null,
    tip: null,
    fees: null,
    evidence,
    provenance,
    metadata: null,
  };
}
