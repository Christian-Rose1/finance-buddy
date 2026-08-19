/**
 * Reward account persistence repository.
 *
 * Provides CRUD operations for user-owned reward accounts. All operations use
 * the cookie-aware server Supabase client and rely on RLS as the security
 * boundary. `user_id` is always taken from the explicit `userId` argument;
 * any value supplied by the caller in the input payload is ignored.
 */

import { createServerClient } from "@/lib/supabase-server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { RewardAccount } from "./types";

/** Fields required to create a persisted reward account. */
export interface CreateRewardAccountInput {
  rewardProgramId: string;
  ownerKey: string;
  ownerLabel: string;
  ownerType: RewardAccount["ownerType"];
  balance: number;
  balanceAsOf: string;
  origin?: "manual" | "evidence" | "connected";
  verificationStatus?: "unverified" | "verified";
}

/** Fields allowed when updating a persisted reward account. */
export interface UpdateRewardAccountInput {
  ownerLabel?: string;
  balance?: number;
  balanceAsOf?: string;
  origin?: "manual" | "evidence" | "connected";
  verificationStatus?: "unverified" | "verified";
}

/** Maps a reward_accounts row (snake_case) to a RewardAccount (camelCase). */
function toRewardAccount(row: Record<string, unknown>): RewardAccount {
  return {
    id: row.id as string,
    userId: row.user_id as string,
    rewardProgramId: row.reward_program_id as string,
    ownerKey: row.owner_key as string,
    ownerLabel: row.owner_label as string,
    ownerType: row.owner_type as RewardAccount["ownerType"],
    balance: parseNumeric(row.balance) ?? 0,
    balanceAsOf: row.balance_as_of as string,
    origin: row.origin as RewardAccount["origin"],
    verificationStatus: row.verification_status as RewardAccount["verificationStatus"],
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
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

/** Maps a RewardAccount to a snake_case payload for inserts/updates. */
function toRowPayload(
  input: CreateRewardAccountInput | UpdateRewardAccountInput
): Record<string, unknown> {
  const payload: Record<string, unknown> = {};

  if ("rewardProgramId" in input && input.rewardProgramId !== undefined) {
    payload.reward_program_id = input.rewardProgramId;
  }
  if ("ownerKey" in input && input.ownerKey !== undefined) {
    payload.owner_key = input.ownerKey;
  }
  if ("ownerType" in input && input.ownerType !== undefined) {
    payload.owner_type = input.ownerType;
  }
  if ("ownerLabel" in input && input.ownerLabel !== undefined) {
    payload.owner_label = input.ownerLabel;
  }
  if ("balance" in input && input.balance !== undefined) {
    payload.balance = input.balance;
  }
  if ("balanceAsOf" in input && input.balanceAsOf !== undefined) {
    payload.balance_as_of = input.balanceAsOf;
  }
  if ("origin" in input && input.origin !== undefined) {
    payload.origin = input.origin;
  }
  if ("verificationStatus" in input && input.verificationStatus !== undefined) {
    payload.verification_status = input.verificationStatus;
  }

  return payload;
}

/**
 * Load all reward accounts belonging to an authenticated user.
 *
 * @param userId The authenticated user id. This is the ONLY source of truth
 *               for ownership.
 * @param client Optional Supabase client for testing; defaults to the
 *               cookie-aware server client.
 */
export async function getRewardAccountsForUser(
  userId: string,
  client?: SupabaseClient
): Promise<RewardAccount[]> {
  const supabase = client ?? await createServerClient();

  const { data: rows, error } = await supabase
    .from("reward_accounts")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error("Failed to load reward accounts.");
  }

  return (rows ?? []).map((row) => toRewardAccount(row as Record<string, unknown>));
}

/**
 * Load a single reward account belonging to an authenticated user.
 *
 * @param accountId The reward account id to load.
 * @param userId The authenticated user id. This is the ONLY source of truth
 *               for ownership.
 * @param client Optional Supabase client for testing; defaults to the
 *               cookie-aware server client.
 * @returns The RewardAccount, or null if it does not exist or is not owned by
 *          the user.
 */
export async function getRewardAccountForUser(
  accountId: string,
  userId: string,
  client?: SupabaseClient
): Promise<RewardAccount | null> {
  const supabase = client ?? await createServerClient();

  const { data: row, error } = await supabase
    .from("reward_accounts")
    .select("*")
    .eq("id", accountId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    throw new Error("Failed to load reward account.");
  }

  if (!row) {
    return null;
  }

  return toRewardAccount(row as Record<string, unknown>);
}

/**
 * Persist a new reward account for an authenticated user.
 *
 * The `user_id` is set from `userId`; any user_id in the input is ignored.
 *
 * @param input  The reward account data to persist.
 * @param userId The authenticated user id. This is the ONLY source of truth
 *               for ownership.
 * @param client Optional Supabase client for testing; defaults to the
 *               cookie-aware server client.
 * @returns The persisted RewardAccount, including the generated id.
 */
export async function createRewardAccount(
  input: CreateRewardAccountInput,
  userId: string,
  client?: SupabaseClient
): Promise<RewardAccount> {
  const supabase = client ?? await createServerClient();

  const payload = {
    ...toRowPayload(input),
    user_id: userId,
  };

  const { data: row, error } = await supabase
    .from("reward_accounts")
    .insert(payload)
    .select()
    .single();

  if (error || !row) {
    throw new Error("Failed to create reward account.");
  }

  return toRewardAccount(row as Record<string, unknown>);
}

/**
 * Update an existing reward account belonging to an authenticated user.
 *
 * @param accountId The reward account id to update.
 * @param updates The fields to update.
 * @param userId The authenticated user id. This is the ONLY source of truth
 *               for ownership.
 * @param client Optional Supabase client for testing; defaults to the
 *               cookie-aware server client.
 * @returns The updated RewardAccount.
 * @throws If the account does not exist or is not owned by the user.
 */
export async function updateRewardAccount(
  accountId: string,
  updates: UpdateRewardAccountInput,
  userId: string,
  client?: SupabaseClient
): Promise<RewardAccount> {
  const supabase = client ?? await createServerClient();

  const payload = {
    ...toRowPayload(updates),
    updated_at: new Date().toISOString(),
  };

  const { data: row, error } = await supabase
    .from("reward_accounts")
    .update(payload)
    .eq("id", accountId)
    .eq("user_id", userId)
    .select()
    .single();

  if (error || !row) {
    throw new Error("Failed to update reward account.");
  }

  return toRewardAccount(row as Record<string, unknown>);
}

/**
 * Delete a reward account belonging to an authenticated user.
 *
 * @param accountId The reward account id to delete.
 * @param userId The authenticated user id. This is the ONLY source of truth
 *               for ownership.
 * @param client Optional Supabase client for testing; defaults to the
 *               cookie-aware server client.
 * @throws If the delete fails.
 */
export async function deleteRewardAccount(
  accountId: string,
  userId: string,
  client?: SupabaseClient
): Promise<void> {
  const supabase = client ?? await createServerClient();

  const { error } = await supabase
    .from("reward_accounts")
    .delete()
    .eq("id", accountId)
    .eq("user_id", userId);

  if (error) {
    throw new Error("Failed to delete reward account.");
  }
}