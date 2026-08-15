import type { Purchase } from "@/lib/purchases/types";

/**
 * A deterministic match between two purchases that plausibly represent
 * the same real-world transaction.
 *
 * This is evidence-level matching only — it does NOT merge purchases.
 */
export interface PurchaseMatch {
  /**
   * The ID of the primary purchase in the matched pair.
   * Evidence IDs from both purchases are collected in `evidenceIds`.
   */
  purchaseId: string;
  /** All evidence entry IDs from both purchases involved in the match. */
  evidenceIds: string[];
  /**
   * 1.0 when merchant, date, amount, and known currency all match exactly.
   * 0.9 when merchant, date, and amount match but one currency is null.
   */
  confidence: number;
  /** Human-readable explanation of why the evidence matched. */
  reason: string;
}

/**
 * Normalizes a merchant name for comparison.
 *
 * - case-insensitive (lowercased)
 * - whitespace trimmed from both ends
 * - repeated / collapsed whitespace reduced to a single space
 */
function normalizeMerchant(merchant: string): string {
  return merchant
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

/**
 * Deterministically matches purchases that plausibly represent the same
 * real-world transaction.
 *
 * Matching compares:
 * - merchant: normalized equality (case-insensitive, trimmed, collapsed whitespace)
 * - date: exact match
 * - amount: exact match to cents
 * - currency: if both are non-null, they must match; if one is null, the
 *   match still holds at reduced confidence
 *
 * Pre-filter: a purchase with null merchant, date, or amount is skipped
 * because it cannot be deterministically compared on that axis.
 *
 * @param purchases The purchases to compare (typically from multiple evidence sources).
 * @returns An array of match records, one per matched pair.
 */
export function matchPurchaseEvidence(
  purchases: Purchase[]
): PurchaseMatch[] {
  const matches: PurchaseMatch[] = [];

  for (let i = 0; i < purchases.length; i++) {
    const a = purchases[i];

    // Pre-filter: both purchases must have non-null required fields
    // (merchant, date, amount) to be comparable.
    if (a.merchant === null || a.date === null || a.amount === null) {
      continue;
    }

    const aMerchantNorm = normalizeMerchant(a.merchant);

    for (let j = i + 1; j < purchases.length; j++) {
      const b = purchases[j];

      if (b.merchant === null || b.date === null || b.amount === null) {
        continue;
      }

      const bMerchantNorm = normalizeMerchant(b.merchant);

      // Merchant must match (normalized equality).
      if (aMerchantNorm !== bMerchantNorm) {
        continue;
      }

      // Date must match exactly.
      if (a.date !== b.date) {
        continue;
      }

      // Amount must match exactly to cents.
      if (a.amount !== b.amount) {
        continue;
      }

      // Currency: if both are non-null, they must match.
      // If one is null, do not reject solely because currency is missing.
      if (
        a.currency !== null &&
        b.currency !== null &&
        a.currency !== b.currency
      ) {
        continue;
      }

      // Determine confidence and reason.
      const merchantSnippet = `"${a.merchant}" (normalized: "${aMerchantNorm}")`;
      let confidence: number;
      let reason: string;

      if (a.currency !== null && b.currency !== null) {
        confidence = 1.0;
        reason = `Exact match: merchant ${merchantSnippet}, date "${a.date}", amount ${a.amount}, currency "${a.currency}" all match exactly.`;
      } else {
        confidence = 0.9;
        const nullSide = a.currency === null ? "first" : "second";
        reason = `Match: merchant ${merchantSnippet}, date "${a.date}", amount ${a.amount} match exactly; currency is null on ${nullSide} purchase, so confidence reduced to 0.9.`;
      }

      // Collect all evidence IDs from both purchases.
      const evidenceIds: string[] = [];
      for (const ev of a.evidence) {
        evidenceIds.push(ev.id);
      }
      for (const ev of b.evidence) {
        evidenceIds.push(ev.id);
      }

      matches.push({
        purchaseId: a.id,
        evidenceIds,
        confidence,
        reason,
      });
    }
  }

  return matches;
}
