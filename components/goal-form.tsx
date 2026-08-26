"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  createGoalAction,
  updateGoalAction,
  type GoalActionState,
} from "@/lib/goals/actions";
import type { Goal } from "@/lib/goals/types";

interface GoalFormProps {
  mode?: "create" | "edit";
  goal?: Goal;
  onSuccess?: (state: GoalActionState) => void;
  onCancel?: () => void;
}

export function GoalForm({
  mode = "create",
  goal,
  onSuccess,
  onCancel,
}: GoalFormProps) {
  const router = useRouter();
  const [state, setState] = useState<GoalActionState | null>(null);
  const [isPending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);
  const isEdit = mode === "edit" && goal !== undefined;
  const idPrefix = isEdit ? `goal-${goal.id}` : "new-goal";

  async function handleSubmit(formData: FormData) {
    if (isPending) return;

    startTransition(async () => {
      const nextState = isEdit
        ? await updateGoalAction(state, formData)
        : await createGoalAction(state, formData);
      setState(nextState);

      if (nextState.success) {
        if (!isEdit) formRef.current?.reset();
        router.refresh();
        onSuccess?.(nextState);
      }
    });
  }

  return (
    <form ref={formRef} action={handleSubmit} className="space-y-4">
      {isEdit ? <input type="hidden" name="goalId" value={goal.id} /> : null}

      <div className="space-y-2">
        <label
          htmlFor={`${idPrefix}-title`}
          className="block text-sm font-medium text-slate-200"
        >
          Goal Title
        </label>
        <input
          id={`${idPrefix}-title`}
          name="title"
          type="text"
          placeholder="e.g., Summer Trip to Europe"
          className="fb-input"
          required
          maxLength={100}
          defaultValue={goal?.title ?? ""}
          disabled={isPending}
          autoComplete="off"
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <label
            htmlFor={`${idPrefix}-origins`}
            className="block text-sm font-medium text-slate-200"
          >
            Flying from <span className="text-slate-400">(cities or airports)</span>
          </label>
          <input
            id={`${idPrefix}-origins`}
            name="origins"
            type="text"
            placeholder="e.g., Denver, New York City"
            className="fb-input"
            required
            maxLength={1009}
            defaultValue={goal?.origin.join(", ") ?? ""}
            disabled={isPending}
            autoComplete="off"
          />
        </div>

        <div className="space-y-2">
          <label
            htmlFor={`${idPrefix}-destinations`}
            className="block text-sm font-medium text-slate-200"
          >
            Destinations <span className="text-slate-400">(comma-separated locations)</span>
          </label>
          <input
            id={`${idPrefix}-destinations`}
            name="destinations"
            type="text"
            placeholder="e.g., London, Paris"
            className="fb-input"
            required
            maxLength={1009}
            defaultValue={goal?.destinations.join(", ") ?? ""}
            disabled={isPending}
            autoComplete="off"
          />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <label
            htmlFor={`${idPrefix}-earliestDeparture`}
            className="block text-sm font-medium text-slate-200"
          >
            Earliest Departure
          </label>
          <input
            id={`${idPrefix}-earliestDeparture`}
            name="earliestDeparture"
            type="date"
            className="fb-input"
            defaultValue={goal?.earliestDeparture ?? ""}
            disabled={isPending}
          />
        </div>

        <div className="space-y-2">
          <label
            htmlFor={`${idPrefix}-latestReturn`}
            className="block text-sm font-medium text-slate-200"
          >
            Latest Return
          </label>
          <input
            id={`${idPrefix}-latestReturn`}
            name="latestReturn"
            type="date"
            className="fb-input"
            defaultValue={goal?.latestReturn ?? ""}
            disabled={isPending}
          />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="space-y-2">
          <label
            htmlFor={`${idPrefix}-minimumNights`}
            className="block text-sm font-medium text-slate-200"
          >
            Minimum Nights
          </label>
          <input
            id={`${idPrefix}-minimumNights`}
            name="minimumNights"
            type="number"
            min="1"
            max="365"
            step="1"
            placeholder="e.g., 5"
            className="fb-input"
            defaultValue={goal?.minimumNights ?? ""}
            disabled={isPending}
          />
        </div>

        <div className="space-y-2">
          <label
            htmlFor={`${idPrefix}-maximumNights`}
            className="block text-sm font-medium text-slate-200"
          >
            Maximum Nights
          </label>
          <input
            id={`${idPrefix}-maximumNights`}
            name="maximumNights"
            type="number"
            min="1"
            max="365"
            step="1"
            placeholder="e.g., 14"
            className="fb-input"
            defaultValue={goal?.maximumNights ?? ""}
            disabled={isPending}
          />
        </div>

        <div className="space-y-2">
          <label
            htmlFor={`${idPrefix}-travelerCount`}
            className="block text-sm font-medium text-slate-200"
          >
            Travelers
          </label>
          <input
            id={`${idPrefix}-travelerCount`}
            name="travelerCount"
            type="number"
            min="1"
            max="50"
            step="1"
            defaultValue={goal?.travelerCount ?? 1}
            className="fb-input"
            required
            disabled={isPending}
          />
        </div>
      </div>

      <div className={`grid gap-4 ${isEdit ? "sm:grid-cols-3" : "sm:grid-cols-2"}`}>
        <div className="space-y-2">
          <label
            htmlFor={`${idPrefix}-cabinPreference`}
            className="block text-sm font-medium text-slate-200"
          >
            Cabin Preference
          </label>
          <select
            id={`${idPrefix}-cabinPreference`}
            name="cabinPreference"
            defaultValue={goal?.cabinPreference ?? "economy"}
            className="fb-input"
            required
            disabled={isPending}
          >
            <option value="economy">Economy</option>
            <option value="premium_economy">Premium Economy</option>
            <option value="business">Business</option>
            <option value="first">First Class</option>
            <option value="flexible">Flexible / Any</option>
          </select>
        </div>

        <div className="space-y-2">
          <label
            htmlFor={`${idPrefix}-optimizationPriority`}
            className="block text-sm font-medium text-slate-200"
          >
            Optimization Priority
          </label>
          <select
            id={`${idPrefix}-optimizationPriority`}
            name="optimizationPriority"
            defaultValue={goal?.optimizationPriority ?? "balanced"}
            className="fb-input"
            required
            disabled={isPending}
          >
            <option value="lowest_cash">Lowest Cash Cost</option>
            <option value="best_experience">Best Experience</option>
            <option value="simplest">Simplest Routing</option>
            <option value="balanced">Balanced</option>
          </select>
        </div>

        {isEdit ? (
          <div className="space-y-2">
            <label
              htmlFor={`${idPrefix}-status`}
              className="block text-sm font-medium text-slate-200"
            >
              Status
            </label>
            <select
              id={`${idPrefix}-status`}
              name="status"
              defaultValue={goal.status}
              className="fb-input"
              required
              disabled={isPending}
            >
              <option value="draft">Draft</option>
              <option value="active">Active</option>
              <option value="paused">Paused</option>
              <option value="completed">Completed</option>
            </select>
          </div>
        ) : null}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <label
            htmlFor={`${idPrefix}-maximumCashBudget`}
            className="block text-sm font-medium text-slate-200"
          >
            Maximum Cash Budget (USD){" "}
            <span className="text-slate-500">(optional)</span>
          </label>
          <input
            id={`${idPrefix}-maximumCashBudget`}
            name="maximumCashBudget"
            type="number"
            min="0"
            max="9999999999.99"
            step="0.01"
            placeholder="e.g., 2000"
            className="fb-input"
            defaultValue={goal?.maximumCashBudget ?? ""}
            disabled={isPending}
          />
        </div>

        <label className="flex items-center gap-3 self-end rounded-lg border border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-200">
          <input
            name="allowNewCards"
            type="checkbox"
            defaultChecked={goal?.allowNewCards ?? false}
            disabled={isPending}
            className="h-4 w-4 accent-sky-400"
          />
          Include new card options
        </label>
      </div>

      {state?.success === false ? (
        <div className="rounded-lg border border-rose-400/20 bg-rose-400/10 p-4 text-sm text-rose-200">
          <p className="font-medium">Something went wrong</p>
          <p className="mt-1 text-rose-100/80">{state.error}</p>
        </div>
      ) : null}

      {state?.success === true ? (
        <div className="rounded-lg border border-emerald-400/20 bg-emerald-400/10 p-4 text-sm text-emerald-200">
          <p className="font-medium">Success</p>
          <p className="mt-1 text-emerald-100/80">{state.message}</p>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-3 pt-2">
        <button
          type="submit"
          disabled={isPending}
          className="fb-btn disabled:cursor-not-allowed disabled:opacity-70"
        >
          {isPending
            ? isEdit
              ? "Saving..."
              : "Creating..."
            : isEdit
              ? "Save changes"
              : "Create goal"}
        </button>
        {isEdit && onCancel ? (
          <button
            type="button"
            onClick={onCancel}
            disabled={isPending}
            className="fb-btn-secondary disabled:cursor-not-allowed disabled:opacity-70"
          >
            Cancel
          </button>
        ) : null}
      </div>
    </form>
  );
}
