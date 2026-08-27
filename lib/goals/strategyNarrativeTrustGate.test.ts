import assert from "node:assert/strict";
import { test } from "node:test";

import { containsCustomerInternalReference } from "./customerTextPolicy";
import {
  applyNarrativeTrustGateToNarrative,
  applyNarrativeTrustGateToStrategy,
  BENCHMARK_ONLY_HEADLINE,
  BENCHMARK_ONLY_SUMMARY,
  deterministicNarrativeCopy,
  isBenchmarkOnlyEvidence,
  strongestNarrativeEvidence,
  STRUCTURED_EVIDENCE_HEADLINE,
  STRUCTURED_EVIDENCE_SUMMARY,
} from "./strategyNarrativeTrustGate";
import type {
  CustomerVerifiedTravelOption,
  PersonalizedStrategy,
  PersonalizedStrategyNarrative,
  PublicExactCashCandidate,
  StrategyAwardOption,
} from "./strategyTypes";

function benchmarkOption(
  id: string,
  redemptionType: "flight" | "hotel",
): StrategyAwardOption {
  return {
    id,
    sourceId: "source-1",
    programName: "Chase Ultimate Rewards",
    redemptionType,
    pricingBasis: redemptionType === "flight" ? "round_trip" : "per_night",
    itineraryLabel: "U.S. to Europe",
    pointsRequired: 30_000,
    cashFees: null,
    seats: null,
    cabin: "economy",
    transferFromProgramId: null,
    transferRatio: null,
    centsPerPoint: null,
    availabilityStatus: "unknown",
    evidenceLevel: "planning_benchmark",
    travelerCountCovered: redemptionType === "flight" ? 1 : null,
    nightCountCovered: redemptionType === "hotel" ? 1 : null,
    coverageStatus: "standard_assumption",
  };
}

function structuredOption(
  id: string,
  evidenceLevel: "exact_cash_offer" | "customer_verified",
): StrategyAwardOption {
  return { ...benchmarkOption(id, "flight"), evidenceLevel };
}

function exactCash(kind: "flight" | "hotel" = "flight"): PublicExactCashCandidate {
  // Test-only fixture: the production exact-cash lane is empty until a
  // future provider adapter exists. This proves lane semantics only.
  return {
    id: "cash-test-1",
    kind,
    evidenceLevel: "exact_cash_offer",
    retrievedAt: "2027-01-01T00:00:00.000Z",
    expiresAt: "2027-02-01T00:00:00.000Z",
    search: {
      origin: ["DEN"],
      destinations: ["Paris"],
      departureDate: "2027-04-03",
      returnDate: "2027-04-11",
      travelerCount: 2,
      roomCount: null,
      nightCount: 8,
    },
    coverage: { travelerCount: 2, roomCount: null, nightCount: 8 },
    price: { currency: "USD", total: 900, base: 800, taxes: 100, mandatoryFees: null },
    cancellationTerms: "Refundable",
    baggageTerms: null,
    paymentTiming: null,
    unknownFields: [],
    sourceLabel: "Test-only exact cash quote",
  };
}

function verified(kind: "flight" | "hotel" = "flight"): CustomerVerifiedTravelOption {
  return {
    id: "verified-test-1",
    evidenceLevel: "customer_verified",
    kind,
    confirmedAt: "2027-01-01T00:00:00.000Z",
    summary: "Customer confirmed this option",
    unknownFields: [],
  };
}

function narrative(overrides: Partial<PersonalizedStrategyNarrative> = {}): PersonalizedStrategyNarrative {
  return {
    headline: "Book this trip",
    summary: "Use your points now.",
    feasibility: "on_track",
    pointsGap: 0,
    recommendedAwardOptionId: "award-1",
    recommendedCardOfferId: "card-1",
    flightOptions: [benchmarkOption("award-1", "flight")],
    hotelOptions: [],
    actions: [{ priority: 1, title: "Book", explanation: "Do it.", deadline: null, sourceIds: [] }],
    alternatives: [{ title: "Pay cash", tradeoff: "Different cost.", sourceIds: [] }],
    assumptions: ["A planning assumption."],
    warnings: ["A warning."],
    followUpQuestions: ["Do you prefer a morning departure?"],
    ...overrides,
  };
}

function strategy(overrides: Partial<PersonalizedStrategy> = {}): PersonalizedStrategy {
  return {
    ...narrative(),
    pointsInventory: [],
    allocationScenarios: [],
    ...overrides,
  };
}

test("classification is descriptive: it never grants narrative authority", () => {
  assert.equal(
    strongestNarrativeEvidence({ flightOptions: [benchmarkOption("a", "flight")], hotelOptions: [] }),
    "benchmark_only",
  );
  assert.equal(
    strongestNarrativeEvidence({ flightOptions: [benchmarkOption("a", "flight")], hotelOptions: [], currentCashOptions: [exactCash()] }),
    "exact_cash",
  );
  assert.equal(
    strongestNarrativeEvidence({ flightOptions: [benchmarkOption("a", "flight")], hotelOptions: [], customerVerifiedOptions: [verified()] }),
    "customer_verified",
  );
  assert.equal(
    strongestNarrativeEvidence({ flightOptions: [structuredOption("a", "exact_cash_offer")], hotelOptions: [] }),
    "exact_cash",
  );
  assert.equal(
    strongestNarrativeEvidence({ flightOptions: [structuredOption("a", "customer_verified")], hotelOptions: [] }),
    "customer_verified",
  );
  assert.equal(
    isBenchmarkOnlyEvidence({ flightOptions: [benchmarkOption("a", "flight")], hotelOptions: [benchmarkOption("b", "hotel")] }),
    true,
  );
});

test("narrative gate suppresses the whole model narrative in benchmark-only mode", () => {
  const result = applyNarrativeTrustGateToNarrative(narrative());

  assert.equal(result.headline, BENCHMARK_ONLY_HEADLINE);
  assert.equal(result.summary, BENCHMARK_ONLY_SUMMARY);
  assert.equal(result.feasibility, "insufficient_information");
  assert.equal(result.pointsGap, null);
  assert.equal(result.recommendedAwardOptionId, null);
  assert.equal(result.recommendedCardOfferId, null);
  assert.deepEqual(result.actions, []);
  assert.deepEqual(result.alternatives, []);
  assert.deepEqual(result.assumptions, []);
  assert.deepEqual(result.warnings, []);
  // Allowlisted refinement topics are questions, not recommendation claims.
  assert.deepEqual(result.followUpQuestions, ["Do you prefer a morning departure?"]);
  // Deterministic value remains attached.
  assert.equal(result.flightOptions.length, 1);
});

test("narrative gate never unlocks model narrative for exact-cash or customer-verified evidence", () => {
  const withCash = narrative({ flightOptions: [structuredOption("award-1", "exact_cash_offer")] });
  const cashResult = applyNarrativeTrustGateToNarrative(withCash);
  assert.equal(cashResult.headline, STRUCTURED_EVIDENCE_HEADLINE);
  assert.equal(cashResult.summary, STRUCTURED_EVIDENCE_SUMMARY);
  assert.equal(cashResult.feasibility, "insufficient_information");
  assert.equal(cashResult.pointsGap, null);
  assert.equal(cashResult.recommendedAwardOptionId, null);
  assert.deepEqual(cashResult.actions, []);
  assert.deepEqual(cashResult.alternatives, []);
  assert.deepEqual(cashResult.assumptions, []);
  assert.deepEqual(cashResult.warnings, []);

  const withVerified = narrative({ flightOptions: [structuredOption("award-1", "customer_verified")] });
  const verifiedResult = applyNarrativeTrustGateToNarrative(withVerified);
  assert.equal(verifiedResult.headline, STRUCTURED_EVIDENCE_HEADLINE);
  assert.deepEqual(verifiedResult.actions, []);
  assert.deepEqual(verifiedResult.alternatives, []);
});

test("strategy gate suppresses narrative while preserving structured lanes and mixed assumptions", () => {
  const result = applyNarrativeTrustGateToStrategy(
    strategy({ currentCashOptions: [exactCash()], customerVerifiedOptions: [verified()] }),
  );

  assert.equal(result.headline, STRUCTURED_EVIDENCE_HEADLINE);
  assert.equal(result.summary, STRUCTURED_EVIDENCE_SUMMARY);
  assert.equal(result.feasibility, "insufficient_information");
  assert.equal(result.pointsGap, null);
  assert.equal(result.recommendedAwardOptionId, null);
  assert.equal(result.recommendedCardOfferId, null);
  assert.deepEqual(result.actions, []);
  assert.deepEqual(result.alternatives, []);
  // Structured lanes survive for display with their own evidence labels.
  assert.equal(result.currentCashOptions?.length, 1);
  assert.equal(result.customerVerifiedOptions?.length, 1);
  // Saved strategies mix server-side research notes with legacy model text;
  // the presentation filter removes unsafe sentences from them.
  assert.deepEqual(result.assumptions, ["A planning assumption."]);
  assert.deepEqual(result.warnings, ["A warning."]);
});

test("one stronger record never unlocks unrelated claims", () => {
  // One verified hotel must not authorize flight, budget, transfer, or
  // full-trip prose.
  const verifiedHotel = strategy({
    hotelOptions: [benchmarkOption("hotel-1", "hotel")],
    customerVerifiedOptions: [verified("hotel")],
  });
  const hotelResult = applyNarrativeTrustGateToStrategy(verifiedHotel);
  assert.equal(hotelResult.headline, STRUCTURED_EVIDENCE_HEADLINE);
  assert.deepEqual(hotelResult.actions, []);
  assert.deepEqual(hotelResult.alternatives, []);
  assert.equal(hotelResult.customerVerifiedOptions?.length, 1);

  // One exact-cash flight must not authorize hotel or total-budget prose.
  const cashFlight = strategy({
    hotelOptions: [benchmarkOption("hotel-1", "hotel")],
    currentCashOptions: [exactCash("flight")],
  });
  const flightResult = applyNarrativeTrustGateToStrategy(cashFlight);
  assert.equal(flightResult.headline, STRUCTURED_EVIDENCE_HEADLINE);
  assert.deepEqual(flightResult.actions, []);
  assert.deepEqual(flightResult.alternatives, []);
  assert.equal(flightResult.currentCashOptions?.length, 1);

  // A stronger record unrelated to a model-recommended option changes nothing.
  const unrelated = applyNarrativeTrustGateToStrategy(
    strategy({ recommendedAwardOptionId: "award-1", currentCashOptions: [exactCash()] }),
  );
  assert.equal(unrelated.recommendedAwardOptionId, null);
  assert.deepEqual(unrelated.actions, []);
});

test("deterministic copy variants are selected by the descriptive classifier and never contain internal references", () => {
  assert.equal(
    deterministicNarrativeCopy({ flightOptions: [benchmarkOption("a", "flight")], hotelOptions: [] }).headline,
    BENCHMARK_ONLY_HEADLINE,
  );
  assert.equal(
    deterministicNarrativeCopy({ flightOptions: [], hotelOptions: [], currentCashOptions: [exactCash()] }).headline,
    STRUCTURED_EVIDENCE_HEADLINE,
  );
  assert.equal(
    deterministicNarrativeCopy({ flightOptions: [], hotelOptions: [], customerVerifiedOptions: [verified()] }).headline,
    STRUCTURED_EVIDENCE_HEADLINE,
  );
  for (const copy of [BENCHMARK_ONLY_HEADLINE, BENCHMARK_ONLY_SUMMARY, STRUCTURED_EVIDENCE_HEADLINE, STRUCTURED_EVIDENCE_SUMMARY]) {
    assert.equal(containsCustomerInternalReference(copy), false, copy);
    assert.equal(/(?:https?:\/\/|www\.)/i.test(copy), false, copy);
  }
});
