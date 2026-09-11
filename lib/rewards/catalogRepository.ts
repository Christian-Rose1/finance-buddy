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
  ProductBenefit,
  CardProductSource,
} from "./catalogTypes";
import type {
  AirportRegionEntry,
  AwardPriceBenchmark,
  VerifiedTransferPartner,
} from "./awardBenchmarks";
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

function toProductBenefit(row: Record<string, unknown>): ProductBenefit {
  return {
    id: row.id as string,
    cardProductId: (row.card_product_id as string) ?? "",
    type: (row.type as ProductBenefit["type"]) ?? "other",
    title: (row.title as string | null) ?? "",
    description: (row.description as string | null) ?? null,
    eligibleCategory: (row.eligible_category as string | null) ?? null,
    eligibleMerchant: (row.eligible_merchant as string | null) ?? null,
    fixedValue: parseNumeric(row.fixed_value),
    annualLimit: parseNumeric(row.annual_limit),
    periodType: (row.period_type as ProductBenefit["periodType"]) ?? "none",
    requiresActivation: (row.requires_activation as boolean | null) ?? false,
    source: (row.source as CardProductSource) ?? "unknown",
    lastVerifiedAt: (row.last_verified_at as string | null) ?? null,
    active: (row.active as boolean | null) ?? true,
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
 * Load a single product benefit definition by id.
 */
export async function getProductBenefit(
  benefitId: string,
  client?: SupabaseClient
): Promise<ProductBenefit | null> {
  const supabase = client ?? await createServerClient();

  const { data: row, error } = await supabase
    .from("product_benefits")
    .select("*")
    .eq("id", benefitId)
    .maybeSingle();

  if (error) {
    throw new Error("Failed to load product benefit.");
  }

  if (!row) {
    return null;
  }

  return toProductBenefit(row as Record<string, unknown>);
}

/**
 * Load product benefit definitions by a set of ids, optionally filtered to
 * active product-level benefits.
 */
export async function getProductBenefits(
  ids: string[],
  options: { activeOnly?: boolean } = {},
  client?: SupabaseClient
): Promise<ProductBenefit[]> {
  const supabase = client ?? await createServerClient();

  if (ids.length === 0) {
    return [];
  }

  let query = supabase
    .from("product_benefits")
    .select("*")
    .in("id", ids);

  if (options.activeOnly) {
    query = query.eq("active", true);
  }

  const { data: rows, error } = await query;

  if (error) {
    throw new Error("Failed to load product benefits.");
  }

  return (rows ?? []).map((row) => toProductBenefit(row as Record<string, unknown>));
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

/**
 * Load all earning rules for a set of card products in a single query.
 * Empty input short-circuits with an empty result (no database round trip).
 */
export async function getEarningRulesForProducts(
  productIds: string[],
  options: { activeOnly?: boolean } = {},
  client?: SupabaseClient
): Promise<EarningRule[]> {
  if (productIds.length === 0) {
    return [];
  }

  const supabase = client ?? await createServerClient();

  let query = supabase
    .from("earning_rules")
    .select("*")
    .in("card_product_id", productIds)
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

// ---------------------------------------------------------------------------
// Award benchmarks (R2): airport regions, transfer partners, price benchmarks.
// All trust gating (verification, validity windows, enum checks) happens in
// lib/rewards/awardBenchmarks.ts; these loaders only map rows faithfully.
// ---------------------------------------------------------------------------

/**
 * Load every airport -> region mapping row. Insertion order is the stable
 * order the region map is built from.
 */
export async function getAirportRegionEntries(
  client?: SupabaseClient
): Promise<AirportRegionEntry[]> {
  const supabase = client ?? await createServerClient();

  const { data: rows, error } = await supabase
    .from("airport_region_map")
    .select("*")
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error("Failed to load airport region map.");
  }

  return (rows ?? []).map((row) => {
    const record = row as Record<string, unknown>;
    return {
      iataCode: record.iata_code as string,
      region: record.region as AirportRegionEntry["region"],
      source: record.source as string,
      lastVerifiedAt: record.last_verified_at as string,
    };
  });
}

/**
 * Load every verified transfer-partner row, ordered deterministically by
 * insertion order.
 */
export async function getVerifiedTransferPartners(
  client?: SupabaseClient
): Promise<VerifiedTransferPartner[]> {
  const supabase = client ?? await createServerClient();

  const { data: rows, error } = await supabase
    .from("transfer_partners")
    .select("*")
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error("Failed to load transfer partners.");
  }

  return (rows ?? []).map((row) => {
    const record = row as Record<string, unknown>;
    return {
      id: record.id as string,
      fromProgramId: record.from_program_id as string,
      toProgramId: record.to_program_id as string,
      destinationPointsPerSourcePoint:
        parseNumeric(record.destination_points_per_source_point) ?? 0,
      source: record.source as string,
      lastVerifiedAt: record.last_verified_at as string,
    };
  });
}

/**
 * Load active award-price benchmark rows, ordered deterministically by
 * insertion order (first-occurrence wins downstream). The matcher in
 * awardBenchmarks.ts re-validates every row; nothing here trusts the table.
 */
export async function getActiveAwardPriceBenchmarks(
  client?: SupabaseClient
): Promise<AwardPriceBenchmark[]> {
  const supabase = client ?? await createServerClient();

  const { data: rows, error } = await supabase
    .from("award_price_benchmarks")
    .select("*")
    .eq("active", true)
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error("Failed to load award price benchmarks.");
  }

  return (rows ?? []).map((row) => {
    const record = row as Record<string, unknown>;
    return {
      id: record.id as string,
      rewardProgramId: record.reward_program_id as string,
      redemptionType: record.redemption_type as AwardPriceBenchmark["redemptionType"],
      originRegion: record.origin_region as AirportRegionEntry["region"],
      destinationRegion: record.destination_region as AirportRegionEntry["region"],
      cabin: record.cabin as string,
      pricingBasis: record.pricing_basis as AwardPriceBenchmark["pricingBasis"],
      pointsRequired: parseNumeric(record.points_required) ?? 0,
      cashFees: parseNumeric(record.cash_fees),
      currency: record.currency as string,
      travelerCountCovered: parseNumeric(record.traveler_count_covered) ?? 0,
      nightCountCovered: parseNumeric(record.night_count_covered),
      validFrom: (record.valid_from as string | null) ?? null,
      validUntil: (record.valid_until as string | null) ?? null,
      source: record.source as string,
      lastVerifiedAt: record.last_verified_at as string | null,
      active: (record.active as boolean | null) ?? true,
    };
  });
}
