/**
 * Purchase provenance types and helpers.
 *
 * This module tracks the source and trustworthiness of individual field values
 * on a Purchase. It does NOT modify the Purchase, PurchaseEvidence, or
 * PurchaseItem types — it is a sidecar provenance record that can be assembled
 * alongside any Purchase to record where each field's value came from.
 */

/**
 * The origin of a value on a Purchase.
 */
export type PurchaseValueOrigin =
  | "evidence"
  | "inferred"
  | "calculated"
  | "manual";

/**
 * Whether a value has been explicitly verified.
 *
 * **"verified"** means the value has been explicitly confirmed by a human or an
 * authoritative process — e.g., the user reviewed and accepted it.
 *
 * **Simply extracting** a value from a receipt or statement does NOT
 * automatically make it verified. Extraction yields *evidence-backed* data,
 * not *verified* data. Verification is an additional, intentional act.
 */
export type PurchaseVerificationStatus =
  | "unverified"
  | "verified";

/**
 * Tracks the provenance of a single field on a Purchase.
 *
 * Each field on a Purchase that has an auditable origin can be annotated with
 * a `PurchaseFieldProvenance` record. This preserves the distinction between
 * verified evidence, inferred classifications, deterministic calculations, and
 * user-supplied values.
 */
export interface PurchaseFieldProvenance {
  /** The name of the Purchase field this provenance record describes. */
  field: string;
  /** How the value was produced. */
  origin: PurchaseValueOrigin;
  /**
   * IDs of PurchaseEvidence records that support this value.
   *
   * For "evidence" and "inferred" origins, these reference the evidence
   * entries (receipt, statement, etc.) that the value was derived from.
   * May be empty for "manual" values.
   */
  evidenceIds: string[];
  /**
   * Confidence in the value on a 0–1 scale.
   *
   * - Extraction / inference may carry a confidence score from the provider.
   * - Deterministic calculations and manual values may use null (confidence
   *   is not applicable).
   */
  confidence: number | null;
  /**
   * Whether the value has been explicitly verified.
   */
  verificationStatus: PurchaseVerificationStatus;
  /**
   * How the value was produced, e.g. "receipt-extraction",
   * "statement-parser", "deterministic-category-rule", "user-correction".
   * null when the origin alone is sufficient.
   */
  method: string | null;
}

/**
 * Creates provenance for a value **directly supported by source evidence**
 * (e.g., a merchant name or date extracted from a receipt or statement).
 *
 * Defaults to `verificationStatus: "unverified"` — extraction alone does not
 * constitute verification.
 *
 * @param field             - The Purchase field name (e.g., "merchant").
 * @param evidenceIds       - IDs of PurchaseEvidence records that back this value.
 * @param confidence        - Extraction confidence (0–1), or null if unknown.
 * @param method            - How the evidence was extracted (e.g., "receipt-extraction").
 * @param verificationStatus - Defaults to "unverified".
 */
export function createEvidenceProvenance(
  field: string,
  evidenceIds: string[],
  confidence: number | null,
  method: string | null = null,
  verificationStatus: PurchaseVerificationStatus = "unverified"
): PurchaseFieldProvenance {
  return {
    field,
    origin: "evidence",
    evidenceIds,
    confidence,
    verificationStatus,
    method,
  };
}

/**
 * Creates provenance for a value **inferred from evidence** (e.g., a spending
 * category classified from a merchant name).
 *
 * Defaults to `verificationStatus: "unverified"` — inference is not
 * verification.
 *
 * @param field             - The Purchase field name (e.g., "category").
 * @param evidenceIds       - IDs of PurchaseEvidence records that support this inference.
 * @param confidence        - Inference confidence (0–1), or null if unknown.
 * @param method            - How the inference was performed (e.g., "deterministic-category-rule").
 * @param verificationStatus - Defaults to "unverified".
 */
export function createInferredProvenance(
  field: string,
  evidenceIds: string[],
  confidence: number | null,
  method: string | null = null,
  verificationStatus: PurchaseVerificationStatus = "unverified"
): PurchaseFieldProvenance {
  return {
    field,
    origin: "inferred",
    evidenceIds,
    confidence,
    verificationStatus,
    method,
  };
}

/**
 * Creates provenance for a value **produced by deterministic application logic**
 * (e.g., a computed discount, tax total, or best-card comparison).
 *
 * Confidence defaults to `null` — deterministic calculations do not need a
 * confidence score.
 *
 * @param field             - The Purchase field name.
 * @param evidenceIds       - IDs of PurchaseEvidence records the calculation is based on.
 * @param method            - How the calculation was performed (e.g., "deterministic-discount-computation").
 * @param verificationStatus - Defaults to "unverified".
 */
export function createCalculatedProvenance(
  field: string,
  evidenceIds: string[],
  method: string | null = null,
  verificationStatus: PurchaseVerificationStatus = "unverified"
): PurchaseFieldProvenance {
  return {
    field,
    origin: "calculated",
    evidenceIds,
    confidence: null,
    verificationStatus,
    method,
  };
}

/**
 * Creates provenance for a value **explicitly supplied or corrected by the user**.
 *
 * Defaults to `verificationStatus: "verified"` — the user's explicit input is
 * an authoritative act and constitutes explicit verification. Callers can
 * override this default if the manual value should be treated as unverified.
 *
 * @param field              - The Purchase field name.
 * @param method             - How the user supplied the value (e.g., "user-correction", "user-input"). Defaults to "user-correction".
 * @param verificationStatus - Defaults to "verified".
 * @param evidenceIds        - Defaults to [] (user-supplied values may have no evidence backing).
 */
export function createManualProvenance(
  field: string,
  method: string | null = "user-correction",
  verificationStatus: PurchaseVerificationStatus = "verified",
  evidenceIds: string[] = []
): PurchaseFieldProvenance {
  return {
    field,
    origin: "manual",
    evidenceIds,
    confidence: null,
    verificationStatus,
    method,
  };
}
