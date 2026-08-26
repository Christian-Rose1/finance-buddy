import type {
  StrategyAllocationScenario,
  StrategyFeasibility,
} from "@/lib/goals/strategyTypes";
import type { ClientStageStatus } from "./generation-state";

export const FEASIBILITY_PRESENTATION: Record<
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

export const PRICING_BASIS_LABELS: Record<string, string> = {
  one_way: "One way",
  round_trip: "Round trip",
  per_night: "Per night",
  total_stay: "Total stay",
  unknown: "Pricing basis not confirmed",
};

export const SCENARIO_KIND_LABELS: Record<string, string> = {
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

export const SCENARIO_STATUS_PRESENTATION: Record<
  StrategyAllocationScenario["status"],
  { label: string; classes: string }
> = {
  feasible: {
    label: "Feasible",
    classes: "border-emerald-400/30 bg-emerald-400/10 text-emerald-300",
  },
  gap: {
    label: "Points gap",
    classes: "border-amber-400/30 bg-amber-400/10 text-amber-300",
  },
  conditional: {
    label: "Conditional",
    classes: "border-sky-400/30 bg-sky-400/10 text-sky-300",
  },
  insufficient_information: {
    label: "Insufficient information",
    classes: "border-slate-400/30 bg-slate-400/10 text-slate-300",
  },
};

export const FUNDING_METHOD_LABELS: Record<string, string> = {
  transfer_source: "Transfer from",
  direct_program: "Direct program",
};

export const AVAILABILITY_LABELS: Record<string, string> = {
  available: "Available",
  unavailable: "Unavailable",
  unknown: "Unknown availability",
};

export const OWNER_TYPE_LABELS: Record<string, string> = {
  self: "Self",
  companion: "Companion",
};

export const VERIFICATION_LABELS: Record<string, string> = {
  verified: "Verified",
  unverified: "Unverified",
};

export const ORIGIN_LABELS: Record<string, string> = {
  manual: "Manually entered",
  evidence: "Evidence-backed",
  connected: "Connected account",
};

export type StepState =
  | "waiting"
  | "in-progress"
  | "complete"
  | "could-not-complete";

export const STEP_LABELS = [
  "Researching flight options",
  "Researching hotel options",
  "Building your personalized points plan",
] as const;

export function formatPoints(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

export function formatBalanceAsOf(value: string): string {
  const parsed = new Date(value);
  if (value.length > 0 && !Number.isNaN(parsed.getTime())) {
    return new Intl.DateTimeFormat("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    }).format(parsed);
  }
  return value;
}

export function getStepState(status: ClientStageStatus): StepState {
  if (status === "succeeded") return "complete";
  if (status === "failed") return "could-not-complete";
  if (status === "loading") return "in-progress";
  return "waiting";
}

export function getGenerationProgressAnnouncement({
  flightStatus,
  flightMessage,
  hotelStatus,
  hotelMessage,
  finalStatus,
}: {
  flightStatus: ClientStageStatus;
  flightMessage: string | null;
  hotelStatus: ClientStageStatus;
  hotelMessage: string | null;
  finalStatus: ClientStageStatus;
}): string {
  const statuses = [flightStatus, hotelStatus, finalStatus];
  const messages = [flightMessage, hotelMessage, null];

  return STEP_LABELS.map((label, index) => {
    const state = getStepState(statuses[index]);
    const stateLabel =
      state === "in-progress"
        ? "in progress"
        : state === "complete"
          ? "complete"
          : state === "could-not-complete"
            ? "could not complete"
            : "waiting";
    const message = messages[index];
    return `${label}: ${stateLabel}${message ? `. ${message}` : ""}`;
  }).join(". ");
}

export function sortAllocationScenarios(
  scenarios: StrategyAllocationScenario[]
): StrategyAllocationScenario[] {
  return [...scenarios].sort(
    (a, b) =>
      (SCENARIO_KIND_ORDER[a.kind] ?? 99) -
      (SCENARIO_KIND_ORDER[b.kind] ?? 99)
  );
}
