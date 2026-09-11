/**
 * Verified award-price benchmarks (Route A of the R2 milestone).
 *
 * Benchmark rows encode published award-chart facts that a human sourced and
 * verified (see the `award_price_benchmarks` catalog table). They are
 * PLANNING BENCHMARKS ONLY: they never claim live availability, never carry a
 * cash valuation of points, and never claim bookability.
 *
 * Trust rules enforced here (mirroring the earn-plan discipline):
 * - Only rows with `lastVerifiedAt` set and `active` are ever selected.
 * - Expired or not-yet-valid rows are invisible.
 * - Region matching is structured (IATA -> region via a verified map). An
 *   unmapped airport yields NO benchmarks — city/property text is never
 *   matched, and regions are never guessed from names.
 * - Unknown enum values make a row unusable rather than approximated.
 * - The matcher is deterministic and never mutates its inputs.
 */

/** Bounded route-region vocabulary used by seeded benchmark rows. */
export const AWARD_BENCHMARK_REGIONS = [
  "us_domestic",
  "transatlantic_europe",
  "intra_europe",
  "caribbean_central_america",
  "south_america",
  "hawaii_pacific",
  "east_asia",
  "southeast_asia_oceania",
  "south_asia_middle_east",
  "africa",
  "canada",
  "mexico",
] as const;

export type AwardBenchmarkRegion = (typeof AWARD_BENCHMARK_REGIONS)[number];

export function isAwardBenchmarkRegion(value: unknown): value is AwardBenchmarkRegion {
  return (
    typeof value === "string" &&
    (AWARD_BENCHMARK_REGIONS as readonly string[]).includes(value)
  );
}

/** Structured origin/destination region pair a benchmark row is scoped to. */
export interface AwardBenchmarkRouteScope {
  originRegion: AwardBenchmarkRegion;
  destinationRegion: AwardBenchmarkRegion;
}

/**
 * A verified award-price benchmark row as loaded from the catalog.
 * Identifiers reference existing catalog rows; prices are in the award
 * program's native points/miles units, never combined across programs.
 */
export interface AwardPriceBenchmark {
  id: string;
  rewardProgramId: string;
  redemptionType: "flight";
  originRegion: AwardBenchmarkRegion;
  destinationRegion: AwardBenchmarkRegion;
  cabin: string;
  pricingBasis: "one_way" | "round_trip";
  /** Points/miles per the pricing basis, per traveler covered. */
  pointsRequired: number;
  /** Sourced taxes/fees estimate for the same basis and coverage; null when unsourced. */
  cashFees: number | null;
  currency: string;
  travelerCountCovered: number;
  nightCountCovered: number | null;
  validFrom: string | null;
  validUntil: string | null;
  /** Human-sourced provenance note; rows without it are unusable. */
  source: string;
  lastVerifiedAt: string | null;
  active: boolean;
}

/**
 * A verified airline transfer-partner row: program `fromProgramId` transfers
 * into program `toProgramId` at `destinationPointsPerSourcePoint` destination
 * points per source point (e.g. 1 Chase point -> 1 United mile => 1).
 */
export interface VerifiedTransferPartner {
  id: string;
  fromProgramId: string;
  toProgramId: string;
  destinationPointsPerSourcePoint: number;
  source: string;
  lastVerifiedAt: string | null;
}

/** Verified IATA -> region mapping rows (see `airport_region_map`). */
export interface AirportRegionEntry {
  iataCode: string;
  region: AwardBenchmarkRegion;
  source: string;
  lastVerifiedAt: string | null;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isPositiveFinite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

/**
 * Build the IATA -> region lookup. Unverified or malformed entries are
 * dropped; duplicate IATA codes keep their first occurrence so a stable
 * loader order produces a stable map.
 */
export function buildAirportRegionMap(
  entries: readonly AirportRegionEntry[] | null | undefined,
): Map<string, AwardBenchmarkRegion> {
  const map = new Map<string, AwardBenchmarkRegion>();
  if (!Array.isArray(entries)) return map;
  for (const entry of entries) {
    if (!entry || typeof entry !== "object") continue;
    if (
      !isNonEmptyString(entry.iataCode) ||
      !isAwardBenchmarkRegion(entry.region) ||
      !isNonEmptyString(entry.source) ||
      !isNonEmptyString(entry.lastVerifiedAt)
    ) {
      continue;
    }
    const code = entry.iataCode.trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(code) || map.has(code)) continue;
    map.set(code, entry.region);
  }
  return map;
}

function isWithinValidityWindow(
  row: AwardPriceBenchmark,
  now: Date,
): boolean {
  // Fail closed: a caller-supplied invalid clock must never open the window.
  const nowTime = now.getTime();
  if (!Number.isFinite(nowTime)) return false;
  if (row.validFrom !== null) {
    const from = Date.parse(row.validFrom);
    if (!Number.isFinite(from) || from > nowTime) return false;
  }
  if (row.validUntil !== null) {
    const until = Date.parse(row.validUntil);
    if (!Number.isFinite(until) || until < nowTime) return false;
  }
  return true;
}

/** A benchmark row is usable only when fully verified, active, and in-window. */
export function isUsableBenchmarkRow(
  row: AwardPriceBenchmark,
  now: Date,
): boolean {
  if (!row || typeof row !== "object") return false;
  if (row.active !== true) return false;
  if (!isNonEmptyString(row.lastVerifiedAt)) return false;
  if (!isNonEmptyString(row.source)) return false;
  if (!isNonEmptyString(row.rewardProgramId) || !isNonEmptyString(row.id)) {
    return false;
  }
  if (row.redemptionType !== "flight") return false;
  if (!isAwardBenchmarkRegion(row.originRegion)) return false;
  if (!isAwardBenchmarkRegion(row.destinationRegion)) return false;
  if (!isNonEmptyString(row.cabin)) return false;
  if (row.pricingBasis !== "one_way" && row.pricingBasis !== "round_trip") {
    return false;
  }
  if (!isPositiveFinite(row.pointsRequired)) return false;
  if (row.cashFees !== null && !isPositiveFinite(row.cashFees)) return false;
  if (!isNonEmptyString(row.currency)) return false;
  if (!isPositiveFinite(row.travelerCountCovered)) return false;
  if (
    row.nightCountCovered !== null &&
    !isPositiveFinite(row.nightCountCovered)
  ) {
    return false;
  }
  return isWithinValidityWindow(row, now);
}

export interface BenchmarkSelectionInput {
  benchmarks: readonly AwardPriceBenchmark[];
  airportRegions: ReadonlyMap<string, AwardBenchmarkRegion>;
  /** IATA code of the searched origin; unmapped codes yield no benchmarks. */
  originIata: string | null;
  /** IATA code of the searched destination; unmapped codes yield no benchmarks. */
  destinationIata: string | null;
  /** Saved cabin preference; only exact-cabin rows are eligible. */
  cabin: string | null;
  now: Date;
}

/**
 * Select the verified benchmark rows matching a searched route. Fails closed:
 * an unmapped IATA code, unknown cabin, or unusable row yields nothing —
 * never a near-match and never a guessed region.
 *
 * Deterministic: preserves the caller's row order (loaders supply a stable
 * order); no re-ranking beyond usability filtering.
 */
export function selectFlightAwardBenchmarks(
  input: BenchmarkSelectionInput,
): AwardPriceBenchmark[] {
  const { benchmarks, airportRegions, originIata, destinationIata, cabin, now } =
    input;
  if (!Array.isArray(benchmarks) || benchmarks.length === 0) return [];
  if (!isNonEmptyString(originIata) || !isNonEmptyString(destinationIata)) {
    return [];
  }
  if (!isNonEmptyString(cabin)) return [];

  const originRegion = airportRegions.get(originIata.trim().toUpperCase());
  const destinationRegion = airportRegions.get(
    destinationIata.trim().toUpperCase(),
  );
  if (originRegion === undefined || destinationRegion === undefined) {
    return [];
  }

  return benchmarks.filter(
    (row) =>
      isUsableBenchmarkRow(row, now) &&
      row.originRegion === originRegion &&
      row.destinationRegion === destinationRegion &&
      row.cabin === cabin,
  );
}

/**
 * Verified transfer partners into `toProgramId` from a set of candidate
 * source program IDs (the customer's own programs). Fails closed: partners
 * without a verified timestamp or positive finite ratio are unusable.
 * Deterministic: preserves loader order; callers pick deliberately.
 */
export function selectVerifiedTransferPartnersInto(
  partners: readonly VerifiedTransferPartner[],
  toProgramId: string,
  fromProgramIds: ReadonlySet<string>,
): VerifiedTransferPartner[] {
  if (!Array.isArray(partners)) return [];
  if (!isNonEmptyString(toProgramId) || fromProgramIds.size === 0) return [];
  return partners.filter(
    (partner) =>
      partner &&
      typeof partner === "object" &&
      isNonEmptyString(partner.id) &&
      isNonEmptyString(partner.fromProgramId) &&
      partner.fromProgramId !== toProgramId &&
      fromProgramIds.has(partner.fromProgramId) &&
      partner.toProgramId === toProgramId &&
      isPositiveFinite(partner.destinationPointsPerSourcePoint) &&
      isNonEmptyString(partner.source) &&
      isNonEmptyString(partner.lastVerifiedAt),
  );
}
