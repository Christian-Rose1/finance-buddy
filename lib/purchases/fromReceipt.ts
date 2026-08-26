import type { ReceiptExtraction, ReceiptItem } from "@/lib/receipts/types";
import type { Purchase, PurchaseEvidence, PurchaseItem } from "@/lib/purchases/types";
import {
  createEvidenceProvenance,
  createInferredProvenance,
  type PurchaseFieldProvenance,
} from "@/lib/purchases/provenance";

/**
 * Converts a validated ReceiptExtraction into the canonical Purchase model.
 *
 * Mapping rules:
 * - merchant → merchant
 * - transaction_date → date
 * - total → amount
 * - currency → currency
 * - discount → discount
 * - tax → tax
 * - tip → tip
 * - category: only set when ALL items share the same non-null category
 * - source = "receipt"
 * - sourceConfidence = receipt.confidence
 * - cardId = null (not known at receipt-extraction time)
 *
 * A single PurchaseEvidence entry is created from the receipt.
 * Field-level provenance is also populated to track how each value was
 * produced.
 */
export interface PurchaseFromReceiptOptions {
  /** Stable Storage identifier for the uploaded receipt object. */
  sourceId?: string;
  /** Storage bucket/path metadata for the uploaded receipt object. */
  storage?: { bucket: string; path: string };
}

export function purchaseFromReceipt(
  receipt: ReceiptExtraction,
  id?: string,
  options?: PurchaseFromReceiptOptions
): Purchase {
  const purchaseId =
    id || `purchase-${receipt.merchant ?? "unknown"}-${receipt.transaction_date ?? "no-date"}-${receipt.source}`;

  // Category: only when every item has the same non-null category.
  const categories = receipt.items
    .map((item) => item.category)
    .filter((c): c is string => c !== null);
  const category =
    categories.length > 0 && categories.every((c) => c === categories[0])
      ? categories[0]
      : null;

  const items: PurchaseItem[] = receipt.items.map((item: ReceiptItem) => ({
    name: item.name,
    quantity: item.quantity,
    unitPrice: item.unit_price,
    total: item.total,
    discount: item.discount,
    category: item.category,
    confidence: item.confidence,
  }));

  // Use the uploaded Storage object identity when available. The Storage path
  // is a stable identifier for this receipt source; otherwise fall back to the
  // generated purchase id for non-Storage usage of the adapter.
  const evidenceSourceId = options?.sourceId ?? purchaseId;
  const evidenceId = `evidence-${evidenceSourceId}`;
  const evidenceMetadata = options?.storage
    ? { bucket: options.storage.bucket, path: options.storage.path }
    : null;

  const evidence: PurchaseEvidence[] = [
    {
      id: evidenceId,
      type: "receipt",
      sourceId: evidenceSourceId,
      sourceName: receipt.source,
      confidence: receipt.confidence,
      // Receipt extraction is evidence-backed but not explicitly verified.
      verified: false,
      metadata: evidenceMetadata,
    },
  ];

  // Build field-level provenance.
  // Extraction ≠ verification: all evidence-backed values default to
  // verificationStatus "unverified".
  const provenance: Record<string, PurchaseFieldProvenance> = {
    merchant: createEvidenceProvenance(
      "merchant",
      [evidenceId],
      receipt.confidence,
      "receipt-extraction"
    ),
    date: createEvidenceProvenance(
      "date",
      [evidenceId],
      receipt.confidence,
      "receipt-extraction"
    ),
    amount: createEvidenceProvenance(
      "amount",
      [evidenceId],
      receipt.confidence,
      "receipt-extraction"
    ),
    currency: createEvidenceProvenance(
      "currency",
      [evidenceId],
      receipt.confidence,
      "receipt-extraction"
    ),
    source: createEvidenceProvenance(
      "source",
      [evidenceId],
      receipt.confidence,
      "receipt-extraction"
    ),
    sourceConfidence: createEvidenceProvenance(
      "sourceConfidence",
      [evidenceId],
      receipt.confidence,
      "receipt-extraction"
    ),
    discount: createEvidenceProvenance(
      "discount",
      [evidenceId],
      receipt.confidence,
      "receipt-extraction"
    ),
    tax: createEvidenceProvenance(
      "tax",
      [evidenceId],
      receipt.confidence,
      "receipt-extraction"
    ),
    tip: createEvidenceProvenance(
      "tip",
      [evidenceId],
      receipt.confidence,
      "receipt-extraction"
    ),
  };

  // Category is inferred from item-level categories, not directly
  // extracted from the receipt.
  if (category !== null) {
    provenance.category = createInferredProvenance(
      "category",
      [evidenceId],
      1,
      "deterministic-category-rule"
    );
  }

  return {
    id: purchaseId,
    merchant: receipt.merchant,
    date: receipt.transaction_date,
    amount: receipt.total,
    currency: receipt.currency,
    category,
    source: "receipt",
    sourceConfidence: receipt.confidence,
    cardId: null,
    items,
    discount: receipt.discount,
    tax: receipt.tax,
    tip: receipt.tip,
    fees: null,
    evidence,
    provenance,
    metadata: null,
  };
}
