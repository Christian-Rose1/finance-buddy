"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { generateGoalFlightStageAction, generateGoalHotelStageAction, finalizeGoalStrategyRunAction } from "@/lib/goals/strategyActions";
import type { PersonalizedStrategy, StrategyAwardOption } from "@/lib/goals/strategyTypes";
import type { Goal } from "@/lib/goals/types";
import { buildCustomerSafeStrategyPresentation } from "@/lib/goals/customerSafeStrategyPresentation";
import { BENCHMARK_ONLY_HEADLINE } from "@/lib/goals/strategyNarrativeTrustGate";
import { CustomerSafeStrategyContent } from "./customer-safe-strategy-content";
import { normalizePersistedStrategyTimestamp, transitionStrategyTimestamp } from "@/lib/goals/customerSafeStrategyTimestamp";
import { buildCustomerSafePlanningPreview, type CustomerSafePlanningPreview } from "@/lib/goals/customerSafeGoalSummary";
import {
  buildStrategyFailureMessage,
  buildStrategyPreviewPresentation,
  buildStrategyProgressPresentation,
  createInitialStrategyPanelRunState,
  isStrategyRetryAvailable,
  transitionStrategyPanelRun,
  type StrategyPanelRunState,
} from "@/lib/goals/strategyPanelLifecycle";

function PreviewCard({ preview }: { preview: CustomerSafePlanningPreview }) {
  return <li className="rounded-xl border border-white/5 bg-white/[0.02] p-3"><div className="flex flex-wrap justify-between gap-2"><span className="text-sm font-medium text-white">{preview.programName}</span><span className="text-sm font-semibold text-white">{preview.pointsRequired === null ? "Amount not confirmed" : `${new Intl.NumberFormat("en-US").format(preview.pointsRequired)} points`}</span></div><p className="mt-1 text-xs text-slate-400">{preview.evidenceLabel} · {preview.availabilityLabel}</p>{preview.itineraryLabel ? <p className="mt-1 text-sm text-slate-300">{preview.itineraryLabel}</p> : null}<p className="mt-1 text-xs text-slate-500">{preview.pricingLabel} · {preview.coverageLabel}</p></li>;
}

function StagedPreviewLists({ flightOptions, hotelOptions }: { flightOptions: StrategyAwardOption[]; hotelOptions: StrategyAwardOption[] }) {
  return <>
    {flightOptions.length > 0 ? <div><p className="text-xs text-slate-400">Flight planning estimates</p><ul className="mt-2 space-y-2">{flightOptions.slice(0, 3).map((option, index) => <PreviewCard key={`flight-preview-${index}`} preview={buildCustomerSafePlanningPreview(option, `flight-preview-${index + 1}`)} />)}</ul></div> : null}
    {hotelOptions.length > 0 ? <div><p className="text-xs text-slate-400">Hotel planning estimates</p><ul className="mt-2 space-y-2">{hotelOptions.slice(0, 3).map((option, index) => <PreviewCard key={`hotel-preview-${index}`} preview={buildCustomerSafePlanningPreview(option, `hotel-preview-${index + 1}`)} />)}</ul></div> : null}
  </>;
}

export function GoalStrategyPanel({ goalId, goal, initialStrategy = null, initialGeneratedAt = null }: { goalId: string; goal: Goal; initialStrategy?: PersonalizedStrategy | null; initialGeneratedAt?: string | null }) {
  const [strategy, setStrategy] = useState<PersonalizedStrategy | null>(initialStrategy);
  const [generatedAt, setGeneratedAt] = useState<string | null>(() => normalizePersistedStrategyTimestamp(initialGeneratedAt));
  const [runState, setRunState] = useState<StrategyPanelRunState>(() => createInitialStrategyPanelRunState());
  const noticeRef = useRef<HTMLDivElement>(null);
  const presentation = strategy ? buildCustomerSafeStrategyPresentation(goal, strategy, generatedAt) : null;
  // The narrative gate suppresses model prose in every evidence state; the
  // panel header must not claim personalization and must not duplicate the
  // fixed strategy headline shown below it.
  const benchmarkOnly =
    strategy !== null &&
    presentation !== null &&
    presentation.strategy.headline === BENCHMARK_ONLY_HEADLINE;
  const hasSavedStrategy = strategy !== null;
  const progress = buildStrategyProgressPresentation(runState, hasSavedStrategy);
  const previews = buildStrategyPreviewPresentation(runState, hasSavedStrategy);
  const failureMessage = runState.failure ? buildStrategyFailureMessage(runState.failure, hasSavedStrategy) : null;
  const retryAvailable = isStrategyRetryAvailable(runState);

  useEffect(() => { if (!runState.isGenerating && failureMessage) noticeRef.current?.focus(); }, [failureMessage, runState.isGenerating]);

  /** Applies a successful-finalization outcome; failures never reach this. */
  function applyFinalizationSucceeded(state: StrategyPanelRunState, finalized: { strategy: PersonalizedStrategy; generatedAt: string }) {
    const transition = transitionStrategyPanelRun(state, { type: "finalization_succeeded", strategy: finalized.strategy, generatedAt: finalized.generatedAt });
    if (transition.strategyUpdate) {
      const update = transition.strategyUpdate;
      setStrategy(update.strategy);
      setGeneratedAt((current) => transitionStrategyTimestamp(current, { type: "finalization_succeeded", generatedAt: update.generatedAt }));
    }
    setRunState(transition.state);
  }

  async function handleGenerate() {
    if (runState.isGenerating) return;
    let state = transitionStrategyPanelRun(runState, { type: "run_started" }).state;
    setRunState(state);
    try {
      const flight = await generateGoalFlightStageAction(goalId);
      if (!flight.success) { setRunState(transitionStrategyPanelRun(state, { type: "flight_action_failed" }).state); return; }
      // success: true means the signed stage reached a valid terminal state;
      // stageStatus "failed" is a degraded lane that still yields a usable run.
      state = transitionStrategyPanelRun(state, { type: "flight_stage_completed", runId: flight.runId, stageStatus: flight.stageStatus, options: flight.options }).state;
      setRunState(state);
      const hotel = await generateGoalHotelStageAction(goalId, flight.runId);
      if (!hotel.success) { setRunState(transitionStrategyPanelRun(state, { type: "hotel_action_failed" }).state); return; }
      state = transitionStrategyPanelRun(state, { type: "hotel_stage_completed", stageStatus: hotel.stageStatus, options: hotel.options }).state;
      setRunState(state);
      const final = await finalizeGoalStrategyRunAction(goalId, flight.runId);
      if (!final.success) { setRunState(transitionStrategyPanelRun(state, { type: "finalization_failed", retryable: final.retryable === true }).state); return; }
      applyFinalizationSucceeded(state, { strategy: final.strategy, generatedAt: final.generatedAt });
    } catch {
      // Transport failure: stop all activity and fall back to the allowlisted
      // safe state for the stage whose action was executing. A finalization
      // transport exception conservatively retains the reusable run because
      // the existing server-validation design makes a repeated finalization
      // attempt demonstrably safe (failed→running only, verified server-side
      // stages, no research rerun, saved strategy replaced only on successful
      // persistence, and non-retryable results clear the run).
      if (state.stage === "final") setRunState(transitionStrategyPanelRun(state, { type: "finalization_transport_exception" }).state);
      else if (state.stage === "hotel") setRunState(transitionStrategyPanelRun(state, { type: "hotel_action_failed" }).state);
      else setRunState(transitionStrategyPanelRun(state, { type: "flight_action_failed" }).state);
    }
  }

  async function handleRetry() {
    if (runState.isGenerating || !isStrategyRetryAvailable(runState)) return;
    const retainedRunId = runState.runId;
    if (!retainedRunId) return;
    const state = transitionStrategyPanelRun(runState, { type: "retry_started" }).state;
    setRunState(state);
    try {
      // Finalization-only retry: only goalId and the existing signed runId.
      // Flight and hotel research are never rerun from this control.
      const result = await finalizeGoalStrategyRunAction(goalId, retainedRunId);
      if (!result.success) { setRunState(transitionStrategyPanelRun(state, { type: "finalization_failed", retryable: result.retryable === true }).state); return; }
      applyFinalizationSucceeded(state, { strategy: result.strategy, generatedAt: result.generatedAt });
    } catch {
      setRunState(transitionStrategyPanelRun(state, { type: "finalization_transport_exception" }).state);
    }
  }

  return <div className="mt-6 border-t border-white/5 pt-4">
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-sm font-medium text-slate-300">{strategy ? "Planning estimates" : "Ready to plan this trip?"}</p><p className="mt-1 text-xs text-slate-500">{strategy ? (benchmarkOnly ? "Planning estimates based on your saved goal, not a route- and date-specific recommendation." : "Exact cash and customer-verified records are shown with their evidence labels; recommendation prose is not generated yet.") : "We’ll use your saved goal to build a planning strategy."}</p></div><button type="button" onClick={handleGenerate} disabled={runState.isGenerating} className="fb-btn inline-flex min-h-11 items-center justify-center gap-2 disabled:cursor-not-allowed disabled:opacity-60">{runState.isGenerating ? <><Loader2 className="h-4 w-4 animate-spin" />Working…</> : <><Sparkles className="h-4 w-4" />{strategy ? "Refresh plan" : "Build my plan"}</>}</button></div>
    {progress ? <div className="mt-4 space-y-2" role="status" aria-live="polite"><p className="text-sm font-medium text-slate-200">{progress.heading}</p><p className="text-xs text-slate-500">{progress.description}</p>{progress.stageLabel ? <p className="text-xs font-medium text-slate-300">{progress.stageLabel}</p> : null}{previews.mode === "active" ? <StagedPreviewLists flightOptions={runState.flightOptions} hotelOptions={runState.hotelOptions} /> : null}</div> : null}
    {previews.mode === "retained" ? <div className="mt-4 space-y-2"><p className="text-xs text-slate-400">{previews.heading}</p><StagedPreviewLists flightOptions={runState.flightOptions} hotelOptions={runState.hotelOptions} /></div> : null}
    {failureMessage ? <div ref={noticeRef} tabIndex={-1} className="mt-4 rounded-xl border border-amber-400/20 bg-amber-400/10 p-3"><p className="text-sm text-amber-100">{failureMessage}</p>{retryAvailable ? <button type="button" className="mt-3 min-h-11 rounded-lg border border-amber-400/30 px-3 text-sm text-amber-100" onClick={handleRetry} disabled={runState.isGenerating}>Try finishing again</button> : null}</div> : null}
    {presentation ? <CustomerSafeStrategyContent presentation={presentation} /> : null}
  </div>;
}
