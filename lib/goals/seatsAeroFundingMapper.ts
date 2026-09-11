/**
 * Seats.aero funding mapper (server-only, pure).
 *
 * Maps validated Seats.aero availability rows into the existing
 * `StrategyAwardOption` / `StrategySource` strategy contracts so the
 * deterministic funding and allocation engine can use them exactly like any
 * other flight option — with one upgrade: these options carry **observed**
 * award prices, not chart benchmarks.
 *
 * Trust rules:
 * - Output is always fresh objects; inputs are never mutated or referenced.
 * - The provider's program slug is the only identity a row carries. A slug
 *   outside the fixed allowlist below is skipped — the allowlist maps each
 *   supported slug to the exact catalog program name, which is what funding
 *   matches on. An unmapped slug can never become an option, so this mapper
 *   can never emit a non-airline (e.g. hotel-points) option.
 * - `pointsRequired` is the observed price in the program's native points
 *   unit, never combined across programs and never derived from cash.
 * - Taxes are accepted only when the provider reports a currency; minor units
 *   are converted to major units (18560 → 185.60) exactly once. A program
 *   reporting taxes without a currency yields `cashFees: null` — the fees are
 *   unknown, never guessed.
 * - `availabilityStatus` is `"available"`: the price was observed on a real
 *   crawled result for these dates. It is NOT a bookable guarantee — the
 *   option's `evidenceLevel` is `"web_observed_not_live"` and its source
 *   label states that verification is required, exactly like the SerpAPI
 *   flight observation convention.
 * - Round-trip totals combine only two rows of the SAME program: the best
 *   outbound and the best return observation, each chosen deterministically
 *   (earliest departure, then lowest price). One-way requests pass through
 *   unchanged. A leg without a usable observation yields no option for that
 *   program — a half-observed round trip is never fabricated from a chart.
 * - Deterministic: stable sort keys, first-wins on ties, bounded outputs.
 */

import type {
  StrategyAwardOption,
  StrategySource,
} from "./strategyTypes";
import type {
  SeatsAeroAvailabilityRow,
} from "./seatsAeroClient";

/** Server-owned source label; parity with the SerpAPI flight observation. */
export const SEATS_AERO_SOURCE_LABEL =
  "Observed award price (cached provider result; verify before acting)";

/**
 * Provider slug → exact catalog program name. Airline loyalty programs only:
 * this allowlist is also the points-currency gate, because every mapped
 * program spends airline miles/points in its native unit.
 */
const SAME_PROGRAM_NAMES: Readonly<Record<string, string>> = Object.freeze({
  aeroplan: "Air Canada Aeroplan",
  united: "United MileagePlus",
  flyingblue: "Air France-KLM Flying Blue",
  virginatlantic: "Virgin Atlantic Flying Club",
});

/** One option per allowlisted program with observations; bounded at 4. */
const MAX_OPTIONS = 4;

export interface ObservedAwardProjectionInput {
  originIata: string;
  destinationIata: string;
  cabin: string;
  pricingBasis: "one_way" | "round_trip";
}

export interface ObservedAwardProjectionResult {
  awardOptions: StrategyAwardOption[];
  sources: StrategySource[];
}

interface LegObservation {
  pointsRequired: number;
  departureDate: string;
  taxesMinorUnits: number | null;
  taxesCurrency: string | null;
  remainingSeats: number | null;
  direct: boolean | null;
  /** Crawl freshness of the selected row. */
  updatedAt: string;
}

/** Earliest departure, then lowest price, then slug — fully deterministic. */
function compareRows(
  a: SeatsAeroAvailabilityRow,
  b: SeatsAeroAvailabilityRow,
): number {
  if (a.departureDate !== b.departureDate) {
    return a.departureDate < b.departureDate ? -1 : 1;
  }
  if (a.pointsRequired !== b.pointsRequired) {
    return a.pointsRequired - b.pointsRequired;
  }
  return a.source < b.source ? -1 : a.source > b.source ? 1 : 0;
}

function bestLeg(rows: readonly SeatsAeroAvailabilityRow[]): LegObservation | null {
  const usable = rows.filter(
    (row) =>
      typeof row.pointsRequired === "number" &&
      Number.isInteger(row.pointsRequired) &&
      row.pointsRequired > 0,
  );
  if (usable.length === 0) return null;
  const sorted = [...usable].sort(compareRows);
  const best = sorted[0];
  return {
    pointsRequired: best.pointsRequired,
    departureDate: best.departureDate,
    taxesMinorUnits: best.taxesMinorUnits,
    taxesCurrency: best.taxesCurrency,
    remainingSeats: best.remainingSeats,
    direct: best.direct,
    updatedAt: best.updatedAt,
  };
}

/**
 * Taxes → major-unit cash fees. Only a taxes observation that carries its own
 * ISO-4217-style currency is representable; anything else stays null.
 */
function cashFeesFromTaxes(
  taxesMinorUnits: number | null,
  taxesCurrency: string | null,
): number | null {
  if (taxesMinorUnits === null || taxesCurrency === null) return null;
  if (!/^[A-Z]{3}$/.test(taxesCurrency)) return null;
  const majorUnits = taxesMinorUnits / 100;
  if (!Number.isFinite(majorUnits) || majorUnits < 0) return null;
  return Math.round(majorUnits * 100) / 100;
}

function seatsFromLegs(
  outbound: LegObservation | null,
  returnLeg: LegObservation | null,
): number | null {
  // A seat count is claimed only when BOTH legs report one for a round trip;
  // a single missing count means the party coverage is unknown.
  if (outbound === null || returnLeg === null) return null;
  if (outbound.remainingSeats === null || returnLeg.remainingSeats === null) {
    return null;
  }
  return Math.min(outbound.remainingSeats, returnLeg.remainingSeats);
}

/**
 * Project validated availability rows into award options plus their sources.
 * Rows with slugs outside the program allowlist, non-positive prices, or
 * rows that cannot combine into a complete one-way/round-trip observation
 * are skipped silently — an option that cannot be projected honestly is
 * never approximated. Returns an empty result when nothing qualifies; never
 * throws, never mutates its inputs.
 */
export function projectSeatsAeroRowsToAwardOptions(
  rows: readonly SeatsAeroAvailabilityRow[],
  programNamesById: ReadonlyMap<string, string>,
  input: ObservedAwardProjectionInput,
): ObservedAwardProjectionResult {
  const awardOptions: StrategyAwardOption[] = [];
  const sources: StrategySource[] = [];

  // Reverse the caller's id→name map into a name→id index for the server-only
  // catalog identity used by deterministic transfer funding.
  const programIdsByName = new Map<string, string>();
  for (const [programId, name] of programNamesById) {
    if (typeof name === "string" && name.length > 0) {
      if (!programIdsByName.has(name)) {
        programIdsByName.set(name, programId);
      }
    }
  }

  const outboundRowsBySlug = new Map<string, SeatsAeroAvailabilityRow[]>();
  const returnRowsBySlug = new Map<string, SeatsAeroAvailabilityRow[]>();
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    if (typeof row.source !== "string") continue;
    if (SAME_PROGRAM_NAMES[row.source] === undefined) continue;
    const bucket = row.isReturn ? returnRowsBySlug : outboundRowsBySlug;
    const existing = bucket.get(row.source);
    if (existing) {
      existing.push(row);
    } else {
      bucket.set(row.source, [row]);
    }
  }

  for (const slug of Object.keys(SAME_PROGRAM_NAMES)) {
    if (awardOptions.length >= MAX_OPTIONS) break;
    const programName = SAME_PROGRAM_NAMES[slug];
    const catalogProgramId = programIdsByName.get(programName);
    // The catalog identity is optional for presentation but required for
    // funding; without it the option would be dead weight downstream.
    if (catalogProgramId === undefined) continue;

    const outbound = bestLeg(outboundRowsBySlug.get(slug) ?? []);
    // The return leg must depart strictly after the chosen outbound; a
    // cached "return" row departing earlier would invert the trip. Rows
    // that cannot follow the selected outbound are not fabricated into a
    // total — the program simply yields no round-trip option.
    const returnLeg =
      outbound === null
        ? null
        : bestLeg(
            (returnRowsBySlug.get(slug) ?? []).filter(
              (row) => row.departureDate > outbound.departureDate,
            ),
          );

    let pointsRequired: number;
    if (input.pricingBasis === "one_way") {
      if (outbound === null) continue;
      pointsRequired = outbound.pointsRequired;
    } else {
      if (outbound === null || returnLeg === null) continue;
      pointsRequired = outbound.pointsRequired + returnLeg.pointsRequired;
    }

    const cashFees =
      input.pricingBasis === "round_trip"
        ? (() => {
            // Only a complete per-leg fees observation in a SINGLE currency is
            // summable; a partially observed or mixed-currency fees picture
            // stays unknown.
            if (
              outbound!.taxesMinorUnits === null ||
              returnLeg!.taxesMinorUnits === null ||
              outbound!.taxesCurrency === null ||
              returnLeg!.taxesCurrency === null ||
              outbound!.taxesCurrency !== returnLeg!.taxesCurrency
            ) {
              return null;
            }
            const outboundFees = cashFeesFromTaxes(
              outbound!.taxesMinorUnits,
              outbound!.taxesCurrency,
            );
            const returnFees = cashFeesFromTaxes(
              returnLeg!.taxesMinorUnits,
              returnLeg!.taxesCurrency,
            );
            if (outboundFees === null || returnFees === null) return null;
            return Math.round((outboundFees + returnFees) * 100) / 100;
          })()
        : cashFeesFromTaxes(outbound!.taxesMinorUnits, outbound!.taxesCurrency);

    const seats =
      input.pricingBasis === "round_trip"
        ? seatsFromLegs(outbound, returnLeg)
        : outbound!.remainingSeats;

    const optionId = `award-observed-${slug}-${input.pricingBasis}-v1`;
    const sourceId = `award-observed-${slug}-v1`;
    const itineraryLabel = `${input.originIata} to ${input.destinationIata} (observed award price)`;

    sources.push({
      id: sourceId,
      label: SEATS_AERO_SOURCE_LABEL,
      status: "live",
      observedAt: outbound!.updatedAt,
    });

    awardOptions.push({
      id: optionId,
      sourceId,
      programName,
      // Server-only catalog identity used for deterministic transfer funding;
      // stripped by every client/model projection boundary.
      catalogRewardProgramId: catalogProgramId,
      redemptionType: "flight",
      pricingBasis: input.pricingBasis,
      itineraryLabel,
      pointsRequired,
      cashFees,
      seats,
      cabin: input.cabin,
      transferFromProgramId: null,
      transferRatio: null,
      centsPerPoint: null,
      availabilityStatus: "available",
      evidenceLevel: "web_observed_not_live",
      travelerCountCovered: 1,
      nightCountCovered: null,
      coverageStatus: "source_explicit",
      goalMatch: "exact",
      goalMismatchReasons: [],
    });
  }

  return { awardOptions, sources };
}
