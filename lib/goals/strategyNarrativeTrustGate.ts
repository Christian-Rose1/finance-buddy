/**
 * Deterministic narrative trust gate.
 *
 * Policy (current milestone): model-authored recommendation prose is ALWAYS
 * suppressed, regardless of evidence strength. Structured exact-cash and
 * customer-verified records may be displayed with their own evidence labels,
 * but their existence is NOT permission to display unrestricted model
 * narrative. Unrelated flight, hotel, budget, transfer, availability,
 * mixed-payment, or full-trip claims are never authorized by "some stronger
 * evidence exists elsewhere."
 *
 *   "Structured evidence may be displayed, but model recommendation prose
 *   remains suppressed until claims are bound to the specific supporting
 *   evidence."
 *
 * Claim-level authorization is deferred to the future source-bound candidate
 * milestone. This gate is deliberately not a keyword blacklist: in every
 * evidence state the whole model narrative is replaced with fixed
 * server-owned copy, so no semantic claim detection is ever attempted here.
 */

import type {
  CustomerVerifiedTravelOption,
  PersonalizedStrategy,
  PersonalizedStrategyNarrative,
  PublicExactCashCandidate,
  StrategyAwardOption,
} from "./strategyTypes";
import { evidenceLevelOf } from "./travelEvidence";

/**
 * Descriptive evidence classification only. The state never grants narrative
 * authority: model recommendation prose remains suppressed in every state
 * until claims are bound to the specific supporting evidence.
 */
export type NarrativeEvidenceState =
  | "benchmark_only"
  | "exact_cash"
  | "customer_verified";

export interface NarrativeEvidenceInput {
  flightOptions: StrategyAwardOption[];
  hotelOptions: StrategyAwardOption[];
  currentCashOptions?: PublicExactCashCandidate[];
  customerVerifiedOptions?: CustomerVerifiedTravelOption[];
}

/**
 * Strongest eligible evidence ordering:
 * customer_verified > exact_cash_offer > planning_benchmark.
 *
 * Descriptive only: it selects the fixed deterministic copy variant and may
 * inform future routing. It does not authorize model narrative.
 */
export function strongestNarrativeEvidence(
  input: NarrativeEvidenceInput,
): NarrativeEvidenceState {
  if ((input.customerVerifiedOptions?.length ?? 0) > 0) {
    return "customer_verified";
  }
  if ((input.currentCashOptions?.length ?? 0) > 0) {
    return "exact_cash";
  }
  const awards = [...(input.flightOptions ?? []), ...(input.hotelOptions ?? [])];
  if (
    awards.some(
      (option) => evidenceLevelOf(option) === "customer_verified",
    )
  ) {
    return "customer_verified";
  }
  if (
    awards.some(
      (option) => evidenceLevelOf(option) === "exact_cash_offer",
    )
  ) {
    return "exact_cash";
  }
  return "benchmark_only";
}

/** True only when the strongest evidence is a planning benchmark (descriptive). */
export function isBenchmarkOnlyEvidence(
  input: NarrativeEvidenceInput,
): boolean {
  return strongestNarrativeEvidence(input) === "benchmark_only";
}

/** Fixed customer-safe copy when only planning benchmarks exist. */
export const BENCHMARK_ONLY_HEADLINE = "Planning benchmarks found";
export const BENCHMARK_ONLY_SUMMARY =
  "Finance Buddy found planning benchmarks, but not a route- and date-specific option strong enough to recommend yet. " +
  "The estimates below can help compare possible points requirements, but they do not establish availability, affordability, or exact trip fit.";

/**
 * Fixed customer-safe copy when structured exact-cash or customer-verified
 * evidence exists. Structured records are displayed with their own evidence
 * labels, but no recommendation prose is generated yet.
 */
export const STRUCTURED_EVIDENCE_HEADLINE = "Planning estimates found";
export const STRUCTURED_EVIDENCE_SUMMARY =
  "Finance Buddy found planning estimates, but no claim-specific recommendation is ready yet. " +
  "Structured quotes and verified records are shown with their evidence labels; model recommendation prose remains suppressed until claims are bound to the specific supporting evidence.";

/**
 * Deterministic server-owned narrative copy for the given evidence state.
 * Never model-authored.
 */
export function deterministicNarrativeCopy(
  input: NarrativeEvidenceInput,
): { headline: string; summary: string } {
  return strongestNarrativeEvidence(input) === "benchmark_only"
    ? { headline: BENCHMARK_ONLY_HEADLINE, summary: BENCHMARK_ONLY_SUMMARY }
    : {
        headline: STRUCTURED_EVIDENCE_HEADLINE,
        summary: STRUCTURED_EVIDENCE_SUMMARY,
      };
}

/**
 * Server-side suppression applied to the provider narrative before research
 * data is merged and the strategy is persisted. Unconditional: model-authored
 * headline, summary, actions, alternatives, assumptions, and warnings are
 * discarded in every evidence state. Allowlisted refinement topics are
 * retained because they are fixed decision questions, not claims.
 */
export function applyNarrativeTrustGateToNarrative(
  narrative: PersonalizedStrategyNarrative,
): PersonalizedStrategyNarrative {
  const copy = deterministicNarrativeCopy({
    flightOptions: narrative.flightOptions,
    hotelOptions: narrative.hotelOptions,
  });
  return {
    ...narrative,
    headline: copy.headline,
    summary: copy.summary,
    feasibility: "insufficient_information",
    pointsGap: null,
    recommendedAwardOptionId: null,
    recommendedCardOfferId: null,
    actions: [],
    alternatives: [],
    assumptions: [],
    warnings: [],
  };
}

/**
 * Presentation-side defense in depth for any persisted strategy, including
 * strategies saved before this gate existed. Unconditional: benchmark-only,
 * exact-cash, customer-verified, and mixed evidence all receive deterministic
 * server-owned narrative copy. Structured lanes survive untouched (they are
 * displayed with their own evidence labels). Assumptions and warnings are
 * retained because saved strategies mix server-side research notes with
 * legacy model text, and the presentation filter removes unsafe sentences
 * from them.
 */
export function applyNarrativeTrustGateToStrategy(
  strategy: PersonalizedStrategy,
): PersonalizedStrategy {
  const copy = deterministicNarrativeCopy({
    flightOptions: strategy.flightOptions,
    hotelOptions: strategy.hotelOptions,
    currentCashOptions: strategy.currentCashOptions,
    customerVerifiedOptions: strategy.customerVerifiedOptions,
  });
  return {
    ...strategy,
    headline: copy.headline,
    summary: copy.summary,
    feasibility: "insufficient_information",
    pointsGap: null,
    recommendedAwardOptionId: null,
    recommendedCardOfferId: null,
    actions: [],
    alternatives: [],
  };
}
