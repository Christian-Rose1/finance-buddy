/**
 * Goal-strategy persistence repository.
 *
 * Stores the latest successful personalized strategy per user-owned goal.
 * All operations use the cookie-aware server Supabase client and rely on RLS
 * as the security boundary. `user_id` and `goal_id` are always taken from the
 * explicit function arguments; no value is ever accepted from a browser
 * payload. Strategy JSON is always server-generated and validated.
 */

import { createServerClient } from "@/lib/supabase-server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { PersonalizedStrategy, StrategyFeasibility } from "./strategyTypes";

/** Current persisted strategy schema version. */
const CURRENT_STRATEGY_SCHEMA_VERSION = 1;

/** Supported feasibility enum values for persisted-shape validation. */
const SUPPORTED_FEASIBILITY_VALUES: StrategyFeasibility[] = [
  "on_track",
  "gap_remaining",
  "depends_on_new_card",
  "insufficient_information",
];

/** A saved, validated personalized strategy for a goal. */
export interface SavedGoalStrategy {
  goalId: string;
  userId: string;
  strategy: PersonalizedStrategy;
  schemaVersion: 1;
  generatedAt: string;
  createdAt: string;
  updatedAt: string;
}

/** Maps a goal_strategies row (snake_case) to a SavedGoalStrategy (camelCase). */
function toSavedGoalStrategy(row: Record<string, unknown>): SavedGoalStrategy {
  return {
    goalId: row.goal_id as string,
    userId: row.user_id as string,
    strategy: row.strategy_json as PersonalizedStrategy,
    schemaVersion: row.schema_version as 1,
    generatedAt: row.generated_at as string,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

/**
 * Validates the persisted shape of a loaded goal_strategies row.
 *
 * Returns true when the row is a non-array object, the schema version is the
 * current version, and the strategy_json has the expected persisted shape.
 * Never logs or exposes strategy JSON.
 */
function isValidSavedRow(row: unknown): row is Record<string, unknown> {
  if (typeof row !== "object" || row === null || Array.isArray(row)) {
    return false;
  }

  const record = row as Record<string, unknown>;

  if (record.schema_version !== CURRENT_STRATEGY_SCHEMA_VERSION) {
    return false;
  }

  const strategy = record.strategy_json;
  if (
    typeof strategy !== "object" ||
    strategy === null ||
    Array.isArray(strategy)
  ) {
    return false;
  }

  const s = strategy as Record<string, unknown>;

  if (typeof s.headline !== "string" || typeof s.summary !== "string") {
    return false;
  }

  if (
    typeof s.feasibility !== "string" ||
    !SUPPORTED_FEASIBILITY_VALUES.includes(s.feasibility as StrategyFeasibility)
  ) {
    return false;
  }

  const arrayFields = [
    "pointsInventory",
    "flightOptions",
    "hotelOptions",
    "actions",
    "alternatives",
    "assumptions",
    "warnings",
    "followUpQuestions",
  ];

  for (const field of arrayFields) {
    if (!Array.isArray(s[field])) {
      return false;
    }
  }

  return true;
}

/**
 * Load the latest saved strategy for a goal belonging to an authenticated user.
 *
 * @param goalId The goal id to load.
 * @param userId The authenticated user id. This is the ONLY source of truth
 *               for ownership.
 * @param client Optional Supabase client for testing; defaults to the
 *               cookie-aware server client.
 * @returns The SavedGoalStrategy, or null if no owned row exists.
 * @throws If the read fails or the persisted row fails the shape/version check.
 */
export async function getLatestStrategyForGoal(
  goalId: string,
  userId: string,
  client?: SupabaseClient
): Promise<SavedGoalStrategy | null> {
  const supabase = client ?? (await createServerClient());

  const { data: row, error } = await supabase
    .from("goal_strategies")
    .select(
      "goal_id, user_id, strategy_json, schema_version, generated_at, created_at, updated_at"
    )
    .eq("goal_id", goalId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    throw new Error("Failed to load saved strategy.");
  }

  if (!row) {
    return null;
  }

  if (!isValidSavedRow(row)) {
    throw new Error("Failed to load saved strategy.");
  }

  return toSavedGoalStrategy(row);
}

/**
 * Load the latest saved strategy for multiple goals belonging to an
 * authenticated user, in a single query.
 *
 * @param goalIds The goal ids to load.
 * @param userId The authenticated user id. This is the ONLY source of truth
 *               for ownership.
 * @param client Optional Supabase client for testing; defaults to the
 *               cookie-aware server client.
 * @returns A plain record keyed by goalId. Goals without a saved strategy are
 *          absent from the record.
 * @throws If the read fails or any persisted row fails the shape/version check.
 */
export async function getLatestStrategiesForGoals(
  goalIds: string[],
  userId: string,
  client?: SupabaseClient
): Promise<Record<string, SavedGoalStrategy>> {
  if (goalIds.length === 0) {
    return {};
  }

  const supabase = client ?? (await createServerClient());

  const { data: rows, error } = await supabase
    .from("goal_strategies")
    .select(
      "goal_id, user_id, strategy_json, schema_version, generated_at, created_at, updated_at"
    )
    .eq("user_id", userId)
    .in("goal_id", goalIds);

  if (error) {
    throw new Error("Failed to load saved strategies.");
  }

  const result: Record<string, SavedGoalStrategy> = {};
  for (const row of rows ?? []) {
    if (!isValidSavedRow(row)) {
      throw new Error("Failed to load saved strategies.");
    }
    const saved = toSavedGoalStrategy(row);
    result[saved.goalId] = saved;
  }

  return result;
}

/**
 * Persist the latest successful strategy for a goal belonging to an
 * authenticated user. A successful rebuild atomically replaces the previous
 * saved strategy for the same goal (upsert on goal_id).
 *
 * @param goalId The goal id to persist for.
 * @param userId The authenticated user id. This is the ONLY source of truth
 *               for ownership.
 * @param strategy The server-generated, validated PersonalizedStrategy.
 * @param generatedAt The ISO timestamp when the strategy was generated.
 * @param client Optional Supabase client for testing; defaults to the
 *               cookie-aware server client.
 * @returns The persisted SavedGoalStrategy.
 * @throws If the write fails.
 */
export async function saveLatestStrategy(
  goalId: string,
  userId: string,
  strategy: PersonalizedStrategy,
  generatedAt: string,
  client?: SupabaseClient
): Promise<SavedGoalStrategy> {
  const supabase = client ?? (await createServerClient());

  const payload = {
    goal_id: goalId,
    user_id: userId,
    strategy_json: strategy,
    schema_version: CURRENT_STRATEGY_SCHEMA_VERSION,
    generated_at: generatedAt,
    updated_at: new Date().toISOString(),
  };

  const { data: row, error } = await supabase
    .from("goal_strategies")
    .upsert(payload, { onConflict: "goal_id" })
    .select(
      "goal_id, user_id, strategy_json, schema_version, generated_at, created_at, updated_at"
    )
    .single();

  if (error || !row) {
    throw new Error("Failed to save strategy.");
  }

  if (!isValidSavedRow(row)) {
    throw new Error("Failed to save strategy.");
  }

  return toSavedGoalStrategy(row);
}