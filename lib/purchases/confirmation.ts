/**
 * Minimal "Confirmation & Evidence" layer — F1: which card was actually used.
 *
 * This is intentionally small. It is NOT a generic evidence framework. It
 * reuses the existing Purchase.provenance model (evidence / inferred /
 * calculated / manual) and the existing `verified` semantics.
 *
 * IMPORTANT: `confirmCardUsed` matches a **card** identifier (a credit-card
 * issuer/printed last four from card-specific evidence) against an active
 * WalletCard's `lastFour`. A bank statement ACCOUNT NUMBER is a different
 * identifier and must NEVER be passed here — matching an account number
 * against a card last-four would be incorrect. Card-used confirmation requires
 * exact card-specific evidence; absent or ambiguous evidence leaves cardId
 * null (we never guess).
 */

import type { PurchaseFieldProvenance } from "./provenance";
import { createEvidenceProvenance } from "./provenance";

/** The facts this layer can confirm. Currently only card usage. */
export type ConfirmableFact = "card_used";

/**
 * A confirmed fact about a Purchase.
 *
 * `value` carries the fact's payload — for `card_used` it is the wallet card
 * id. When no unambiguous match exists, `confirmCardUsed` returns null rather
 * than a low-confidence guess.
 */
export interface PurchaseConfirmation {
  fact: ConfirmableFact;
  value: string;
  /** Reuses the existing provenance origin vocabulary. */
  origin: "evidence" | "manual";
  /** Reuses the existing verification semantics; evidence is not verified. */
  verified: boolean;
  reason: string;
}

/**
 * Confirm the card actually used from exact card-specific evidence (a genuine
 * credit-card last-four).
 *
 * - Exactly one active card with a matching lastFour → confirmed.
 * - Zero matches → null (do not guess).
 * - Multiple active cards share the lastFour → null (ambiguous; do not guess).
 *
 * Inactive cards never participate.
 *
 * NOTE: Pass only a CARD last-four here, never a bank statement account
 * number. A statement account number is a different identifier and must not be
 * compared to a card's last four.
 *
 * @param lastFour    The card's last four digits from card-specific evidence.
 * @param activeCards The authenticated user's ACTIVE wallet cards.
 * @returns A `card_used` confirmation, or null when no unambiguous match.
 */
export function confirmCardUsed(
  lastFour: string,
  activeCards: { id: string; lastFour: string | null }[]
): PurchaseConfirmation | null {
  const matches = activeCards.filter((card) => card.lastFour === lastFour);

  if (matches.length !== 1) {
    return null;
  }

  return {
    fact: "card_used",
    value: matches[0].id,
    origin: "evidence",
    verified: false,
    reason: `Card last-four (${lastFour}) matched exactly one active wallet card.`,
  };
}

/** The wallet card id carried by a confirmation, or null when none. */
export function confirmationCardId(
  confirmation: PurchaseConfirmation | null
): string | null {
  return confirmation ? confirmation.value : null;
}

/**
 * Build the PurchaseFieldProvenance entry for a confirmed `cardId`.
 *
 * The card is identified from exact card-specific evidence, so it is
 * evidence-backed but NOT verified (verification is an additional, intentional
 * act). The match reason is preserved in `method` so the consumer can explain
 * why the card was chosen without inventing data.
 */
export function cardUsedProvenance(
  confirmation: PurchaseConfirmation,
  evidenceId: string
): PurchaseFieldProvenance {
  return createEvidenceProvenance(
    "cardId",
    [evidenceId],
    null,
    confirmation.reason,
    "unverified"
  );
}