import type { Goal } from "./types";
import type { StrategyAwardOption } from "./strategyTypes";
import { containsCustomerInternalReference } from "./customerTextPolicy";

export interface CustomerSafeGoalSummary {
  title: string;
  route: string;
  dateWindow: string | null;
  dateWindowIsFlexible: boolean;
  travelerCount: number | null;
  travelerLabel: string;
  nights: number | null;
  nightsLabel: string | null;
  cabin: string;
  budget: string | null;
  budgetLabel: string | null;
  priority: string;
  status: string;
}

export interface CustomerSafePlanningPreview {
  key: string;
  programName: string;
  itineraryLabel: string | null;
  pointsRequired: number | null;
  pricingLabel: string;
  coverageLabel: string;
  evidenceLabel: "Planning estimate";
  availabilityLabel: "Check current availability before acting";
}

const priorityLabels: Record<string, string> = { lowest_cash: "Lowest cash cost", best_experience: "Best experience", simplest: "Simplest path", balanced: "Balanced" };
const cabinLabels: Record<string, string> = { economy: "Economy", premium_economy: "Premium economy", business: "Business", first: "First class", flexible: "Flexible" };
const statusLabels: Record<string, string> = { draft: "Draft goal", active: "Active goal", completed: "Completed goal", paused: "Paused goal" };
const pricingLabels: Record<string, string> = { one_way: "One way", round_trip: "Round trip", per_night: "Per night", total_stay: "Total stay", unknown: "Pricing basis not confirmed" };
const coverageLabels: Record<string, string> = { source_explicit: "Coverage stated by the research source", standard_assumption: "Uses a planning assumption", unknown: "Coverage not confirmed" };

export function safeGoalLabel(value: unknown, fallback = ""): string {
  if (typeof value !== "string") return fallback;
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized || normalized.length > 120 || /[\u0000-\u001f\u007f]/.test(normalized) || /https?:\/\//i.test(normalized) || containsCustomerInternalReference(normalized)) return fallback;
  return normalized;
}

export function toCustomerSafeResearchLabel(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const normalized = value.replace(/\s+/g, " ").trim();
  // Syntax and privacy only: URLs, internal references, and genuine technical
  // pipeline terms. Ordinary semantic words (live, bookable, guaranteed,
  // exact) are not blacklisted — claim truth is the evidence gate's job.
  if (!normalized || normalized.length > 160 || /[\u0000-\u001f\u007f]/.test(normalized) || /https?:\/\//i.test(normalized) || containsCustomerInternalReference(normalized) || /\b(?:payload|signature|validation|provider|stage)\b/i.test(normalized)) return fallback;
  return normalized;
}

function finite(value: unknown): number | null { return typeof value === "number" && Number.isFinite(value) ? value : null; }
function nonNegativeInteger(value: unknown): number | null { const result = finite(value); return result !== null && result >= 0 && Number.isInteger(result) ? result : null; }
function nonNegative(value: unknown): number | null { const result = finite(value); return result !== null && result >= 0 ? result : null; }
function dateLabel(value: unknown): string | null { if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null; const parsed = new Date(`${value}T00:00:00.000Z`); return Number.isNaN(parsed.getTime()) ? null : new Intl.DateTimeFormat("en-US", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" }).format(parsed); }
function currencyLabel(value: unknown): string | null { return typeof value === "string" && /^[A-Za-z]{3}$/.test(value.trim()) ? value.trim().toUpperCase() : null; }
function safeMap(map: Record<string, string>, value: unknown, fallback: string): string { return typeof value === "string" && map[value] ? map[value] : fallback; }

export function buildCustomerSafeGoalSummary(goal: Goal): CustomerSafeGoalSummary {
  const origins = goal.origin.map((item) => safeGoalLabel(item)).filter(Boolean);
  const destinations = goal.destinations.map((item) => safeGoalLabel(item)).filter(Boolean);
  const departure = dateLabel(goal.earliestDeparture);
  const returned = dateLabel(goal.latestReturn);
  const minimumNights = nonNegativeInteger(goal.minimumNights);
  const maximumNights = nonNegativeInteger(goal.maximumNights);
  const nights = minimumNights !== null && maximumNights !== null ? (minimumNights === maximumNights ? minimumNights : null) : minimumNights ?? maximumNights;
  const nightsLabel = minimumNights !== null && maximumNights !== null
    ? minimumNights === maximumNights
      ? `${minimumNights} ${minimumNights === 1 ? "night" : "nights"}`
      : `${minimumNights}–${maximumNights} nights`
    : nights === null ? null : `${nights} ${nights === 1 ? "night" : "nights"}`;
  const travelerCount = nonNegativeInteger(goal.travelerCount);
  const budget = nonNegative(goal.maximumCashBudget);
  const currency = currencyLabel(goal.currency);
  return {
    title: safeGoalLabel(goal.title, "Travel goal"),
    route: origins.length && destinations.length ? `${origins.join(", ")} → ${destinations.join(", ")}` : "Travel destination saved",
    dateWindow: departure && returned ? `${departure} – ${returned}` : null,
    dateWindowIsFlexible: Boolean(departure && returned && goal.earliestDeparture !== goal.latestReturn),
    travelerCount,
    travelerLabel: travelerCount === null ? "Traveler count saved" : `${travelerCount} ${travelerCount === 1 ? "traveler" : "travelers"}`,
    nights,
    nightsLabel,
    cabin: safeMap(cabinLabels, goal.cabinPreference, "Cabin preference saved"),
    budget: budget !== null && currency ? `${currency} ${budget.toLocaleString("en-US")}` : null,
    budgetLabel: budget !== null && currency ? `Budget: ${currency} ${budget.toLocaleString("en-US")}` : null,
    priority: safeMap(priorityLabels, goal.optimizationPriority, "Planning preferences saved"),
    status: safeMap(statusLabels, goal.status, "Goal saved"),
  };
}

export function buildCustomerSafePlanningPreview(option: StrategyAwardOption, key: string): CustomerSafePlanningPreview {
  return {
    key,
    programName: toCustomerSafeResearchLabel(option.programName, "Reward program"),
    itineraryLabel: option.itineraryLabel ? toCustomerSafeResearchLabel(option.itineraryLabel, "") || null : null,
    pointsRequired: nonNegativeInteger(option.pointsRequired),
    pricingLabel: safeMap(pricingLabels, option.pricingBasis, "Pricing basis not confirmed"),
    coverageLabel: safeMap(coverageLabels, option.coverageStatus, "Coverage not confirmed"),
    evidenceLabel: "Planning estimate",
    availabilityLabel: "Check current availability before acting",
  };
}

export const safeGoalStatusLabels = statusLabels;
export const safeCabinLabels = cabinLabels;
export const safePriorityLabels = priorityLabels;
