"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { generateGoalFlightStageAction, generateGoalHotelStageAction, finalizeGoalStrategyRunAction } from "@/lib/goals/strategyActions";
import type { PersonalizedStrategy, StrategyAwardOption } from "@/lib/goals/strategyTypes";
import type { Goal } from "@/lib/goals/types";
import { buildCustomerSafeStrategyPresentation } from "@/lib/goals/customerSafeStrategyPresentation";
import { CustomerSafeStrategyContent } from "./customer-safe-strategy-content";
import { normalizePersistedStrategyTimestamp, transitionStrategyTimestamp } from "@/lib/goals/customerSafeStrategyTimestamp";
import { buildCustomerSafePlanningPreview, type CustomerSafePlanningPreview } from "@/lib/goals/customerSafeGoalSummary";

type ClientGenerationStage = "idle" | "flight" | "hotel" | "final";
type ClientStageStatus = "idle" | "loading" | "succeeded" | "failed";

function PreviewCard({ preview }: { preview: CustomerSafePlanningPreview }) {
  return <li className="rounded-xl border border-white/5 bg-white/[0.02] p-3"><div className="flex flex-wrap justify-between gap-2"><span className="text-sm font-medium text-white">{preview.programName}</span><span className="text-sm font-semibold text-white">{preview.pointsRequired === null ? "Amount not confirmed" : `${new Intl.NumberFormat("en-US").format(preview.pointsRequired)} points`}</span></div><p className="mt-1 text-xs text-slate-400">{preview.evidenceLabel} · {preview.availabilityLabel}</p>{preview.itineraryLabel ? <p className="mt-1 text-sm text-slate-300">{preview.itineraryLabel}</p> : null}<p className="mt-1 text-xs text-slate-500">{preview.pricingLabel} · {preview.coverageLabel}</p></li>;
}

export function GoalStrategyPanel({ goalId, goal, initialStrategy = null, initialGeneratedAt = null }: { goalId: string; goal: Goal; initialStrategy?: PersonalizedStrategy | null; initialGeneratedAt?: string | null }) {
  const [strategy, setStrategy] = useState<PersonalizedStrategy | null>(initialStrategy);
  const [generatedAt, setGeneratedAt] = useState<string | null>(() => normalizePersistedStrategyTimestamp(initialGeneratedAt));
  const [isGenerating, setIsGenerating] = useState(false);
  const [currentStage, setCurrentStage] = useState<ClientGenerationStage>("idle");
  const [runId, setRunId] = useState<string | null>(null);
  const [flightStatus, setFlightStatus] = useState<ClientStageStatus>("idle");
  const [flightOptions, setFlightOptions] = useState<StrategyAwardOption[]>([]);
  const [hotelStatus, setHotelStatus] = useState<ClientStageStatus>("idle");
  const [hotelOptions, setHotelOptions] = useState<StrategyAwardOption[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [canRetryFinalization, setCanRetryFinalization] = useState(false);
  const noticeRef = useRef<HTMLDivElement>(null);
  const presentation = strategy ? buildCustomerSafeStrategyPresentation(goal, strategy, generatedAt) : null;

  useEffect(() => { if (!isGenerating && error) noticeRef.current?.focus(); }, [error, isGenerating]);

  async function handleGenerate() {
    if (isGenerating) return;
    setIsGenerating(true); setError(null); setCurrentStage("flight"); setFlightStatus("loading"); setFlightOptions([]); setHotelStatus("idle"); setHotelOptions([]); setRunId(null); setCanRetryFinalization(false);
    let stage: ClientGenerationStage = "flight";
    try {
      const flight = await generateGoalFlightStageAction(goalId);
      if (!flight.success) { setError("We couldn’t finish this part of the research. Your previous plan is still here."); return; }
      setRunId(flight.runId); setFlightStatus(flight.stageStatus === "succeeded" ? "succeeded" : "failed"); setFlightOptions(flight.options);
      stage = "hotel"; setCurrentStage("hotel"); setHotelStatus("loading");
      const hotel = await generateGoalHotelStageAction(goalId, flight.runId);
      if (!hotel.success) { setError("We couldn’t finish this part of the research. Your previous plan is still here."); return; }
      setHotelStatus(hotel.stageStatus === "succeeded" ? "succeeded" : "failed"); setHotelOptions(hotel.options);
      stage = "final"; setCurrentStage("final");
      const final = await finalizeGoalStrategyRunAction(goalId, flight.runId);
      if (!final.success) { setError("We couldn’t finish this part of the research. Your previous plan is still here."); setCanRetryFinalization(final.retryable !== false); return; }
      setStrategy(final.strategy); setGeneratedAt((current) => transitionStrategyTimestamp(current, { type: "finalization_succeeded", generatedAt: final.generatedAt })); setRunId(null); setFlightOptions([]); setHotelOptions([]); setFlightStatus("idle"); setHotelStatus("idle");
    } catch { setError("We couldn’t finish this part of the research. Your previous plan is still here."); if (stage === "flight") setFlightStatus("failed"); else if (stage === "hotel") setHotelStatus("failed"); else setCanRetryFinalization(true); }
    finally { setIsGenerating(false); }
  }

  async function handleRetry() {
    if (isGenerating || !runId || !canRetryFinalization) return;
    setIsGenerating(true); setError(null); setCurrentStage("final");
    try { const result = await finalizeGoalStrategyRunAction(goalId, runId); if (result.success) { setStrategy(result.strategy); setGeneratedAt((current) => transitionStrategyTimestamp(current, { type: "finalization_succeeded", generatedAt: result.generatedAt })); setRunId(null); setCanRetryFinalization(false); } else { setError("We couldn’t finish this part of the research. Your previous plan is still here."); } }
    catch { setError("We couldn’t finish this part of the research. Your previous plan is still here."); }
    finally { setIsGenerating(false); }
  }

  const showProgress = isGenerating || currentStage !== "idle";
  return <div className="mt-6 border-t border-white/5 pt-4">
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-sm font-medium text-slate-300">{strategy ? "Your personalized strategy" : "Ready to plan this trip?"}</p><p className="mt-1 text-xs text-slate-500">{strategy ? "Your saved planning strategy remains visible while you refresh." : "We’ll use your saved goal to build a planning strategy."}</p></div><button type="button" onClick={handleGenerate} disabled={isGenerating} className="fb-btn inline-flex min-h-11 items-center justify-center gap-2 disabled:cursor-not-allowed disabled:opacity-60">{isGenerating ? <><Loader2 className="h-4 w-4 animate-spin" />Working…</> : <><Sparkles className="h-4 w-4" />{strategy ? "Refresh plan" : "Build my plan"}</>}</button></div>
    {showProgress ? <div className="mt-4 space-y-2" role="status" aria-live="polite"><p className="text-sm font-medium text-slate-200">{strategy ? "Refreshing your plan" : "Building your plan"}</p><p className="text-xs text-slate-500">{strategy ? "Refreshing your planning research. This may take a few minutes. Check current availability before acting." : "Building your planning research. This may take a few minutes. Check current availability before acting."}</p>{!strategy && flightStatus === "succeeded" && flightOptions.length > 0 ? <div><p className="text-xs text-slate-400">Flight planning estimates</p><ul className="mt-2 space-y-2">{flightOptions.slice(0, 3).map((option, index) => <PreviewCard key={`flight-preview-${index}`} preview={buildCustomerSafePlanningPreview(option, `flight-preview-${index + 1}`)} />)}</ul></div> : null}{!strategy && hotelStatus === "succeeded" && hotelOptions.length > 0 ? <div><p className="text-xs text-slate-400">Hotel planning estimates</p><ul className="mt-2 space-y-2">{hotelOptions.slice(0, 3).map((option, index) => <PreviewCard key={`hotel-preview-${index}`} preview={buildCustomerSafePlanningPreview(option, `hotel-preview-${index + 1}`)} />)}</ul></div> : null}</div> : null}
    {error ? <div ref={noticeRef} tabIndex={-1} className="mt-4 rounded-xl border border-amber-400/20 bg-amber-400/10 p-3"><p className="text-sm text-amber-100">{error}</p>{runId && canRetryFinalization ? <button type="button" className="mt-3 min-h-11 rounded-lg border border-amber-400/30 px-3 text-sm text-amber-100" onClick={handleRetry} disabled={isGenerating}>Try finishing again</button> : null}</div> : null}
    {presentation ? <CustomerSafeStrategyContent presentation={presentation} /> : null}
  </div>;
}
