import type { Goal } from "./types";
import type { ResearchResponse, ResearchResult } from "./researchTypes";
import {
  ResearchInterpreterError,
  type ResearchFocus,
  type ResearchRewardProgram,
} from "./researchInterpreter";
import type { StrategyDataStatus, StrategySource } from "./strategyTypes";

const DIAGNOSTIC_SNIPPET_LENGTH = 300;

export interface SourceEntry {
  source: StrategySource;
  result: ResearchResult;
}

export interface ValidationContext {
  goal: Goal;
  rewardPrograms: ResearchRewardProgram[];
  sourceMap: Map<string, SourceEntry>;
  model: string;
  focus: ResearchFocus;
}

const LIVE_AVAILABILITY_MARKERS = [
  "available",
  "bookable",
  "inventory",
  "award space",
  "seats available",
  "live",
  "current availability",
  "dates",
];

export function buildResearchSources(research: ResearchResponse[]): SourceEntry[] {
  const entries: SourceEntry[] = [];
  let index = 0;
  for (const response of research) {
    for (const result of response.results) {
      const sourceId = result.url; // Use URL as stable source identity
      const status: StrategyDataStatus = result.sourceTier === "official" ? "catalog" : "catalog";
      entries.push({
        source: {
          id: sourceId,
          label: result.title,
          status,
          observedAt: result.publishedDate,
        },
        result,
      });
      index++;
    }
  }
  return entries;
}

/**
 * Resolve a model-supplied source reference to the canonical source ID.
 *
 * Resolution order:
 *   a. If the reference exactly matches a canonical source ID, use it.
 *   b. Otherwise, if it exactly matches a research-result title and that title
 *      resolves to exactly one distinct canonical source ID, use that canonical
 *      source ID.
 *   c. Otherwise reject with ResearchInterpreterError.
 *
 * Matching is exact after trimming leading/trailing whitespace. No fuzzy,
 * substring, semantic, or case-insensitive matching is performed.
 */
export function resolveCanonicalSourceId(
  rawSourceId: string,
  ctx: ValidationContext,
  entityLabel: string
): string {
  const trimmed = rawSourceId.trim();

  // a. Exact canonical source ID match.
  if (ctx.sourceMap.has(trimmed)) {
    return trimmed;
  }

  // b. Exact title match resolving to exactly one distinct canonical source ID.
  const titleMatches = Array.from(ctx.sourceMap.values()).filter(
    (entry) => entry.result.title.trim() === trimmed
  );
  const distinctIds = new Set(titleMatches.map((entry) => entry.source.id));
  if (distinctIds.size === 1) {
    return Array.from(distinctIds)[0];
  }
  if (distinctIds.size > 1) {
    throw new ResearchInterpreterError(
      `${entityLabel} references ambiguous source title "${rawSourceId}".`,
      "ollama",
      ctx.model
    );
  }

  // c. Reject.
  throw new ResearchInterpreterError(
    `${entityLabel} references unknown source "${rawSourceId}".`,
    "ollama",
    ctx.model
  );
}

export function parseModelResponse(raw: string, model: string): unknown {
  const trimmed = raw.trim();
  const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fencedMatch ? fencedMatch[1].trim() : trimmed;

  try {
    return JSON.parse(candidate);
  } catch {
    const firstBrace = candidate.indexOf("{");
    const lastBrace = candidate.lastIndexOf("}");
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      try {
        return JSON.parse(candidate.slice(firstBrace, lastBrace + 1));
      } catch {
        // fall through
      }
    }
  }

  throw new ResearchInterpreterError(
    "Ollama model did not return valid JSON. See details for a truncated response.",
    "ollama",
    model,
    undefined,
    `Response (truncated to ${DIAGNOSTIC_SNIPPET_LENGTH} chars): ${trimmed.slice(
      0,
      DIAGNOSTIC_SNIPPET_LENGTH
    )}`
  );
}

export function requireObject(
  value: unknown,
  field: string,
  model: string
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ResearchInterpreterError(
      `Model output missing required object field "${field}".`,
      "ollama",
      model,
      undefined,
      `Field "${field}" received: ${String(value)}`
    );
  }
  return value as Record<string, unknown>;
}

export function requireString(value: unknown, field: string, model: string): string {
  if (typeof value !== "string") {
    throw new ResearchInterpreterError(
      `Model output missing required string field "${field}".`,
      "ollama",
      model,
      undefined,
      `Field "${field}" received: ${String(value)}`
    );
  }
  return value;
}

export function requireOptionalString(value: unknown, field: string, model: string): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value !== "string") {
    throw new ResearchInterpreterError(
      `Model output field "${field}" must be a string or null.`,
      "ollama",
      model,
      undefined,
      `Field "${field}" received: ${String(value)}`
    );
  }
  return value;
}

export function requireStringArray(
  value: unknown,
  field: string,
  model: string
): string[] {
  if (!Array.isArray(value)) {
    throw new ResearchInterpreterError(
      `Model output missing required array field "${field}".`,
      "ollama",
      model
    );
  }
  const strings: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") {
      throw new ResearchInterpreterError(
        `Model output field "${field}" must contain only strings.`,
        "ollama",
        model
      );
    }
    strings.push(item);
  }
  return strings;
}

export function requireFiniteNonNegativeNumber(
  value: unknown,
  field: string,
  model: string
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new ResearchInterpreterError(
      `Model output field "${field}" must be a finite number.`,
      "ollama",
      model
    );
  }
  if (value < 0) {
    throw new ResearchInterpreterError(
      `Model output field "${field}" must be non-negative.`,
      "ollama",
      model
    );
  }
  return value;
}

const FIELD_EVIDENCE_TERMS: Record<string, string[]> = {
  pointsRequired: ["point", "mile"],
  cashFees: ["fee", "tax", "surcharge"],
  seats: ["seat"],
  transferRatio: ["transfer", "ratio"],
  centsPerPoint: ["cent", "point"],
  welcomeBonusPoints: ["bonus", "point", "mile"],
  spendingRequirement: ["spend", "purchase", "minimum"],
  spendingDeadlineMonths: ["month", "day"],
  annualFee: ["annual fee", "yearly fee", "fee"],
  travelerCountCovered: ["traveler", "passenger", "person"],
  nightCountCovered: ["night", "stay"],
};

export function numberIsSupportedBySource(
  value: number,
  sourceContent: string,
  field?: string
): boolean {
  const pattern = /\b\d+(?:[\d,.]*\d)?\b/g;
  const occurrences: Array<{ start: number; end: number }> = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(sourceContent)) !== null) {
    if (Number(match[0].replace(/,/g, "")) === value) {
      occurrences.push({ start: match.index, end: match.index + match[0].length });
    }
  }
  if (occurrences.length === 0) return false;

  const terms = field ? FIELD_EVIDENCE_TERMS[field] : undefined;
  if (!terms) return occurrences.length === 1;
  // Repeated values are ambiguous even when one nearby occurrence has a
  // plausible label (for example, the same number may be both a fee and a
  // points price). Fail closed rather than attributing the value to a field.
  if (occurrences.length !== 1) return false;

  return occurrences.some(({ start, end }) => {
    const window = sourceContent.slice(Math.max(0, start - 90), Math.min(sourceContent.length, end + 90)).toLowerCase();
    return terms.some((term) => window.includes(term));
  });
}

export function assertNumberSupported(
  value: unknown,
  field: string,
  sourceContent: string,
  model: string
): number {
  const num = requireFiniteNonNegativeNumber(value, field, model);
  if (!numberIsSupportedBySource(num, sourceContent, field.split(".").at(-1))) {
    throw new ResearchInterpreterError(
      `Model output field "${field}" value "${num}" is not supported by the cited source content.`,
      "ollama",
      model
    );
  }
  return num;
}

/**
 * Returns true when the source content contains a hotel category range
 * (e.g. "Category 1-4 properties cost 8,000-15,000 points per night")
 * where at least one numeric boundary is present in the source.
 * This is used as a fallback for hotel per_night pricing when the exact
 * points value is not verbatim in the source but a category range is.
 */
export function hotelCategoryRangeSupported(
  value: number,
  sourceContent: string
): boolean {
  // Match patterns like "8,000-15,000", "8,000 to 15,000", or "8,000–15,000"
  const rangePattern = /(\d[\d,]*)\s*(?:-|to|–)\s*(\d[\d,]*)/gi;
  let match: RegExpExecArray | null;
  while ((match = rangePattern.exec(sourceContent)) !== null) {
    const lo = Number(match[1].replace(/,/g, ""));
    const hi = Number(match[2].replace(/,/g, ""));
    if (Number.isFinite(lo) && Number.isFinite(hi) && value >= lo && value <= hi) {
      return true;
    }
  }
  return false;
}

export function assertOptionalNumberSupported(
  value: unknown,
  field: string,
  sourceContent: string,
  model: string
): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  const num = requireFiniteNonNegativeNumber(value, field, model);
  if (!numberIsSupportedBySource(num, sourceContent, field.split(".").at(-1))) {
    return null;
  }
  return num;
}

function assertLiveAvailabilitySupported(
  sourceContent: string,
  model: string
): void {
  const normalized = sourceContent.toLowerCase();
  const hasMarker = LIVE_AVAILABILITY_MARKERS.some((marker) =>
    normalized.includes(marker)
  );
  if (!hasMarker) {
    throw new ResearchInterpreterError(
      "Model output claims live availability but the cited source does not report current bookable inventory.",
      "ollama",
      model
    );
  }
}

function requirePositiveInteger(
  value: unknown,
  field: string,
  model: string
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new ResearchInterpreterError(
      `Model output field "${field}" must be a finite number.`,
      "ollama",
      model
    );
  }
  if (value <= 0 || !Number.isInteger(value)) {
    throw new ResearchInterpreterError(
      `Model output field "${field}" must be a positive integer.`,
      "ollama",
      model
    );
  }
  return value;
}

function requireOptionalPositiveInteger(
  value: unknown,
  field: string,
  model: string
): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  return requirePositiveInteger(value, field, model);
}

export function validateCoverage(
  obj: Record<string, unknown>,
  sourceContent: string,
  redemptionType: string,
  pricingBasis: string,
  id: string,
  model: string
): {
  travelerCountCovered: number | null;
  nightCountCovered: number | null;
  coverageStatus: "source_explicit" | "standard_assumption" | "unknown";
} {
  const coverageStatusRaw =
    obj.coverageStatus === null || obj.coverageStatus === undefined
      ? "unknown"
      : obj.coverageStatus;

  if (
    coverageStatusRaw !== "source_explicit" &&
    coverageStatusRaw !== "standard_assumption" &&
    coverageStatusRaw !== "unknown"
  ) {
    throw new ResearchInterpreterError(
      `Award option "${id}" has invalid coverageStatus "${coverageStatusRaw}".`,
      "ollama",
      model
    );
  }

  const travelerCountCovered = requireOptionalPositiveInteger(
    obj.travelerCountCovered,
    "awardOptions[].travelerCountCovered",
    model
  );
  const nightCountCovered = requireOptionalPositiveInteger(
    obj.nightCountCovered,
    "awardOptions[].nightCountCovered",
    model
  );

  // Flight: nightCountCovered must be null
  if (redemptionType === "flight" && nightCountCovered !== null) {
    throw new ResearchInterpreterError(
      `Award option "${id}" is a flight but has nightCountCovered.`,
      "ollama",
      model
    );
  }

  // Hotel: travelerCountCovered must be null
  if (redemptionType === "hotel" && travelerCountCovered !== null) {
    throw new ResearchInterpreterError(
      `Award option "${id}" is a hotel but has travelerCountCovered.`,
      "ollama",
      model
    );
  }

  // coverageStatus="unknown": both counts must be null
  if (coverageStatusRaw === "unknown") {
    if (travelerCountCovered !== null || nightCountCovered !== null) {
      throw new ResearchInterpreterError(
        `Award option "${id}" has coverageStatus "unknown" but a count is non-null.`,
        "ollama",
        model
      );
    }
    return { travelerCountCovered: null, nightCountCovered: null, coverageStatus: "unknown" };
  }

  // coverageStatus="source_explicit": applicable count must be non-null and source-backed
  if (coverageStatusRaw === "source_explicit") {
    if (redemptionType === "flight") {
      if (travelerCountCovered === null) {
        throw new ResearchInterpreterError(
          `Award option "${id}" has coverageStatus "source_explicit" but travelerCountCovered is null.`,
          "ollama",
          model
        );
      }
      if (!numberIsSupportedBySource(travelerCountCovered, sourceContent, "travelerCountCovered")) {
        throw new ResearchInterpreterError(
          `Award option "${id}" travelerCountCovered "${travelerCountCovered}" is not supported by the cited source content.`,
          "ollama",
          model
        );
      }
    } else {
      // hotel
      if (nightCountCovered === null) {
        throw new ResearchInterpreterError(
          `Award option "${id}" has coverageStatus "source_explicit" but nightCountCovered is null.`,
          "ollama",
          model
        );
      }
      // Per-night hotel pricing semantically establishes a single night per
      // the cited rate even when the digit "1" does not literally appear in
      // the source text (sources say "per night" far more often than "1 night").
      // This is the ONLY hotel source_explicit compatibility relaxation;
      // exact verbatim digits are still required in every other case.
      const perNightSingleNightRate =
        pricingBasis === "per_night" && nightCountCovered === 1;
      if (
        !perNightSingleNightRate &&
        !numberIsSupportedBySource(nightCountCovered, sourceContent, "nightCountCovered")
      ) {
        throw new ResearchInterpreterError(
          `Award option "${id}" nightCountCovered "${nightCountCovered}" is not supported by the cited source content.`,
          "ollama",
          model
        );
      }
    }
    return {
      travelerCountCovered,
      nightCountCovered,
      coverageStatus: "source_explicit",
    };
  }

  // coverageStatus="standard_assumption"
  if (redemptionType === "flight") {
    if (travelerCountCovered !== 1 || nightCountCovered !== null) {
      throw new ResearchInterpreterError(
        `Award option "${id}" has coverageStatus "standard_assumption" but flight coverage is not travelerCountCovered=1 / nightCountCovered=null.`,
        "ollama",
        model
      );
    }
  } else {
    // hotel
    if (pricingBasis !== "per_night") {
      throw new ResearchInterpreterError(
        `Award option "${id}" has coverageStatus "standard_assumption" but hotel pricingBasis is not "per_night".`,
        "ollama",
        model
      );
    }
    if (travelerCountCovered !== null || nightCountCovered !== 1) {
      throw new ResearchInterpreterError(
        `Award option "${id}" has coverageStatus "standard_assumption" but hotel coverage is not travelerCountCovered=null / nightCountCovered=1.`,
        "ollama",
        model
      );
    }
  }

  return {
    travelerCountCovered,
    nightCountCovered,
    coverageStatus: "standard_assumption",
  };
}

const VALID_GOAL_MATCHES = new Set([
  "exact",
  "partial",
  "general",
  "different_destination",
]);

const VALID_MISMATCH_REASONS = new Set([
  "origin",
  "destination",
  "dates",
  "traveler_count",
  "cabin",
  "property",
]);

export function validateGoalClassification(
  obj: Record<string, unknown>,
  id: string,
  model: string,
  goal?: Goal
): {
  goalMatch: "exact" | "partial" | "general" | "different_destination";
  goalMismatchReasons: Array<
    "origin" | "destination" | "dates" | "traveler_count" | "cabin" | "property"
  >;
} {
  const rawGoalMatch = obj.goalMatch;
  const rawReasons = obj.goalMismatchReasons;

  // If both fields are omitted, normalize to general + []
  if (rawGoalMatch === undefined && rawReasons === undefined) {
    return { goalMatch: "general", goalMismatchReasons: [] };
  }

  // If only one is missing, the model output is inconsistent; still treat as omitted
  // and normalize to general + []
  if (rawGoalMatch === undefined || rawReasons === undefined) {
    return { goalMatch: "general", goalMismatchReasons: [] };
  }

  if (typeof rawGoalMatch !== "string" || !VALID_GOAL_MATCHES.has(rawGoalMatch)) {
    throw new ResearchInterpreterError(
      `Award option "${id}" has invalid goalMatch "${String(rawGoalMatch)}".`,
      "ollama",
      model
    );
  }

  if (!Array.isArray(rawReasons)) {
    throw new ResearchInterpreterError(
      `Award option "${id}" has non-array goalMismatchReasons.`,
      "ollama",
      model
    );
  }

  const reasons: Array<
    "origin" | "destination" | "dates" | "traveler_count" | "cabin" | "property"
  > = [];
  const seen = new Set<string>();

  for (const item of rawReasons) {
    if (typeof item !== "string" || !VALID_MISMATCH_REASONS.has(item)) {
      throw new ResearchInterpreterError(
        `Award option "${id}" has unknown goalMismatchReasons value "${String(item)}".`,
        "ollama",
        model
      );
    }
    if (seen.has(item)) {
      throw new ResearchInterpreterError(
        `Award option "${id}" has duplicate goalMismatchReasons value "${item}".`,
        "ollama",
        model
      );
    }
    seen.add(item);
    reasons.push(item as "origin" | "destination" | "dates" | "traveler_count" | "cabin" | "property");
  }

  // exact requires empty reasons
  if (rawGoalMatch === "exact" && reasons.length > 0) {
    throw new ResearchInterpreterError(
      `Award option "${id}" has goalMatch "exact" but non-empty goalMismatchReasons.`,
      "ollama",
      model
    );
  }

  // different_destination requires "destination" in reasons
  if (rawGoalMatch === "different_destination" && !reasons.includes("destination")) {
    throw new ResearchInterpreterError(
      `Award option "${id}" has goalMatch "different_destination" but goalMismatchReasons does not include "destination".`,
      "ollama",
      model
    );
  }

  let goalMatch = rawGoalMatch as "exact" | "partial" | "general" | "different_destination";
  const label = typeof obj.itineraryLabel === "string" ? obj.itineraryLabel.toLowerCase() : "";
  const destinations = goal?.destinations.filter(Boolean).map((value) => value.toLowerCase()) ?? [];
  if (label && destinations.length > 0) {
    const mentionsDestination = destinations.some((destination) => label.includes(destination));
    if (mentionsDestination && goalMatch === "different_destination") {
      goalMatch = "partial";
    } else if (!mentionsDestination && goalMatch === "exact") {
      goalMatch = "general";
      if (!reasons.includes("destination")) reasons.push("destination");
    }
  }

  return { goalMatch, goalMismatchReasons: reasons };
}
