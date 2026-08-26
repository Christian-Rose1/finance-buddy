import React from "react";
import { Bed, Plane } from "lucide-react";
import type { StrategyAwardOption } from "@/lib/goals/strategyTypes";
import {
  AVAILABILITY_LABELS,
  PRICING_BASIS_LABELS,
  formatPoints,
} from "./presentation";

export function AwardOptionCard({ option }: { option: StrategyAwardOption }) {
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
        {option.seats !== null ? <span>Seats: {option.seats}</span> : null}
      </p>
      {option.sourceId ? (
        <p className="mt-1 break-words text-xs text-slate-500">
          Sources: {option.sourceId}
        </p>
      ) : null}
    </li>
  );
}

export function AwardOptionsSection({
  kind,
  options,
  className,
  showEmpty = false,
}: {
  kind: "flight" | "hotel";
  options: StrategyAwardOption[];
  className?: string;
  showEmpty?: boolean;
}) {
  if (options.length === 0) {
    return showEmpty ? (
      <div className="mt-4 rounded-xl border border-white/5 bg-white/[0.02] p-3">
        <p className="text-sm text-slate-400">
          No validated {kind} options were found.
        </p>
      </div>
    ) : null;
  }

  const Icon = kind === "flight" ? Plane : Bed;
  const title = kind === "flight" ? "Flight options" : "Hotel options";

  return (
    <div className={className}>
      <p className="flex items-center gap-2 text-sm font-medium text-slate-200">
        <Icon aria-hidden="true" className="h-4 w-4 text-sky-300" />
        {title}
      </p>
      <ul className="mt-2 space-y-2">
        {options.map((option) => (
          <AwardOptionCard key={option.id} option={option} />
        ))}
      </ul>
      <p className="mt-2 text-xs leading-relaxed text-slate-500">
        {title.split(" ")[0]} pricing and availability are planning estimates
        from web research, not live availability. Unknown availability means it
        is not confirmed.
      </p>
    </div>
  );
}
