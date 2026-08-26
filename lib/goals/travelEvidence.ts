import type {
  ExactCashCandidate,
  PersonalizedStrategy,
  PublicExactCashCandidate,
  StrategyAwardOption,
  TravelEvidenceLevel,
} from "./strategyTypes";

export function evidenceLevelOf(option: Pick<StrategyAwardOption, "evidenceLevel">): TravelEvidenceLevel {
  return option.evidenceLevel ?? "planning_benchmark";
}

/** Legacy research and saved options are conservative planning benchmarks. */
export function asPlanningBenchmark(option: StrategyAwardOption): StrategyAwardOption {
  return { ...option, evidenceLevel: evidenceLevelOf(option) };
}

function validTime(value: string): boolean {
  return value.length > 0 && !Number.isNaN(new Date(value).getTime());
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/** URLs and opaque provider references are never customer display text. */
function isSafeDisplayText(value: unknown): value is string {
  return typeof value === "string" &&
    value.trim().length > 0 &&
    value.length <= 500 &&
    !/(?:https?:\/\/|www\.)/i.test(value);
}

function isNullablePositiveInteger(value: unknown): value is number | null {
  return value === null || (typeof value === "number" && Number.isInteger(value) && value > 0);
}

function isNullableDate(value: unknown): value is string | null {
  return value === null || (typeof value === "string" && validTime(value));
}

function hasSafeSearchShape(value: unknown): boolean {
  if (!isRecord(value) ||
    !isNullableDate(value.departureDate) ||
    !isNullableDate(value.returnDate) ||
    !isNullablePositiveInteger(value.travelerCount) ||
    !isNullablePositiveInteger(value.roomCount) ||
    !isNullablePositiveInteger(value.nightCount)) return false;
  return (value.origin === null || (Array.isArray(value.origin) && value.origin.every(isSafeDisplayText))) &&
    Array.isArray(value.destinations) && value.destinations.every(isSafeDisplayText);
}

/** Exact cash evidence must carry identity, freshness, coverage, and a complete money shape. */
export function isValidExactCashCandidate(value: unknown): value is ExactCashCandidate {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as ExactCashCandidate;
  const money = candidate.price;
  return candidate.evidenceLevel === "exact_cash_offer" &&
    typeof candidate.providerIdentity === "string" && candidate.providerIdentity.trim().length > 0 &&
    typeof candidate.offerIdentity === "string" && candidate.offerIdentity.trim().length > 0 &&
    validTime(candidate.retrievedAt) && validTime(candidate.expiresAt) &&
    (candidate.kind === "flight" || candidate.kind === "hotel") &&
    hasSafeSearchShape(candidate.search) &&
    !!candidate.coverage &&
    [candidate.coverage.travelerCount, candidate.coverage.roomCount, candidate.coverage.nightCount].every(isNullablePositiveInteger) &&
    [candidate.coverage.travelerCount, candidate.coverage.roomCount, candidate.coverage.nightCount].some((value) => value !== null) &&
    !!money && typeof money.currency === "string" && money.currency.length === 3 &&
    typeof money.total === "number" && Number.isFinite(money.total) && money.total >= 0 &&
    [money.base, money.taxes, money.mandatoryFees].every(
      (value) => value === null || (typeof value === "number" && Number.isFinite(value) && value >= 0)
    ) && Array.isArray(candidate.unknownFields);
}

export function toPublicExactCashCandidate(
  candidate: ExactCashCandidate,
  sourceLabel: string,
): PublicExactCashCandidate | null {
  if (!isValidExactCashCandidate(candidate) || !isSafeDisplayText(sourceLabel)) return null;
  if (new Date(candidate.expiresAt).getTime() <= new Date(candidate.retrievedAt).getTime()) return null;
  if (!candidate.unknownFields.every(isSafeDisplayText)) return null;
  if (![candidate.cancellationTerms, candidate.baggageTerms, candidate.paymentTiming]
    .every((value) => value === null || isSafeDisplayText(value))) return null;

  // Construct the result explicitly: a future provider adapter may retain raw
  // payload fields on its server record, but none may cross this boundary.
  return {
    id: "",
    kind: candidate.kind,
    evidenceLevel: "exact_cash_offer",
    retrievedAt: candidate.retrievedAt,
    expiresAt: candidate.expiresAt,
    search: {
      origin: candidate.search.origin ? [...candidate.search.origin] : null,
      destinations: [...candidate.search.destinations],
      departureDate: candidate.search.departureDate,
      returnDate: candidate.search.returnDate,
      travelerCount: candidate.search.travelerCount,
      roomCount: candidate.search.roomCount,
      nightCount: candidate.search.nightCount,
    },
    coverage: { ...candidate.coverage },
    price: { ...candidate.price },
    cancellationTerms: candidate.cancellationTerms,
    baggageTerms: candidate.baggageTerms,
    paymentTiming: candidate.paymentTiming,
    unknownFields: [...candidate.unknownFields],
    sourceLabel: sourceLabel.trim(),
  };
}

/**
 * Treat persisted/browser-shaped cash data as untrusted. Exact cash records
 * require server-only quote identities; accepted records receive fresh opaque
 * display IDs instead of retaining either a provider or database identifier.
 */
function toClientSafeCashOptions(value: unknown): PublicExactCashCandidate[] {
  if (!Array.isArray(value)) return [];
  const safe: PublicExactCashCandidate[] = [];
  for (const raw of value) {
    if (!isRecord(raw) || !isSafeDisplayText(raw.sourceLabel)) continue;
    const projected = toPublicExactCashCandidate(raw as unknown as ExactCashCandidate, raw.sourceLabel);
    if (!projected) continue;
    safe.push({ ...projected, id: `cash-${safe.length + 1}` });
  }
  return safe;
}

/** Planning research may never enter an exact-cash primary selection. */
export function selectPrimaryExactCashCandidates(
  candidates: ExactCashCandidate[],
): ExactCashCandidate[] {
  return candidates.filter(isValidExactCashCandidate);
}

/** Removes source URLs from every client-visible award option. */
export function toClientSafeStrategy(strategy: PersonalizedStrategy): PersonalizedStrategy {
  const sourceReferences = new Map<string, string>();
  const toSourceReference = (realSourceId: string) => {
    let reference = sourceReferences.get(realSourceId);
    if (!reference) {
      reference = `source-${sourceReferences.size + 1}`;
      sourceReferences.set(realSourceId, reference);
    }
    return reference;
  };
  const safeOptions = (options: StrategyAwardOption[]) => options.map((option) => {
    const sourceId = toSourceReference(option.sourceId);
    const benchmark = asPlanningBenchmark(option);
    return {
      ...benchmark,
      sourceId,
      // Saved research is not a live inventory check, even if a legacy record
      // incorrectly carried the old "available" label.
      availabilityStatus: benchmark.availabilityStatus === "available" ? "unknown" : benchmark.availabilityStatus,
    };
  });

  const flightOptions = safeOptions(strategy.flightOptions);
  const hotelOptions = safeOptions(strategy.hotelOptions);
  const benchmarkIds = new Set(
    [...flightOptions, ...hotelOptions]
      .filter((option) => option.evidenceLevel === "planning_benchmark")
      .map((option) => option.id),
  );

  return {
    ...strategy,
    flightOptions,
    hotelOptions,
    actions: strategy.actions.map((action) => ({
      ...action,
      sourceIds: action.sourceIds.map(toSourceReference),
    })),
    alternatives: strategy.alternatives.map((alternative) => ({
      ...alternative,
      sourceIds: alternative.sourceIds.map(toSourceReference),
    })),
    recommendedAwardOptionId: benchmarkIds.has(strategy.recommendedAwardOptionId ?? "")
      ? null
      : strategy.recommendedAwardOptionId,
    currentCashOptions: toClientSafeCashOptions(strategy.currentCashOptions),
    customerVerifiedOptions: strategy.customerVerifiedOptions ?? [],
  };
}

export function toClientSafeResearch(
  options: StrategyAwardOption[],
): StrategyAwardOption[] {
  const sourceReferences = new Map<string, string>();
  return options.map((option) => {
    const sourceId = sourceReferences.get(option.sourceId) ?? `source-${sourceReferences.size + 1}`;
    sourceReferences.set(option.sourceId, sourceId);
    const benchmark = asPlanningBenchmark(option);
    return {
      ...benchmark,
      sourceId,
      availabilityStatus: benchmark.availabilityStatus === "available" ? "unknown" : benchmark.availabilityStatus,
    };
  });
}
