"use server";

import { revalidatePath } from "next/cache";
import { createServerClient } from "@/lib/supabase-server";
import { createGoal, type CreateGoalInput } from "./repository";
import type { Goal, CabinPreference, OptimizationPriority } from "./types";

export type GoalActionState =
  | { success: true; goal: Goal; message?: string }
  | { success: false; error: string };

async function getAuthenticatedUserId(): Promise<string> {
  const supabase = await createServerClient();
  const { data: userData, error: userError } = await supabase.auth.getUser();

  if (userError || !userData.user) {
    throw new Error("You must be signed in to manage your goals.");
  }

  return userData.user.id;
}

function normalizeCommaSeparated(value: string): string[] {
  return Array.from(
    new Set(
      value
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0)
    )
  );
}

export async function createGoalAction(
  _prevState: GoalActionState | null,
  formData: FormData
): Promise<GoalActionState> {
  try {
    const userId = await getAuthenticatedUserId();

    const title = String(formData.get("title") ?? "").trim();
    if (!title) {
      return { success: false, error: "Title is required." };
    }

    const originInput = String(formData.get("origins") ?? "");
    const origin = normalizeCommaSeparated(originInput);

    if (origin.length === 0) {
      return { success: false, error: "At least one origin is required." };
    }

    const destinationsInput = String(formData.get("destinations") ?? "");
    const destinations = normalizeCommaSeparated(destinationsInput);
    if (destinations.length === 0) {
      return { success: false, error: "At least one destination is required." };
    }

    const travelerCountRaw = formData.get("travelerCount");
    if (travelerCountRaw === null || travelerCountRaw === undefined || travelerCountRaw === "") {
      return { success: false, error: "Traveler count is required." };
    }
    const travelerCount = Number(travelerCountRaw);
    if (!Number.isInteger(travelerCount) || travelerCount <= 0) {
      return { success: false, error: "Traveler count must be a positive integer greater than zero." };
    }

    const minNightsRaw = formData.get("minimumNights");
    const maxNightsRaw = formData.get("maximumNights");
    const maxCashBudgetRaw = formData.get("maximumCashBudget");

    let minimumNights: number | null = null;
    if (minNightsRaw !== null && minNightsRaw !== undefined && minNightsRaw !== "") {
      const val = Number(minNightsRaw);
      if (!Number.isInteger(val) || val <= 0) {
        return { success: false, error: "Minimum nights must be a positive integer greater than zero." };
      }
      minimumNights = val;
    }

    let maximumNights: number | null = null;
    if (maxNightsRaw !== null && maxNightsRaw !== undefined && maxNightsRaw !== "") {
      const val = Number(maxNightsRaw);
      if (!Number.isInteger(val) || val <= 0) {
        return { success: false, error: "Maximum nights must be a positive integer greater than zero." };
      }
      maximumNights = val;
    }

    let maximumCashBudget: number | null = null;
    if (maxCashBudgetRaw !== null && maxCashBudgetRaw !== undefined && maxCashBudgetRaw !== "") {
      const val = Number(maxCashBudgetRaw);
      if (!Number.isFinite(val) || val < 0) {
        return { success: false, error: "Maximum cash budget must be a non-negative number." };
      }
      maximumCashBudget = val;
    }

    if (minimumNights !== null && maximumNights !== null && maximumNights < minimumNights) {
      return { success: false, error: "Maximum nights cannot be less than minimum nights." };
    }

    const earliestDepartureRaw = formData.get("earliestDeparture") ? String(formData.get("earliestDeparture")) : "";
    const latestReturnRaw = formData.get("latestReturn") ? String(formData.get("latestReturn")) : "";

    function isValidDate(dateStr: string): boolean {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return false;
      const date = new Date(dateStr);
      return !isNaN(date.getTime()) && date.toISOString().slice(0, 10) === dateStr;
    }

    if (earliestDepartureRaw && !isValidDate(earliestDepartureRaw)) {
      return { success: false, error: "Earliest departure must be a valid YYYY-MM-DD date." };
    }
    if (latestReturnRaw && !isValidDate(latestReturnRaw)) {
      return { success: false, error: "Latest return must be a valid YYYY-MM-DD date." };
    }

    const earliestDeparture = earliestDepartureRaw || null;
    const latestReturn = latestReturnRaw || null;

    if (earliestDeparture && latestReturn) {
      const start = new Date(earliestDeparture);
      const end = new Date(latestReturn);
      if (end < start) {
        return { success: false, error: "Latest return cannot be before earliest departure." };
      }
    }

    const validCabinPreferences: CabinPreference[] = ["economy", "premium_economy", "business", "first", "flexible"];
    const cabinPreference = String(formData.get("cabinPreference") ?? "economy") as CabinPreference;
    if (!validCabinPreferences.includes(cabinPreference)) {
      return { success: false, error: "Invalid cabin preference." };
    }

    const validOptimizationPriorities: OptimizationPriority[] = ["lowest_cash", "best_experience", "simplest", "balanced"];
    const optimizationPriority = String(formData.get("optimizationPriority") ?? "balanced") as OptimizationPriority;
    if (!validOptimizationPriorities.includes(optimizationPriority)) {
      return { success: false, error: "Invalid optimization priority." };
    }

    const allowNewCardsRaw = formData.get("allowNewCards");
    const allowNewCards = allowNewCardsRaw === "true" || allowNewCardsRaw === "yes";

    const input: CreateGoalInput = {
      title,
      status: "draft",
      origin,
      destinations,
      earliestDeparture,
      latestReturn,
      minimumNights,
      maximumNights,
      travelerCount,
      cabinPreference,
      optimizationPriority,
      maximumCashBudget,
      currency: "USD",
      allowNewCards,
    };

    const goal = await createGoal(input, userId);
    revalidatePath("/goals");
    return {
      success: true,
      goal,
      message: `Goal "${goal.title}" was successfully created.`,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to create goal.";
    return { success: false, error: message };
  }
}
