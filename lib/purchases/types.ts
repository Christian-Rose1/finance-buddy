import type { PurchaseFieldProvenance } from "./provenance";

/**
 * Unified Purchase data model.
 *
 * This is the canonical downstream purchase object. All receipt/statement/email
 * extractions are converted into this shape. No AI/model-specific fields are
 * embedded. Receipt-specific nuances are mapped away.
 */

export type PurchaseSourceType =
  | "receipt"
  | "statement"
  | "email"
  | "screenshot"
  | "manual";

export type PurchaseEvidenceType =
  | "receipt"
  | "statement"
  | "email"
  | "screenshot"
  | "manual";

/** A piece of evidence linking a purchase to its source. */
export interface PurchaseEvidence {
  id: string;
  type: PurchaseEvidenceType;
  sourceId: string | null;
  sourceName: string | null;
  confidence: number;
  verified: boolean;
  metadata: Record<string, unknown> | null;
}

/** A single item purchased in a transaction. */
export interface PurchaseItem {
  name: string | null;
  quantity: number | null;
  unitPrice: number | null;
  total: number | null;
  discount: number | null;
  category: string | null;
  confidence: number;
}

/** The canonical downstream purchase object. */
export interface Purchase {
  id: string;
  merchant: string | null;
  date: string | null;
  amount: number | null;
  currency: string | null;
  category: string | null;

  source: PurchaseSourceType;
  sourceConfidence: number;

  cardId: string | null;

  items: PurchaseItem[];

  discount: number | null;
  tax: number | null;
  tip: number | null;
  fees: number | null;

  evidence: PurchaseEvidence[];

  metadata: Record<string, unknown> | null;

  /**
   * Field-level provenance: tracks how each field value on the Purchase was
   * produced (evidence-backed, inferred, calculated, or manual) and whether
   * it has been explicitly verified.
   *
   * Keys are field names (e.g., "merchant", "category"). Not every field
   * needs a provenance entry — only those with a meaningful origin.
   */
  provenance?: Record<string, PurchaseFieldProvenance>;
}
