import type { Purchase, PurchaseEvidence, PurchaseItem } from "@/lib/purchases/types";

/**
 * Error thrown when two purchases cannot be safely merged because their
 * values conflict in a way that requires human review.
 */
export class PurchaseMergeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PurchaseMergeError";
    // Restore prototype chain for proper instanceof checks (V8).
    Object.setPrototypeOf(this, PurchaseMergeError.prototype);
  }
}

/**
 * Resolves a nullable scalar field with strict conflict checking.
 *
 * - If primaryVal is null, return secondaryVal (may also be null).
 * - If secondaryVal is null, return primaryVal.
 * - If both are non-null and materially different, throw PurchaseMergeError.
 * - If both are non-null and equal, return the value (from primary).
 */
function resolveNonNullConflict<T>(
  primaryVal: T | null,
  secondaryVal: T | null,
  fieldName: string
): T | null {
  if (primaryVal === null) {
    return secondaryVal;
  }
  if (secondaryVal === null) {
    return primaryVal;
  }
  // Both are non-null.
  if (primaryVal !== secondaryVal) {
    throw new PurchaseMergeError(
      `Cannot merge purchases: ${fieldName} conflict — ` +
        `primary has ${JSON.stringify(primaryVal)} but secondary has ${JSON.stringify(secondaryVal)}. ` +
        `Both values are non-null and different. Manual resolution required.`
    );
  }
  return primaryVal;
}

/**
 * Resolves a nullable field preferring the secondary value when non-null.
 * Used for cardId, where the statement purchase typically carries the card ID.
 */
function resolvePreferSecondary<T>(
  primaryVal: T | null,
  secondaryVal: T | null
): T | null {
  if (secondaryVal !== null) {
    return secondaryVal;
  }
  return primaryVal;
}

/**
 * Merges exactly two Purchases into a single Purchase.
 *
 * This is an explicit operation — the caller must identify the two purchases
 * to merge (e.g., via matchPurchaseEvidence results). This function does NOT
 * perform matching.
 *
 * Merge rules:
 *
 * - **id**: always preserved from primary.
 * - **evidence**: combined from both purchases, deduplicated by evidence.id.
 * - **items**: prefer non-empty items over an empty array
 *   (receipt items over statement items = []).
 * - **cardId**: prefer a non-null statement cardId when available.
 * - **merchant / date / amount / currency**: if both non-null and different,
 *   throw PurchaseMergeError; otherwise prefer non-null over null.
 * - **discount / tax / tip / fees**: prefer the non-null value; throw
 *   PurchaseMergeError if both are non-null and materially different.
 * - **category**: prefer a non-null value when the other is null. If both are
 *   non-null but different, preserve primary.category (category inference is
 *   not verified financial evidence).
 * - **source**: always preserves primary.source.
 * - **sourceConfidence**: the higher of the two source confidence values.
 * - **metadata**: preserve primary metadata; fall back to secondary if
 *   primary metadata is null.
 *
 * @param primary   The primary purchase. Its identity (id), source, and
 *                  category are preferred on conflicts.
 * @param secondary The secondary purchase whose evidence and detail
 *                  augment the primary.
 * @returns A merged Purchase.
 * @throws {PurchaseMergeError} When conflicting non-null values cannot be
 *   resolved deterministically.
 */
export function mergePurchases(
  primary: Purchase,
  secondary: Purchase
): Purchase {
  // --- id: always preserve primary ---
  const mergedId = primary.id;

  // --- evidence: combine from both purchases, deduplicate by evidence.id ---
  const evidenceById = new Map<string, PurchaseEvidence>();
  for (const ev of primary.evidence) {
    evidenceById.set(ev.id, ev);
  }
  for (const ev of secondary.evidence) {
    evidenceById.set(ev.id, ev);
  }
  const mergedEvidence: PurchaseEvidence[] = Array.from(evidenceById.values());

  // --- items: prefer non-empty receipt items over empty statement items ---
  const primaryHasItems = primary.items.length > 0;
  const secondaryHasItems = secondary.items.length > 0;
  const mergedItems: PurchaseItem[] = primaryHasItems
    ? primary.items
    : secondaryHasItems
      ? secondary.items
      : [];

  // --- merchant: strict conflict check ---
  const mergedMerchant = resolveNonNullConflict(
    primary.merchant,
    secondary.merchant,
    "merchant"
  );

  // --- date: strict conflict check ---
  const mergedDate = resolveNonNullConflict(
    primary.date,
    secondary.date,
    "date"
  );

  // --- amount: strict conflict check ---
  const mergedAmount = resolveNonNullConflict(
    primary.amount,
    secondary.amount,
    "amount"
  );

  // --- currency: strict conflict check ---
  const mergedCurrency = resolveNonNullConflict(
    primary.currency,
    secondary.currency,
    "currency"
  );

  // --- cardId: prefer non-null statement cardId when available ---
  const mergedCardId = resolvePreferSecondary(
    primary.cardId,
    secondary.cardId
  );

  // --- category: prefer non-null; preserve primary on conflict ---
  const mergedCategory =
    primary.category !== null ? primary.category : secondary.category;

  // --- source: always primary ---
  const mergedSource = primary.source;

  // --- sourceConfidence: higher of the two ---
  const mergedSourceConfidence = Math.max(
    primary.sourceConfidence,
    secondary.sourceConfidence
  );

  // --- discount: strict conflict check ---
  const mergedDiscount = resolveNonNullConflict(
    primary.discount,
    secondary.discount,
    "discount"
  );

  // --- tax: strict conflict check ---
  const mergedTax = resolveNonNullConflict(
    primary.tax,
    secondary.tax,
    "tax"
  );

  // --- tip: strict conflict check ---
  const mergedTip = resolveNonNullConflict(
    primary.tip,
    secondary.tip,
    "tip"
  );

  // --- fees: strict conflict check ---
  const mergedFees = resolveNonNullConflict(
    primary.fees,
    secondary.fees,
    "fees"
  );

  // --- metadata: preserve primary, fall back to secondary ---
  const mergedMetadata =
    primary.metadata !== null ? primary.metadata : secondary.metadata;

  return {
    id: mergedId,
    merchant: mergedMerchant,
    date: mergedDate,
    amount: mergedAmount,
    currency: mergedCurrency,
    category: mergedCategory,
    source: mergedSource,
    sourceConfidence: mergedSourceConfidence,
    cardId: mergedCardId,
    items: mergedItems,
    discount: mergedDiscount,
    tax: mergedTax,
    tip: mergedTip,
    fees: mergedFees,
    evidence: mergedEvidence,
    metadata: mergedMetadata,
  };
}
