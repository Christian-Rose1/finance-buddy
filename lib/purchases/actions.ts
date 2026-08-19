"use server";

/**
 * Minimal server-action layer for manual "card used" confirmation.
 *
 * This is intentionally small. It is NOT a generic evidence framework. It
 * reuses the existing Purchase.provenance model (evidence / inferred /
 * calculated / manual) and the existing RPC path (persist_purchase).
 *
 * Only the `card_id` field and the `provenance.cardId` entry are ever touched.
 * All other provenance keys are preserved.
 */

import { createServerClient } from "@/lib/supabase-server";
import { getPurchaseForUser } from "@/lib/purchases/repository";
import { getWalletCardForUser } from "@/lib/wallet/repository";
import { createManualProvenance } from "@/lib/purchases/provenance";
import { revalidatePath } from "next/cache";
import type { Purchase } from "@/lib/purchases/types";
import type { PurchaseFieldProvenance } from "@/lib/purchases/provenance";

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

  // 2. If cardId is non-null, validate the card.
  if (cardId !== null) {
    const walletCard = await getWalletCardForUser(cardId, userId);
    if (!walletCard) {
      throw new Error("Wallet card not found or not owned by the user.");
    }
    if (!walletCard.active) {
      throw new Error("Wallet card must be active to confirm use.");
    }
    // cardId is valid and owned + active; proceed to write.
  }

  // 3. Re-read the existing provenance from the DB to preserve all other keys.
  const { data: row, error: rowErr } = await supabase
    .from("purchases")
    .select("provenance")
    .eq("id", purchaseId)
    .eq("user_id", userId)
    .maybeSingle();

  if (rowErr) {
    throw new Error("Failed to read current purchase provenance.");
  }

  const existingProvenance: Record<string, PurchaseFieldProvenance> | undefined =
    row?.provenance;

  // ---- Merge the manual/verified cardId provenance ----
  let mergedProvenance: Record<string, PurchaseFieldProvenance> | undefined;

  if (cardId === null) {
    // CLEAR: remove only the cardId provenance key, preserve everything else.
    if (existingProvenance) {
      const { cardId: _, ...rest } = existingProvenance;
      mergedProvenance = rest;
    } else {
      mergedProvenance = undefined;
    }
  } else {
    // SET: merge manual/verified cardId provenance alongside existing keys.
    const cardProv = createManualProvenance(
      "cardId",
      "user-card-confirmation",
      "verified",
      []
    );

    if (existingProvenance) {
      // Shallow merge: keep existing keys, override/add cardId.
      mergedProvenance = {
        ...existingProvenance,
        cardId: cardProv,
      };
    } else {
      mergedProvenance = { cardId: cardProv };
    }
  }

  // ---- Direct RLS-scoped UPDATE on the existing purchase row ----
  // We update ONLY card_id + provenance. No new Purchase is created.
  const { error: updateError } = await supabase
    .from("purchases")
    .update({
      card_id: cardId ?? null,
      provenance: mergedProvenance ?? {},
    })
    .eq("id", purchaseId)
    .eq("user_id", userId);

  if (updateError) {
    throw new Error("Failed to update purchase card confirmation.");
  }

  // 4. Revalidate the Purchase Detail path so the page re-renders with the
  //    saved card_id + provenance on the next request.
  revalidatePath(`/purchases/${purchaseId}`);

  // 5. Re-read the purchase so the caller gets a complete rehydrated object.
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

  // 2. Re-read existing metadata/provenance to preserve all fields
  const { data: row, error: rowErr } = await supabase
    .from("purchases")
    .select("metadata,provenance")
    .eq("id", purchaseId)
    .eq("user_id", userId)
    .maybeSingle();

  if (rowErr) {
    throw new Error("Failed to read current purchase metadata/provenance.");
  }

  const existingMetadata = (row?.metadata as Record<string, unknown>) || {};
  const existingProvenance =
    (row?.provenance as Record<string, PurchaseFieldProvenance>) || {};

  // ---- Merge bookingChannel ----
  let mergedMetadata: Record<string, unknown>;
  let mergedProvenance: Record<string, PurchaseFieldProvenance>;

  if (channel === null) {
    // CLEAR: remove only metadata.bookingChannel
    mergedMetadata = { ...existingMetadata };
    delete mergedMetadata.bookingChannel;

    // CLEAR: remove only provenance.bookingChannel
    mergedProvenance = { ...existingProvenance };
    delete mergedProvenance.bookingChannel;
  } else {
    // SET: add to both metadata and provenance
    mergedMetadata = { ...existingMetadata, bookingChannel: "chase_travel" };
    mergedProvenance = {
      ...existingProvenance,
      bookingChannel: createManualProvenance(
        "bookingChannel",
        "user-booking-channel-confirmation",
        "verified",
        []
      ),
    };
  }

  // ---- Update purchase row ----
  const { error: updateError } = await supabase
    .from("purchases")
    .update({
      metadata: mergedMetadata,
      provenance: mergedProvenance,
    })
    .eq("id", purchaseId)
    .eq("user_id", userId);

  if (updateError) {
    throw new Error("Failed to update purchase booking channel confirmation.");
  }

  // 3. Revalidate path and re-read purchase
  revalidatePath(`/purchases/${purchaseId}`);
  const refreshed = await getPurchaseForUser(purchaseId, userId);
  if (!refreshed) {
    throw new Error("Purchase not found after update.");
  }

  return { purchase: refreshed, confirmed: channel !== null };
}
