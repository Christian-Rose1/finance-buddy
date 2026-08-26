import React from "react";
import { CheckCircle2, Loader2, MinusCircle, XCircle } from "lucide-react";
import type {
  ClientGenerationStage,
  ClientStageStatus,
} from "./generation-state";
import {
  getGenerationProgressAnnouncement,
  getStepState,
  STEP_LABELS,
  type StepState,
} from "./presentation";

const STEP_STATE_PRESENTATION: Record<
  StepState,
  { icon: React.ReactNode; label: string; classes: string }
> = {
  waiting: {
    icon: <MinusCircle aria-hidden="true" className="h-4 w-4 text-slate-600" />,
    label: "Waiting",
    classes: "text-slate-500",
  },
  "in-progress": {
    icon: <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin text-sky-300" />,
    label: "In progress",
    classes: "text-sky-200",
  },
  complete: {
    icon: <CheckCircle2 aria-hidden="true" className="h-4 w-4 text-emerald-300" />,
    label: "Complete",
    classes: "text-emerald-300",
  },
  "could-not-complete": {
    icon: <XCircle aria-hidden="true" className="h-4 w-4 text-rose-300" />,
    label: "Could not complete",
    classes: "text-rose-300",
  },
};

export function GenerationProgress({
  isGenerating,
  currentStage,
  flightStatus,
  flightMessage,
  hotelStatus,
  hotelMessage,
  finalStatus,
}: {
  isGenerating: boolean;
  currentStage: ClientGenerationStage;
  flightStatus: ClientStageStatus;
  flightMessage: string | null;
  hotelStatus: ClientStageStatus;
  hotelMessage: string | null;
  finalStatus: ClientStageStatus;
}) {
  const showProgress =
    isGenerating ||
    (currentStage !== "idle" && finalStatus !== "succeeded");

  if (!showProgress) return null;

  const stepStates = [
    getStepState(flightStatus),
    getStepState(hotelStatus),
    getStepState(finalStatus),
  ];
  const announcement = getGenerationProgressAnnouncement({
    flightStatus,
    flightMessage,
    hotelStatus,
    hotelMessage,
    finalStatus,
  });

  return (
    <div className="mt-4 space-y-3" aria-busy={isGenerating}>
      <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {announcement}
      </p>
      <p className="text-sm font-medium text-slate-200">
        Building your strategy
      </p>

      <ol className="space-y-2">
        {STEP_LABELS.map((label, index) => {
          const state = stepStates[index];
          const presentation = STEP_STATE_PRESENTATION[state];
          return (
            <li
              key={label}
              className={`flex items-center gap-3 rounded-lg border px-3 py-2 ${
                state === "in-progress"
                  ? "border-sky-400/20 bg-sky-400/5"
                  : "border-white/5 bg-white/[0.02]"
              }`}
            >
              {presentation.icon}
              <div className="min-w-0 flex-1">
                <p className={`text-sm ${presentation.classes}`}>{label}</p>
                <p className="text-xs text-slate-500">
                  {presentation.label}
                </p>
              </div>
            </li>
          );
        })}
      </ol>

      {flightStatus === "failed" && flightMessage ? (
        <div className="rounded-lg border border-amber-400/20 bg-amber-400/5 p-2">
          <p className="text-xs text-amber-100/80">{flightMessage}</p>
        </div>
      ) : null}

      {hotelStatus === "failed" && hotelMessage ? (
        <div className="rounded-lg border border-amber-400/20 bg-amber-400/5 p-2">
          <p className="text-xs text-amber-100/80">{hotelMessage}</p>
        </div>
      ) : null}
    </div>
  );
}
