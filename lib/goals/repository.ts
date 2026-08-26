/**
 * Goal persistence repository.
 *
 * Provides CRUD operations for user-owned goals. All operations use
 * the cookie-aware server Supabase client and rely on RLS as the security
 * boundary. `user_id` is always taken from the explicit `userId` argument;
 * any value supplied by the caller in the input payload is ignored.
 */

import { createServerClient } from "@/lib/supabase-server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Goal, GoalStatus, OptimizationPriority, CabinPreference } from "./types";

/** Fields required to create a persisted goal. */
export interface CreateGoalInput {
  title: string;
  status?: GoalStatus;
  origin?: string[];
  destinations?: string[];
  earliestDeparture?: string | null;
  latestReturn?: string | null;
  minimumNights?: number | null;
  maximumNights?: number | null;
  travelerCount?: number;
  cabinPreference?: CabinPreference;
  optimizationPriority?: OptimizationPriority;
  maximumCashBudget?: number | null;
  currency?: string;
  allowNewCards?: boolean;
}

/** Fields allowed when updating a persisted goal. */
export interface UpdateGoalInput {
  title?: string;
  status?: GoalStatus;
  origin?: string[];
  destinations?: string[];
  earliestDeparture?: string | null;
  latestReturn?: string | null;
  minimumNights?: number | null;
  maximumNights?: number | null;
  travelerCount?: number;
  cabinPreference?: CabinPreference;
  optimizationPriority?: OptimizationPriority;
  maximumCashBudget?: number | null;
  currency?: string;
  allowNewCards?: boolean;
}

/** Safe numeric parser. */
function parseNumeric(value: unknown): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/** Maps a goals row (snake_case) to a Goal (camelCase). */
function toGoal(row: Record<string, unknown>): Goal {
  return {
    id: row.id as string,
    userId: row.user_id as string,
    type: row.type as "travel",
    title: row.title as string,
    status: row.status as GoalStatus,
    origin: row.origin as string[],
    destinations: row.destinations as string[],
    earliestDeparture: row.earliest_departure as string | null,
    latestReturn: row.latest_return as string | null,
    minimumNights: row.minimum_nights as number | null,
    maximumNights: row.maximum_nights as number | null,
    travelerCount: row.traveler_count as number,
    cabinPreference: row.cabin_preference as CabinPreference,
    optimizationPriority: row.optimization_priority as OptimizationPriority,
    maximumCashBudget: parseNumeric(row.maximum_cash_budget),
    currency: row.currency as string,
    allowNewCards: row.allow_new_cards as boolean,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

/** Maps a Goal to a snake_case payload for inserts/updates. */
function toRowPayload(
  input: CreateGoalInput | UpdateGoalInput
): Record<string, unknown> {
  const payload: Record<string, unknown> = {};

  if ("title" in input && input.title !== undefined) payload.title = input.title;
  if ("status" in input && input.status !== undefined) payload.status = input.status;
  if ("origin" in input && input.origin !== undefined) payload.origin = input.origin;
  if ("destinations" in input && input.destinations !== undefined) {
    payload.destinations = input.destinations;
  }
  if ("earliestDeparture" in input && input.earliestDeparture !== undefined) {
    payload.earliest_departure = input.earliestDeparture;
  }
  if ("latestReturn" in input && input.latestReturn !== undefined) {
    payload.latest_return = input.latestReturn;
  }
  if ("minimumNights" in input && input.minimumNights !== undefined) {
    payload.minimum_nights = input.minimumNights;
  }
  if ("maximumNights" in input && input.maximumNights !== undefined) {
    payload.maximum_nights = input.maximumNights;
  }
  if ("travelerCount" in input && input.travelerCount !== undefined) {
    payload.traveler_count = input.travelerCount;
  }
  if ("cabinPreference" in input && input.cabinPreference !== undefined) {
    payload.cabin_preference = input.cabinPreference;
  }
  if ("optimizationPriority" in input && input.optimizationPriority !== undefined) {
    payload.optimization_priority = input.optimizationPriority;
  }
  if ("maximumCashBudget" in input && input.maximumCashBudget !== undefined) {
    payload.maximum_cash_budget = input.maximumCashBudget;
  }
  if ("currency" in input && input.currency !== undefined) payload.currency = input.currency;
  if ("allowNewCards" in input && input.allowNewCards !== undefined) {
    payload.allow_new_cards = input.allowNewCards;
  }

  return payload;
}

/**
 * Load all goals belonging to an authenticated user.
 *
 * @param userId The authenticated user id. This is the ONLY source of truth
 *               for ownership.
 * @param client Optional Supabase client for testing; defaults to the
 *               cookie-aware server client.
 */
export async function getGoalsForUser(
  userId: string,
  client?: SupabaseClient
): Promise<Goal[]> {
  const supabase = client ?? await createServerClient();

  const { data: rows, error } = await supabase
    .from("goals")
    .select("*")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false });

  if (error) {
    throw new Error("Failed to load goals.");
  }

  return (rows ?? []).map((row) => toGoal(row as Record<string, unknown>));
}

/**
 * Load a single goal belonging to an authenticated user.
 *
 * @param goalId The goal id to load.
 * @param userId The authenticated user id. This is the ONLY source of truth
 *               for ownership.
 * @param client Optional Supabase client for testing; defaults to the
 *               cookie-aware server client.
 * @returns The Goal, or null if it does not exist or is not owned by
 *          the user.
 */
export async function getGoalForUser(
  goalId: string,
  userId: string,
  client?: SupabaseClient
): Promise<Goal | null> {
  const supabase = client ?? await createServerClient();

  const { data: row, error } = await supabase
    .from("goals")
    .select("*")
    .eq("id", goalId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    throw new Error("Failed to load goal.");
  }

  if (!row) {
    return null;
  }

  return toGoal(row as Record<string, unknown>);
}

/**
 * Persist a new goal for an authenticated user.
 *
 * The `user_id` is set from `userId`; any user_id in the input is ignored.
 *
 * @param input  The goal data to persist.
 * @param userId The authenticated user id. This is the ONLY source of truth
 *               for ownership.
 * @param client Optional Supabase client for testing; defaults to the
 *               cookie-aware server client.
 * @returns The persisted Goal, including the generated id.
 */
export async function createGoal(
  input: CreateGoalInput,
  userId: string,
  client?: SupabaseClient
): Promise<Goal> {
  const supabase = client ?? await createServerClient();

  const payload = {
    ...toRowPayload(input),
    user_id: userId,
  };

  const { data: row, error } = await supabase
    .from("goals")
    .insert(payload)
    .select()
    .single();

  if (error || !row) {
    throw new Error("Failed to create goal.");
  }

  return toGoal(row as Record<string, unknown>);
}

/**
 * Update an existing goal belonging to an authenticated user.
 *
 * @param goalId The goal id to update.
 * @param updates The fields to update.
 * @param userId The authenticated user id. This is the ONLY source of truth
 *               for ownership.
 * @param client Optional Supabase client for testing; defaults to the
 *               cookie-aware server client.
 * @returns The updated Goal.
 * @throws If the goal does not exist or is not owned by the user.
 */
export async function updateGoal(
  goalId: string,
  updates: UpdateGoalInput,
  userId: string,
  client?: SupabaseClient
): Promise<Goal> {
  const supabase = client ?? await createServerClient();

  const payload = {
    ...toRowPayload(updates),
    updated_at: new Date().toISOString(),
  };

  const { data: row, error } = await supabase
    .from("goals")
    .update(payload)
    .eq("id", goalId)
    .eq("user_id", userId)
    .select()
    .single();

  if (error || !row) {
    throw new Error("Failed to update goal.");
  }

  return toGoal(row as Record<string, unknown>);
}

/**
 * Delete a goal belonging to an authenticated user.
 *
 * @param goalId The goal id to delete.
 * @param userId The authenticated user id. This is the ONLY source of truth
 *               for ownership.
 * @param client Optional Supabase client for testing; defaults to the
 *               cookie-aware server client.
 * @throws If the delete fails.
 */
export async function deleteGoal(
  goalId: string,
  userId: string,
  client?: SupabaseClient
): Promise<void> {
  const supabase = client ?? await createServerClient();

  const { data: row, error } = await supabase
    .from("goals")
    .delete()
    .eq("id", goalId)
    .eq("user_id", userId)
    .select("id")
    .maybeSingle();

  if (error || !row) {
    throw new Error("Failed to delete goal.");
  }
}
