"use server";

/**
 * Minimal server-action layer for manual "card used" confirmation.
 *
 * This is intentionally small. It is NOT a generic evidence framework. It
 * reuses the existing Purchase.provenance model (evidence / inferred /
 * calculated / manual) and narrow database RPCs for the two confirmation
 * workflows.
 *
 * Only the `card_id` field and the `provenance.cardId` entry are ever touched.
 * All other provenance keys are preserved.
 */

import { createServerClient } from "@/lib/supabase-server";
import { getPurchaseForUser } from "@/lib/purchases/repository";
import { revalidatePath } from "next/cache";
import type { Purchase } from "@/lib/purchases/types";

/** Card-used confirmation result. */
export interface ConfirmPurchaseCardResult {
  /** The persisted Purchase, rehydrated with complete items + evidence. */
  purchase: Purchase;
  /** True when provenance was set to manual+verified; false when cleared. */
  confirmed: boolean;
}

/** Booking channel confirmation result. */
export interface ConfirmPurchaseBookingChannelResult {
  /** The persisted Purchase, rehydrated with complete items + evidence. */
  purchase: Purchase;
  /** True when bookingChannel was set; false when cleared. */
  confirmed: boolean;
}

/**
 * Confirm (or clear) which wallet card was used for a purchase.
 *
 * Rules:
 * - Only active, user-owned wallet cards may be selected.
 * - `cardId` = null clears the confirmation; only the `cardId` provenance key
 *   is removed (all other provenance keys are preserved).
 * - `cardId` = a card id sets card_id + provenance.cardId with origin=manual,
 *   verificationStatus=verified, method="user-card-confirmation", evidenceIds=[].
 * - The purchase's other provenance fields are never touched.
 *
 * @param purchaseId   The purchase id to update.
 * @param cardId       The wallet card id to confirm, or null to clear.
 * @returns The persisted purchase and a flag indicating whether the
 *          confirmation was set (not cleared).
 * @throws If the purchase is not found, or the card is not active / not owned.
 */
export async function confirmPurchaseCardAction(
  purchaseId: string,
  cardId: string | null
): Promise<ConfirmPurchaseCardResult> {
  const supabase = await createServerClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (authError || !user) {
    throw new Error("Authentication required. Please sign in first.");
  }
  const userId = user.id;

  // 1. Load the Purchase through the user-scoped repository path.
  const purchase = await getPurchaseForUser(purchaseId, userId);
  if (!purchase) {
    throw new Error("Purchase not found or does not belong to the user.");
  }

  const { error: updateError } = await supabase.rpc("confirm_purchase_card", {
    p_purchase_id: purchaseId,
    p_card_id: cardId,
  });

  if (updateError) {
    throw new Error("Failed to update purchase card confirmation.");
  }

  // Revalidate the Purchase Detail path so the page re-renders with the
  //    saved card_id + provenance on the next request.
  revalidatePath(`/purchases/${purchaseId}`);

  // Re-read through the ownership-scoped repository so the caller gets the
  // complete normalized purchase and child evidence rows.
  const refreshed = await getPurchaseForUser(purchaseId, userId);
  if (!refreshed) {
    throw new Error("Purchase not found after update.");
  }

  return { purchase: refreshed, confirmed: cardId !== null };
}

/**
 * Confirm (or clear) which booking channel was used for a purchase.
 *
 * Rules:
 * - Only active, user-owned purchases may be updated.
 * - `channel` = "chase_travel" sets metadata.bookingChannel and provenance.bookingChannel
 * - `channel` = null clears only metadata.bookingChannel and provenance.bookingChannel
 * - Other provenance/metadata fields are preserved
 *
 * @param purchaseId   The purchase id to update.
 * @param channel      "chase_travel" or null
 * @returns The persisted purchase and a flag indicating whether the
 *          confirmation was set (not cleared).
 * @throws If the purchase is not found or does not belong to the user.
 */
export async function confirmPurchaseBookingChannelAction(
  purchaseId: string,
  channel: "chase_travel" | null
): Promise<ConfirmPurchaseBookingChannelResult> {
  const supabase = await createServerClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    throw new Error("Authentication required. Please sign in first.");
  }
  const userId = user.id;

  // 1. Load the Purchase through the user-scoped repository path.
  const purchase = await getPurchaseForUser(purchaseId, userId);
  if (!purchase) {
    throw new Error("Purchase not found or does not belong to the user.");
  }

  const { error: updateError } = await supabase.rpc(
    "confirm_purchase_booking_channel",
    {
      p_purchase_id: purchaseId,
      p_channel: channel,
    }
  );

  if (updateError) {
    throw new Error("Failed to update purchase booking channel confirmation.");
  }

  // Revalidate path and re-read purchase
  revalidatePath(`/purchases/${purchaseId}`);
  const refreshed = await getPurchaseForUser(purchaseId, userId);
  if (!refreshed) {
    throw new Error("Purchase not found after update.");
  }

  return { purchase: refreshed, confirmed: channel !== null };
}
