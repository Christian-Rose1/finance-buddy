/**
 * Wallet card persistence repository.
 *
 * Provides CRUD operations for user-owned wallet cards. All operations use
 * the cookie-aware server Supabase client and rely on RLS as the security
 * boundary. `user_id` is always taken from the explicit `userId` argument;
 * any value supplied by the caller in the input payload is ignored.
 *
 * Development fixture cards (source: "development") live in code and are not
 * stored through this repository.
 */

import { createServerClient } from "@/lib/supabase-server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { WalletCard, WalletCardSource, CardNetwork, RewardCurrency } from "./types";

/** Fields required to create a persisted wallet card. */
export interface CreateWalletCardInput {
  name: string;
  issuer: string;
  network: CardNetwork;
  rewardCurrency: RewardCurrency;
  lastFour: string | null;
  active?: boolean;
  source?: WalletCardSource;
  metadata?: Record<string, unknown> | null;
}

/** Fields allowed when updating a persisted wallet card. */
export interface UpdateWalletCardInput {
  name?: string;
  issuer?: string;
  network?: CardNetwork;
  rewardCurrency?: RewardCurrency;
  lastFour?: string | null;
  active?: boolean;
  source?: WalletCardSource;
  metadata?: Record<string, unknown> | null;
  cardProductId?: string | null;
}

/** Maps a wallet_cards row (snake_case) to a WalletCard (camelCase). */
function toWalletCard(row: Record<string, unknown>): WalletCard {
  return {
    id: row.id as string,
    name: (row.name as string | null) ?? "",
    issuer: (row.issuer as string | null) ?? "",
    network: row.network as CardNetwork,
    rewardCurrency: row.reward_currency as RewardCurrency,
    lastFour: (row.last_four as string | null) ?? null,
    active: row.active as boolean,
    source: row.source as WalletCardSource,
    cardProductId: (row.card_product_id as string | null) ?? null,
  };
}

/** Maps a WalletCard to a snake_case payload for inserts/updates. */
function toRowPayload(
  input: CreateWalletCardInput | UpdateWalletCardInput
): Record<string, unknown> {
  const payload: Record<string, unknown> = {};

  if ("name" in input && input.name !== undefined) payload.name = input.name;
  if ("issuer" in input && input.issuer !== undefined) payload.issuer = input.issuer;
  if ("network" in input && input.network !== undefined) payload.network = input.network;
  if ("rewardCurrency" in input && input.rewardCurrency !== undefined) {
    payload.reward_currency = input.rewardCurrency;
  }
  if ("lastFour" in input && input.lastFour !== undefined) {
    payload.last_four = input.lastFour;
  }
  if ("active" in input && input.active !== undefined) payload.active = input.active;
  if ("source" in input && input.source !== undefined) payload.source = input.source;
  if ("metadata" in input && input.metadata !== undefined) payload.metadata = input.metadata;
  if ("cardProductId" in input && input.cardProductId !== undefined) {
    payload.card_product_id = input.cardProductId;
  }

  return payload;
}

/**
 * Load all wallet cards belonging to an authenticated user.
 *
 * @param userId The authenticated user id. This is the ONLY source of truth
 *               for ownership.
 * @param client Optional Supabase client for testing; defaults to the
 *               cookie-aware server client.
 */
export async function getWalletCardsForUser(
  userId: string,
  client?: SupabaseClient
): Promise<WalletCard[]> {
  const supabase = client ?? await createServerClient();

  const { data: rows, error } = await supabase
    .from("wallet_cards")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error("Failed to load wallet cards.");
  }

  return (rows ?? []).map((row) => toWalletCard(row as Record<string, unknown>));
}

/**
 * Load a single wallet card belonging to an authenticated user.
 *
 * @param cardId The wallet card id to load.
 * @param userId The authenticated user id. This is the ONLY source of truth
 *               for ownership.
 * @param client Optional Supabase client for testing; defaults to the
 *               cookie-aware server client.
 * @returns The WalletCard, or null if it does not exist or is not owned by
 *          the user.
 */
export async function getWalletCardForUser(
  cardId: string,
  userId: string,
  client?: SupabaseClient
): Promise<WalletCard | null> {
  const supabase = client ?? await createServerClient();

  const { data: row, error } = await supabase
    .from("wallet_cards")
    .select("*")
    .eq("id", cardId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    throw new Error("Failed to load wallet card.");
  }

  if (!row) {
    return null;
  }

  return toWalletCard(row as Record<string, unknown>);
}

/**
 * Persist a new wallet card for an authenticated user.
 *
 * The `user_id` is set from `userId`; any user_id in the input is ignored.
 *
 * @param input  The card data to persist.
 * @param userId The authenticated user id. This is the ONLY source of truth
 *               for ownership.
 * @param client Optional Supabase client for testing; defaults to the
 *               cookie-aware server client.
 * @returns The persisted WalletCard, including the generated id.
 */
export async function createWalletCard(
  input: CreateWalletCardInput,
  userId: string,
  client?: SupabaseClient
): Promise<WalletCard> {
  const supabase = client ?? await createServerClient();

  const payload = {
    ...toRowPayload(input),
    user_id: userId,
  };

  const { data: row, error } = await supabase
    .from("wallet_cards")
    .insert(payload)
    .select()
    .single();

  if (error || !row) {
    throw new Error("Failed to create wallet card.");
  }

  return toWalletCard(row as Record<string, unknown>);
}

/**
 * Update an existing wallet card belonging to an authenticated user.
 *
 * @param cardId The wallet card id to update.
 * @param updates The fields to update.
 * @param userId The authenticated user id. This is the ONLY source of truth
 *               for ownership.
 * @param client Optional Supabase client for testing; defaults to the
 *               cookie-aware server client.
 * @returns The updated WalletCard.
 * @throws If the card does not exist or is not owned by the user.
 */
export async function updateWalletCard(
  cardId: string,
  updates: UpdateWalletCardInput,
  userId: string,
  client?: SupabaseClient
): Promise<WalletCard> {
  const supabase = client ?? await createServerClient();

  const payload = {
    ...toRowPayload(updates),
    updated_at: new Date().toISOString(),
  };

  const { data: row, error } = await supabase
    .from("wallet_cards")
    .update(payload)
    .eq("id", cardId)
    .eq("user_id", userId)
    .select()
    .single();

  if (error || !row) {
    throw new Error("Failed to update wallet card.");
  }

  return toWalletCard(row as Record<string, unknown>);
}

/**
 * Delete a wallet card belonging to an authenticated user.
 *
 * @param cardId The wallet card id to delete.
 * @param userId The authenticated user id. This is the ONLY source of truth
 *               for ownership.
 * @param client Optional Supabase client for testing; defaults to the
 *               cookie-aware server client.
 * @throws If the delete fails.
 */
export async function deleteWalletCard(
  cardId: string,
  userId: string,
  client?: SupabaseClient
): Promise<void> {
  const supabase = client ?? await createServerClient();

  const { error } = await supabase
    .from("wallet_cards")
    .delete()
    .eq("id", cardId)
    .eq("user_id", userId);

  if (error) {
    throw new Error("Failed to delete wallet card.");
  }
}

/**
 * Explicitly link or unlink a user's wallet card from a shared card product.
 *
 * Only `card_product_id` is updated. All user-entered fields (name, issuer,
 * network, reward_currency, last_four, metadata) are preserved. Setting
 * `cardProductId` to null removes the link.
 *
 * @param cardId The wallet card id to update.
 * @param productId The card product id to link, or null to unlink.
 * @param userId The authenticated user id. This is the ONLY source of truth
 *               for ownership.
 * @param client Optional Supabase client for testing; defaults to the
 *               cookie-aware server client.
 * @returns The updated WalletCard.
 * @throws If the card does not exist or is not owned by the user.
 */
export async function linkWalletCardToProduct(
  cardId: string,
  productId: string | null,
  userId: string,
  client?: SupabaseClient
): Promise<WalletCard> {
  return updateWalletCard(cardId, { cardProductId: productId }, userId, client);
}
