/**
 * Card product catalog repository.
 *
 * Provides read-only access to the shared catalog tables:
 *   reward_programs
 *   card_products
 *   earning_rules
 *
 * All functions use the cookie-aware authenticated server Supabase client.
 * The catalog is shared, non-user-owned data; ordinary authenticated users may
 * read it but cannot modify it (enforced by RLS). This module deliberately
 * exposes no create/update/delete functions.
 */

import { createServerClient } from "@/lib/supabase-server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  RewardProgram,
  CardProduct,
  EarningRule,
  CardProductSource,
} from "./catalogTypes";
import type { CardNetwork, RewardCurrency } from "@/lib/wallet/types";
import type { CanonicalCategoryKey } from "./categories";

function parseNumeric(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  if (Number.isNaN(parsed)) return null;
  return parsed;
}

function toRewardProgram(row: Record<string, unknown>): RewardProgram {
  return {
    id: row.id as string,
    name: (row.name as string | null) ?? "",
    currency: (row.currency as RewardCurrency) ?? "none",
    family:
      (row.family as RewardProgram["family"]) ??
      "other",
    source: (row.source as CardProductSource) ?? "unknown",
    lastVerifiedAt: (row.last_verified_at as string | null) ?? null,
    metadata: (row.metadata as Record<string, unknown> | null) ?? null,
  };
}

function toCardProduct(row: Record<string, unknown>): CardProduct {
  return {
    id: row.id as string,
    rewardProgramId: (row.reward_program_id as string | null) ?? null,
    issuer: (row.issuer as string | null) ?? "",
    name: (row.name as string | null) ?? "",
    network: (row.network as CardNetwork) ?? "other",
    active: (row.active as boolean | null) ?? true,
    annualFee: parseNumeric(row.annual_fee),
    source: (row.source as CardProductSource) ?? "unknown",
    lastVerifiedAt: (row.last_verified_at as string | null) ?? null,
    metadata: (row.metadata as Record<string, unknown> | null) ?? null,
  };
}

function toEarningRule(row: Record<string, unknown>): EarningRule {
  return {
    id: row.id as string,
    cardProductId: (row.card_product_id as string) ?? "",
    type: (row.type as EarningRule["type"]) ?? "earning_rate",
    eligibleCategory:
      (row.eligible_category as CanonicalCategoryKey | null) ?? null,
    eligibleMerchant: (row.eligible_merchant as string | null) ?? null,
    excludedMerchants: (row.excluded_merchants as string[]) ?? [],
    rewardCurrency: (row.reward_currency as RewardCurrency) ?? "none",
    rewardValue: parseNumeric(row.reward_value) ?? 0,
    percentage: parseNumeric(row.percentage),
    fixedValue: parseNumeric(row.fixed_value),
    explanation: (row.explanation as string | null) ?? "",
    source: (row.source as CardProductSource) ?? "unknown",
    lastVerifiedAt: (row.last_verified_at as string | null) ?? null,
    active: (row.active as boolean | null) ?? true,
    metadata: (row.metadata as Record<string, unknown> | null) ?? null,
  };
}

/**
 * Load all reward programs in the catalog.
 */
export async function getRewardPrograms(
  client?: SupabaseClient
): Promise<RewardProgram[]> {
  const supabase = client ?? await createServerClient();

  const { data: rows, error } = await supabase
    .from("reward_programs")
    .select("*")
    .order("name", { ascending: true });

  if (error) {
    throw new Error("Failed to load reward programs.");
  }

  return (rows ?? []).map((row) => toRewardProgram(row as Record<string, unknown>));
}

/**
 * Load all card products in the catalog, optionally filtered to active ones.
 */
export async function getCardProducts(
  options: { activeOnly?: boolean } = {},
  client?: SupabaseClient
): Promise<CardProduct[]> {
  const supabase = client ?? await createServerClient();

  let query = supabase
    .from("card_products")
    .select("*")
    .order("issuer", { ascending: true })
    .order("name", { ascending: true });

  if (options.activeOnly) {
    query = query.eq("active", true);
  }

  const { data: rows, error } = await query;

  if (error) {
    throw new Error("Failed to load card products.");
  }

  return (rows ?? []).map((row) => toCardProduct(row as Record<string, unknown>));
}

/**
 * Load a single card product by id.
 */
export async function getCardProduct(
  productId: string,
  client?: SupabaseClient
): Promise<CardProduct | null> {
  const supabase = client ?? await createServerClient();

  const { data: row, error } = await supabase
    .from("card_products")
    .select("*")
    .eq("id", productId)
    .maybeSingle();

  if (error) {
    throw new Error("Failed to load card product.");
  }

  if (!row) {
    return null;
  }

  return toCardProduct(row as Record<string, unknown>);
}

/**
 * Load all earning rules for a given card product.
 */
export async function getEarningRulesForProduct(
  productId: string,
  options: { activeOnly?: boolean } = {},
  client?: SupabaseClient
): Promise<EarningRule[]> {
  const supabase = client ?? await createServerClient();

  let query = supabase
    .from("earning_rules")
    .select("*")
    .eq("card_product_id", productId)
    .order("created_at", { ascending: false });

  if (options.activeOnly) {
    query = query.eq("active", true);
  }

  const { data: rows, error } = await query;

  if (error) {
    throw new Error("Failed to load earning rules.");
  }

  return (rows ?? []).map((row) => toEarningRule(row as Record<string, unknown>));
}
