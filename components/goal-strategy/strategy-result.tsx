import React from "react";
import {
  AlertTriangle,
  HelpCircle,
  Lightbulb,
  ListChecks,
  Plane,
  Shuffle,
} from "lucide-react";
import type { PersonalizedStrategy } from "@/lib/goals/strategyTypes";
import { AllocationScenariosSection } from "./allocation-scenarios-section";
import { AwardOptionsSection } from "./award-options-section";
import { PointsInventorySection } from "./points-inventory-section";
import { FEASIBILITY_PRESENTATION, formatPoints } from "./presentation";

export function StrategyResult({
  strategy,
}: {
  strategy: PersonalizedStrategy;
}) {
  const feasibility = FEASIBILITY_PRESENTATION[strategy.feasibility];

  return (
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

      <PointsInventorySection inventory={strategy.pointsInventory} />

      <AllocationScenariosSection
        scenarios={strategy.allocationScenarios}
        flightOptions={strategy.flightOptions}
        hotelOptions={strategy.hotelOptions}
        pointsInventory={strategy.pointsInventory}
      />

      <AwardOptionsSection kind="flight" options={strategy.flightOptions} />
      <AwardOptionsSection kind="hotel" options={strategy.hotelOptions} />

      {strategy.actions.length > 0 ? (
        <div>
          <p className="flex items-center gap-2 text-sm font-medium text-slate-200">
            <ListChecks aria-hidden="true" className="h-4 w-4 text-emerald-300" />
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
            <Shuffle aria-hidden="true" className="h-4 w-4 text-sky-300" />
            Alternatives to consider
          </p>
          <ul className="mt-2 space-y-2">
            {strategy.alternatives.map((alternative, index) => (
              <li
                key={`${alternative.title}-${index}`}
                className="rounded-xl border border-white/5 bg-white/[0.02] p-3"
              >
                <p className="text-sm font-medium text-white">
                  {alternative.title}
                </p>
                <p className="mt-1 text-sm text-slate-400">
                  {alternative.tradeoff}
                </p>
                {alternative.sourceIds.length > 0 ? (
                  <p className="mt-1 break-words text-xs text-slate-500">
                    Sources: {alternative.sourceIds.join(", ")}
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
            <Lightbulb aria-hidden="true" className="h-4 w-4 text-sky-300" />
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
            <AlertTriangle aria-hidden="true" className="h-4 w-4" />
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
            <HelpCircle aria-hidden="true" className="h-4 w-4 text-sky-300" />
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
        <Plane
          aria-hidden="true"
          className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-500"
        />
        Award pricing and availability mentioned in this strategy come from web
        research and are planning estimates only — not live availability.
        Confirm exact pricing and seats with the airline or program before
        transferring points or booking.
      </p>
    </div>
  );
}
