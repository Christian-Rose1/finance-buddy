"use client";

/**
 * Client panel for building and rendering a saved goal's strategy.
 *
 * The staged hook sends only goalId and runId back to server actions. Research
 * payloads, signatures, balances, and generated strategy data remain server
 * controlled throughout generation and finalization retries.
 */

import { Loader2, Sparkles } from "lucide-react";
import type { PersonalizedStrategy } from "@/lib/goals/strategyTypes";
import { AwardOptionsSection } from "./goal-strategy/award-options-section";
import { GenerationProgress } from "./goal-strategy/generation-progress";
import { StrategyResult } from "./goal-strategy/strategy-result";
import { useGoalStrategyGeneration } from "./goal-strategy/use-goal-strategy-generation";

export function GoalStrategyPanel({
  goalId,
  initialStrategy = null,
}: {
  goalId: string;
  initialStrategy?: PersonalizedStrategy | null;
}) {
  const {
    isGenerating,
    currentStage,
    runId,
    flightStatus,
    flightOptions,
    flightMessage,
    hotelStatus,
    hotelOptions,
    hotelMessage,
    finalStatus,
    canRetryFinalization,
    error,
    saveMessage,
    isSaved,
    strategy,
    generate,
    retryFinalization,
  } = useGoalStrategyGeneration(goalId, initialStrategy);

  const retryFinal =
    finalStatus === "failed" && runId && canRetryFinalization;

  return (
    <div
      className="mt-6 border-t border-white/5 pt-4"
      aria-busy={isGenerating}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-medium text-slate-300">
            {strategy
              ? "Your personalized strategy"
              : "Ready to plan this trip?"}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            {strategy
              ? "Generated from your balances, cards, and spending."
              : "We'll research your programs and build a points strategy."}
          </p>
          {strategy ? (
            <span
              className={`mt-1 inline-block rounded-full border px-2 py-0.5 text-xs font-medium ${
                isSaved
                  ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-300"
                  : "border-amber-400/30 bg-amber-400/10 text-amber-300"
              }`}
            >
              {isSaved ? "Saved" : "Not saved"}
            </span>
          ) : null}
        </div>
        <button
          type="button"
          onClick={generate}
          disabled={isGenerating}
          className="fb-btn inline-flex items-center justify-center gap-2 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isGenerating ? (
            <>
              <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
              Building strategy...
            </>
          ) : (
            <>
              <Sparkles aria-hidden="true" className="h-4 w-4" />
              {strategy ? "Rebuild my strategy" : "Build my strategy"}
            </>
          )}
        </button>
      </div>

      <GenerationProgress
        isGenerating={isGenerating}
        currentStage={currentStage}
        flightStatus={flightStatus}
        flightMessage={flightMessage}
        hotelStatus={hotelStatus}
        hotelMessage={hotelMessage}
        finalStatus={finalStatus}
      />

      {finalStatus === "succeeded" ? (
        <p className="sr-only" role="status" aria-live="polite">
          {isSaved
            ? "Your strategy was built and saved."
            : "Your strategy was built but could not be saved."}
        </p>
      ) : null}

      {flightStatus === "succeeded" ? (
        <AwardOptionsSection
          kind="flight"
          options={flightOptions}
          className="mt-4"
          showEmpty
        />
      ) : null}

      {hotelStatus === "succeeded" ? (
        <AwardOptionsSection
          kind="hotel"
          options={hotelOptions}
          className="mt-4"
          showEmpty
        />
      ) : null}

      {saveMessage ? (
        <div
          className="mt-4 rounded-xl border border-amber-400/20 bg-amber-400/10 p-3"
          role="status"
          aria-live="polite"
        >
          <p className="text-sm text-amber-200">{saveMessage}</p>
        </div>
      ) : null}

      {error ? (
        <div
          className="mt-4 rounded-xl border border-rose-400/20 bg-rose-400/10 p-3"
          role="alert"
          aria-live="assertive"
        >
          <p className="text-sm font-medium text-rose-200">
            Strategy couldn&apos;t be built
          </p>
          <p className="mt-1 text-sm text-rose-100/80">{error}</p>
          <button
            type="button"
            onClick={retryFinal ? retryFinalization : generate}
            disabled={isGenerating}
            className="mt-3 inline-flex items-center gap-2 rounded-lg border border-rose-400/30 px-3 py-1.5 text-xs font-medium text-rose-200 transition hover:bg-rose-400/10 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {retryFinal ? "Try finishing again" : "Rebuild my strategy"}
          </button>
        </div>
      ) : null}

      {strategy ? <StrategyResult strategy={strategy} /> : null}
    </div>
  );
}
