import { test } from "node:test";
import assert from "node:assert/strict";
import {
  validateStrategyRunStagePayload,
  buildStrategyRunStagePayload,
  StrategyRunPayloadError,
} from "./strategyRunPayload";
import type { StrategyAwardOption, StrategySource } from "./strategyTypes";
import type { InterpretedResearch } from "./researchInterpreter";

/** A minimal valid source fixture. */
function validSource(overrides: Partial<StrategySource> = {}): StrategySource {
  return {
    id: "src-1",
    label: "Test Source",
    status: "live",
    observedAt: null,
    ...overrides,
  };
}

/** A minimal valid flight award option fixture. */
function validFlightOption(
  overrides: Partial<StrategyAwardOption> = {},
): StrategyAwardOption {
  return {
    id: "opt-1",
    sourceId: "src-1",
    programName: "United MileagePlus",
    redemptionType: "flight",
    pricingBasis: "one_way",
    itineraryLabel: null,
    pointsRequired: 70000,
    cashFees: null,
    seats: null,
    cabin: null,
    transferFromProgramId: null,
    transferRatio: null,
    centsPerPoint: null,
    availabilityStatus: "available",
    ...overrides,
  };
}

/** A minimal valid hotel award option fixture. */
function validHotelOption(
  overrides: Partial<StrategyAwardOption> = {},
): StrategyAwardOption {
  return {
    id: "opt-2",
    sourceId: "src-1",
    programName: "Hyatt",
    redemptionType: "hotel",
    pricingBasis: "per_night",
    itineraryLabel: null,
    pointsRequired: 25000,
    cashFees: null,
    seats: null,
    cabin: null,
    transferFromProgramId: null,
    transferRatio: null,
    centsPerPoint: null,
    availabilityStatus: "available",
    ...overrides,
  };
}

/** A valid interpreted research payload with flight options. */
function validFlightInterpreted(opts: Partial<StrategyAwardOption> = {}): InterpretedResearch {
  return {
    awardOptions: [validFlightOption(opts)],
    cardOffers: [],
    sources: [validSource()],
    assumptions: ["Test assumption"],
    warnings: ["Test warning"],
  };
}

/** A valid interpreted research payload with hotel options. */
function validHotelInterpreted(opts: Partial<StrategyAwardOption> = {}): InterpretedResearch {
  return {
    awardOptions: [validHotelOption(opts)],
    cardOffers: [],
    sources: [validSource()],
    assumptions: ["Test assumption"],
    warnings: ["Test warning"],
  };
}

/** Assert the function throws StrategyRunPayloadError with the generic message. */
function assertRejected(fn: () => void): void {
  try {
    fn();
    assert.fail("Expected rejection");
  } catch (err) {
    assert.ok(err instanceof StrategyRunPayloadError);
    assert.equal(err.message, "Invalid strategy-run stage payload.");
    assert.equal(err.name, "StrategyRunPayloadError");
  }
}

// ---------------------------------------------------------------------------
// Valid envelope tests
// ---------------------------------------------------------------------------

test("valid flight envelope accepted", () => {
  const result = validateStrategyRunStagePayload(
    { schemaVersion: 1, stage: "flight", interpreted: validFlightInterpreted() },
    "flight",
  );
  assert.ok(result);
  assert.equal(result.schemaVersion, 1);
  assert.equal(result.stage, "flight");
});

test("valid hotel envelope accepted", () => {
  const result = validateStrategyRunStagePayload(
    { schemaVersion: 1, stage: "hotel", interpreted: validHotelInterpreted() },
    "hotel",
  );
  assert.ok(result);
  assert.equal(result.stage, "hotel");
});

test("returned value is newly constructed and input is unmodified", () => {
  const input = {
    schemaVersion: 1,
    stage: "flight" as const,
    interpreted: validFlightInterpreted(),
  };
  const result = buildStrategyRunStagePayload("flight", input.interpreted);
  assert.notStrictEqual(result, input);
  assert.notStrictEqual(result.interpreted, input.interpreted);
  assert.notStrictEqual(result.interpreted.awardOptions, input.interpreted.awardOptions);
  assert.equal(input.schemaVersion, 1);
  assert.equal(input.stage, "flight");
});

// ---------------------------------------------------------------------------
// Envelope validation failures
// ---------------------------------------------------------------------------

test("wrong schemaVersion rejected", () => {
  assert.throws(
    () =>
      validateStrategyRunStagePayload(
        { schemaVersion: 2, stage: "flight", interpreted: validFlightInterpreted() },
        "flight",
      ),
    StrategyRunPayloadError,
  );
});

test("wrong expected stage rejected", () => {
  assert.throws(
    () =>
      validateStrategyRunStagePayload(
        { schemaVersion: 1, stage: "flight", interpreted: validFlightInterpreted() },
        "hotel",
      ),
    StrategyRunPayloadError,
  );
});

test("flight payload containing hotel option rejected", () => {
  assertRejected(() =>
    validateStrategyRunStagePayload(
      {
        schemaVersion: 1,
        stage: "flight",
        interpreted: { ...validFlightInterpreted(), awardOptions: [validHotelOption()] },
      },
      "flight",
    ),
  );
});

test("hotel payload containing flight option rejected", () => {
  assertRejected(() =>
    validateStrategyRunStagePayload(
      {
        schemaVersion: 1,
        stage: "hotel",
        interpreted: { ...validHotelInterpreted(), awardOptions: [validFlightOption()] },
      },
      "hotel",
    ),
  );
});

test("nonempty cardOffers rejected", () => {
  assertRejected(() =>
    validateStrategyRunStagePayload(
      {
        schemaVersion: 1,
        stage: "flight",
        interpreted: {
          ...validFlightInterpreted(),
          cardOffers: [{ id: "co-1", sourceId: "src-1", cardName: "X", issuer: "Y", welcomeBonusPoints: 1, spendingRequirement: 1, spendingDeadlineMonths: 1, annualFee: 1, destinationProgramId: null }],
        },
      },
      "flight",
    ),
  );
});

test("missing required top-level array rejected", () => {
  assertRejected(() =>
    validateStrategyRunStagePayload(
      {
        schemaVersion: 1,
        stage: "flight",
        interpreted: { awardOptions: validFlightInterpreted().awardOptions, cardOffers: [], sources: validFlightInterpreted().sources, warnings: validFlightInterpreted().warnings },
      },
      "flight",
    ),
  );
});

test("extra envelope property rejected", () => {
  assertRejected(() =>
    validateStrategyRunStagePayload(
      { schemaVersion: 1, stage: "flight", interpreted: validFlightInterpreted(), extra: "bad" },
      "flight",
    ),
  );
});

test("extra interpreted property rejected", () => {
  assertRejected(() =>
    validateStrategyRunStagePayload(
      { schemaVersion: 1, stage: "flight", interpreted: { ...validFlightInterpreted(), extra: "bad" } },
      "flight",
    ),
  );
});

test("extra award option property rejected", () => {
  assertRejected(() =>
    validateStrategyRunStagePayload(
      {
        schemaVersion: 1,
        stage: "flight",
        interpreted: { ...validFlightInterpreted(), awardOptions: [{ ...validFlightOption(), extraField: "bad" }] },
      },
      "flight",
    ),
  );
});

test("extra source property rejected", () => {
  assertRejected(() =>
    validateStrategyRunStagePayload(
      {
        schemaVersion: 1,
        stage: "flight",
        interpreted: { ...validFlightInterpreted(), sources: [{ ...validSource(), extraField: "bad" }] },
      },
      "flight",
    ),
  );
});

// ---------------------------------------------------------------------------
// Optional number validation
// ---------------------------------------------------------------------------

test("negative cashFees rejected", () => {
  assertRejected(() =>
    validateStrategyRunStagePayload(
      { schemaVersion: 1, stage: "flight", interpreted: validFlightInterpreted({ cashFees: -1 }) },
      "flight",
    ),
  );
});

test("negative transferRatio rejected", () => {
  assertRejected(() =>
    validateStrategyRunStagePayload(
      { schemaVersion: 1, stage: "flight", interpreted: validFlightInterpreted({ transferRatio: -0.5 }) },
      "flight",
    ),
  );
});

test("negative centsPerPoint rejected", () => {
  assertRejected(() =>
    validateStrategyRunStagePayload(
      { schemaVersion: 1, stage: "flight", interpreted: validFlightInterpreted({ centsPerPoint: -1 }) },
      "flight",
    ),
  );
});

test("pointsRequired not integer rejected", () => {
  assertRejected(() =>
    validateStrategyRunStagePayload(
      { schemaVersion: 1, stage: "flight", interpreted: validFlightInterpreted({ pointsRequired: 1.5 }) },
      "flight",
    ),
  );
});

// ---------------------------------------------------------------------------
// Coverage count validation
// ---------------------------------------------------------------------------

test("zero coverage count rejected", () => {
  assertRejected(() =>
    validateStrategyRunStagePayload(
      {
        schemaVersion: 1,
        stage: "flight",
        interpreted: validFlightInterpreted({
          coverageStatus: "source_explicit",
          travelerCountCovered: 0,
        } as Partial<StrategyAwardOption>),
      },
      "flight",
    ),
  );
});

test("fractional coverage count rejected", () => {
  assertRejected(() =>
    validateStrategyRunStagePayload(
      {
        schemaVersion: 1,
        stage: "hotel",
        interpreted: validHotelInterpreted({
          coverageStatus: "source_explicit",
          nightCountCovered: 1.5,
        } as Partial<StrategyAwardOption>),
      },
      "hotel",
    ),
  );
});

test("flight with night count rejected", () => {
  assertRejected(() =>
    validateStrategyRunStagePayload(
      {
        schemaVersion: 1,
        stage: "flight",
        interpreted: validFlightInterpreted({ nightCountCovered: 2 } as Partial<StrategyAwardOption>),
      },
      "flight",
    ),
  );
});

test("hotel with traveler count rejected", () => {
  assertRejected(() =>
    validateStrategyRunStagePayload(
      {
        schemaVersion: 1,
        stage: "hotel",
        interpreted: validHotelInterpreted({ travelerCountCovered: 2 } as Partial<StrategyAwardOption>),
      },
      "hotel",
    ),
  );
});

// ---------------------------------------------------------------------------
// Coverage status acceptance
// ---------------------------------------------------------------------------

test("source_explicit flight coverage accepted", () => {
  const result = validateStrategyRunStagePayload(
    {
      schemaVersion: 1,
      stage: "flight",
      interpreted: validFlightInterpreted({
        coverageStatus: "source_explicit",
        travelerCountCovered: 2,
      } as Partial<StrategyAwardOption>),
    },
    "flight",
  );
  assert.ok(result);
  assert.equal(result.interpreted.awardOptions[0].coverageStatus, "source_explicit");
  assert.equal(result.interpreted.awardOptions[0].travelerCountCovered, 2);
});

test("source_explicit hotel coverage accepted", () => {
  const result = validateStrategyRunStagePayload(
    {
      schemaVersion: 1,
      stage: "hotel",
      interpreted: validHotelInterpreted({
        coverageStatus: "source_explicit",
        nightCountCovered: 3,
      } as Partial<StrategyAwardOption>),
    },
    "hotel",
  );
  assert.ok(result);
  assert.equal(result.interpreted.awardOptions[0].coverageStatus, "source_explicit");
  assert.equal(result.interpreted.awardOptions[0].nightCountCovered, 3);
});

test("standard_assumption flight requires travelerCountCovered=1", () => {
  const result = validateStrategyRunStagePayload(
    {
      schemaVersion: 1,
      stage: "flight",
      interpreted: validFlightInterpreted({
        coverageStatus: "standard_assumption",
        travelerCountCovered: 1,
      } as Partial<StrategyAwardOption>),
    },
    "flight",
  );
  assert.ok(result);
  assert.equal(result.interpreted.awardOptions[0].coverageStatus, "standard_assumption");
  assert.equal(result.interpreted.awardOptions[0].travelerCountCovered, 1);
});

test("standard_assumption flight with travelerCountCovered not 1 rejected", () => {
  assertRejected(() =>
    validateStrategyRunStagePayload(
      {
        schemaVersion: 1,
        stage: "flight",
        interpreted: validFlightInterpreted({
          coverageStatus: "standard_assumption",
          travelerCountCovered: 2,
        } as Partial<StrategyAwardOption>),
      },
      "flight",
    ),
  );
});

test("standard_assumption hotel requires per_night and nightCountCovered=1", () => {
  const result = validateStrategyRunStagePayload(
    {
      schemaVersion: 1,
      stage: "hotel",
      interpreted: validHotelInterpreted({
        pricingBasis: "per_night",
        coverageStatus: "standard_assumption",
        nightCountCovered: 1,
      } as Partial<StrategyAwardOption>),
    },
    "hotel",
  );
  assert.ok(result);
});

test("total_stay hotel standard_assumption rejected", () => {
  assertRejected(() =>
    validateStrategyRunStagePayload(
      {
        schemaVersion: 1,
        stage: "hotel",
        interpreted: validHotelInterpreted({
          pricingBasis: "total_stay",
          coverageStatus: "standard_assumption",
          nightCountCovered: 1,
        } as Partial<StrategyAwardOption>),
      },
      "hotel",
    ),
  );
});

test("unknown coverage with any count rejected", () => {
  assertRejected(() =>
    validateStrategyRunStagePayload(
      {
        schemaVersion: 1,
        stage: "flight",
        interpreted: validFlightInterpreted({
          coverageStatus: "unknown",
          travelerCountCovered: 1,
        } as Partial<StrategyAwardOption>),
      },
      "flight",
    ),
  );
});

test("coverage count without coverageStatus rejected", () => {
  assertRejected(() =>
    validateStrategyRunStagePayload(
      {
        schemaVersion: 1,
        stage: "flight",
        interpreted: validFlightInterpreted({
          travelerCountCovered: 2,
        } as Partial<StrategyAwardOption>),
      },
      "flight",
    ),
  );
});

test("coverageStatus without required count rejected", () => {
  assertRejected(() =>
    validateStrategyRunStagePayload(
      {
        schemaVersion: 1,
        stage: "flight",
        interpreted: validFlightInterpreted({
          coverageStatus: "source_explicit",
        } as Partial<StrategyAwardOption>),
      },
      "flight",
    ),
  );
});

test("valid flight accepts nightCountCovered=null", () => {
  const result = validateStrategyRunStagePayload(
    {
      schemaVersion: 1,
      stage: "flight",
      interpreted: validFlightInterpreted({ nightCountCovered: null } as Partial<StrategyAwardOption>),
    },
    "flight",
  );
  assert.ok(result);
  assert.equal(result.interpreted.awardOptions[0].nightCountCovered, null);
});

test("valid hotel accepts travelerCountCovered=null", () => {
  const result = validateStrategyRunStagePayload(
    {
      schemaVersion: 1,
      stage: "hotel",
      interpreted: validHotelInterpreted({ travelerCountCovered: null } as Partial<StrategyAwardOption>),
    },
    "hotel",
  );
  assert.ok(result);
  assert.equal(result.interpreted.awardOptions[0].travelerCountCovered, null);
});

test("unknown coverage accepts both counts explicitly null", () => {
  const result = validateStrategyRunStagePayload(
    {
      schemaVersion: 1,
      stage: "flight",
      interpreted: validFlightInterpreted({
        coverageStatus: "unknown",
        travelerCountCovered: null,
        nightCountCovered: null,
      } as Partial<StrategyAwardOption>),
    },
    "flight",
  );
  assert.ok(result);
  assert.equal(result.interpreted.awardOptions[0].coverageStatus, "unknown");
  assert.equal(result.interpreted.awardOptions[0].travelerCountCovered, null);
  assert.equal(result.interpreted.awardOptions[0].nightCountCovered, null);
});

test("absent coverageStatus accepts both counts explicitly null", () => {
  const result = validateStrategyRunStagePayload(
    {
      schemaVersion: 1,
      stage: "flight",
      interpreted: validFlightInterpreted({
        travelerCountCovered: null,
        nightCountCovered: null,
      } as Partial<StrategyAwardOption>),
    },
    "flight",
  );
  assert.ok(result);
  assert.equal(result.interpreted.awardOptions[0].travelerCountCovered, null);
  assert.equal(result.interpreted.awardOptions[0].nightCountCovered, null);
});

// ---------------------------------------------------------------------------
// Goal classification
// ---------------------------------------------------------------------------

test("only one goal-classification field rejected (goalMatch only)", () => {
  assertRejected(() =>
    validateStrategyRunStagePayload(
      {
        schemaVersion: 1,
        stage: "flight",
        interpreted: validFlightInterpreted({ goalMatch: "exact" } as Partial<StrategyAwardOption>),
      },
      "flight",
    ),
  );
});

test("only one goal-classification field rejected (goalMismatchReasons only)", () => {
  assertRejected(() =>
    validateStrategyRunStagePayload(
      {
        schemaVersion: 1,
        stage: "flight",
        interpreted: validFlightInterpreted({ goalMismatchReasons: ["destination"] } as Partial<StrategyAwardOption>),
      },
      "flight",
    ),
  );
});

test("duplicate mismatch reasons rejected", () => {
  assertRejected(() =>
    validateStrategyRunStagePayload(
      {
        schemaVersion: 1,
        stage: "flight",
        interpreted: validFlightInterpreted({
          goalMatch: "partial",
          goalMismatchReasons: ["destination", "destination"],
        } as Partial<StrategyAwardOption>),
      },
      "flight",
    ),
  );
});

test("exact with non-empty reasons rejected", () => {
  assertRejected(() =>
    validateStrategyRunStagePayload(
      {
        schemaVersion: 1,
        stage: "flight",
        interpreted: validFlightInterpreted({
          goalMatch: "exact",
          goalMismatchReasons: ["destination"],
        } as Partial<StrategyAwardOption>),
      },
      "flight",
    ),
  );
});

test("different_destination without destination in reasons rejected", () => {
  assertRejected(() =>
    validateStrategyRunStagePayload(
      {
        schemaVersion: 1,
        stage: "flight",
        interpreted: validFlightInterpreted({
          goalMatch: "different_destination",
          goalMismatchReasons: ["origin"],
        } as Partial<StrategyAwardOption>),
      },
      "flight",
    ),
  );
});

test("valid different_destination classification accepted", () => {
  const result = validateStrategyRunStagePayload(
    {
      schemaVersion: 1,
      stage: "flight",
      interpreted: validFlightInterpreted({
        goalMatch: "different_destination",
        goalMismatchReasons: ["destination", "dates"],
      } as Partial<StrategyAwardOption>),
    },
    "flight",
  );
  assert.ok(result);
  assert.equal(result.interpreted.awardOptions[0].goalMatch, "different_destination");
});

test("valid exact classification accepted", () => {
  const result = validateStrategyRunStagePayload(
    {
      schemaVersion: 1,
      stage: "flight",
      interpreted: validFlightInterpreted({
        goalMatch: "exact",
        goalMismatchReasons: [],
      } as Partial<StrategyAwardOption>),
    },
    "flight",
  );
  assert.ok(result);
  assert.equal(result.interpreted.awardOptions[0].goalMatch, "exact");
});

// ---------------------------------------------------------------------------
// Other validation
// ---------------------------------------------------------------------------

test("assumptions non-string rejected", () => {
  assertRejected(() =>
    validateStrategyRunStagePayload(
      { schemaVersion: 1, stage: "flight", interpreted: { ...validFlightInterpreted(), assumptions: [123 as any] } },
      "flight",
    ),
  );
});

test("warnings non-string rejected", () => {
  assertRejected(() =>
    validateStrategyRunStagePayload(
      { schemaVersion: 1, stage: "flight", interpreted: { ...validFlightInterpreted(), warnings: [false as any] } },
      "flight",
    ),
  );
});

test("unknown sourceId rejected", () => {
  assertRejected(() =>
    validateStrategyRunStagePayload(
      {
        schemaVersion: 1,
        stage: "flight",
        interpreted: { ...validFlightInterpreted(), awardOptions: [validFlightOption({ sourceId: "unknown-src" })] },
      },
      "flight",
    ),
  );
});

test("invalid pricing-basis/type combination rejected", () => {
  assertRejected(() =>
    validateStrategyRunStagePayload(
      {
        schemaVersion: 1,
        stage: "flight",
        interpreted: { ...validFlightInterpreted(), awardOptions: [validFlightOption({ pricingBasis: "per_night" as any })] },
      },
      "flight",
    ),
  );
});

test("NaN number rejected", () => {
  assertRejected(() =>
    validateStrategyRunStagePayload(
      { schemaVersion: 1, stage: "flight", interpreted: validFlightInterpreted({ pointsRequired: NaN }) },
      "flight",
    ),
  );
});

test("infinite number rejected", () => {
  assertRejected(() =>
    validateStrategyRunStagePayload(
      { schemaVersion: 1, stage: "flight", interpreted: validFlightInterpreted({ pointsRequired: Infinity }) },
      "flight",
    ),
  );
});