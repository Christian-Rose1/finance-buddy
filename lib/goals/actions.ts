"use server";

import { revalidatePath } from "next/cache";
import { createServerClient } from "@/lib/supabase-server";
import {
  createGoal,
  deleteGoal,
  updateGoal,
  type CreateGoalInput,
  type UpdateGoalInput,
} from "./repository";
import { isUuid, validateGoalFormData } from "./goalForm";
import type { Goal } from "./types";

export type GoalActionState =
  | { success: true; goal: Goal; message?: string }
  | { success: false; error: string };

export type DeleteGoalActionState =
  | { success: true; goalId: string; message: string }
  | { success: false; error: string };

async function getAuthenticatedUserId(): Promise<string> {
  const supabase = await createServerClient();
  const { data: userData, error: userError } = await supabase.auth.getUser();

  if (userError || !userData.user) {
    throw new Error("You must be signed in to manage your goals.");
  }

  return userData.user.id;
}

export async function createGoalAction(
  _prevState: GoalActionState | null,
  formData: FormData
): Promise<GoalActionState> {
  try {
    const userId = await getAuthenticatedUserId();
    const validation = validateGoalFormData(formData, "create");
    if (!validation.valid) {
      return { success: false, error: validation.error };
    }

    const goal = await createGoal(validation.data as CreateGoalInput, userId);
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

export async function updateGoalAction(
  _prevState: GoalActionState | null,
  formData: FormData
): Promise<GoalActionState> {
  try {
    const userId = await getAuthenticatedUserId();
    const goalIdValue = formData.get("goalId");
    const goalId = typeof goalIdValue === "string" ? goalIdValue.trim() : "";
    if (!isUuid(goalId)) {
      return { success: false, error: "Goal identifier is invalid." };
    }

    const validation = validateGoalFormData(formData, "update");
    if (!validation.valid) {
      return { success: false, error: validation.error };
    }

    const goal = await updateGoal(
      goalId,
      validation.data as UpdateGoalInput,
      userId
    );
    revalidatePath("/goals");
    return {
      success: true,
      goal,
      message: `Goal "${goal.title}" was updated.`,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to update goal.";
    return { success: false, error: message };
  }
}

export async function deleteGoalAction(
  goalId: string
): Promise<DeleteGoalActionState> {
  try {
    const userId = await getAuthenticatedUserId();
    if (!isUuid(goalId)) {
      return { success: false, error: "Goal identifier is invalid." };
    }

    await deleteGoal(goalId, userId);
    revalidatePath("/goals");
    return {
      success: true,
      goalId,
      message: "Goal was deleted.",
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to delete goal.";
    return { success: false, error: message };
  }
}
