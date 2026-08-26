import React from "react";
import { AlertCircle, ArrowRightLeft, CheckCircle2, MinusCircle } from "lucide-react";
import type {
  StrategyAllocationScenario,
  StrategyAwardOption,
  StrategyPointsInventoryItem,
} from "@/lib/goals/strategyTypes";
import {
  FUNDING_METHOD_LABELS,
  OWNER_TYPE_LABELS,
  PRICING_BASIS_LABELS,
  SCENARIO_KIND_LABELS,
  SCENARIO_STATUS_PRESENTATION,
  formatPoints,
  sortAllocationScenarios,
} from "./presentation";

function ScenarioStatusIcon({
  status,
}: {
  status: StrategyAllocationScenario["status"];
}) {
  if (status === "feasible") {
    return <CheckCircle2 aria-hidden="true" className="h-4 w-4 text-emerald-300" />;
  }
  if (status === "gap") {
    return <AlertCircle aria-hidden="true" className="h-4 w-4 text-amber-300" />;
  }
  if (status === "conditional") {
    return <AlertCircle aria-hidden="true" className="h-4 w-4 text-sky-300" />;
  }
  return <MinusCircle aria-hidden="true" className="h-4 w-4 text-slate-400" />;
}

function ScenarioAwardSummary({ option }: { option: StrategyAwardOption }) {
  return (
    <div className="rounded-lg border border-white/5 bg-white/[0.03] p-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-medium text-white">{option.programName}</p>
        <p className="text-xs font-semibold text-white">
          {formatPoints(option.pointsRequired)} pts
        </p>
      </div>
      <p className="mt-0.5 text-xs text-slate-400">
        {PRICING_BASIS_LABELS[option.pricingBasis] ?? option.pricingBasis}
      </p>
      {option.itineraryLabel ? (
        <p className="mt-0.5 text-xs text-slate-300">
          {option.itineraryLabel}
        </p>
      ) : null}
    </div>
  );
}

function ScenarioOptionReferences({
  scenario,
  flightOptions,
  hotelOptions,
}: {
  scenario: StrategyAllocationScenario;
  flightOptions: StrategyAwardOption[];
  hotelOptions: StrategyAwardOption[];
}) {
  const flightOption = scenario.flightOptionId
    ? flightOptions.find((option) => option.id === scenario.flightOptionId)
    : null;
  const hotelOption = scenario.hotelOptionId
    ? hotelOptions.find((option) => option.id === scenario.hotelOptionId)
    : null;

  if (!flightOption && !hotelOption) {
    if (!scenario.flightOptionId && !scenario.hotelOptionId) return null;

    return (
      <p className="mt-1 text-xs text-slate-400">
        {scenario.flightOptionId
          ? "Selected flight details are unavailable."
          : "Selected hotel details are unavailable."}
      </p>
    );
  }

  return (
    <div className="mt-2 space-y-2">
      {flightOption ? (
        <ScenarioAwardSummary option={flightOption} />
      ) : scenario.flightOptionId ? (
        <p className="text-xs text-slate-400">
          Selected flight details are unavailable.
        </p>
      ) : null}
      {hotelOption ? (
        <ScenarioAwardSummary option={hotelOption} />
      ) : scenario.hotelOptionId ? (
        <p className="text-xs text-slate-400">
          Selected hotel details are unavailable.
        </p>
      ) : null}
    </div>
  );
}

function ScenarioCard({
  scenario,
  flightOptions,
  hotelOptions,
  inventoryByAccount,
}: {
  scenario: StrategyAllocationScenario;
  flightOptions: StrategyAwardOption[];
  hotelOptions: StrategyAwardOption[];
  inventoryByAccount: Map<string, StrategyPointsInventoryItem>;
}) {
  const statusPresentation = SCENARIO_STATUS_PRESENTATION[scenario.status];
  const hasAllocations = scenario.allocations.length > 0;

  return (
    <div className="rounded-xl border border-white/5 bg-white/[0.02] p-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm font-medium text-white">
          {SCENARIO_KIND_LABELS[scenario.kind] ?? scenario.title}
        </p>
        {statusPresentation ? (
          <span
            className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${statusPresentation.classes}`}
          >
            <ScenarioStatusIcon status={scenario.status} />
            {statusPresentation.label}
          </span>
        ) : null}
      </div>

      {scenario.title ? (
        <p className="mt-1 text-sm text-slate-300">{scenario.title}</p>
      ) : null}

      <ScenarioOptionReferences
        scenario={scenario}
        flightOptions={flightOptions}
        hotelOptions={hotelOptions}
      />

      {scenario.flightPointsRequired !== null ||
      scenario.hotelPointsRequired !== null ? (
        <p className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-slate-400">
          {scenario.flightPointsRequired !== null ? (
            <span>
              Flights: {formatPoints(scenario.flightPointsRequired)} pts
            </span>
          ) : null}
          {scenario.hotelPointsRequired !== null ? (
            <span>Hotels: {formatPoints(scenario.hotelPointsRequired)} pts</span>
          ) : null}
          <span>
            {scenario.travelerCount}{" "}
            {scenario.travelerCount === 1 ? "traveler" : "travelers"}
          </span>
          {scenario.tripNights !== null ? (
            <span>
              {scenario.tripNights}{" "}
              {scenario.tripNights === 1 ? "night" : "nights"}
            </span>
          ) : null}
        </p>
      ) : null}

      {hasAllocations ? (
        <ul className="mt-3 space-y-2">
          {scenario.allocations.map((allocation) => {
            const inventoryItem = inventoryByAccount.get(allocation.accountId);
            const displayName =
              inventoryItem?.programName ??
              allocation.programName ??
              "Unknown program";
            const ownerLabel =
              inventoryItem?.ownerLabel ?? allocation.ownerLabel;
            const ownerType = inventoryItem?.ownerType;
            const balance = inventoryItem?.balance;

            return (
              <li
                key={allocation.accountId}
                className="rounded-lg border border-white/5 bg-white/[0.03] p-2.5"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-medium text-white">
                    {displayName}
                  </p>
                  <p className="text-xs text-slate-400">
                    {FUNDING_METHOD_LABELS[allocation.fundingMethod] ??
                      allocation.fundingMethod}
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
                    <span className="text-slate-500">Available</span>
                    <p className="font-medium text-white">
                      {formatPoints(allocation.availablePoints)}
                    </p>
                  </div>
                  <div>
                    <span className="text-slate-500">Planned</span>
                    <p className="font-medium text-white">
                      {formatPoints(allocation.plannedPoints)}
                    </p>
                  </div>
                  <div>
                    <span className="text-slate-500">Remaining</span>
                    <p className="font-medium text-white">
                      {formatPoints(allocation.remainingPoints)}
                    </p>
                  </div>
                  <div>
                    <span className="text-slate-500">Gap</span>
                    <p
                      className={`font-medium ${
                        allocation.pointsGap > 0
                          ? "text-amber-300"
                          : "text-emerald-300"
                      }`}
                    >
                      {allocation.pointsGap > 0 ? "+" : ""}
                      {formatPoints(allocation.pointsGap)}
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

      {scenario.assumptions.length > 0 ? (
        <div className="mt-2">
          <p className="text-xs font-medium text-slate-400">Assumptions</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs text-slate-500">
            {scenario.assumptions.map((assumption, index) => (
              <li key={index}>{assumption}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {scenario.warnings.length > 0 ? (
        <div className="mt-2 rounded-lg border border-amber-400/20 bg-amber-400/5 p-2">
          <ul className="list-disc space-y-0.5 pl-4 text-xs text-amber-100/80">
            {scenario.warnings.map((warning, index) => (
              <li key={index}>{warning}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

export function AllocationScenariosSection({
  scenarios,
  flightOptions,
  hotelOptions,
  pointsInventory,
}: {
  scenarios: StrategyAllocationScenario[] | undefined;
  flightOptions: StrategyAwardOption[];
  hotelOptions: StrategyAwardOption[];
  pointsInventory: StrategyPointsInventoryItem[];
}) {
  const allocationScenarios = scenarios ?? [];

  if (allocationScenarios.length === 0) {
    return (
      <div className="rounded-xl border border-white/5 bg-white/[0.02] p-3">
        <p className="text-sm text-slate-400">
          Rebuild this strategy to generate personalized points-allocation
          scenarios.
        </p>
      </div>
    );
  }

  const inventoryByAccount = new Map(
    pointsInventory.map((item) => [item.accountId, item])
  );

  return (
    <div>
      <p className="flex items-center gap-2 text-sm font-medium text-slate-200">
        <ArrowRightLeft aria-hidden="true" className="h-4 w-4 text-sky-300" />
        Ways to use your points
      </p>

      <div className="mt-3 space-y-3">
        {sortAllocationScenarios(allocationScenarios).map((scenario) => (
          <ScenarioCard
            key={scenario.id}
            scenario={scenario}
            flightOptions={flightOptions}
            hotelOptions={hotelOptions}
            inventoryByAccount={inventoryByAccount}
          />
        ))}
      </div>
    </div>
  );
}
