import type { StrategyAwardOption, StrategyCardOffer, StrategySource } from "./strategyTypes";
import type { InterpretedResearch } from "./researchInterpreter";

export type StrategyRunPayloadStage = "flight" | "hotel";

export interface StrategyRunStagePayload {
  schemaVersion: 1;
  stage: StrategyRunPayloadStage;
  interpreted: InterpretedResearch;
}

export class StrategyRunPayloadError extends Error {
  constructor() {
    super("Invalid strategy-run stage payload.");
    this.name = "StrategyRunPayloadError";
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isNonArrayObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function safeThrow(): never {
  throw new StrategyRunPayloadError();
}

function hasOnlyKeys(obj: Record<string, unknown>, allowed: ReadonlySet<string>): boolean {
  for (const key of Object.keys(obj)) {
    if (!allowed.has(key)) {
      return false;
    }
  }
  return true;
}

function validateNonNegativeInteger(value: unknown): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < 0 ||
    !Number.isInteger(value)
  ) {
    safeThrow();
  }
  return value;
}

function validatePositiveInteger(value: unknown): number {
  const n = validateNonNegativeInteger(value);
  if (n === 0) {
    safeThrow();
  }
  return n;
}

function validateNonNegativeFinite(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    safeThrow();
  }
  return value;
}

function validateNullOrNonNegativeFinite(value: unknown): number | null {
  if (value === null) {
    return null;
  }
  return validateNonNegativeFinite(value);
}

function validateNullOrNonNegativeInteger(value: unknown): number | null {
  if (value === null) {
    return null;
  }
  return validateNonNegativeInteger(value);
}

function validateNullOrPositiveInteger(value: unknown): number | null {
  if (value === null) {
    return null;
  }
  return validatePositiveInteger(value);
}

function validateString(value: unknown): string {
  if (typeof value !== "string") {
    safeThrow();
  }
  return value;
}

function validateNullableString(value: unknown): string | null {
  if (value === null) {
    return null;
  }
  return validateString(value);
}

function validateStringEnum<T extends string>(
  value: unknown,
  allowed: ReadonlyArray<T>,
): T {
  const s = validateString(value);
  if (!allowed.includes(s as T)) {
    safeThrow();
  }
  return s as T;
}

function validateStringArray(values: unknown): string[] {
  if (!Array.isArray(values)) {
    safeThrow();
  }
  return values.map((v) => validateString(v));
}

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

const REDEMPTION_TYPES = ["flight", "hotel"] as const;
const PRICING_BASIS = ["one_way", "round_trip", "per_night", "total_stay", "unknown"] as const;
const AVAILABILITY_STATUSES = ["available", "unavailable", "unknown"] as const;
const COVERAGE_STATUSES = ["source_explicit", "standard_assumption", "unknown"] as const;
const GOAL_MATCHES = ["exact", "partial", "general", "different_destination"] as const;
const GOAL_MISMATCH_REASONS = [
  "origin",
  "destination",
  "dates",
  "traveler_count",
  "cabin",
  "property",
] as const;
const SOURCE_STATUSES = ["live", "catalog", "user_confirmed", "calculated", "estimated"] as const;

// Valid pricingBasis per redemptionType
const FLIGHT_PRICING_BASIS: ReadonlySet<string> = new Set(["one_way", "round_trip", "unknown"]);
const HOTEL_PRICING_BASIS: ReadonlySet<string> = new Set(["per_night", "total_stay", "unknown"]);

// ---------------------------------------------------------------------------
// Source validation
// ---------------------------------------------------------------------------

const SOURCE_KEYS = new Set(["id", "label", "status", "observedAt"]);

function validateSource(raw: unknown): StrategySource {
  if (!isNonArrayObject(raw)) {
    safeThrow();
  }
  if (!hasOnlyKeys(raw, SOURCE_KEYS)) {
    safeThrow();
  }

  const id = validateString(raw.id);
  const label = validateString(raw.label);
  const status = validateStringEnum(raw.status, SOURCE_STATUSES);
  const observedAt = validateNullableString(raw.observedAt);

  return { id, label, status, observedAt };
}

// ---------------------------------------------------------------------------
// AwardOption validation
// ---------------------------------------------------------------------------

const AWARD_OPTION_REQUIRED_KEYS = new Set([
  "id",
  "sourceId",
  "programName",
  "redemptionType",
  "pricingBasis",
  "itineraryLabel",
  "pointsRequired",
  "cashFees",
  "seats",
  "cabin",
  "transferFromProgramId",
  "transferRatio",
  "centsPerPoint",
  "availabilityStatus",
]);

const AWARD_OPTION_OPTIONAL_KEYS = new Set([
  "travelerCountCovered",
  "nightCountCovered",
  "coverageStatus",
  "goalMatch",
  "goalMismatchReasons",
]);

const ALL_AWARD_OPTION_KEYS = new Set([...AWARD_OPTION_REQUIRED_KEYS, ...AWARD_OPTION_OPTIONAL_KEYS]);

function validateAwardOption(
  raw: unknown,
  expectedRedemptionType: "flight" | "hotel",
): StrategyAwardOption {
  if (!isNonArrayObject(raw)) {
    safeThrow();
  }

  // Check all keys are known
  const actualKeys = new Set(Object.keys(raw));
  for (const key of actualKeys) {
    if (!ALL_AWARD_OPTION_KEYS.has(key)) {
      safeThrow();
    }
  }

  // Check all required keys are present
  for (const key of AWARD_OPTION_REQUIRED_KEYS) {
    if (!actualKeys.has(key)) {
      safeThrow();
    }
  }

  const id = validateString(raw.id);
  const sourceId = validateString(raw.sourceId);
  const programName = validateString(raw.programName);
  const redemptionType = validateStringEnum(raw.redemptionType, REDEMPTION_TYPES);
  const pricingBasis = validateStringEnum(raw.pricingBasis, PRICING_BASIS);
  const itineraryLabel = validateNullableString(raw.itineraryLabel);
  const pointsRequired = validatePositiveInteger(raw.pointsRequired);
  const cashFees = validateNullOrNonNegativeFinite(raw.cashFees);
  const seats = validateNullOrNonNegativeInteger(raw.seats);
  const cabin = validateNullableString(raw.cabin);
  const transferFromProgramId = validateNullableString(raw.transferFromProgramId);
  const transferRatio = validateNullOrNonNegativeFinite(raw.transferRatio);
  const centsPerPoint = validateNullOrNonNegativeFinite(raw.centsPerPoint);
  const availabilityStatus = validateStringEnum(raw.availabilityStatus, AVAILABILITY_STATUSES);

  // Redemption type must match expected stage
  if (redemptionType !== expectedRedemptionType) {
    safeThrow();
  }

  // Valid pricingBasis / redemptionType combinations
  if (expectedRedemptionType === "flight") {
    if (!FLIGHT_PRICING_BASIS.has(pricingBasis)) {
      safeThrow();
    }
  } else {
    if (!HOTEL_PRICING_BASIS.has(pricingBasis)) {
      safeThrow();
    }
  }

  // ---- Optional fields ----

  // Coverage count fields: must be positive integer (>0) when non-null
  let travelerCountCovered: number | null | undefined;
  let nightCountCovered: number | null | undefined;
  let coverageStatus: "source_explicit" | "standard_assumption" | "unknown" | undefined;
  let goalMatch: "exact" | "partial" | "general" | "different_destination" | undefined;
  let goalMismatchReasons:
    | Array<"origin" | "destination" | "dates" | "traveler_count" | "cabin" | "property">
    | undefined;

  const hasTraveler = "travelerCountCovered" in raw;
  const hasNight = "nightCountCovered" in raw;
  const hasCoverageStatus = "coverageStatus" in raw;
  const hasGoalMatch = "goalMatch" in raw;
  const hasGoalReasons = "goalMismatchReasons" in raw;

  // Parse coverage count fields (null is allowed for irrelevant fields)
  if (hasTraveler) {
    travelerCountCovered = validateNullOrPositiveInteger(raw.travelerCountCovered);
  }
  if (hasNight) {
    nightCountCovered = validateNullOrPositiveInteger(raw.nightCountCovered);
  }

  // Parse coverage status
  if (hasCoverageStatus) {
    coverageStatus = validateStringEnum(raw.coverageStatus, COVERAGE_STATUSES);
  }

  // Non-null count requires coverageStatus to be present
  if (hasTraveler && travelerCountCovered !== null && !hasCoverageStatus) {
    safeThrow();
  }
  if (hasNight && nightCountCovered !== null && !hasCoverageStatus) {
    safeThrow();
  }

  // Non-null irrelevant count is always rejected
  if (expectedRedemptionType === "flight" && hasNight && nightCountCovered !== null) {
    safeThrow();
  }
  if (expectedRedemptionType === "hotel" && hasTraveler && travelerCountCovered !== null) {
    safeThrow();
  }

  // coverageStatus present: applicable count must be present
  // (non-null requirement is enforced per-status below)
  if (hasCoverageStatus) {
    if (expectedRedemptionType === "flight") {
      if (!hasTraveler) {
        safeThrow();
      }
    } else {
      if (!hasNight) {
        safeThrow();
      }
    }
  }

  // Coverage-status rules
  if (coverageStatus === "unknown") {
    // Both counts must be null or absent
    if (travelerCountCovered !== undefined && travelerCountCovered !== null) {
      safeThrow();
    }
    if (nightCountCovered !== undefined && nightCountCovered !== null) {
      safeThrow();
    }
  }

  if (coverageStatus === "source_explicit") {
    if (expectedRedemptionType === "flight") {
      if (travelerCountCovered === undefined || travelerCountCovered === null) {
        safeThrow();
      }
    } else {
      if (nightCountCovered === undefined || nightCountCovered === null) {
        safeThrow();
      }
    }
  }

  if (coverageStatus === "standard_assumption") {
    if (expectedRedemptionType === "flight") {
      if (travelerCountCovered !== 1) {
        safeThrow();
      }
    } else {
      if (pricingBasis !== "per_night") {
        safeThrow();
      }
      if (nightCountCovered !== 1) {
        safeThrow();
      }
    }
  }

  // ---- Goal classification ----
  // Both fields must be present together when either is present
  if (hasGoalMatch !== hasGoalReasons) {
    safeThrow();
  }

  if (hasGoalMatch) {
    goalMatch = validateStringEnum(raw.goalMatch, GOAL_MATCHES);

    // Parse reasons array
    if (!Array.isArray(raw.goalMismatchReasons)) {
      safeThrow();
    }
    const reasons: string[] = [];
    for (const r of raw.goalMismatchReasons as unknown[]) {
      const validated = validateStringEnum(r as string, GOAL_MISMATCH_REASONS);
      reasons.push(validated);
    }

    // No duplicates
    const reasonSet = new Set(reasons);
    if (reasonSet.size !== reasons.length) {
      safeThrow();
    }

    goalMismatchReasons = reasons as Array<
      "origin" | "destination" | "dates" | "traveler_count" | "cabin" | "property"
    >;

    if (goalMatch === "exact") {
      if (goalMismatchReasons.length !== 0) {
        safeThrow();
      }
    }

    if (goalMatch === "different_destination") {
      if (!reasonSet.has("destination")) {
        safeThrow();
      }
    }
  }

  return {
    id,
    sourceId,
    programName,
    redemptionType,
    pricingBasis,
    itineraryLabel,
    pointsRequired,
    cashFees,
    seats,
    cabin,
    transferFromProgramId,
    transferRatio,
    centsPerPoint,
    availabilityStatus,
    travelerCountCovered: travelerCountCovered as number | null | undefined,
    nightCountCovered: nightCountCovered as number | null | undefined,
    coverageStatus: coverageStatus as
      | "source_explicit"
      | "standard_assumption"
      | "unknown"
      | undefined,
    goalMatch: goalMatch as
      | "exact"
      | "partial"
      | "general"
      | "different_destination"
      | undefined,
    goalMismatchReasons,
  };
}

// ---------------------------------------------------------------------------
// CardOffer validation (for completeness; cardOffers must be empty)
// ---------------------------------------------------------------------------

function validateCardOffersArray(raw: unknown): StrategyCardOffer[] {
  if (!Array.isArray(raw)) {
    safeThrow();
  }
  if (raw.length !== 0) {
    safeThrow();
  }
  return [];
}

// ---------------------------------------------------------------------------
// Source reference check
// ---------------------------------------------------------------------------

function validateSourceReferences(
  options: StrategyAwardOption[],
  sources: StrategySource[],
): void {
  const sourceIds = new Set(sources.map((s) => s.id));
  for (const opt of options) {
    if (!sourceIds.has(opt.sourceId)) {
      safeThrow();
    }
  }
}

// ---------------------------------------------------------------------------
// Top-level validation
// ---------------------------------------------------------------------------

const ENVELOPE_KEYS = new Set(["schemaVersion", "stage", "interpreted"]);
const INTERPRETED_KEYS = new Set([
  "awardOptions",
  "cardOffers",
  "sources",
  "assumptions",
  "warnings",
]);

/**
 * Strictly validate a strategy-run staged payload against the expected stage.
 */
export function validateStrategyRunStagePayload(
  value: unknown,
  expectedStage: StrategyRunPayloadStage,
): StrategyRunStagePayload {
  // Envelope
  if (!isNonArrayObject(value)) {
    safeThrow();
  }
  if (!hasOnlyKeys(value, ENVELOPE_KEYS)) {
    safeThrow();
  }

  if (value.schemaVersion !== 1) {
    safeThrow();
  }
  if (value.stage !== expectedStage) {
    safeThrow();
  }

  const interpreted = value.interpreted;
  if (!isNonArrayObject(interpreted)) {
    safeThrow();
  }
  if (!hasOnlyKeys(interpreted, INTERPRETED_KEYS)) {
    safeThrow();
  }

  // Validate sources first (needed for sourceId references)
  if (!Array.isArray(interpreted.sources)) {
    safeThrow();
  }
  const sources = interpreted.sources.map((s: unknown) => validateSource(s));

  // Validate awardOptions
  if (!Array.isArray(interpreted.awardOptions)) {
    safeThrow();
  }
  const awardOptions = interpreted.awardOptions.map((o: unknown) =>
    validateAwardOption(o, expectedStage),
  );

  // Validate cardOffers (must be empty)
  const cardOffers = validateCardOffersArray(interpreted.cardOffers);

  // Validate assumptions and warnings
  if (!Array.isArray(interpreted.assumptions)) {
    safeThrow();
  }
  const assumptions = interpreted.assumptions.map((s: unknown) => validateString(s));

  if (!Array.isArray(interpreted.warnings)) {
    safeThrow();
  }
  const warnings = interpreted.warnings.map((s: unknown) => validateString(s));

  // Cross-reference: each option.sourceId must match a source
  validateSourceReferences(awardOptions, sources);

  return {
    schemaVersion: 1,
    stage: expectedStage,
    interpreted: {
      awardOptions,
      cardOffers,
      sources,
      assumptions,
      warnings,
    },
  };
}

/**
 * Build a versioned envelope for a strategy-run stage payload.
 * Runs the result through the strict validator before returning.
 */
export function buildStrategyRunStagePayload(
  stage: StrategyRunPayloadStage,
  interpreted: InterpretedResearch,
): StrategyRunStagePayload {
  return validateStrategyRunStagePayload(
    {
      schemaVersion: 1,
      stage,
      interpreted,
    },
    stage,
  );
}