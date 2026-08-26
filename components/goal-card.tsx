"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Trash2 } from "lucide-react";
import { deleteGoalAction } from "@/lib/goals/actions";
import type { Goal } from "@/lib/goals/types";
import type { PersonalizedStrategy } from "@/lib/goals/strategyTypes";
import { GoalForm } from "./goal-form";
import { GoalStrategyPanel } from "./goal-strategy-panel";

interface GoalCardProps {
  goal: Goal;
  initialStrategy: PersonalizedStrategy | null;
  strategyGeneratedAt: string | null;
}

function readableStatus(status: Goal["status"]): string {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

export function GoalCard({
  goal,
  initialStrategy,
  strategyGeneratedAt,
}: GoalCardProps) {
  const router = useRouter();
  const editorId = useId();
  const [isEditing, setIsEditing] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [isDeleting, startDeleteTransition] = useTransition();
  const strategyIsStale =
    initialStrategy !== null &&
    strategyGeneratedAt !== null &&
    new Date(strategyGeneratedAt).getTime() < new Date(goal.updatedAt).getTime();

  function handleDelete() {
    if (
      !confirm(
        `Permanently delete "${goal.title}" and its saved strategy? This cannot be undone.`
      )
    ) {
      return;
    }

    setDeleteError(null);
    startDeleteTransition(async () => {
      const result = await deleteGoalAction(goal.id);
      if (!result.success) {
        setDeleteError(result.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <article className="fb-card overflow-hidden" aria-busy={isDeleting}>
      <div className="p-4 sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="break-words text-lg font-medium text-white">
                {goal.title}
              </h3>
              <span className="rounded-full bg-sky-400/10 px-2.5 py-0.5 text-xs font-medium text-sky-300">
                {readableStatus(goal.status)}
              </span>
            </div>
            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-sm text-slate-400">
              <span>
                {goal.origin.join(", ")} to {goal.destinations.join(", ")}
              </span>
              <span className="capitalize">
                {goal.cabinPreference.replace("_", " ")}
              </span>
              <span>
                {goal.travelerCount}{" "}
                {goal.travelerCount === 1 ? "traveler" : "travelers"}
              </span>
            </div>
          </div>

          <div
            className="flex w-full shrink-0 flex-wrap items-center gap-2 sm:w-auto"
            role="group"
            aria-label={`Actions for ${goal.title}`}
          >
            <button
              type="button"
              onClick={() => {
                setDeleteError(null);
                setIsEditing((current) => !current);
              }}
              disabled={isDeleting}
              aria-expanded={isEditing}
              aria-controls={editorId}
              className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm font-medium text-slate-200 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-70 sm:flex-none"
            >
              <Pencil aria-hidden="true" className="h-4 w-4" />
              {isEditing ? "Close editor" : "Edit"}
            </button>
            <button
              type="button"
              onClick={handleDelete}
              disabled={isDeleting}
              aria-label={`Permanently delete ${goal.title}`}
              className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg border border-rose-400/20 bg-rose-400/10 px-3 py-2 text-sm font-medium text-rose-200 transition hover:bg-rose-400/20 disabled:cursor-not-allowed disabled:opacity-70 sm:flex-none"
            >
              <Trash2 aria-hidden="true" className="h-4 w-4" />
              {isDeleting ? "Deleting..." : "Delete"}
            </button>
          </div>
        </div>

        {isDeleting ? (
          <p className="sr-only" role="status" aria-live="polite">
            Permanently deleting {goal.title} and its saved strategy.
          </p>
        ) : null}

        {deleteError ? (
          <p
            className="mt-4 rounded-lg border border-rose-400/20 bg-rose-400/10 p-3 text-sm text-rose-200"
            role="alert"
          >
            {deleteError}
          </p>
        ) : null}
      </div>

      {isEditing ? (
        <div
          id={editorId}
          className="border-t border-white/10 bg-slate-950/30 p-4 sm:p-6"
        >
          <GoalForm
            mode="edit"
            goal={goal}
            onSuccess={() => setIsEditing(false)}
            onCancel={() => setIsEditing(false)}
          />
        </div>
      ) : (
        <div className="border-t border-white/10 p-4 sm:p-6">
          {strategyIsStale ? (
            <p className="mb-4 rounded-lg border border-amber-400/20 bg-amber-400/10 p-3 text-sm text-amber-100">
              This goal changed after its saved strategy was generated. Build a
              new strategy before relying on that plan.
            </p>
          ) : null}
          <GoalStrategyPanel
            key={goal.updatedAt}
            goalId={goal.id}
            initialStrategy={strategyIsStale ? null : initialStrategy}
          />
        </div>
      )}
    </article>
  );
}
