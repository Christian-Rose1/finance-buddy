/**
 * Wallet benefit persistence repository.
 *
 * Provides read, create, and update operations for user-owned benefit state
 * attached to a user's wallet card. All operations use the cookie-aware server
 * Supabase client and rely on RLS as the security boundary plus a DB trigger
 * that guarantees the wallet_card belongs to the same user.
 *
 * `user_id` is always taken from the explicit `userId` argument; any value
 * supplied by the caller in the input payload is ignored.
 *
 * The shared product-level benefit definition (the catalog `product_benefits`)
 * is NOT written here. Only the per-user state rows are managed by this module.
 */

import { createServerClient } from "@/lib/supabase-server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { WalletBenefit } from "./types";
import type { ProductBenefit } from "@/lib/rewards/catalogTypes";
import { getProductBenefits } from "@/lib/rewards/catalogRepository";

/** Fields required to create a persisted user benefit state row. */
export interface CreateWalletBenefitInput {
  /** The user's wallet card this benefit belongs to. */
  walletCardId: string;

  /** The shared catalog product_benefit this user state is derived from. */
  productBenefitId: string;

  active?: boolean;
  activatedAt?: string | null;
  expiresAt?: string | null;
  remainingValue?: number | null;
  usedValue?: number;
  metadata?: Record<string, unknown> | null;
}

/** Fields allowed when updating a persisted user benefit state row. */
export interface UpdateWalletBenefitInput {
  active?: boolean;
  activatedAt?: string | null;
  expiresAt?: string | null;
  remainingValue?: number | null;
  usedValue?: number;
  metadata?: Record<string, unknown> | null;
}

/** Maps a wallet_benefits row (snake_case) to a WalletBenefit (camelCase). */
function toWalletBenefit(row: Record<string, unknown>): WalletBenefit {
  return {
    id: row.id as string,
    walletCardId: (row.wallet_card_id as string) ?? "",
    productBenefitId: (row.product_benefit_id as string) ?? "",
    active: (row.active as boolean) ?? true,
    activatedAt: (row.activated_at as string | null) ?? null,
    expiresAt: (row.expires_at as string | null) ?? null,
    remainingValue: parseNumeric(row.remaining_value),
    usedValue: parseNumeric(row.used_value) ?? 0,
    metadata: (row.metadata as Record<string, unknown> | null) ?? null,
  };
}

/** Parses a numeric DB value to a number, or null. */
function parseNumeric(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  if (Number.isNaN(parsed)) return null;
  return parsed;
}

/** Maps a create/update input to a snake_case payload for inserts/updates. */
function toRowPayload(
  input: CreateWalletBenefitInput | UpdateWalletBenefitInput
): Record<string, unknown> {
  const payload: Record<string, unknown> = {};

  if ("walletCardId" in input && input.walletCardId !== undefined) {
    payload.wallet_card_id = input.walletCardId;
  }
  if ("productBenefitId" in input && input.productBenefitId !== undefined) {
    payload.product_benefit_id = input.productBenefitId;
  }
  if ("active" in input && input.active !== undefined) payload.active = input.active;
  if ("activatedAt" in input && input.activatedAt !== undefined) {
    payload.activated_at = input.activatedAt;
  }
  if ("expiresAt" in input && input.expiresAt !== undefined) {
    payload.expires_at = input.expiresAt;
  }
  if ("remainingValue" in input && input.remainingValue !== undefined) {
    payload.remaining_value = input.remainingValue;
  }
  if ("usedValue" in input && input.usedValue !== undefined) {
    payload.used_value = input.usedValue;
  }
  if ("metadata" in input && input.metadata !== undefined) {
    payload.metadata = input.metadata;
  }

  return payload;
}

/**
 * Load all user benefit state rows for a wallet card belonging to an
 * authenticated user.
 *
 * @param walletCardId The wallet card to load benefits for.
 * @param userId The authenticated user id. This is the ONLY source of truth
 *               for ownership.
 * @param client Optional Supabase client for testing; defaults to the
 *               cookie-aware server client.
 */
export async function getWalletBenefitsForCard(
  walletCardId: string,
  userId: string,
  client?: SupabaseClient
): Promise<WalletBenefit[]> {
  const supabase = client ?? await createServerClient();

  const { data: rows, error } = await supabase
    .from("wallet_benefits")
    .select("*")
    .eq("wallet_card_id", walletCardId)
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error("Failed to load wallet benefits.");
  }

  return (rows ?? []).map((row) => toWalletBenefit(row as Record<string, unknown>));
}

/**
 * Load a single wallet benefit state row for an authenticated user.
 *
 * @param benefitId The wallet benefit id to load.
 * @param userId The authenticated user id. This is the ONLY source of truth
 *               for ownership.
 * @param client Optional Supabase client for testing; defaults to the
 *               cookie-aware server client.
 * @returns The WalletBenefit, or null if it does not exist or is not owned by
 *          the user.
 */
export async function getWalletBenefitForUser(
  benefitId: string,
  userId: string,
  client?: SupabaseClient
): Promise<WalletBenefit | null> {
  const supabase = client ?? await createServerClient();

  const { data: row, error } = await supabase
    .from("wallet_benefits")
    .select("*")
    .eq("id", benefitId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    throw new Error("Failed to load wallet benefit.");
  }

  if (!row) {
    return null;
  }

  return toWalletBenefit(row as Record<string, unknown>);
}

/**
 * Persist a new wallet benefit state row for an authenticated user.
 *
 * The `user_id` is set from `userId`; any user_id in the input is ignored.
 * A DB trigger additionally enforces that the referenced wallet_card belongs
 * to the same user.
 *
 * @param input  The benefit state to persist.
 * @param userId The authenticated user id. This is the ONLY source of truth
 *               for ownership.
 * @param client Optional Supabase client for testing; defaults to the
 *               cookie-aware server client.
 * @returns The persisted WalletBenefit, including the generated id.
 */
export async function createWalletBenefit(
  input: CreateWalletBenefitInput,
  userId: string,
  client?: SupabaseClient
): Promise<WalletBenefit> {
  const supabase = client ?? await createServerClient();

  const payload = {
    ...toRowPayload(input),
    user_id: userId,
  };

  const { data: row, error } = await supabase
    .from("wallet_benefits")
    .insert(payload)
    .select()
    .single();

  if (error || !row) {
    throw new Error("Failed to create wallet benefit.");
  }

  return toWalletBenefit(row as Record<string, unknown>);
}

/**
 * Update an existing wallet benefit state row belonging to an authenticated
 * user.
 *
 * @param benefitId The wallet benefit id to update.
 * @param updates The fields to update.
 * @param userId The authenticated user id. This is the ONLY source of truth
 *               for ownership.
 * @param client Optional Supabase client for testing; defaults to the
 *               cookie-aware server client.
 * @returns The updated WalletBenefit.
 * @throws If the benefit row does not exist or is not owned by the user.
 */
export async function updateWalletBenefit(
  benefitId: string,
  updates: UpdateWalletBenefitInput,
  userId: string,
  client?: SupabaseClient
): Promise<WalletBenefit> {
  const supabase = client ?? await createServerClient();

  const payload = {
    ...toRowPayload(updates),
    updated_at: new Date().toISOString(),
  };

  const { data: row, error } = await supabase
    .from("wallet_benefits")
    .update(payload)
    .eq("id", benefitId)
    .eq("user_id", userId)
    .select()
    .single();

  if (error || !row) {
    throw new Error("Failed to update wallet benefit.");
  }

  return toWalletBenefit(row as Record<string, unknown>);
}

/**
 * Delete a wallet benefit state row belonging to an authenticated user.
 *
 * @param benefitId The wallet benefit id to delete.
 * @param userId The authenticated user id. This is the ONLY source of truth
 *               for ownership.
 * @param client Optional Supabase client for testing; defaults to the
 *               cookie-aware server client.
 * @throws If the delete fails.
 */
export async function deleteWalletBenefit(
  benefitId: string,
  userId: string,
  client?: SupabaseClient
): Promise<void> {
  const supabase = client ?? await createServerClient();

  const { error } = await supabase
    .from("wallet_benefits")
    .delete()
    .eq("id", benefitId)
    .eq("user_id", userId);

  if (error) {
    throw new Error("Failed to delete wallet benefit.");
  }
}

// =============================================================================
// Combined read: user benefit state + shared product definition
// =============================================================================

/**
 * Application read shape for the Wallet UI.
 *
 * Deliberately keeps the shared product-level definition separate from the
 * user-specific state. `product` is the catalog ProductBenefit; `state` is the
 * user's WalletBenefit row.
 */
export interface WalletBenefitDisplay {
  /** The shared product-level benefit definition. */
  product: ProductBenefit;

  /** The user-specific benefit state. */
  state: WalletBenefit;
}

/**
 * Load the user's persisted benefit state for a wallet card and rehydrate each
 * with its shared product definition.
 *
 * Flow:
 *   wallet_benefits rows (user-owned)
 *     → distinct product_benefit_id set
 *     → product_benefits definitions (shared catalog)
 *     → joined into a clean display shape per benefit
 *
 * The read is scoped to the authenticated user via RLS and the `userId`
 * boundary. Benefits whose product definition cannot be resolved are skipped so
 * they never render as inferred/partial data.
 *
 * @param walletCardId The wallet card to load benefits for.
 * @param userId The authenticated user id. This is the ONLY source of truth
 *               for ownership.
 * @param client Optional Supabase client for testing; defaults to the
 *               cookie-aware server client.
 */
export async function getWalletBenefitsWithProducts(
  walletCardId: string,
  userId: string,
  client?: SupabaseClient
): Promise<WalletBenefitDisplay[]> {
  const states = await getWalletBenefitsForCard(walletCardId, userId, client);

  if (states.length === 0) {
    return [];
  }

  const definitionIds = Array.from(
    new Set(states.map((s) => s.productBenefitId))
  );

  const products = await getProductBenefits(definitionIds, { activeOnly: false }, client);

  const productById = new Map(products.map((p) => [p.id, p]));

  const displays: WalletBenefitDisplay[] = [];
  for (const state of states) {
    const product = productById.get(state.productBenefitId);
    if (!product) continue;
    displays.push({ product, state });
  }

  return displays;
}
