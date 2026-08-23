"use server";

/**
 * Server actions for manually creating and updating reward accounts.
 *
 * Security model:
 * - Authentication comes from the cookie-aware server Supabase client.
 * - `userId` is NEVER accepted from form data; it is read from the
 *   authenticated session.
 * - The same authenticated client is reused for catalog and repository calls.
 */

import { revalidatePath } from "next/cache";
import { createServerClient } from "@/lib/supabase-server";
import type { RewardAccount } from "./types";
import {
  createRewardAccount,
  getRewardAccountsForUser,
  getRewardAccountForUser,
  updateRewardAccount,
} from "./rewardAccountsRepository";
import { getRewardPrograms } from "@/lib/rewards/catalogRepository";

/** Discriminated result of a reward-account mutation action. */
export type RewardAccountActionState =
  | { success: true; rewardAccount: RewardAccount }
  | { success: false; message: string };

const VALID_OWNER_TYPES: ReadonlyArray<RewardAccount["ownerType"]> = [
  "self",
  "companion",
];

/** Parses a raw form value as a finite, non-negative number, or null. */
function parseNonNegativeBalance(value: unknown): number | null {
  if (typeof value !== "string" && typeof value !== "number") {
    return null;
  }
  const raw = String(value).trim();
  if (raw === "") {
    return null;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return null;
  }
  return parsed;
}

/**
 * Checks that a string is a real `YYYY-MM-DD` calendar date. Rejects impossible
 * dates such as 2026-02-31.
 */
function isValidCalendarDate(value: unknown): value is string {
  if (typeof value !== "string") {
    return false;
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    return false;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

/** Converts a validated `YYYY-MM-DD` date to an ISO UTC timestamp. */
function toIsoUtc(dateValue: string): string {
  return new Date(`${dateValue}T00:00:00Z`).toISOString();
}

/** Collapses internal whitespace runs to single spaces and trims. */
function collapseWhitespace(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

/**
 * Create a reward account from manual form input.
 *
 * Field ownership:
 * - `self`      -> ownerKey "self", ownerLabel "Me"
 * - `companion` -> ownerKey "companion:<lowercase label>", ownerLabel is the
 *                  trimmed, whitespace-collapsed label.
 *
 * The client never supplies `ownerKey`.
 */
export async function createRewardAccountAction(
  formData: FormData
): Promise<RewardAccountActionState> {
  const supabase = await createServerClient();

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();
  if (userError || !user) {
    return {
      success: false,
      message: "You must be signed in to manage reward accounts.",
    };
  }
  const userId = user.id;

  // 1. rewardProgramId must be nonempty and exactly match a catalog program.
  const rewardProgramId = String(formData.get("rewardProgramId") ?? "").trim();
  if (rewardProgramId === "") {
    return { success: false, message: "A reward program is required." };
  }

  let programs;
  try {
    programs = await getRewardPrograms(supabase);
  } catch {
    return {
      success: false,
      message: "Unable to load reward programs. Please try again.",
    };
  }

  const program = programs.find((p) => p.id === rewardProgramId);
  if (!program) {
    return {
      success: false,
      message: "Select a valid reward program.",
    };
  }

  // 2. ownerType must be exactly self or companion.
  const rawOwnerType = String(formData.get("ownerType") ?? "").trim();
  if (
    !VALID_OWNER_TYPES.includes(rawOwnerType as RewardAccount["ownerType"])
  ) {
    return {
      success: false,
      message: "Owner type must be self or companion.",
    };
  }
  const ownerType = rawOwnerType as RewardAccount["ownerType"];

  // 3. Balance must be finite and non-negative.
  const balance = parseNonNegativeBalance(formData.get("balance"));
  if (balance === null) {
    return {
      success: false,
      message: "Balance must be a non-negative number.",
    };
  }

  // 4. balanceAsOf must be a real YYYY-MM-DD calendar date.
  const balanceAsOfRaw = String(formData.get("balanceAsOf") ?? "").trim();
  if (!isValidCalendarDate(balanceAsOfRaw)) {
    return {
      success: false,
      message: "Balance as-of must be a valid YYYY-MM-DD date.",
    };
  }

  // 5. Companion label requirements.
  let ownerKey: string;
  let ownerLabel: string;
  if (ownerType === "self") {
    ownerKey = "self";
    ownerLabel = "Me";
  } else {
    const label = collapseWhitespace(String(formData.get("ownerLabel") ?? ""));
    if (label === "") {
      return {
        success: false,
        message: "A companion label is required.",
      };
    }
    if (label.length > 100) {
      return {
        success: false,
        message: "Companion label must be 100 characters or fewer.",
      };
    }
    ownerLabel = label;
    ownerKey = `companion:${label.toLowerCase()}`;
  }

  // Reject an existing exact rewardProgramId + ownerKey pair.
  let existingAccounts;
  try {
    existingAccounts = await getRewardAccountsForUser(userId, supabase);
  } catch {
    return {
      success: false,
      message: "Unable to load reward accounts. Please try again.",
    };
  }

  const duplicate = existingAccounts.find(
    (a) => a.rewardProgramId === rewardProgramId && a.ownerKey === ownerKey
  );
  if (duplicate) {
    return {
      success: false,
      message:
        "A balance for this program and owner already exists. Update it below.",
    };
  }

  const balanceAsOf = toIsoUtc(balanceAsOfRaw);

  try {
    const rewardAccount = await createRewardAccount(
      {
        rewardProgramId,
        ownerKey,
        ownerLabel,
        ownerType,
        balance,
        balanceAsOf,
        origin: "manual",
        // Manual issuer-entered balances are authoritative.
        verificationStatus: "verified",
      },
      userId,
      supabase
    );
    revalidatePath("/wallet");
    return { success: true, rewardAccount };
  } catch {
    return {
      success: false,
      message: "Unable to save the reward account. Please try again.",
    };
  }
}

/**
 * Update the balance of an existing manual reward account.
 *
 * Only `balance`, `balanceAsOf`, `origin`, and `verificationStatus` may change.
 * The user, program, owner key, owner type, and owner label are never updated.
 */
export async function updateRewardAccountAction(
  formData: FormData
): Promise<RewardAccountActionState> {
  const supabase = await createServerClient();

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();
  if (userError || !user) {
    return {
      success: false,
      message: "You must be signed in to manage reward accounts.",
    };
  }
  const userId = user.id;

  const accountId = String(formData.get("accountId") ?? "").trim();
  if (accountId === "") {
    return { success: false, message: "A reward account is required." };
  }

  const balance = parseNonNegativeBalance(formData.get("balance"));
  if (balance === null) {
    return { success: false, message: "Balance must be a non-negative number." };
  }

  const balanceAsOfRaw = String(formData.get("balanceAsOf") ?? "").trim();
  if (!isValidCalendarDate(balanceAsOfRaw)) {
    return {
      success: false,
      message: "Balance as-of must be a valid YYYY-MM-DD date.",
    };
  }

  // Ensure the account exists and belongs to the authenticated user.
  let existingAccount;
  try {
    existingAccount = await getRewardAccountForUser(accountId, userId, supabase);
  } catch {
    return {
      success: false,
      message: "Unable to load the reward account. Please try again.",
    };
  }
  if (!existingAccount) {
    return { success: false, message: "Reward account not found." };
  }

  const balanceAsOf = toIsoUtc(balanceAsOfRaw);

  try {
    const rewardAccount = await updateRewardAccount(
      accountId,
      {
        balance,
        balanceAsOf,
        origin: "manual",
        // Manual issuer-entered balances are authoritative.
        verificationStatus: "verified",
      },
      userId,
      supabase
    );
    revalidatePath("/wallet");
    return { success: true, rewardAccount };
  } catch {
    return {
      success: false,
      message: "Unable to update the reward account. Please try again.",
    };
  }
}
