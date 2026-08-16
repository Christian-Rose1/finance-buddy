"use server";

/**
 * Server actions for wallet card management.
 *
 * All actions run on the server, use the cookie-aware authenticated Supabase
 * client, and pass the authenticated user id to the repository. They never
 * accept a user id from the client and never expose service-role credentials.
 */

import { revalidatePath } from "next/cache";
import { createServerClient } from "@/lib/supabase-server";
import {
  createWalletCard,
  updateWalletCard,
  deleteWalletCard,
  linkWalletCardToProduct,
  type CreateWalletCardInput,
  type UpdateWalletCardInput,
} from "./repository";
import {
  validateWalletCardForm,
  formatWalletCardFormErrors,
} from "./validation";
import type { WalletCard } from "./types";

export type WalletActionState =
  | { success: true; card: WalletCard; message?: string }
  | { success: false; error: string };

async function getAuthenticatedUserId(): Promise<string> {
  const supabase = await createServerClient();
  const { data: userData, error: userError } = await supabase.auth.getUser();

  if (userError || !userData.user) {
    throw new Error("You must be signed in to manage your wallet.");
  }

  return userData.user.id;
}

/** Creates a wallet card from validated form data. */
export async function createWalletCardAction(
  _prevState: WalletActionState | null,
  formData: FormData
): Promise<WalletActionState> {
  try {
    const userId = await getAuthenticatedUserId();

    const validation = validateWalletCardForm({
      name: String(formData.get("name") ?? ""),
      issuer: String(formData.get("issuer") ?? ""),
      network: String(formData.get("network") ?? ""),
      rewardCurrency: String(formData.get("rewardCurrency") ?? ""),
      lastFour: String(formData.get("lastFour") ?? ""),
    });

    if (!validation.valid) {
      return {
        success: false,
        error: formatWalletCardFormErrors(validation.errors),
      };
    }

    const input: CreateWalletCardInput = {
      ...validation.data,
      active: true,
      source: "user",
    };

    const card = await createWalletCard(input, userId);
    revalidatePath("/wallet");
    return {
      success: true,
      card,
      message: `${card.name} was added to your wallet.`,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to add card.";
    return { success: false, error: message };
  }
}

/** Updates a wallet card from validated form data. */
export async function updateWalletCardAction(
  _prevState: WalletActionState | null,
  formData: FormData
): Promise<WalletActionState> {
  try {
    const userId = await getAuthenticatedUserId();
    const cardId = String(formData.get("cardId") ?? "");

    if (!cardId) {
      return { success: false, error: "Card identifier is missing." };
    }

    const validation = validateWalletCardForm({
      name: String(formData.get("name") ?? ""),
      issuer: String(formData.get("issuer") ?? ""),
      network: String(formData.get("network") ?? ""),
      rewardCurrency: String(formData.get("rewardCurrency") ?? ""),
      lastFour: String(formData.get("lastFour") ?? ""),
    });

    if (!validation.valid) {
      return {
        success: false,
        error: formatWalletCardFormErrors(validation.errors),
      };
    }

    const updates: UpdateWalletCardInput = {
      ...validation.data,
      source: "user",
    };

    const card = await updateWalletCard(cardId, updates, userId);
    revalidatePath("/wallet");
    return {
      success: true,
      card,
      message: `${card.name} was updated.`,
    };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to update card.";
    return { success: false, error: message };
  }
}

/** Toggles a wallet card's active status. */
export async function toggleWalletCardAction(
  cardId: string,
  active: boolean
): Promise<WalletActionState> {
  try {
    const userId = await getAuthenticatedUserId();

    const card = await updateWalletCard(cardId, { active }, userId);
    revalidatePath("/wallet");
    return {
      success: true,
      card,
      message: `${card.name} is now ${card.active ? "active" : "inactive"}.`,
    };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to update card status.";
    return { success: false, error: message };
  }
}

/** Deletes a wallet card. */
export async function deleteWalletCardAction(
  cardId: string
): Promise<WalletActionState> {
  try {
    const userId = await getAuthenticatedUserId();
    await deleteWalletCard(cardId, userId);
    revalidatePath("/wallet");
    return {
      success: true,
      card: {
        id: cardId,
        name: "",
        issuer: "",
        network: "other",
        rewardCurrency: "none",
        lastFour: null,
        active: false,
        source: "user",
        cardProductId: null,
      },
      message: "Card removed from your wallet.",
    };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to remove card.";
    return { success: false, error: message };
  }
}

/** Explicitly links a user's wallet card to a shared card product. */
export async function linkWalletCardAction(
  cardId: string,
  productId: string | null
): Promise<WalletActionState> {
  try {
    const userId = await getAuthenticatedUserId();

    const card = await linkWalletCardToProduct(cardId, productId, userId);
    revalidatePath("/wallet");
    return {
      success: true,
      card,
      message: productId
        ? `${card.name} linked to catalog product.`
        : `${card.name} unlinked from catalog product.`,
    };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to update card product link.";
    return { success: false, error: message };
  }
}
