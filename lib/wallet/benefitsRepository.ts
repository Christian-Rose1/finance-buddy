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
import {
  getProductBenefit,
  getProductBenefits,
} from "@/lib/rewards/catalogRepository";
import { getWalletCardForUser } from "./repository";

/** Fields required to create a persisted user benefit state row. */
export interface CreateWalletBenefitInput {
  /** The user's wallet card this benefit belongs to. */
  walletCardId: string;

  /** The shared catalog product_benefit this user state is derived from. */
  productBenefitId: string;

  active?: boolean;
  activatedAt?: string | null;
  expiresAt?: string | null;
  periodStart?: string | null;
  periodEnd?: string | null;
  remainingValue?: number | null;
  usedValue?: number;
  metadata?: Record<string, unknown> | null;
}

/** Fields allowed when updating a persisted user benefit state row. */
export interface UpdateWalletBenefitInput {
  active?: boolean;
  activatedAt?: string | null;
  expiresAt?: string | null;
  periodStart?: string | null;
  periodEnd?: string | null;
  remainingValue?: number | null;
  usedValue?: number;
  metadata?: Record<string, unknown> | null;
}

export interface WalletBenefitManagementContext {
  product: ProductBenefit;
  state: WalletBenefit;
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
    periodStart: (row.period_start as string | null) ?? null,
    periodEnd: (row.period_end as string | null) ?? null,
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
  if ("periodStart" in input && input.periodStart !== undefined) {
    payload.period_start = input.periodStart;
  }
  if ("periodEnd" in input && input.periodEnd !== undefined) {
    payload.period_end = input.periodEnd;
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

  const { data: row, error } = await supabase
    .from("wallet_benefits")
    .delete()
    .eq("id", benefitId)
    .eq("user_id", userId)
    .select("id")
    .maybeSingle();

  if (error || !row) {
    throw new Error("Failed to delete wallet benefit.");
  }
}

async function getWalletBenefitForCardProduct(
  walletCardId: string,
  productBenefitId: string,
  userId: string,
  client: SupabaseClient
): Promise<WalletBenefit | null> {
  const { data: row, error } = await client
    .from("wallet_benefits")
    .select("*")
    .eq("wallet_card_id", walletCardId)
    .eq("product_benefit_id", productBenefitId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    throw new Error("Failed to load wallet benefit.");
  }

  return row ? toWalletBenefit(row as Record<string, unknown>) : null;
}

async function requireCardProductBenefit(
  walletCardId: string,
  productBenefitId: string,
  userId: string,
  client: SupabaseClient
): Promise<ProductBenefit> {
  const card = await getWalletCardForUser(walletCardId, userId, client);
  if (!card?.cardProductId) {
    throw new Error("This card is not linked to a catalog product.");
  }

  const product = await getProductBenefit(productBenefitId, client);
  if (!product || product.cardProductId !== card.cardProductId) {
    throw new Error("That benefit is not available for this card.");
  }

  return product;
}

function knownBenefitLimit(product: ProductBenefit): number | null {
  const limit = product.annualLimit ?? product.fixedValue;
  return limit !== null && Number.isFinite(limit) && limit >= 0 ? limit : null;
}

function validateBenefitStateUpdate(
  current: WalletBenefit,
  updates: UpdateWalletBenefitInput,
  product: ProductBenefit
): void {
  const remaining =
    updates.remainingValue !== undefined
      ? updates.remainingValue
      : current.remainingValue;
  const used =
    updates.usedValue !== undefined ? updates.usedValue : current.usedValue;
  const limit = knownBenefitLimit(product);

  if (
    updates.remainingValue !== undefined ||
    updates.usedValue !== undefined
  ) {
    if (remaining !== null && (!Number.isFinite(remaining) || remaining < 0)) {
      throw new Error("Remaining value must be a non-negative number.");
    }
    if (!Number.isFinite(used) || used < 0) {
      throw new Error("Used value must be a non-negative number.");
    }
    if (limit === null && (remaining !== null || used !== 0)) {
      throw new Error("This benefit does not have a catalog value to track.");
    }
    if (
      limit !== null &&
      (remaining === null ||
        remaining > limit ||
        used > limit ||
        remaining + used > limit)
    ) {
      throw new Error("Benefit usage cannot exceed the catalog limit.");
    }
  }

  const periodStart =
    updates.periodStart !== undefined ? updates.periodStart : current.periodStart;
  const periodEnd =
    updates.periodEnd !== undefined ? updates.periodEnd : current.periodEnd;
  if (
    (updates.periodStart !== undefined || updates.periodEnd !== undefined) &&
    periodStart !== null &&
    periodEnd !== null &&
    new Date(periodEnd).getTime() < new Date(periodStart).getTime()
  ) {
    throw new Error("Benefit period end cannot be before its start.");
  }
}

/**
 * Initialize user state from an active benefit definition belonging to the
 * card's currently linked product. Repeated requests return the existing row.
 */
export async function createWalletBenefitFromProduct(
  walletCardId: string,
  productBenefitId: string,
  userId: string,
  client?: SupabaseClient
): Promise<WalletBenefit> {
  const supabase = client ?? await createServerClient();
  const product = await requireCardProductBenefit(
    walletCardId,
    productBenefitId,
    userId,
    supabase
  );
  if (!product.active) {
    throw new Error("This catalog benefit is no longer active.");
  }

  const existing = await getWalletBenefitForCardProduct(
    walletCardId,
    productBenefitId,
    userId,
    supabase
  );
  if (existing) return existing;

  return createWalletBenefit(
    {
      walletCardId,
      productBenefitId,
      active: !product.requiresActivation,
      activatedAt: null,
      expiresAt: null,
      periodStart: null,
      periodEnd: null,
      remainingValue: knownBenefitLimit(product),
      usedValue: 0,
      metadata: null,
    },
    userId,
    supabase
  );
}

/** Resolve and authorize a user benefit against its current wallet-card link. */
export async function getWalletBenefitManagementContext(
  benefitId: string,
  walletCardId: string,
  userId: string,
  client?: SupabaseClient
): Promise<WalletBenefitManagementContext> {
  const supabase = client ?? await createServerClient();
  const state = await getWalletBenefitForUser(benefitId, userId, supabase);
  if (!state || state.walletCardId !== walletCardId) {
    throw new Error("Wallet benefit was not found for this card.");
  }

  const product = await requireCardProductBenefit(
    walletCardId,
    state.productBenefitId,
    userId,
    supabase
  );
  return { product, state };
}

/** Update mutable state only after card, owner, and catalog linkage checks. */
export async function updateWalletBenefitForCard(
  benefitId: string,
  walletCardId: string,
  updates: UpdateWalletBenefitInput,
  userId: string,
  client?: SupabaseClient
): Promise<WalletBenefit> {
  const supabase = client ?? await createServerClient();
  const { product, state } = await getWalletBenefitManagementContext(
    benefitId,
    walletCardId,
    userId,
    supabase
  );
  if (updates.active === true && !product.active) {
    throw new Error("This catalog benefit is no longer active.");
  }

  validateBenefitStateUpdate(state, updates, product);
  return updateWalletBenefit(benefitId, updates, userId, supabase);
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

/** A current card-product definition and its optional user tracking state. */
export interface WalletBenefitOption {
  product: ProductBenefit;
  state: WalletBenefit | null;
}

async function getBenefitDefinitionsForProduct(
  cardProductId: string,
  client: SupabaseClient
): Promise<ProductBenefit[]> {
  const { data: rows, error } = await client
    .from("product_benefits")
    .select("id")
    .eq("card_product_id", cardProductId)
    .order("title", { ascending: true });

  if (error) {
    throw new Error("Failed to load product benefits.");
  }

  const ids = (rows ?? [])
    .map((row) => (row as Record<string, unknown>).id)
    .filter((id): id is string => typeof id === "string");
  return getProductBenefits(ids, { activeOnly: false }, client);
}

/**
 * Load active catalog benefits available to a user's linked card, plus any
 * inactive definition that still has user state so it can be deactivated.
 */
export async function getWalletBenefitOptionsForCard(
  walletCardId: string,
  userId: string,
  client?: SupabaseClient
): Promise<WalletBenefitOption[]> {
  const supabase = client ?? await createServerClient();
  const card = await getWalletCardForUser(walletCardId, userId, supabase);
  if (!card?.cardProductId) return [];

  const [states, products] = await Promise.all([
    getWalletBenefitsForCard(walletCardId, userId, supabase),
    getBenefitDefinitionsForProduct(card.cardProductId, supabase),
  ]);
  const stateByProductId = new Map(
    states.map((state) => [state.productBenefitId, state])
  );

  return products
    .filter((product) => product.active || stateByProductId.has(product.id))
    .map((product) => ({
      product,
      state: stateByProductId.get(product.id) ?? null,
    }))
    .sort((a, b) => a.product.title.localeCompare(b.product.title));
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
  const supabase = client ?? await createServerClient();
  const card = await getWalletCardForUser(walletCardId, userId, supabase);
  if (!card?.cardProductId) {
    return [];
  }

  const states = await getWalletBenefitsForCard(walletCardId, userId, supabase);

  if (states.length === 0) {
    return [];
  }

  const definitionIds = Array.from(
    new Set(states.map((s) => s.productBenefitId))
  );

  const products = await getProductBenefits(
    definitionIds,
    { activeOnly: false },
    supabase
  );

  const productById = new Map(products.map((p) => [p.id, p]));

  const displays: WalletBenefitDisplay[] = [];
  for (const state of states) {
    const product = productById.get(state.productBenefitId);
    if (!product || product.cardProductId !== card.cardProductId) continue;
    displays.push({ product, state });
  }

  return displays;
}
