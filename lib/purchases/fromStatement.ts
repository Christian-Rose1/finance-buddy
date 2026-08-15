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
export function purchaseFromStatement(
  transaction: StatementTransaction,
  id?: string
): Purchase {
  const purchaseId =
    id || `purchase-statement-${transaction.id}`;

  const evidence: PurchaseEvidence[] = [
    {
      id: purchaseId,
      type: "statement",
      sourceId: transaction.id,
      sourceName: transaction.merchant,
      confidence: transaction.confidence,
      verified: true,
      metadata: null,
    },
  ];

  // Build field-level provenance.
  // The statement parser is deterministic, but deterministic parsing ≠
  // verification: all evidence-backed values default to "unverified".
  const provenance: Record<string, PurchaseFieldProvenance> = {
    merchant: createEvidenceProvenance(
      "merchant",
      [purchaseId],
      transaction.confidence,
      "statement-parser"
    ),
    date: createEvidenceProvenance(
      "date",
      [purchaseId],
      transaction.confidence,
      "statement-parser"
    ),
    amount: createEvidenceProvenance(
      "amount",
      [purchaseId],
      transaction.confidence,
      "statement-parser"
    ),
    source: createEvidenceProvenance(
      "source",
      [purchaseId],
      transaction.confidence,
      "statement-parser"
    ),
    sourceConfidence: createEvidenceProvenance(
      "sourceConfidence",
      [purchaseId],
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
      [purchaseId],
      transaction.confidence,
      "statement-parser"
    );
  }
  if (transaction.cardId !== null) {
    provenance.cardId = createEvidenceProvenance(
      "cardId",
      [purchaseId],
      transaction.confidence,
      "statement-parser"
    );
  }

  // Category is parser-derived (a deterministic rule applied to the
  // merchant name), not directly read from the statement line.
  if (transaction.category !== null) {
    provenance.category = createInferredProvenance(
      "category",
      [purchaseId],
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
