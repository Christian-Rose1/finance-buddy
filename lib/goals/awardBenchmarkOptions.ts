/**
 * Projection of verified award benchmarks into the existing
 * `StrategyAwardOption` / `StrategySource` strategy contracts.
 *
 * Trust rules:
 * - Output is always fresh objects; inputs are never mutated or referenced.
 * - A benchmark whose program row is unknown (no catalog name) is skipped —
 *   program names drive funding matches and presentation, so an unnamed
 *   program can never be projected.
 * - `availabilityStatus` is always "unknown": a chart benchmark is not live
 *   inventory and never claims availability.
 * - `centsPerPoint` is always null: no dollar valuation of points exists in
 *   this pipeline.
 * - Transfer fields stay null on the option itself; transfer funding is a
 *   deterministic allocation decision made later from verified partner rows.
 * - Identifiers must be simple opaque tokens; malformed identifiers and
   over-bound strings make a row unusable rather than sanitized.
 * - Deterministic: loader order is preserved, and the first row wins for a
 *   duplicate (program, route, cabin, basis) combination.
 */

import type {
  StrategyAwardOption,
  StrategySource,
} from "./strategyTypes";
import {
  isAwardBenchmarkRegion,
  type AwardBenchmarkRegion,
  type AwardPriceBenchmark,
} from "@/lib/rewards/awardBenchmarks";

const MAX_ID_LENGTH = 100;
const MAX_PROGRAM_NAME_LENGTH = 120;
const MAX_CABIN_LENGTH = 40;

/** Server-owned source label for every benchmark-derived source. */
export const AWARD_BENCHMARK_SOURCE_LABEL =
  "Published award chart benchmark (verified catalog entry)";

/** Fixed, server-owned region labels for customer-facing itinerary text. */
const REGION_LABELS: Record<AwardBenchmarkRegion, string> = {
  us_domestic: "U.S. domestic",
  transatlantic_europe: "U.S. to Europe",
  intra_europe: "Intra-Europe",
  caribbean_central_america: "U.S. to Caribbean/Central America",
  south_america: "U.S. to South America",
  hawaii_pacific: "U.S. to Hawaii/Pacific",
  east_asia: "U.S. to East Asia",
  southeast_asia_oceania: "U.S. to Southeast Asia/Oceania",
  south_asia_middle_east: "U.S. to South Asia/Middle East",
  africa: "U.S. to Africa",
  canada: "U.S. to Canada",
  mexico: "U.S. to Mexico",
};

function isSafeIdentifier(value: string): boolean {
  return value.length <= MAX_ID_LENGTH && /^[A-Za-z0-9._-]+$/.test(value);
}

function regionLabel(region: AwardBenchmarkRegion): string | null {
  const label = REGION_LABELS[region];
  return typeof label === "string" ? label : null;
}

function buildItineraryLabel(
  originRegion: AwardBenchmarkRegion,
  destinationRegion: AwardBenchmarkRegion,
): string | null {
  const origin = regionLabel(originRegion);
  const destination = regionLabel(destinationRegion);
  if (origin === null || destination === null) return null;
  const label = `${origin} to ${destination} (award benchmark)`;
  return label.length <= 200 ? label : null;
}

export interface BenchmarkProjectionResult {
  awardOptions: StrategyAwardOption[];
  sources: StrategySource[];
}

/**
 * Project usable benchmark rows into award options plus their sources.
 * Rows with unknown programs, malformed identifiers, out-of-bound strings,
 * or unknown regions are skipped silently — a benchmark that cannot be
 * projected honestly is never approximated.
 */
export function projectBenchmarksToAwardOptions(
  benchmarks: readonly AwardPriceBenchmark[],
  programNames: ReadonlyMap<string, string>,
): BenchmarkProjectionResult {
  const awardOptions: StrategyAwardOption[] = [];
  const sources: StrategySource[] = [];
  const seenCombinations = new Set<string>();

  for (const row of benchmarks) {
    if (!row || typeof row !== "object") continue;
    if (
      typeof row.id !== "string" ||
      !isSafeIdentifier(row.id) ||
      typeof row.rewardProgramId !== "string" ||
      !isSafeIdentifier(row.rewardProgramId)
    ) {
      continue;
    }
    if (!isAwardBenchmarkRegion(row.originRegion) || !isAwardBenchmarkRegion(row.destinationRegion)) {
      continue;
    }
    if (
      typeof row.cabin !== "string" ||
      row.cabin.length === 0 ||
      row.cabin.length > MAX_CABIN_LENGTH
    ) {
      continue;
    }
    if (row.pricingBasis !== "one_way" && row.pricingBasis !== "round_trip") {
      continue;
    }
    if (typeof row.lastVerifiedAt !== "string" || row.lastVerifiedAt.length === 0) {
      continue;
    }

    const programName = programNames.get(row.rewardProgramId);
    if (
      typeof programName !== "string" ||
      programName.length === 0 ||
      programName.length > MAX_PROGRAM_NAME_LENGTH
    ) {
      continue;
    }

    const itineraryLabel = buildItineraryLabel(row.originRegion, row.destinationRegion);
    if (itineraryLabel === null) continue;

    const combinationKey = [
      row.rewardProgramId,
      row.originRegion,
      row.destinationRegion,
      row.cabin,
      row.pricingBasis,
    ].join("|");
    if (seenCombinations.has(combinationKey)) continue;
    seenCombinations.add(combinationKey);

    const sourceId = `award-benchmark-${row.id}`;
    const optionId = `award-benchmark-${row.id}`;

    sources.push({
      id: sourceId,
      label: AWARD_BENCHMARK_SOURCE_LABEL,
      status: "catalog",
      observedAt: row.lastVerifiedAt,
    });

    awardOptions.push({
      id: optionId,
      sourceId,
      programName,
      // Server-only catalog identity used for deterministic transfer funding;
      // stripped by every client/model projection boundary.
      catalogRewardProgramId: row.rewardProgramId,
      redemptionType: "flight",
      pricingBasis: row.pricingBasis,
      itineraryLabel,
      pointsRequired: row.pointsRequired,
      cashFees: row.cashFees,
      seats: null,
      cabin: row.cabin,
      transferFromProgramId: null,
      transferRatio: null,
      centsPerPoint: null,
      availabilityStatus: "unknown",
      evidenceLevel: "planning_benchmark",
      travelerCountCovered: row.travelerCountCovered,
      nightCountCovered: row.nightCountCovered,
      coverageStatus: "source_explicit",
      goalMatch: "exact",
      goalMismatchReasons: [],
    });
  }

  return { awardOptions, sources };
}
