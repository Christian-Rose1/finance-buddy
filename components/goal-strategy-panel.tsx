"use client";

/**
 * GoalStrategyPanel
 *
 * Client panel rendered for each saved goal on /goals. Lets the user trigger
 * personalized strategy generation via the generateGoalStrategyAction server
 * action and renders the returned PersonalizedStrategy.
 *
 * Trust rules:
 * - Renders only the strategy returned by the server action. No mock data,
 *   no generic fallback advice.
 * - Researched award pricing/availability is always labeled as a planning
 *   estimate, never live availability.
 */

import { useEffect, useRef, useState } from "react";
import {
  Sparkles,
  Loader2,
  AlertTriangle,
  Lightbulb,
  ListChecks,
  Shuffle,
  HelpCircle,
  Plane,
  Bed,
} from "lucide-react";
import { generateGoalStrategyAction } from "@/lib/goals/strategyActions";
import type {
  PersonalizedStrategy,
  StrategyFeasibility,
} from "@/lib/goals/strategyTypes";

const PROGRESS_MESSAGES = [
  "Researching award options for your programs…",
  "Interpreting the research…",
  "Building your personalized strategy…",
];

const FEASIBILITY_PRESENTATION: Record<
  StrategyFeasibility,
  { label: string; classes: string }
> = {
  on_track: {
    label: "On track",
    classes: "border-emerald-400/30 bg-emerald-400/10 text-emerald-300",
  },
  gap_remaining: {
    label: "Points gap remaining",
    classes: "border-amber-400/30 bg-amber-400/10 text-amber-300",
  },
  depends_on_new_card: {
    label: "Depends on a new card",
    classes: "border-sky-400/30 bg-sky-400/10 text-sky-300",
  },
  insufficient_information: {
    label: "More information needed",
    classes: "border-slate-400/30 bg-slate-400/10 text-slate-300",
  },
};

function formatPoints(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

function formatBalanceAsOf(value: string): string {
  const parsed = new Date(value);
  if (
    typeof value === "string" &&
    value.length > 0 &&
    !Number.isNaN(parsed.getTime())
  ) {
    return new Intl.DateTimeFormat("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    }).format(parsed);
  }
  return value;
}

const PRICING_BASIS_LABELS: Record<string, string> = {
  one_way: "One way",
  round_trip: "Round trip",
  per_night: "Per night",
  total_stay: "Total stay",
  unknown: "Pricing basis not confirmed",
};

const AVAILABILITY_LABELS: Record<string, string> = {
  available: "Available",
  unavailable: "Unavailable",
  unknown: "Unknown availability",
};

const OWNER_TYPE_LABELS: Record<string, string> = {
  self: "Self",
  companion: "Companion",
};

const VERIFICATION_LABELS: Record<string, string> = {
  verified: "Verified",
  unverified: "Unverified",
};

const ORIGIN_LABELS: Record<string, string> = {
  manual: "Manually entered",
  evidence: "Evidence-backed",
  connected: "Connected account",
};

export function GoalStrategyPanel({
  goalId,
  initialStrategy = null,
}: {
  goalId: string;
  initialStrategy?: PersonalizedStrategy | null;
}) {
  const [isGenerating, setIsGenerating] = useState(false);
  const [progressIndex, setProgressIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [isSaved, setIsSaved] = useState<boolean>(initialStrategy !== null);
  const [strategy, setStrategy] = useState<PersonalizedStrategy | null>(
    initialStrategy ?? null
  );
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, []);

  async function handleGenerate() {
    if (isGenerating) return;

    setIsGenerating(true);
    setError(null);
    setSaveMessage(null);
    setProgressIndex(0);

    if (intervalRef.current) {
      clearInterval(intervalRef.current);
    }
    intervalRef.current = setInterval(() => {
      setProgressIndex((i) => (i + 1) % PROGRESS_MESSAGES.length);
    }, 4000);

    try {
      const result = await generateGoalStrategyAction(goalId);
      if (result.success) {
        setStrategy(result.strategy);
        setIsSaved(result.saved);
        setSaveMessage(result.saveMessage);
      } else {
        setError(result.message);
      }
    } catch (error) {
      if (process.env.NODE_ENV === "development") {
        console.error(
          "[strategy-client-error]",
          error instanceof Error
            ? `${error.name}: ${error.message}`
            : "Unknown error"
        );
      }
      setError(
        "We couldn't build your strategy right now. Please try again in a moment."
      );
    } finally {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      setIsGenerating(false);
    }
  }

  const feasibility = strategy
    ? FEASIBILITY_PRESENTATION[strategy.feasibility]
    : null;

  return (
    <div className="mt-6 border-t border-white/5 pt-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-medium text-slate-300">
            {strategy ? "Your personalized strategy" : "Ready to plan this trip?"}
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
          onClick={handleGenerate}
          disabled={isGenerating}
          className="fb-btn inline-flex items-center justify-center gap-2 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isGenerating ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Working…
            </>
          ) : (
            <>
              <Sparkles className="h-4 w-4" />
              {strategy ? "Rebuild my strategy" : "Build my strategy"}
            </>
          )}
        </button>
      </div>

      {isGenerating ? (
        <div
          className="mt-4 flex items-center gap-3 rounded-xl border border-sky-400/20 bg-sky-400/5 p-3"
          role="status"
          aria-live="polite"
        >
          <Loader2 className="h-4 w-4 shrink-0 animate-spin text-sky-300" />
          <div>
            <p className="text-sm text-sky-200">
              {PROGRESS_MESSAGES[progressIndex]}
            </p>
            <p className="mt-0.5 text-xs text-slate-500">
              This can take up to a minute. Please keep this page open.
            </p>
          </div>
        </div>
      ) : null}

      {saveMessage ? (
        <div className="mt-4 rounded-xl border border-amber-400/20 bg-amber-400/10 p-3">
          <p className="text-sm text-amber-200">{saveMessage}</p>
        </div>
      ) : null}

      {error ? (
        <div className="mt-4 rounded-xl border border-rose-400/20 bg-rose-400/10 p-3">
          <p className="text-sm font-medium text-rose-200">
            Strategy couldn't be built
          </p>
          <p className="mt-1 text-sm text-rose-100/80">{error}</p>
          <button
            type="button"
            onClick={handleGenerate}
            disabled={isGenerating}
            className="mt-3 inline-flex items-center gap-2 rounded-lg border border-rose-400/30 px-3 py-1.5 text-xs font-medium text-rose-200 transition hover:bg-rose-400/10 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Try again
          </button>
        </div>
      ) : null}

      {strategy && feasibility ? (
        <div className="mt-4 space-y-4">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h4 className="text-base font-semibold text-white">
                {strategy.headline}
              </h4>
              <span
                className={`rounded-full border px-2.5 py-0.5 text-xs font-medium ${feasibility.classes}`}
              >
                {feasibility.label}
              </span>
            </div>
            <p className="mt-2 text-sm leading-relaxed text-slate-300">
              {strategy.summary}
            </p>
          </div>

          {strategy.pointsGap !== null ? (
            <div className="rounded-xl border border-amber-400/20 bg-amber-400/5 p-3">
              <p className="text-xs font-medium uppercase tracking-wide text-amber-300">
                Points gap
              </p>
              <p className="mt-1 text-lg font-semibold text-white">
                {formatPoints(strategy.pointsGap)} points
              </p>
              <p className="mt-0.5 text-xs text-slate-500">
                Estimated additional points needed to reach this goal.
              </p>
            </div>
          ) : null}

          {strategy.pointsInventory.length === 0 ? (
            <div className="rounded-xl border border-white/5 bg-white/[0.02] p-3">
              <p className="text-sm text-slate-400">
                No reward balances are currently available for this strategy.
              </p>
            </div>
          ) : null}

          {strategy.pointsInventory.length > 0 ? (
            <div>
              <p className="flex items-center gap-2 text-sm font-medium text-slate-200">
                <Sparkles className="h-4 w-4 text-sky-300" />
                Your points
              </p>

              {strategy.pointsInventory.filter(
                (account) => account.verificationStatus === "verified"
              ).length > 0 ? (
                <div className="mt-3">
                  <p className="text-xs font-medium uppercase tracking-wide text-emerald-300">
                    Verified balances
                  </p>
                  <p className="mt-0.5 text-xs text-slate-500">
                    These balances are marked verified in Finance Buddy.
                  </p>
                  <ul className="mt-2 space-y-2">
                    {strategy.pointsInventory
                      .filter(
                        (account) => account.verificationStatus === "verified"
                      )
                      .map((account) => (
                        <li
                          key={account.accountId}
                          className="rounded-xl border border-white/5 bg-white/[0.02] p-3"
                        >
                          <p className="text-sm font-medium text-white">
                            {account.programName ?? "Unknown reward program"}
                          </p>
                          <p className="mt-1 text-sm font-semibold text-white">
                            {formatPoints(account.balance)} points
                          </p>
                          <p className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-slate-400">
                            <span>
                              Balance: {formatPoints(account.balance)}
                            </span>
                            <span>
                              {OWNER_TYPE_LABELS[account.ownerType] ??
                                account.ownerType}
                            </span>
                            <span>
                              {VERIFICATION_LABELS[account.verificationStatus] ??
                                account.verificationStatus}
                            </span>
                            <span>
                              {ORIGIN_LABELS[account.origin] ?? account.origin}
                            </span>
                          </p>
                          <p className="mt-1 text-xs text-slate-500">
                            {account.ownerLabel} · Balance as of{" "}
                            {formatBalanceAsOf(account.balanceAsOf)}
                          </p>
                        </li>
                      ))}
                  </ul>
                </div>
              ) : null}

              {strategy.pointsInventory.filter(
                (account) => account.verificationStatus === "unverified"
              ).length > 0 ? (
                <div className="mt-4">
                  <p className="text-xs font-medium uppercase tracking-wide text-amber-300">
                    Unverified balances
                  </p>
                  <p className="mt-0.5 text-xs text-slate-500">
                    Verify these balances before relying on them for booking
                    decisions.
                  </p>
                  <ul className="mt-2 space-y-2">
                    {strategy.pointsInventory
                      .filter(
                        (account) =>
                          account.verificationStatus === "unverified"
                      )
                      .map((account) => (
                        <li
                          key={account.accountId}
                          className="rounded-xl border border-white/5 bg-white/[0.02] p-3"
                        >
                          <p className="text-sm font-medium text-white">
                            {account.programName ?? "Unknown reward program"}
                          </p>
                          <p className="mt-1 text-sm font-semibold text-white">
                            {formatPoints(account.balance)} points
                          </p>
                          <p className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-slate-400">
                            <span>
                              Balance: {formatPoints(account.balance)}
                            </span>
                            <span>
                              {OWNER_TYPE_LABELS[account.ownerType] ??
                                account.ownerType}
                            </span>
                            <span>
                              {VERIFICATION_LABELS[account.verificationStatus] ??
                                account.verificationStatus}
                            </span>
                            <span>
                              {ORIGIN_LABELS[account.origin] ?? account.origin}
                            </span>
                          </p>
                          <p className="mt-1 text-xs text-slate-500">
                            {account.ownerLabel} · Balance as of{" "}
                            {formatBalanceAsOf(account.balanceAsOf)}
                          </p>
                        </li>
                      ))}
                  </ul>
                </div>
              ) : null}
            </div>
          ) : null}

          {strategy.flightOptions.length > 0 ? (
            <div>
              <p className="flex items-center gap-2 text-sm font-medium text-slate-200">
                <Plane className="h-4 w-4 text-sky-300" />
                Flight options
              </p>
              <ul className="mt-2 space-y-2">
                {strategy.flightOptions.map((option) => (
                  <li
                    key={option.id}
                    className="rounded-xl border border-white/5 bg-white/[0.02] p-3"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm font-medium text-white">
                        {option.programName}
                      </p>
                      <p className="text-sm font-semibold text-white">
                        {formatPoints(option.pointsRequired)} points
                      </p>
                    </div>
                    <p className="mt-1 text-xs text-slate-400">
                      {PRICING_BASIS_LABELS[option.pricingBasis] ??
                        option.pricingBasis}
                    </p>
                    {option.itineraryLabel ? (
                      <p className="mt-1 text-sm text-slate-300">
                        {option.itineraryLabel}
                      </p>
                    ) : null}
                    <p className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-slate-400">
                      <span>
                        Availability:{" "}
                        {AVAILABILITY_LABELS[option.availabilityStatus] ??
                          option.availabilityStatus}
                      </span>
                      {option.cabin ? <span>Cabin: {option.cabin}</span> : null}
                      {option.cashFees !== null ? (
                        <span>Fees: ${option.cashFees}</span>
                      ) : null}
                      {option.seats !== null ? (
                        <span>Seats: {option.seats}</span>
                      ) : null}
                    </p>
                    {option.sourceId ? (
                      <p className="mt-1 break-words text-xs text-slate-500">
                        Sources: {option.sourceId}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-xs leading-relaxed text-slate-500">
                Flight pricing and availability are planning estimates from web
                research, not live availability. Unknown availability means it
                is not confirmed.
              </p>
            </div>
          ) : null}

          {strategy.hotelOptions.length > 0 ? (
            <div>
              <p className="flex items-center gap-2 text-sm font-medium text-slate-200">
                <Bed className="h-4 w-4 text-sky-300" />
                Hotel options
              </p>
              <ul className="mt-2 space-y-2">
                {strategy.hotelOptions.map((option) => (
                  <li
                    key={option.id}
                    className="rounded-xl border border-white/5 bg-white/[0.02] p-3"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm font-medium text-white">
                        {option.programName}
                      </p>
                      <p className="text-sm font-semibold text-white">
                        {formatPoints(option.pointsRequired)} points
                      </p>
                    </div>
                    <p className="mt-1 text-xs text-slate-400">
                      {PRICING_BASIS_LABELS[option.pricingBasis] ??
                        option.pricingBasis}
                    </p>
                    {option.itineraryLabel ? (
                      <p className="mt-1 text-sm text-slate-300">
                        {option.itineraryLabel}
                      </p>
                    ) : null}
                    <p className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-slate-400">
                      <span>
                        Availability:{" "}
                        {AVAILABILITY_LABELS[option.availabilityStatus] ??
                          option.availabilityStatus}
                      </span>
                      {option.cashFees !== null ? (
                        <span>Fees: ${option.cashFees}</span>
                      ) : null}
                    </p>
                    {option.sourceId ? (
                      <p className="mt-1 break-words text-xs text-slate-500">
                        Sources: {option.sourceId}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-xs leading-relaxed text-slate-500">
                Hotel pricing and availability are planning estimates from web
                research, not live availability. Unknown availability means it
                is not confirmed.
              </p>
            </div>
          ) : null}

          {strategy.actions.length > 0 ? (
            <div>
              <p className="flex items-center gap-2 text-sm font-medium text-slate-200">
                <ListChecks className="h-4 w-4 text-emerald-300" />
                Recommended actions
              </p>
              <ol className="mt-2 space-y-2">
                {[...strategy.actions]
                  .sort((a, b) => a.priority - b.priority)
                  .map((action, index) => (
                    <li
                      key={`${action.title}-${index}`}
                      className="rounded-xl border border-white/5 bg-white/[0.02] p-3"
                    >
                      <div className="flex items-start gap-3">
                        <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-400/10 text-xs font-semibold text-emerald-300">
                          {action.priority}
                        </span>
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-white">
                            {action.title}
                          </p>
                          <p className="mt-1 text-sm text-slate-400">
                            {action.explanation}
                          </p>
                          {action.deadline ? (
                            <p className="mt-1 text-xs text-amber-300">
                              Deadline: {action.deadline}
                            </p>
                          ) : null}
                          {action.sourceIds.length > 0 ? (
                            <p className="mt-1 break-words text-xs text-slate-500">
                              Sources: {action.sourceIds.join(", ")}
                            </p>
                          ) : null}
                        </div>
                      </div>
                    </li>
                  ))}
              </ol>
            </div>
          ) : null}

          {strategy.alternatives.length > 0 ? (
            <div>
              <p className="flex items-center gap-2 text-sm font-medium text-slate-200">
                <Shuffle className="h-4 w-4 text-sky-300" />
                Alternatives to consider
              </p>
              <ul className="mt-2 space-y-2">
                {strategy.alternatives.map((alt, index) => (
                  <li
                    key={`${alt.title}-${index}`}
                    className="rounded-xl border border-white/5 bg-white/[0.02] p-3"
                  >
                    <p className="text-sm font-medium text-white">{alt.title}</p>
                    <p className="mt-1 text-sm text-slate-400">{alt.tradeoff}</p>
                    {alt.sourceIds.length > 0 ? (
                      <p className="mt-1 break-words text-xs text-slate-500">
                        Sources: {alt.sourceIds.join(", ")}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {strategy.assumptions.length > 0 ? (
            <div>
              <p className="flex items-center gap-2 text-sm font-medium text-slate-200">
                <Lightbulb className="h-4 w-4 text-sky-300" />
                Assumptions
              </p>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-400">
                {strategy.assumptions.map((assumption, index) => (
                  <li key={index}>{assumption}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {strategy.warnings.length > 0 ? (
            <div className="rounded-xl border border-amber-400/20 bg-amber-400/5 p-3">
              <p className="flex items-center gap-2 text-sm font-medium text-amber-200">
                <AlertTriangle className="h-4 w-4" />
                Warnings
              </p>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-amber-100/80">
                {strategy.warnings.map((warning, index) => (
                  <li key={index}>{warning}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {strategy.followUpQuestions.length > 0 ? (
            <div>
              <p className="flex items-center gap-2 text-sm font-medium text-slate-200">
                <HelpCircle className="h-4 w-4 text-sky-300" />
                To sharpen this plan
              </p>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-400">
                {strategy.followUpQuestions.map((question, index) => (
                  <li key={index}>{question}</li>
                ))}
              </ul>
            </div>
          ) : null}

          <p className="flex items-start gap-2 border-t border-white/5 pt-3 text-xs leading-relaxed text-slate-500">
            <Plane className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-500" />
            Award pricing and availability mentioned in this strategy come from
            web research and are planning estimates only — not live availability.
            Confirm exact pricing and seats with the airline or program before
            transferring points or booking.
          </p>
        </div>
      ) : null}
    </div>
  );
}
