import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { ExactCashCandidate, PersonalizedStrategy, StrategyAwardOption } from "./strategyTypes";
import {
  asPlanningBenchmark,
  isValidExactCashCandidate,
  selectPrimaryExactCashCandidates,
  toClientSafeStrategy,
  toPublicExactCashCandidate,
} from "./travelEvidence";

function benchmark(): StrategyAwardOption {
  return {
    id: "award-1", sourceId: "https://official.example/research", programName: "Program",
    redemptionType: "flight", pricingBasis: "round_trip", itineraryLabel: null,
    pointsRequired: 10000, cashFees: null, seats: null, cabin: null,
    transferFromProgramId: null, transferRatio: null, centsPerPoint: null,
    availabilityStatus: "unknown",
  };
}

function exactCash(): ExactCashCandidate {
  return {
    id: "cash-1", kind: "flight", evidenceLevel: "exact_cash_offer",
    providerIdentity: "provider-private-id", offerIdentity: "offer-private-id",
    retrievedAt: "2026-08-26T10:00:00.000Z", expiresAt: "2026-08-26T10:30:00.000Z",
    search: { origin: ["JFK"], destinations: ["CDG"], departureDate: "2027-04-03", returnDate: "2027-04-11", travelerCount: 2, roomCount: null, nightCount: null },
    coverage: { travelerCount: 2, roomCount: null, nightCount: null },
    price: { currency: "USD", total: 1200, base: 1000, taxes: 150, mandatoryFees: 50 },
    cancellationTerms: null, baggageTerms: null, paymentTiming: null, unknownFields: [],
  };
}

function strategy(): PersonalizedStrategy {
  return {
    headline: "", summary: "", feasibility: "insufficient_information", pointsGap: null,
    recommendedAwardOptionId: null, recommendedCardOfferId: null,
    flightOptions: [benchmark()], hotelOptions: [], actions: [], alternatives: [],
    assumptions: [], warnings: [], followUpQuestions: [], pointsInventory: [], allocationScenarios: [],
  };
}

describe("Evidence Separation v1", () => {
  it("defaults existing research to planning_benchmark", () => {
    assert.equal(asPlanningBenchmark(benchmark()).evidenceLevel, "planning_benchmark");
  });

  it("does not allow a benchmark into the exact-candidate selection path", () => {
    assert.deepEqual(selectPrimaryExactCashCandidates([]), []);
    assert.equal(isValidExactCashCandidate({ ...exactCash(), evidenceLevel: "planning_benchmark" }), false);
    assert.deepEqual(selectPrimaryExactCashCandidates([
      exactCash(),
      { ...exactCash(), id: "not-exact", evidenceLevel: "planning_benchmark" } as unknown as ExactCashCandidate,
    ]).map((candidate) => candidate.id), ["cash-1"]);
  });

  it("requires identity, freshness, coverage, and price fields before an exact cash fixture can render", () => {
    const valid = exactCash();
    assert.ok(toPublicExactCashCandidate(valid, "Official provider"));
    assert.equal(toPublicExactCashCandidate({ ...valid, offerIdentity: "" }, "Official provider"), null);
    assert.equal(toPublicExactCashCandidate({ ...valid, expiresAt: "" }, "Official provider"), null);
    assert.equal(toPublicExactCashCandidate({ ...valid, coverage: { travelerCount: null, roomCount: null, nightCount: null } }, "Official provider"), null);
    assert.equal(toPublicExactCashCandidate({ ...valid, price: { ...valid.price, total: -1 } }, "Official provider"), null);
  });

  it("keeps benchmarks visible while replacing every client source reference with an opaque ID", () => {
    const legacy = strategy();
    legacy.flightOptions[0] = { ...legacy.flightOptions[0], availabilityStatus: "available" };
    legacy.actions = [{ priority: 1, title: "Action", explanation: "Use the benchmark", deadline: null, sourceIds: ["https://official.example/research", "private-source-id"] }];
    legacy.alternatives = [{ title: "Alternative", tradeoff: "Tradeoff", sourceIds: ["private-source-id"] }];
    const safe = toClientSafeStrategy(legacy);
    assert.equal(safe.flightOptions[0].evidenceLevel, "planning_benchmark");
    assert.equal(safe.flightOptions[0].sourceId, "source-1");
    assert.equal(safe.flightOptions[0].availabilityStatus, "unknown");
    assert.deepEqual(safe.actions[0].sourceIds, ["source-1", "source-2"]);
    assert.deepEqual(safe.alternatives[0].sourceIds, ["source-2"]);
    assert.equal(JSON.stringify(safe).includes("official.example"), false);
    assert.equal(JSON.stringify(safe).includes("private-source-id"), false);
  });

  it("does not serialize provider or offer identities into the public exact-cash projection", () => {
    const publicCandidate = toPublicExactCashCandidate(exactCash(), "Official provider");
    assert.ok(publicCandidate);
    const serialized = JSON.stringify(publicCandidate);
    assert.equal(serialized.includes("provider-private-id"), false);
    assert.equal(serialized.includes("offer-private-id"), false);
  });

  it("drops invalid exact-cash candidates before returning a strategy to the browser", () => {
    const input = strategy() as PersonalizedStrategy & { currentCashOptions: unknown[] };
    input.currentCashOptions = [
      { ...exactCash(), sourceLabel: "Official provider", offerIdentity: "" },
      { ...exactCash(), sourceLabel: "Official provider", coverage: { travelerCount: null, roomCount: null, nightCount: null } },
      { ...exactCash(), sourceLabel: "Official provider", price: { ...exactCash().price, total: Number.NaN } },
      { ...exactCash(), sourceLabel: "https://provider.example/private-offer" },
    ];
    assert.deepEqual(toClientSafeStrategy(input).currentCashOptions, []);
  });

  it("projects valid exact-cash candidates without raw provider, offer, internal, payload, or URL fields", () => {
    const input = strategy() as PersonalizedStrategy & { currentCashOptions: unknown[] };
    input.currentCashOptions = [{
      ...exactCash(),
      id: "database-internal-id",
      sourceLabel: "Official provider",
      rawProviderPayload: { bookingUrl: "https://provider.example/offer" },
      signature: "server-only-signature",
    }];
    const safe = toClientSafeStrategy(input);
    assert.equal(safe.currentCashOptions?.[0]?.id, "cash-1");
    assert.equal(safe.currentCashOptions?.[0]?.sourceLabel, "Official provider");
    const serialized = JSON.stringify(safe);
    for (const secret of ["provider-private-id", "offer-private-id", "database-internal-id", "server-only-signature", "provider.example"]) {
      assert.equal(serialized.includes(secret), false);
    }
  });

  it("clears a legacy benchmark recommendation rather than presenting it as a recommendation", () => {
    const legacy = strategy();
    legacy.recommendedAwardOptionId = "award-1";
    legacy.flightOptions[0] = { ...legacy.flightOptions[0], availabilityStatus: "available" };
    const safe = toClientSafeStrategy(legacy);
    assert.equal(safe.recommendedAwardOptionId, null);
    assert.equal(safe.flightOptions[0].availabilityStatus, "unknown");
  });
});
