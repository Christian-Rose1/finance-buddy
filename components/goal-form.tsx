"use client";

import { useState, useTransition, useRef } from "react";
import { createGoalAction, type GoalActionState } from "@/lib/goals/actions";

interface GoalFormProps {
  onSuccess?: (state: GoalActionState) => void;
}

export function GoalForm({ onSuccess }: GoalFormProps) {
  const [state, setState] = useState<GoalActionState | null>(null);
  const [isPending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);

  async function handleSubmit(formData: FormData) {
    if (isPending) return;

    startTransition(async () => {
      const nextState = await createGoalAction(state, formData);
      setState(nextState);

      if (nextState.success) {
        formRef.current?.reset();
        if (onSuccess) {
          onSuccess(nextState);
        }
      }
    });
  }

  return (
    <form ref={formRef} action={handleSubmit} className="space-y-4">
      {/* Title */}
      <div className="space-y-2">
        <label htmlFor="title" className="block text-sm font-medium text-slate-200">
          Goal Title
        </label>
        <input
          id="title"
          name="title"
          type="text"
          placeholder="e.g., Summer Trip to Europe"
          className="fb-input"
          required
          maxLength={100}
          autoComplete="off"
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {/* Origins */}
        <div className="space-y-2">
          <label htmlFor="origins" className="block text-sm font-medium text-slate-200">
            Flying from <span className="text-slate-400">(cities or airports)</span>
          </label>
          <input
            id="origins"
            name="origins"
            type="text"
            placeholder="e.g., Denver, New York City"
            className="fb-input"
            required
            autoComplete="off"
          />
        </div>

        {/* Destinations */}
        <div className="space-y-2">
          <label htmlFor="destinations" className="block text-sm font-medium text-slate-200">
            Destinations <span className="text-slate-400">(comma-separated locations)</span>
          </label>
          <input
            id="destinations"
            name="destinations"
            type="text"
            placeholder="e.g., London, Paris"
            className="fb-input"
            required
            autoComplete="off"
          />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {/* Earliest Departure */}
        <div className="space-y-2">
          <label htmlFor="earliestDeparture" className="block text-sm font-medium text-slate-200">
            Earliest Departure
          </label>
          <input
            id="earliestDeparture"
            name="earliestDeparture"
            type="date"
            className="fb-input"
          />
        </div>

        {/* Latest Return */}
        <div className="space-y-2">
          <label htmlFor="latestReturn" className="block text-sm font-medium text-slate-200">
            Latest Return
          </label>
          <input
            id="latestReturn"
            name="latestReturn"
            type="date"
            className="fb-input"
          />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        {/* Minimum Nights */}
        <div className="space-y-2">
          <label htmlFor="minimumNights" className="block text-sm font-medium text-slate-200">
            Minimum Nights
          </label>
          <input
            id="minimumNights"
            name="minimumNights"
            type="number"
            min="1"
            step="1"
            placeholder="e.g., 5"
            className="fb-input"
          />
        </div>

        {/* Maximum Nights */}
        <div className="space-y-2">
          <label htmlFor="maximumNights" className="block text-sm font-medium text-slate-200">
            Maximum Nights
          </label>
          <input
            id="maximumNights"
            name="maximumNights"
            type="number"
            min="1"
            step="1"
            placeholder="e.g., 14"
            className="fb-input"
          />
        </div>

        {/* Traveler Count */}
        <div className="space-y-2">
          <label htmlFor="travelerCount" className="block text-sm font-medium text-slate-200">
            Travelers
          </label>
          <input
            id="travelerCount"
            name="travelerCount"
            type="number"
            min="1"
            step="1"
            defaultValue="1"
            className="fb-input"
            required
          />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        {/* Cabin Preference */}
        <div className="space-y-2">
          <label htmlFor="cabinPreference" className="block text-sm font-medium text-slate-200">
            Cabin Preference
          </label>
          <select
            id="cabinPreference"
            name="cabinPreference"
            defaultValue="economy"
            className="fb-input"
            required
          >
            <option value="economy">Economy</option>
            <option value="premium_economy">Premium Economy</option>
            <option value="business">Business</option>
            <option value="first">First Class</option>
            <option value="flexible">Flexible / Any</option>
          </select>
        </div>

        {/* Optimization Priority */}
        <div className="space-y-2">
          <label htmlFor="optimizationPriority" className="block text-sm font-medium text-slate-200">
            Optimization Priority
          </label>
          <select
            id="optimizationPriority"
            name="optimizationPriority"
            defaultValue="balanced"
            className="fb-input"
            required
          >
            <option value="lowest_cash">Lowest Cash Cost</option>
            <option value="best_experience">Best Experience</option>
            <option value="simplest">Simplest Routing</option>
            <option value="balanced">Balanced</option>
          </select>
        </div>

        {/* Allow New Cards */}
        <div className="space-y-2">
          <label htmlFor="allowNewCards" className="block text-sm font-medium text-slate-200">
            Allow New Cards
          </label>
          <select
            id="allowNewCards"
            name="allowNewCards"
            defaultValue="no"
            className="fb-input"
            required
          >
            <option value="yes">Yes</option>
            <option value="no">No</option>
          </select>
        </div>
      </div>

      {/* Maximum Cash Budget */}
      <div className="space-y-2">
        <label htmlFor="maximumCashBudget" className="block text-sm font-medium text-slate-200">
          Maximum Cash Budget (USD) <span className="text-slate-500">(optional)</span>
        </label>
        <input
          id="maximumCashBudget"
          name="maximumCashBudget"
          type="number"
          min="0"
          step="0.01"
          placeholder="e.g., 2000"
          className="fb-input sm:w-48"
        />
      </div>

      {/* Error and Success Messages */}
      {state?.success === false ? (
        <div className="rounded-2xl border border-rose-400/20 bg-rose-400/10 p-4 text-sm text-rose-200">
          <p className="font-medium">Something went wrong</p>
          <p className="mt-1 text-rose-100/80">{state.error}</p>
        </div>
      ) : null}

      {state?.success === true ? (
        <div className="rounded-2xl border border-emerald-400/20 bg-emerald-400/10 p-4 text-sm text-emerald-200">
          <p className="font-medium">Success</p>
          <p className="mt-1 text-emerald-100/80">{state.message}</p>
        </div>
      ) : null}

      <div className="flex items-center gap-3 pt-2">
        <button
          type="submit"
          disabled={isPending}
          className="fb-btn disabled:cursor-not-allowed disabled:opacity-70"
        >
          {isPending ? "Creating Goal…" : "Create Goal"}
        </button>
      </div>
    </form>
  );
}
