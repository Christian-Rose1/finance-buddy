import type { Goal } from "./types";
import type { CustomerVerifiedTravelOption, PersonalizedStrategy, PublicExactCashCandidate, StrategyAllocationScenario, StrategyAwardOption, StrategyPointsInventoryItem } from "./strategyTypes";
import { buildCustomerSafeGoalSummary, safeGoalLabel, toCustomerSafeResearchLabel, type CustomerSafeGoalSummary } from "./customerSafeGoalSummary";
import { formatPersistedStrategyTimestamp } from "./customerSafeStrategyTimestamp";
import { filterCustomerSentences } from "./customerTextPolicy";
import { deterministicNarrativeCopy } from "./strategyNarrativeTrustGate";

export { type CustomerSafeGoalSummary } from "./customerSafeGoalSummary";
export interface CustomerSafeRewardAccount { key: string; programName: string; ownerType: "self" | "companion"; ownerLabel: string; balance: number | null; verificationLabel: string; originLabel: string; balanceAsOf: string; }
export interface CustomerSafeAllocation { key: string; programName: string; ownerLabel: string; ownerType: "self" | "companion" | null; fundingLabel: string | null; availablePoints: number | null; plannedPoints: number | null; remainingPoints: number | null; pointsGap: number | null; verificationLabel: string; }
export interface CustomerSafeEstimate { key: string; programName: string; redemptionLabel: string; pricingLabel: string; itineraryLabel: string | null; pointsRequired: number | null; cashFees: number | null; seats: number | null; cabin: string | null; coverageLabel: string; travelerCountCovered: number | null; nightCountCovered: number | null; evidenceLabel: "Planning estimate"; availabilityLabel: "Check current availability before acting"; }
export interface CustomerSafeScenario { key: string; label: string; statusLabel: string; title: string; flight: CustomerSafeEstimate | null; hotel: CustomerSafeEstimate | null; flightPointsRequired: number | null; hotelPointsRequired: number | null; travelerCount: number | null; tripNights: number | null; allocations: CustomerSafeAllocation[]; assumptions: string[]; warnings: string[]; }
export interface CustomerSafeAction { key: string; priority: number | null; title: string; explanation: string; deadline: string | null; }
export interface CustomerSafeAlternative { key: string; title: string; tradeoff: string; }
export interface CustomerSafeExactCashOption { key: string; kind: "flight" | "hotel"; sourceLabel: string; evidenceLabel: "Exact cash quote"; priceLabel: string; taxesLabel: string | null; datesLabel: string | null; coverageLabel: string; cancellationLabel: string | null; baggageLabel: string | null; unknownCount: number; }
export interface CustomerSafeVerifiedOption { key: string; kind: "flight" | "hotel"; summary: string; confirmedAtLabel: string | null; evidenceLabel: "Customer verified"; unknownCount: number; }
export interface CustomerSafeStrategyPresentation { goal: CustomerSafeGoalSummary; strategy: { headline: string; summary: string; actions: CustomerSafeAction[] }; rewards: { confirmedCount: number; needsConfirmationCount: number; pathCount: number; summary: string; verified: CustomerSafeRewardAccount[]; unverified: CustomerSafeRewardAccount[]; scenarios: CustomerSafeScenario[] }; flightEstimates: CustomerSafeEstimate[]; hotelEstimates: CustomerSafeEstimate[]; currentCash: CustomerSafeExactCashOption[]; customerVerified: CustomerSafeVerifiedOption[]; alternatives: CustomerSafeAlternative[]; details: { assumptions: string[]; warnings: string[]; unknowns: string[]; evidenceLabels: string[] }; refinementTopics: string[]; lastResearched: string | null; lastResearchedLabel: string | null; }
export const CUSTOMER_SAFE_MAX_ESTIMATES = 3;
export const CUSTOMER_SAFE_MAX_ALTERNATIVES = 2;

const pricingLabels: Record<string, string> = { one_way: "One way", round_trip: "Round trip", per_night: "Per night", total_stay: "Total stay", unknown: "Pricing basis not confirmed" };
const coverageLabels: Record<string, string> = { source_explicit: "Coverage stated by the research source", standard_assumption: "Uses a planning assumption", unknown: "Coverage not confirmed" };
const fundingLabels: Record<string, string> = { direct_program: "Use this confirmed rewards account", transfer_source: "Potential transfer path" };
const statusLabels: Record<string, string> = { gap: "We don’t see a confirmed rewards balance that can fund this option.", conditional: "Conditional planning scenario", insufficient_information: "We can’t work out the full points requirement yet." };
const cabinLabels: Record<string, string> = { economy: "Economy", premium_economy: "Premium economy", business: "Business", first: "First class", flexible: "Flexible" };

function safeText(value: unknown, fallback = ""): string {
  if (typeof value !== "string") return fallback;
  return filterCustomerSentences(value) || fallback;
}

/**
 * A "feasible" scenario status only proves points-arithmetic coverage, never
 * trip-level feasibility. Label it by what is actually proven: the verified
 * balance could cover the benchmark (or the structured option).
 */
function scenarioStatusLabel(
  value: StrategyAllocationScenario,
  flights: StrategyAwardOption[],
  hotels: StrategyAwardOption[],
): string {
  if (value.status !== "feasible") {
    return label(statusLabels, value.status, "More information needed");
  }
  const ids = [value.flightOptionId, value.hotelOptionId].filter(
    (id): id is string => id !== null,
  );
  const referenced = ids.flatMap((id) =>
    [...flights, ...hotels].filter((option) => option.id === id),
  );
  const allBenchmark = referenced.every(
    (option) =>
      (option.evidenceLevel ?? "planning_benchmark") === "planning_benchmark",
  );
  return allBenchmark
    ? "Points balance could cover this benchmark"
    : "Points balance could cover this option";
}
function safeList(values: readonly unknown[] | undefined): string[] { return (values ?? []).map((value) => safeText(value)).filter(Boolean); }
function safeDateLabel(value: unknown): string | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  return new Intl.DateTimeFormat("en-US", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" }).format(parsed);
}
function safeCurrencyLabel(value: unknown): string | null {
  return typeof value === "string" && /^[A-Za-z]{3}$/.test(value.trim()) ? value.trim().toUpperCase() : null;
}
function safeCashOption(candidate: PublicExactCashCandidate, index: number): CustomerSafeExactCashOption {
  const departure = safeDateLabel(candidate.search.departureDate);
  const returned = safeDateLabel(candidate.search.returnDate);
  const datesLabel = departure && returned ? `${departure} – ${returned}` : (departure ?? returned);
  const coverageParts = [
    candidate.coverage.travelerCount !== null ? `${candidate.coverage.travelerCount} ${candidate.coverage.travelerCount === 1 ? "traveler" : "travelers"}` : null,
    candidate.coverage.nightCount !== null ? `${candidate.coverage.nightCount} ${candidate.coverage.nightCount === 1 ? "night" : "nights"}` : null,
    candidate.coverage.roomCount !== null ? `${candidate.coverage.roomCount} ${candidate.coverage.roomCount === 1 ? "room" : "rooms"}` : null,
  ].filter((part): part is string => part !== null);
  const currency = safeCurrencyLabel(candidate.price.currency);
  const total = nonNegative(candidate.price.total);
  const priceLabel = currency !== null && total !== null ? `${currency} ${total.toLocaleString("en-US")} total` : "Total not confirmed";
  const taxes = nonNegative(candidate.price.taxes);
  const taxesLabel = currency !== null && taxes !== null ? `Taxes and fees: ${currency} ${taxes.toLocaleString("en-US")}` : null;
  return {
    key: `cash-${index + 1}`,
    kind: candidate.kind,
    sourceLabel: safeText(candidate.sourceLabel) || "Exact cash quote",
    evidenceLabel: "Exact cash quote",
    priceLabel,
    taxesLabel,
    datesLabel: datesLabel ? safeText(datesLabel) || null : null,
    coverageLabel: coverageParts.length > 0 ? coverageParts.join(" · ") : "Coverage not confirmed",
    cancellationLabel: candidate.cancellationTerms ? safeText(candidate.cancellationTerms) || null : null,
    baggageLabel: candidate.baggageTerms ? safeText(candidate.baggageTerms) || null : null,
    unknownCount: Array.isArray(candidate.unknownFields) ? candidate.unknownFields.length : 0,
  };
}
function safeVerifiedOption(option: CustomerVerifiedTravelOption, index: number): CustomerSafeVerifiedOption {
  const confirmed = typeof option.confirmedAt === "string" ? option.confirmedAt.slice(0, 10) : null;
  return {
    key: `verified-${index + 1}`,
    kind: option.kind,
    summary: safeText(option.summary) || "Customer-verified option",
    confirmedAtLabel: confirmed ? safeDateLabel(confirmed) : null,
    evidenceLabel: "Customer verified",
    unknownCount: Array.isArray(option.unknownFields) ? option.unknownFields.length : 0,
  };
}
function timestamp(value: unknown): string | null { if (typeof value !== "string") return null; const parsed = new Date(value); return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString(); }
function label(map: Record<string, string>, value: unknown, fallback: string): string { return typeof value === "string" && map[value] ? map[value] : fallback; }
function finite(value: unknown): number | null { return typeof value === "number" && Number.isFinite(value) ? value : null; }
function nonNegative(value: unknown): number | null { const result = finite(value); return result !== null && result >= 0 ? result : null; }
function nonNegativeInteger(value: unknown): number | null { const result = nonNegative(value); return result !== null && Number.isInteger(result) ? result : null; }
function estimate(option: StrategyAwardOption | undefined, key: string): CustomerSafeEstimate | null { if (!option) return null; return { key, programName: toCustomerSafeResearchLabel(option.programName, "Reward program"), redemptionLabel: option.redemptionType === "flight" ? "Flight" : option.redemptionType === "hotel" ? "Hotel" : "Travel option", pricingLabel: label(pricingLabels, option.pricingBasis, "Pricing basis not confirmed"), itineraryLabel: option.itineraryLabel ? toCustomerSafeResearchLabel(option.itineraryLabel, "") || null : null, pointsRequired: nonNegativeInteger(option.pointsRequired), cashFees: nonNegative(option.cashFees), seats: nonNegativeInteger(option.seats), cabin: option.cabin ? label(cabinLabels, option.cabin, "Cabin preference saved") : null, coverageLabel: label(coverageLabels, option.coverageStatus, "Coverage not confirmed"), travelerCountCovered: nonNegativeInteger(option.travelerCountCovered), nightCountCovered: nonNegativeInteger(option.nightCountCovered), evidenceLabel: "Planning estimate", availabilityLabel: "Check current availability before acting" }; }

export function buildCustomerSafeStrategyPresentation(goal: Goal, strategy: PersonalizedStrategy, generatedAt: string | null = null): CustomerSafeStrategyPresentation {
  const flights = strategy.flightOptions ?? []; const hotels = strategy.hotelOptions ?? []; const inventory = strategy.pointsInventory ?? [];
  const safeAccount = (item: StrategyPointsInventoryItem, index: number): CustomerSafeRewardAccount => ({ key: `account-${index + 1}`, programName: toCustomerSafeResearchLabel(item.programName, "Reward program"), ownerType: item.ownerType, ownerLabel: safeGoalLabel(item.ownerLabel, item.ownerType === "self" ? "You" : "Companion"), balance: nonNegative(item.balance), verificationLabel: item.verificationStatus === "verified" ? "Confirmed rewards balance" : "Balance needs confirmation", originLabel: item.origin === "connected" ? "Connected account" : item.origin === "manual" ? "Manually entered" : "Evidence-backed", balanceAsOf: safeGoalLabel(item.balanceAsOf) });
  const safeAccounts = inventory.map(safeAccount); const safeByRawAccount = new Map(inventory.map((item, index) => [item.accountId, safeAccounts[index]]));
  const safeScenario = (value: StrategyAllocationScenario, index: number): CustomerSafeScenario => ({ key: `scenario-${index + 1}`, label: value.kind === "balanced" ? "Balanced points planning" : value.kind === "flight_first" ? "Flight-first points planning" : value.kind === "hotel_first" ? "Hotel-first points planning" : "Planning path", statusLabel: scenarioStatusLabel(value, flights, hotels), title: safeText(value.title, "Planning path"), flight: value.flightOptionId ? estimate(flights.find((item) => item.id === value.flightOptionId), `scenario-${index + 1}-flight`) : null, hotel: value.hotelOptionId ? estimate(hotels.find((item) => item.id === value.hotelOptionId), `scenario-${index + 1}-hotel`) : null, flightPointsRequired: nonNegativeInteger(value.flightPointsRequired), hotelPointsRequired: nonNegativeInteger(value.hotelPointsRequired), travelerCount: nonNegativeInteger(value.travelerCount), tripNights: nonNegativeInteger(value.tripNights), allocations: (value.allocations ?? []).map((raw, allocationIndex) => { const account = safeByRawAccount.get(raw.accountId); if (!account) return { key: `allocation-${index + 1}-${allocationIndex + 1}`, programName: "Rewards account not confirmed", ownerLabel: "Rewards account not confirmed", ownerType: null, fundingLabel: null, availablePoints: null, plannedPoints: null, remainingPoints: null, pointsGap: null, verificationLabel: "Rewards account not confirmed" }; return { key: `allocation-${index + 1}-${allocationIndex + 1}`, programName: toCustomerSafeResearchLabel(account.programName, "Reward program"), ownerLabel: account.ownerLabel, ownerType: account.ownerType, fundingLabel: label(fundingLabels, raw.fundingMethod, "Funding method not confirmed"), availablePoints: account.balance, plannedPoints: nonNegativeInteger(raw.plannedPoints), remainingPoints: nonNegativeInteger(raw.remainingPoints), pointsGap: nonNegativeInteger(raw.pointsGap), verificationLabel: account.verificationLabel }; }), assumptions: safeList(value.assumptions), warnings: safeList(value.warnings) });
  const assumptions = safeList(strategy.assumptions); const warnings = safeList(strategy.warnings); const confirmed = safeAccounts.filter((item) => item.verificationLabel === "Confirmed rewards balance"); const needs = safeAccounts.filter((item) => item.verificationLabel !== "Confirmed rewards balance"); const scenarios = (strategy.allocationScenarios ?? []).map(safeScenario); const goalSummary = buildCustomerSafeGoalSummary(goal);
  // Deterministic evidence gate (defense in depth). Model-authored narrative
  // is suppressed in EVERY evidence state until claims are bound to specific
  // supporting evidence. The classification only selects the fixed server-owned
  // copy variant; structured exact-cash and customer-verified lanes are
  // projected separately with their own evidence labels.
  const narrativeCopy = deterministicNarrativeCopy({
    flightOptions: flights,
    hotelOptions: hotels,
    currentCashOptions: strategy.currentCashOptions,
    customerVerifiedOptions: strategy.customerVerifiedOptions,
  });
  const currentCash = (strategy.currentCashOptions ?? []).map(safeCashOption);
  const customerVerified = (strategy.customerVerifiedOptions ?? []).map(safeVerifiedOption);
  return { goal: goalSummary, strategy: { headline: narrativeCopy.headline, summary: narrativeCopy.summary, actions: [] }, rewards: { confirmedCount: confirmed.length, needsConfirmationCount: needs.length, pathCount: scenarios.length, summary: `${confirmed.length} confirmed rewards account${confirmed.length === 1 ? "" : "s"}, ${needs.length} balance${needs.length === 1 ? "" : "s"} needing confirmation, and ${scenarios.length} planning path${scenarios.length === 1 ? "" : "s"}. Accounts and programs remain separate.`, verified: confirmed, unverified: needs, scenarios }, flightEstimates: flights.slice(0, CUSTOMER_SAFE_MAX_ESTIMATES).map((item, index) => estimate(item, `flight-estimate-${index + 1}`)).filter((item): item is CustomerSafeEstimate => item !== null), hotelEstimates: hotels.slice(0, CUSTOMER_SAFE_MAX_ESTIMATES).map((item, index) => estimate(item, `hotel-estimate-${index + 1}`)).filter((item): item is CustomerSafeEstimate => item !== null), currentCash, customerVerified, alternatives: [], details: { assumptions, warnings, unknowns: [], evidenceLabels: [...flights, ...hotels].some((item) => (item.evidenceLevel ?? "planning_benchmark") === "planning_benchmark") ? ["Planning estimate"] : [] }, refinementTopics: safeList(strategy.followUpQuestions), lastResearched: timestamp(generatedAt), lastResearchedLabel: formatPersistedStrategyTimestamp(generatedAt)?.label ?? null };
}
