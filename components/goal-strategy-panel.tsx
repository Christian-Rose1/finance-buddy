"use client";

/**
 * GoalStrategyPanel
 *
 * Client panel rendered for each saved goal on /goals. Lets the user trigger
 * personalized strategy generation via staged server actions and renders the
 * returned PersonalizedStrategy.
 *
 * Generation flow:
 *   1. generateGoalFlightStageAction(goalId)
 *   2. generateGoalHotelStageAction(goalId, runId)
 *   3. finalizeGoalStrategyRunAction(goalId, runId)
 *
 * Trust rules:
 * - Renders only the strategy returned by the server action. No mock data,
 *   no generic fallback advice.
 * - Researched award pricing/availability is always labeled as a planning
 *   estimate, never live availability.
 * - Only goalId and runId are sent for finalization; no stage results,
 *   payloads, signatures, balances, or customer data are passed back.
 */

import { useState } from "react";
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
  ArrowRightLeft,
  CheckCircle2,
  XCircle,
  AlertCircle,
  MinusCircle,
} from "lucide-react";
import {
  generateGoalFlightStageAction,
  generateGoalHotelStageAction,
  finalizeGoalStrategyRunAction,
} from "@/lib/goals/strategyActions";
import type {
  PersonalizedStrategy,
  StrategyAwardOption,
  StrategyFeasibility,
  StrategyAllocationScenario,
  StrategyPointsAllocation,
} from "@/lib/goals/strategyTypes";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ClientGenerationStage = "idle" | "flight" | "hotel" | "final";
type ClientStageStatus = "idle" | "loading" | "succeeded" | "failed";

type StepState = "waiting" | "in-progress" | "complete" | "could-not-complete";

// ---------------------------------------------------------------------------
// Presentation helpers
// ---------------------------------------------------------------------------

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

const SCENARIO_KIND_LABELS: Record<string, string> = {
  balanced: "Balanced plan",
  flight_first: "Flight-first plan",
  hotel_first: "Hotel-first plan",
  fallback: "Fallback plan",
};

const SCENARIO_KIND_ORDER: Record<string, number> = {
  balanced: 0,
  flight_first: 1,
  hotel_first: 2,
  fallback: 3,
};

const SCENARIO_STATUS_PRESENTATION: Record<
  StrategyAllocationScenario["status"],
  { label: string; icon: React.ReactNode; classes: string }
> = {
  feasible: {
    label: "Feasible",
    icon: <CheckCircle2 className="h-4 w-4 text-emerald-300" />,
    classes: "border-emerald-400/30 bg-emerald-400/10 text-emerald-300",
  },
  gap: {
    label: "Points gap",
    icon: <AlertCircle className="h-4 w-4 text-amber-300" />,
    classes: "border-amber-400/30 bg-amber-400/10 text-amber-300",
  },
  conditional: {
    label: "Conditional",
    icon: <AlertCircle className="h-4 w-4 text-sky-300" />,
    classes: "border-sky-400/30 bg-sky-400/10 text-sky-300",
  },
  insufficient_information: {
    label: "Insufficient information",
    icon: <MinusCircle className="h-4 w-4 text-slate-400" />,
    classes: "border-slate-400/30 bg-slate-400/10 text-slate-300",
  },
};

const FUNDING_METHOD_LABELS: Record<string, string> = {
  transfer_source: "Transfer from",
  direct_program: "Direct program",
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

const STEP_LABELS = [
  "Researching flight options",
  "Researching hotel options",
  "Building your personalized points plan",
] as const;

const STEP_STATE_PRESENTATION: Record<
  StepState,
  { icon: React.ReactNode; label: string; classes: string }
> = {
  waiting: {
    icon: <MinusCircle className="h-4 w-4 text-slate-600" />,
    label: "Waiting",
    classes: "text-slate-500",
  },
  "in-progress": {
    icon: <Loader2 className="h-4 w-4 animate-spin text-sky-300" />,
    label: "In progress",
    classes: "text-sky-200",
  },
  complete: {
    icon: <CheckCircle2 className="h-4 w-4 text-emerald-300" />,
    label: "Complete",
    classes: "text-emerald-300",
  },
  "could-not-complete": {
    icon: <XCircle className="h-4 w-4 text-rose-300" />,
    label: "Could not complete",
    classes: "text-rose-300",
  },
};

// ---------------------------------------------------------------------------
// Award option card (reused for previews)
// ---------------------------------------------------------------------------

function AwardOptionCard({ option }: { option: StrategyAwardOption }) {
  return (
    <li className="rounded-xl border border-white/5 bg-white/[0.02] p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium text-white">{option.programName}</p>
        <p className="text-sm font-semibold text-white">
          {formatPoints(option.pointsRequired)} points
        </p>
      </div>
      <p className="mt-1 text-xs text-slate-400">
        {PRICING_BASIS_LABELS[option.pricingBasis] ?? option.pricingBasis}
      </p>
      {option.itineraryLabel ? (
        <p className="mt-1 text-sm text-slate-300">{option.itineraryLabel}</p>
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
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function GoalStrategyPanel({
  goalId,
  initialStrategy = null,
}: {
  goalId: string;
  initialStrategy?: PersonalizedStrategy | null;
}) {
  // --- generation state ---
  const [isGenerating, setIsGenerating] = useState(false);
  const [currentStage, setCurrentStage] =
    useState<ClientGenerationStage>("idle");
  const [runId, setRunId] = useState<string | null>(null);

  // --- stage status ---
  const [flightStatus, setFlightStatus] = useState<ClientStageStatus>("idle");
  const [flightOptions, setFlightOptions] = useState<StrategyAwardOption[]>([]);
  const [flightMessage, setFlightMessage] = useState<string | null>(null);

  const [hotelStatus, setHotelStatus] = useState<ClientStageStatus>("idle");
  const [hotelOptions, setHotelOptions] = useState<StrategyAwardOption[]>([]);
  const [hotelMessage, setHotelMessage] = useState<string | null>(null);

  const [finalStatus, setFinalStatus] = useState<ClientStageStatus>("idle");

  // --- result state ---
  const [error, setError] = useState<string | null>(null);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [isSaved, setIsSaved] = useState<boolean>(initialStrategy !== null);
  const [strategy, setStrategy] = useState<PersonalizedStrategy | null>(
    initialStrategy ?? null
  );

  // ------------------------------------------------------------------
  // Generate: staged flight → hotel → final
  // ------------------------------------------------------------------

  async function handleGenerate() {
    if (isGenerating) return;

    // Preserve the existing saved strategy throughout rebuild.
    const previousStrategy = strategy;

    // Clear only prior transient stage results / errors / saveMessage.
    setIsGenerating(true);
    setError(null);
    setSaveMessage(null);
    setCurrentStage("flight");
    setRunId(null);
    setFlightStatus("loading");
    setFlightOptions([]);
    setFlightMessage(null);
    setHotelStatus("idle");
    setHotelOptions([]);
    setHotelMessage(null);
    setFinalStatus("idle");

    // Track the current stage locally so the catch block can mark the
    // correct stage as failed even though React state is batched.
    let activeStage: ClientGenerationStage = "flight";

    try {
      // --- Stage 1: Flight ---
      activeStage = "flight";
      const flightResult = await generateGoalFlightStageAction(goalId);

      if (!flightResult.success) {
        // Hard failure — stop.
        setFlightStatus("failed");
        setFlightMessage(flightResult.message);
        return;
      }

      setRunId(flightResult.runId);

      if (flightResult.stageStatus === "failed") {
        // Soft failure — retain runId, continue to hotel.
        setFlightStatus("failed");
        setFlightMessage(flightResult.message);
      } else {
        setFlightStatus("succeeded");
        setFlightOptions(flightResult.options);
      }

      // --- Stage 2: Hotel ---
      activeStage = "hotel";
      setCurrentStage("hotel");
      setHotelStatus("loading");

      const hotelResult = await generateGoalHotelStageAction(
        goalId,
        flightResult.runId
      );

      if (!hotelResult.success) {
        // Hard failure — stop.
        setHotelStatus("failed");
        setHotelMessage(hotelResult.message);
        return;
      }

      if (hotelResult.stageStatus === "failed") {
        // Soft failure — continue to final.
        setHotelStatus("failed");
        setHotelMessage(hotelResult.message);
      } else {
        setHotelStatus("succeeded");
        setHotelOptions(hotelResult.options);
      }

      // --- Stage 3: Final ---
      activeStage = "final";
      setCurrentStage("final");
      setFinalStatus("loading");

      const finalResult = await finalizeGoalStrategyRunAction(
        goalId,
        flightResult.runId
      );

      if (finalResult.success) {
        setStrategy(finalResult.strategy);
        setIsSaved(finalResult.saved);
        setSaveMessage(finalResult.saveMessage);
        setFinalStatus("succeeded");
        // Clear transient flight/hotel previews after the complete
        // strategy is installed.
        setFlightOptions([]);
        setHotelOptions([]);
      } else {
        setFinalStatus("failed");
        setError(finalResult.message);
        // Preserve previous saved strategy and successfully returned
        // flight/hotel previews.
      }
    } catch (err) {
      // Client exception — mark the active stage as failed, preserve
      // previous strategy and completed previews.
      if (process.env.NODE_ENV === "development") {
        console.error(
          "[strategy-client-error]",
          err instanceof Error
            ? `${err.name}: ${err.message}`
            : "Unknown error"
        );
      }

      const genericMessage =
        "We couldn't build your strategy right now. Please try again in a moment.";

      if (activeStage === "flight") {
        setFlightStatus("failed");
        setFlightMessage(genericMessage);
      } else if (activeStage === "hotel") {
        setHotelStatus("failed");
        setHotelMessage(genericMessage);
      } else {
        setFinalStatus("failed");
        setError(genericMessage);
      }
    } finally {
      setIsGenerating(false);
    }
  }

  // ------------------------------------------------------------------
  // Derived values
  // ------------------------------------------------------------------

  const feasibility = strategy
    ? FEASIBILITY_PRESENTATION[strategy.feasibility]
    : null;

  /** Progress section is visible from generation start until the final
   *  strategy successfully replaces the previous one. */
  const showProgress =
    isGenerating ||
    (currentStage !== "idle" && finalStatus !== "succeeded");

  function stepState(status: ClientStageStatus): StepState {
    if (status === "succeeded") return "complete";
    if (status === "failed") return "could-not-complete";
    if (status === "loading") return "in-progress";
    return "waiting";
  }

  const flightStep = stepState(flightStatus);
  const hotelStep = stepState(hotelStatus);
  const finalStep = stepState(finalStatus);

  const stepStates = [flightStep, hotelStep, finalStep];

  // ------------------------------------------------------------------
  // Render
  // ------------------------------------------------------------------

  return (
    <div className="mt-6 border-t border-white/5 pt-4">
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

      {/* ---- Building your strategy progress ---- */}
      {showProgress ? (
        <div className="mt-4 space-y-3">
          <p className="text-sm font-medium text-slate-200">
            Building your strategy
          </p>

          <ol className="space-y-2">
            {STEP_LABELS.map((label, index) => {
              const state = stepStates[index];
              const pres = STEP_STATE_PRESENTATION[state];
              return (
                <li
                  key={label}
                  className={`flex items-center gap-3 rounded-lg border px-3 py-2 ${
                    state === "in-progress"
                      ? "border-sky-400/20 bg-sky-400/5"
                      : "border-white/5 bg-white/[0.02]"
                  }`}
                >
                  {pres.icon}
                  <div className="min-w-0 flex-1">
                    <p className={`text-sm ${pres.classes}`}>{label}</p>
                    <p className="text-xs text-slate-500">{pres.label}</p>
                  </div>
                </li>
              );
            })}
          </ol>

          {/* Flight soft-failure message */}
          {flightStatus === "failed" && flightMessage ? (
            <div className="rounded-lg border border-amber-400/20 bg-amber-400/5 p-2">
              <p className="text-xs text-amber-100/80">{flightMessage}</p>
            </div>
          ) : null}

          {/* Hotel soft-failure message */}
          {hotelStatus === "failed" && hotelMessage ? (
            <div className="rounded-lg border border-amber-400/20 bg-amber-400/5 p-2">
              <p className="text-xs text-amber-100/80">{hotelMessage}</p>
            </div>
          ) : null}
        </div>
      ) : null}

      {/* ---- Flight preview (shown as soon as flight succeeds, cleared on final success) ---- */}
      {flightStatus === "succeeded" && flightOptions.length > 0 ? (
        <div className="mt-4">
          <p className="flex items-center gap-2 text-sm font-medium text-slate-200">
            <Plane className="h-4 w-4 text-sky-300" />
            Flight options
          </p>
          <ul className="mt-2 space-y-2">
            {flightOptions.map((option) => (
              <AwardOptionCard key={option.id} option={option} />
            ))}
          </ul>
          <p className="mt-2 text-xs leading-relaxed text-slate-500">
            Flight pricing and availability are planning estimates from web
            research, not live availability. Unknown availability means it is
            not confirmed.
          </p>
        </div>
      ) : null}

      {flightStatus === "succeeded" && flightOptions.length === 0 ? (
        <div className="mt-4 rounded-xl border border-white/5 bg-white/[0.02] p-3">
          <p className="text-sm text-slate-400">
            No validated flight options were found.
          </p>
        </div>
      ) : null}

      {/* ---- Hotel preview (shown as soon as hotel succeeds, cleared on final success) ---- */}
      {hotelStatus === "succeeded" && hotelOptions.length > 0 ? (
        <div className="mt-4">
          <p className="flex items-center gap-2 text-sm font-medium text-slate-200">
            <Bed className="h-4 w-4 text-sky-300" />
            Hotel options
          </p>
          <ul className="mt-2 space-y-2">
            {hotelOptions.map((option) => (
              <AwardOptionCard key={option.id} option={option} />
            ))}
          </ul>
          <p className="mt-2 text-xs leading-relaxed text-slate-500">
            Hotel pricing and availability are planning estimates from web
            research, not live availability. Unknown availability means it is
            not confirmed.
          </p>
        </div>
      ) : null}

      {hotelStatus === "succeeded" && hotelOptions.length === 0 ? (
        <div className="mt-4 rounded-xl border border-white/5 bg-white/[0.02] p-3">
          <p className="text-sm text-slate-400">
            No validated hotel options were found.
          </p>
        </div>
      ) : null}

      {/* ---- Save message ---- */}
      {saveMessage ? (
        <div className="mt-4 rounded-xl border border-amber-400/20 bg-amber-400/10 p-3">
          <p className="text-sm text-amber-200">{saveMessage}</p>
        </div>
      ) : null}

      {/* ---- Error ---- */}
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

      {/* ---- Strategy result ---- */}
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

          {/* Allocation scenarios */}
          {(() => {
            const allocationScenarios = strategy.allocationScenarios ?? [];

            if (allocationScenarios.length === 0) {
              return (
                <div className="rounded-xl border border-white/5 bg-white/[0.02] p-3">
                  <p className="text-sm text-slate-400">
                    Rebuild this strategy to generate personalized
                    points-allocation scenarios.
                  </p>
                </div>
              );
            }

            const inventoryByAccount = new Map(
              strategy.pointsInventory.map((item) => [item.accountId, item])
            );

            const sortedScenarios = [...allocationScenarios].sort(
              (a, b) =>
                (SCENARIO_KIND_ORDER[a.kind] ?? 99) -
                (SCENARIO_KIND_ORDER[b.kind] ?? 99)
            );

            return (
              <div>
                <p className="flex items-center gap-2 text-sm font-medium text-slate-200">
                  <ArrowRightLeft className="h-4 w-4 text-sky-300" />
                  Ways to use your points
                </p>

                <div className="mt-3 space-y-3">
                  {sortedScenarios.map((scenario) => {
                    const statusPres = SCENARIO_STATUS_PRESENTATION[scenario.status];
                    const hasAllocations = scenario.allocations.length > 0;

                    return (
                      <div
                        key={scenario.id}
                        className="rounded-xl border border-white/5 bg-white/[0.02] p-3"
                      >
                        {/* Scenario header */}
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-sm font-medium text-white">
                            {SCENARIO_KIND_LABELS[scenario.kind] ??
                              scenario.title}
                          </p>
                          {statusPres ? (
                            <span
                              className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${statusPres.classes}`}
                            >
                              {statusPres.icon}
                              {statusPres.label}
                            </span>
                          ) : null}
                        </div>

                        {/* Scenario title / explanation */}
                        {scenario.title ? (
                          <p className="mt-1 text-sm text-slate-300">
                            {scenario.title}
                          </p>
                        ) : null}

                        {/* Flight / hotel option references */}
                        {(() => {
                          const flightOption = scenario.flightOptionId
                            ? strategy.flightOptions.find(
                                (o) => o.id === scenario.flightOptionId
                              )
                            : null;
                          const hotelOption = scenario.hotelOptionId
                            ? strategy.hotelOptions.find(
                                (o) => o.id === scenario.hotelOptionId
                              )
                            : null;

                          if (!flightOption && !hotelOption) {
                            if (
                              scenario.flightOptionId ||
                              scenario.hotelOptionId
                            ) {
                              return (
                                <p className="mt-1 text-xs text-slate-400">
                                  {scenario.flightOptionId
                                    ? "Selected flight details are unavailable."
                                    : "Selected hotel details are unavailable."}
                                </p>
                              );
                            }
                            return null;
                          }

                          return (
                            <div className="mt-2 space-y-2">
                              {flightOption ? (
                                <div className="rounded-lg border border-white/5 bg-white/[0.03] p-2">
                                  <div className="flex flex-wrap items-center justify-between gap-2">
                                    <p className="text-xs font-medium text-white">
                                      {flightOption.programName}
                                    </p>
                                    <p className="text-xs font-semibold text-white">
                                      {formatPoints(flightOption.pointsRequired)}{" "}
                                      pts
                                    </p>
                                  </div>
                                  <p className="mt-0.5 text-xs text-slate-400">
                                    {PRICING_BASIS_LABELS[
                                      flightOption.pricingBasis
                                    ] ?? flightOption.pricingBasis}
                                  </p>
                                  {flightOption.itineraryLabel ? (
                                    <p className="mt-0.5 text-xs text-slate-300">
                                      {flightOption.itineraryLabel}
                                    </p>
                                  ) : null}
                                </div>
                              ) : scenario.flightOptionId ? (
                                <p className="text-xs text-slate-400">
                                  Selected flight details are unavailable.
                                </p>
                              ) : null}
                              {hotelOption ? (
                                <div className="rounded-lg border border-white/5 bg-white/[0.03] p-2">
                                  <div className="flex flex-wrap items-center justify-between gap-2">
                                    <p className="text-xs font-medium text-white">
                                      {hotelOption.programName}
                                    </p>
                                    <p className="text-xs font-semibold text-white">
                                      {formatPoints(hotelOption.pointsRequired)}{" "}
                                      pts
                                    </p>
                                  </div>
                                  <p className="mt-0.5 text-xs text-slate-400">
                                    {PRICING_BASIS_LABELS[
                                      hotelOption.pricingBasis
                                    ] ?? hotelOption.pricingBasis}
                                  </p>
                                  {hotelOption.itineraryLabel ? (
                                    <p className="mt-0.5 text-xs text-slate-300">
                                      {hotelOption.itineraryLabel}
                                    </p>
                                  ) : null}
                                </div>
                              ) : scenario.hotelOptionId ? (
                                <p className="text-xs text-slate-400">
                                  Selected hotel details are unavailable.
                                </p>
                              ) : null}
                            </div>
                          );
                        })()}

                        {/* Points required summary */}
                        {scenario.flightPointsRequired !== null ||
                        scenario.hotelPointsRequired !== null ? (
                          <p className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-slate-400">
                            {scenario.flightPointsRequired !== null ? (
                              <span>
                                Flights:{" "}
                                {formatPoints(scenario.flightPointsRequired)}{" "}
                                pts
                              </span>
                            ) : null}
                            {scenario.hotelPointsRequired !== null ? (
                              <span>
                                Hotels:{" "}
                                {formatPoints(scenario.hotelPointsRequired)}{" "}
                                pts
                              </span>
                            ) : null}
                            <span>
                              {scenario.travelerCount}{" "}
                              {scenario.travelerCount === 1
                                ? "traveler"
                                : "travelers"}
                            </span>
                            {scenario.tripNights !== null ? (
                              <span>
                                {scenario.tripNights}{" "}
                                {scenario.tripNights === 1 ? "night" : "nights"}
                              </span>
                            ) : null}
                          </p>
                        ) : null}

                        {/* Allocations */}
                        {hasAllocations ? (
                          <ul className="mt-3 space-y-2">
                            {scenario.allocations.map((alloc) => {
                              const inventoryItem = inventoryByAccount.get(
                                alloc.accountId
                              );
                              const displayName =
                                inventoryItem?.programName ??
                                alloc.programName ??
                                "Unknown program";
                              const ownerLabel =
                                inventoryItem?.ownerLabel ??
                                alloc.ownerLabel;
                              const ownerType = inventoryItem?.ownerType;
                              const balance = inventoryItem?.balance;

                              return (
                                <li
                                  key={alloc.accountId}
                                  className="rounded-lg border border-white/5 bg-white/[0.03] p-2.5"
                                >
                                  <div className="flex flex-wrap items-center justify-between gap-2">
                                    <p className="text-sm font-medium text-white">
                                      {displayName}
                                    </p>
                                    <p className="text-xs text-slate-400">
                                      {FUNDING_METHOD_LABELS[
                                        alloc.fundingMethod
                                      ] ?? alloc.fundingMethod}
                                    </p>
                                  </div>

                                  <p className="mt-1 text-xs text-slate-400">
                                    {ownerLabel}
                                    {ownerType
                                      ? ` · ${OWNER_TYPE_LABELS[ownerType] ?? ownerType}`
                                      : null}
                                    {balance !== undefined
                                      ? ` · Balance: ${formatPoints(balance)}`
                                      : null}
                                  </p>

                                  <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs sm:grid-cols-4">
                                    <div>
                                      <span className="text-slate-500">
                                        Available
                                      </span>
                                      <p className="font-medium text-white">
                                        {formatPoints(alloc.availablePoints)}
                                      </p>
                                    </div>
                                    <div>
                                      <span className="text-slate-500">
                                        Planned
                                      </span>
                                      <p className="font-medium text-white">
                                        {formatPoints(alloc.plannedPoints)}
                                      </p>
                                    </div>
                                    <div>
                                      <span className="text-slate-500">
                                        Remaining
                                      </span>
                                      <p className="font-medium text-white">
                                        {formatPoints(alloc.remainingPoints)}
                                      </p>
                                    </div>
                                    <div>
                                      <span className="text-slate-500">
                                        Gap
                                      </span>
                                      <p
                                        className={`font-medium ${
                                          alloc.pointsGap > 0
                                            ? "text-amber-300"
                                            : "text-emerald-300"
                                        }`}
                                      >
                                        {alloc.pointsGap > 0 ? "+" : ""}
                                        {formatPoints(alloc.pointsGap)}
                                      </p>
                                    </div>
                                  </div>
                                </li>
                              );
                            })}
                          </ul>
                        ) : (
                          <p className="mt-2 text-sm text-slate-400">
                            {scenario.title
                              ? scenario.title
                              : "This scenario cannot yet be fully calculated from the available data."}
                          </p>
                        )}

                        {/* Scenario assumptions */}
                        {scenario.assumptions.length > 0 ? (
                          <div className="mt-2">
                            <p className="text-xs font-medium text-slate-400">
                              Assumptions
                            </p>
                            <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs text-slate-500">
                              {scenario.assumptions.map((a, i) => (
                                <li key={i}>{a}</li>
                              ))}
                            </ul>
                          </div>
                        ) : null}

                        {/* Scenario warnings */}
                        {scenario.warnings.length > 0 ? (
                          <div className="mt-2 rounded-lg border border-amber-400/20 bg-amber-400/5 p-2">
                            <ul className="list-disc space-y-0.5 pl-4 text-xs text-amber-100/80">
                              {scenario.warnings.map((w, i) => (
                                <li key={i}>{w}</li>
                              ))}
                            </ul>
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })()}

          {strategy.flightOptions.length > 0 ? (
            <div>
              <p className="flex items-center gap-2 text-sm font-medium text-slate-200">
                <Plane className="h-4 w-4 text-sky-300" />
                Flight options
              </p>
              <ul className="mt-2 space-y-2">
                {strategy.flightOptions.map((option) => (
                  <AwardOptionCard key={option.id} option={option} />
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
                  <AwardOptionCard key={option.id} option={option} />
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