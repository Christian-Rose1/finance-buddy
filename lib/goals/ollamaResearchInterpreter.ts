import type { Goal } from "./types";
import type { ResearchResponse, ResearchResult } from "./researchTypes";
import {
  ResearchInterpreterError,
  type InterpretedResearch,
  type ResearchRewardProgram,
  type ResearchFocus,
  type InterpretResearchInput,
  type ResearchInterpreter,
} from "./researchInterpreter";
import type {
  StrategyAwardOption,
  StrategyCardOffer,
  StrategySource,
  StrategyDataStatus,
} from "./strategyTypes";

export {
  ResearchInterpreterError,
  type InterpretedResearch,
  type ResearchRewardProgram,
  type ResearchFocus,
  type InterpretResearchInput,
} from "./researchInterpreter";

const DEFAULT_TIMEOUT_MS = 120_000;
const DIAGNOSTIC_SNIPPET_LENGTH = 300;

interface SourceEntry {
  source: StrategySource;
  result: ResearchResult;
}

interface ValidationContext {
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

const FOCUS_INSTRUCTIONS: Record<ResearchFocus, string> = {
  award_options:
    "Research focus is award_options: extract supported award options only; cardOffers must be [].\n" +
    "- Emit an award option whenever one cited source supports:\n" +
    "  a recognizable program name and an exact points price.\n" +
    "- An award option does NOT require the cited source to match the research\n" +
    "  query's exact origin, destination, dates, traveler count, cabin, or hotel\n" +
    "  property. Do not omit a sourced award benchmark merely because it does\n" +
    "  not match every detail in the research query.\n" +
    "- Valid planning benchmarks include general U.S.-to-Europe flight pricing,\n" +
    "  regional route pricing, airline-program award-chart pricing, hotel-program\n" +
    "  or destination hotel points-per-night pricing, and total-stay pricing when\n" +
    "  explicitly supported by the source.\n" +
    "- For a non-exact benchmark: set availabilityStatus=\"unknown\"; set\n" +
    "  itineraryLabel to describe ONLY the scope the source supports (never\n" +
    "  rewrite it as the customer's exact route, dates, or hotel); include an\n" +
    "  assumption or warning disclosing the mismatch.\n" +
    "- Every award option MUST identify whether it is a flight or hotel\n" +
    "  redemption via redemptionType \"flight\" or \"hotel\".\n" +
    "- Set pricingBasis ONLY to what the cited source establishes:\n" +
    "  - flight options may use \"one_way\", \"round_trip\", or \"unknown\".\n" +
    "  - hotel options may use \"per_night\", \"total_stay\", or \"unknown\".\n" +
    "  - Use \"unknown\" when the source does not establish the basis.\n" +
    "- Never infer round-trip pricing from a one-way price.\n" +
    "- Never infer total-stay pricing from a per-night price.\n" +
    "- Missing itinerary, fees, seats, cabin, transfer details, or valuation\n" +
    "  must be null and must NOT cause the option to be omitted.\n" +
    "- For public award-charts/examples, use availabilityStatus=\"unknown\".\n" +
    "- Do not require transfer evidence to emit the base award option.\n" +
    "- A clear shortened program name may map to the unique supplied catalog\n" +
    "  name containing that name, such as \"Flying Blue\" mapping to\n" +
    "  \"Air France-KLM Flying Blue\". Never make an ambiguous mapping.\n" +
    "- Identify how many travelers or nights the cited points figure covers:\n" +
    "  - travelerCountCovered (number|null): travelers covered by the points price.\n" +
    "  - nightCountCovered (number|null): nights covered by the points price.\n" +
    "  - coverageStatus: \"source_explicit\" | \"standard_assumption\" | \"unknown\".\n" +
    "  - Use \"source_explicit\" only when the source establishes the quantity.\n" +
    "  - Use \"standard_assumption\" for a single-traveler flight benchmark when\n" +
    "    the source presents a normal per-ticket award price but does not state a\n" +
    "    group quantity (travelerCountCovered=1, nightCountCovered=null).\n" +
    "  - Use \"standard_assumption\" with one night for per-night hotel pricing\n" +
    "    (travelerCountCovered=null, nightCountCovered=1).\n" +
    "  - Use \"unknown\" with null counts when coverage cannot safely be determined.\n" +
    "  - Never assume a group price applies to one traveler.\n" +
    "  - Never assume a per-night hotel price covers the entire stay.\n" +
    "- Every award option MUST include a goalMatch and a goalMismatchReasons array\n" +
    "  classifying how well the cited source content matches the research query's\n" +
    "  travel criteria (origin, destination, dates, traveler count, cabin, and hotel\n" +
    "  property/scope).\n" +
    "  - goalMatch: \"exact\" | \"partial\" | \"general\" | \"different_destination\".\n" +
    "  - goalMismatchReasons: array of \"origin\" | \"destination\" | \"dates\" |\n" +
    "    \"traveler_count\" | \"cabin\" | \"property\".\n" +
    "  - \"exact\": the cited source scope matches the requested route/destination\n" +
    "    and relevant trip characteristics. goalMismatchReasons must be [].\n" +
    "    Classification must reflect the cited source content, NOT merely the\n" +
    "    research query wording.\n" +
    "  - \"partial\": the source matches an important part of the goal but not\n" +
    "    every detail. Include the specific mismatch reasons.\n" +
    "  - \"general\": broad program/region benchmark with no contradictory\n" +
    "    destination. Include no mismatch reasons, or only reasons that do not\n" +
    "    contradict the goal (e.g., missing dates for a general benchmark).\n" +
    "  - \"different_destination\": the source explicitly concerns a different\n" +
    "    destination than the research query. goalMismatchReasons MUST include\n" +
    "    \"destination\".\n" +
    "  - different-destination options may still be preserved as fallbacks, but\n" +
    "    they must not be presented as primary matches.\n" +
    "  - Missing exact dates normally prevents an exact date match.\n" +
    "  - General benchmarks should not be omitted merely for being general.\n" +
    "  - Do not include duplicate reasons. Use each reason at most once.\n" +
    "  - Example classifications:\n" +
    "    * Denver-to-Paris source for a Denver-to-Paris query → exact, []\n" +
    "    * General U.S.-to-Paris source → partial, [\"origin\"]\n" +
    "    * General U.S.-to-Europe benchmark → general, []\n" +
    "    * U.S.-to-London source for a Paris query → different_destination, [\"destination\"]\n" +
    "    * Generic Hyatt category price with no Paris property → general or partial with [\"property\"]",
  card_offers:
    "Research focus is card_offers: extract actual credit-card offers only; awardOptions must be []; a rewards-program name is not a card name.",
};

const INTERPRET_PROMPT = `You are a strict research interpreter. You convert supplied
web research results into structured award-planning facts.

You will be given:
- A travel goal.
- A list of reward programs, each with an id and a name.
- A list of research sources, each with an id, label, and content.

Your job is to extract ONLY facts that are explicitly supported by the supplied
research content. You must never invent, infer, or guess.

<focus_instruction>

Return ONLY valid JSON matching this exact contract:

{
  "awardOptions": [
    {
      "id": string,
      "sourceId": string,
      "programName": string,
      "redemptionType": "flight" | "hotel",
      "pricingBasis": "one_way" | "round_trip" | "per_night" | "total_stay" | "unknown",
      "itineraryLabel": string | null,
      "pointsRequired": number,
      "cashFees": number | null,
      "seats": number | null,
      "cabin": string | null,
      "transferFromProgramId": string | null,
      "transferRatio": number | null,
      "centsPerPoint": number | null,
      "availabilityStatus": "available" | "unavailable" | "unknown"
    }
  ],
  "cardOffers": [
    {
      "id": string,
      "sourceId": string,
      "cardName": string,
      "issuer": string,
      "welcomeBonusPoints": number,
      "spendingRequirement": number,
      "spendingDeadlineMonths": number,
      "annualFee": number,
      "destinationProgramId": string | null
    }
  ],
  "assumptions": string[],
  "warnings": string[]
}

Rules:
- Extract only facts explicitly supported by the supplied research content.
- Every award option and card offer MUST reference a sourceId that exists in the
  supplied sources.
- sourceId MUST copy the supplied source id/URL exactly as provided in the
  sources list. Never use the source title as sourceId.
- Every numeric value (pointsRequired, cashFees, seats, welcomeBonusPoints,
  spendingRequirement, spendingDeadlineMonths, annualFee, transferRatio,
  centsPerPoint) MUST appear verbatim in the cited source content. Do not
  compute, round, or estimate numbers.
- programName MUST be the name of a supplied reward program.
- transferFromProgramId and destinationProgramId MUST be the id of a supplied
  reward program. When a researched program is referenced, use the id that
  belongs to that program's name.
- Do not invent availability, award space, points prices, taxes, fees, transfer
  ratios, welcome bonuses, annual fees, URLs, dates, or program IDs.
- Set availabilityStatus to "available" ONLY if a source explicitly reports
  current bookable inventory for the requested route/date. Public award charts,
  examples, or search snippets are catalog information, not live availability.
- Preserve ranges when sources provide ranges; do not convert them into false
  exact values.
- Conflicting or incomplete claims become warnings, not silently selected facts.
- Optional unknown fields must be null.
- Omit an award candidate only when sourceId, programName, or pointsRequired cannot be supported.
- If no award options or card offers can be supported, return empty arrays.
- Do not explain anything. Output JSON only.`;

export function buildResearchSystemPrompt(focus: ResearchFocus): string {
  return `${INTERPRET_PROMPT}\n${FOCUS_INSTRUCTIONS[focus]}`;
}

export function buildPublicResearchPayload(input: InterpretResearchInput): string {
  return JSON.stringify({
    focus: input.focus,
    rewardPrograms: input.rewardPrograms,
    research: input.research,
  });
}

function buildSources(research: ResearchResponse[]): SourceEntry[] {
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
function resolveCanonicalSourceId(
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

function parseModelResponse(raw: string, model: string): unknown {
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

function requireObject(
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

function requireString(value: unknown, field: string, model: string): string {
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

function requireOptionalString(value: unknown, field: string, model: string): string | null {
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

function requireStringArray(
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

function requireFiniteNonNegativeNumber(
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

function numberIsSupportedBySource(value: number, sourceContent: string): boolean {
  const tokens = sourceContent.match(/\d+(?:[\d,.]*\d)?/g) || [];
  return tokens.some((token) => {
    const normalizedToken = token.replace(/,/g, "");
    return Number(normalizedToken) === value;
  });
}

function assertNumberSupported(
  value: unknown,
  field: string,
  sourceContent: string,
  model: string
): number {
  const num = requireFiniteNonNegativeNumber(value, field, model);
  if (!numberIsSupportedBySource(num, sourceContent)) {
    throw new ResearchInterpreterError(
      `Model output field "${field}" value "${num}" is not supported by the cited source content.`,
      "ollama",
      model
    );
  }
  return num;
}

function assertOptionalNumberSupported(
  value: unknown,
  field: string,
  sourceContent: string,
  model: string
): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  const num = requireFiniteNonNegativeNumber(value, field, model);
  if (!numberIsSupportedBySource(num, sourceContent)) {
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

function validateCoverage(
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
      if (!numberIsSupportedBySource(travelerCountCovered, sourceContent)) {
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
      if (!numberIsSupportedBySource(nightCountCovered, sourceContent)) {
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

function validateGoalClassification(
  obj: Record<string, unknown>,
  id: string,
  model: string
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

  return {
    goalMatch: rawGoalMatch as "exact" | "partial" | "general" | "different_destination",
    goalMismatchReasons: reasons,
  };
}

function validateAwardOption(
  raw: unknown,
  ctx: ValidationContext
): StrategyAwardOption {
  const obj = requireObject(raw, "awardOptions[]", ctx.model);

  const id = requireString(obj.id, "awardOptions[].id", ctx.model);
  const rawSourceId = requireString(obj.sourceId, "awardOptions[].sourceId", ctx.model);
  const programName = requireString(obj.programName, "awardOptions[].programName", ctx.model);

  const sourceId = resolveCanonicalSourceId(
    rawSourceId,
    ctx,
    `Award option "${id}"`
  );
  const sourceEntry = ctx.sourceMap.get(sourceId);
  if (!sourceEntry) {
    throw new ResearchInterpreterError(
      `Award option "${id}" references unknown source "${sourceId}".`,
      "ollama",
      ctx.model
    );
  }

  const redemptionTypeRaw = requireString(
    obj.redemptionType,
    "awardOptions[].redemptionType",
    ctx.model
  );
  if (redemptionTypeRaw !== "flight" && redemptionTypeRaw !== "hotel") {
    throw new ResearchInterpreterError(
      `Award option "${id}" has invalid redemptionType "${redemptionTypeRaw}".`,
      "ollama",
      ctx.model
    );
  }

  const pricingBasisRaw = requireString(
    obj.pricingBasis,
    "awardOptions[].pricingBasis",
    ctx.model
  );
  if (
    pricingBasisRaw !== "one_way" &&
    pricingBasisRaw !== "round_trip" &&
    pricingBasisRaw !== "per_night" &&
    pricingBasisRaw !== "total_stay" &&
    pricingBasisRaw !== "unknown"
  ) {
    throw new ResearchInterpreterError(
      `Award option "${id}" has invalid pricingBasis "${pricingBasisRaw}".`,
      "ollama",
      ctx.model
    );
  }

  if (redemptionTypeRaw === "flight") {
    if (pricingBasisRaw === "per_night" || pricingBasisRaw === "total_stay") {
      throw new ResearchInterpreterError(
        `Award option "${id}" is a flight but has pricingBasis "${pricingBasisRaw}".`,
        "ollama",
        ctx.model
      );
    }
  }

  if (redemptionTypeRaw === "hotel") {
    if (pricingBasisRaw === "one_way" || pricingBasisRaw === "round_trip") {
      throw new ResearchInterpreterError(
        `Award option "${id}" is a hotel but has pricingBasis "${pricingBasisRaw}".`,
        "ollama",
        ctx.model
      );
    }
  }

  const sourceContent = sourceEntry.result.content;

  let finalProgramName = programName;
  const exactMatch = ctx.rewardPrograms.find((p) => p.name === programName);
  if (!exactMatch) {
    const partialMatches = ctx.rewardPrograms.filter((p) =>
      p.name.toLowerCase().includes(programName.toLowerCase())
    );
    if (partialMatches.length === 1) {
      finalProgramName = partialMatches[0].name;
    }
  }

  if (!ctx.rewardPrograms.some((program) => program.name === finalProgramName)) {
    throw new ResearchInterpreterError(
      `Award option "${id}" references program "${programName}" which was not supplied.`,
      "ollama",
      ctx.model
    );
  }

  const pointsRequired = assertNumberSupported(
    obj.pointsRequired,
    "awardOptions[].pointsRequired",
    sourceContent,
    ctx.model
  );
  const cashFees = assertOptionalNumberSupported(
    obj.cashFees,
    "awardOptions[].cashFees",
    sourceContent,
    ctx.model
  );
  const seats = assertOptionalNumberSupported(
    obj.seats,
    "awardOptions[].seats",
    sourceContent,
    ctx.model
  );

  const cabin = requireOptionalString(obj.cabin, "awardOptions[].cabin", ctx.model);

  const transferFromProgramId =
    obj.transferFromProgramId === null || obj.transferFromProgramId === undefined
      ? null
      : requireString(
          obj.transferFromProgramId,
          "awardOptions[].transferFromProgramId",
          ctx.model
        );

  if (
    transferFromProgramId !== null &&
    !ctx.rewardPrograms.some((program) => program.id === transferFromProgramId)
  ) {
    throw new ResearchInterpreterError(
      `Award option "${id}" references transfer program "${transferFromProgramId}" which was not supplied.`,
      "ollama",
      ctx.model
    );
  }

  const transferRatio = assertOptionalNumberSupported(
    obj.transferRatio,
    "awardOptions[].transferRatio",
    sourceContent,
    ctx.model
  );

  const centsPerPoint = assertOptionalNumberSupported(
    obj.centsPerPoint,
    "awardOptions[].centsPerPoint",
    sourceContent,
    ctx.model
  );

  const availabilityStatusRaw = requireString(
    obj.availabilityStatus,
    "awardOptions[].availabilityStatus",
    ctx.model
  );
  if (
    availabilityStatusRaw !== "available" &&
    availabilityStatusRaw !== "unavailable" &&
    availabilityStatusRaw !== "unknown"
  ) {
    throw new ResearchInterpreterError(
      `Award option "${id}" has invalid availabilityStatus "${availabilityStatusRaw}".`,
      "ollama",
      ctx.model
    );
  }

  if (availabilityStatusRaw === "available") {
    throw new ResearchInterpreterError(
      `Award option "${id}" has availabilityStatus "available", which is rejected. Research is planning evidence, not live inventory.`,
      "ollama",
      ctx.model
    );
  }

  const coverage = validateCoverage(
    obj,
    sourceContent,
    redemptionTypeRaw,
    pricingBasisRaw,
    id,
    ctx.model
  );

  const goalClassification = validateGoalClassification(obj, id, ctx.model);

  return {
    id,
    sourceId,
    programName: finalProgramName,
    redemptionType: redemptionTypeRaw,
    pricingBasis: pricingBasisRaw,
    itineraryLabel: requireOptionalString(
      obj.itineraryLabel,
      "awardOptions[].itineraryLabel",
      ctx.model
    ),
    pointsRequired,
    cashFees,
    seats,
    cabin,
    transferFromProgramId,
    transferRatio,
    centsPerPoint,
    availabilityStatus: availabilityStatusRaw,
    travelerCountCovered: coverage.travelerCountCovered,
    nightCountCovered: coverage.nightCountCovered,
    coverageStatus: coverage.coverageStatus,
    goalMatch: goalClassification.goalMatch,
    goalMismatchReasons: goalClassification.goalMismatchReasons,
  };
}

function validateCardOffer(
  raw: unknown,
  ctx: ValidationContext
): StrategyCardOffer {
  if (!ctx.goal.allowNewCards) {
    throw new ResearchInterpreterError(
      "Model output contains a card offer but goal.allowNewCards is false.",
      "ollama",
      ctx.model
    );
  }

  const obj = requireObject(raw, "cardOffers[]", ctx.model);

  const id = requireString(obj.id, "cardOffers[].id", ctx.model);
  const rawSourceId = requireString(obj.sourceId, "cardOffers[].sourceId", ctx.model);

  const sourceId = resolveCanonicalSourceId(
    rawSourceId,
    ctx,
    `Card offer "${id}"`
  );
  const sourceEntry = ctx.sourceMap.get(sourceId);
  if (!sourceEntry) {
    throw new ResearchInterpreterError(
      `Card offer "${id}" references unknown source "${sourceId}".`,
      "ollama",
      ctx.model
    );
  }
  const sourceContent = sourceEntry.result.content;

  const welcomeBonusPoints = assertNumberSupported(
    obj.welcomeBonusPoints,
    "cardOffers[].welcomeBonusPoints",
    sourceContent,
    ctx.model
  );
  const spendingRequirement = assertNumberSupported(
    obj.spendingRequirement,
    "cardOffers[].spendingRequirement",
    sourceContent,
    ctx.model
  );
  const spendingDeadlineMonths = assertNumberSupported(
    obj.spendingDeadlineMonths,
    "cardOffers[].spendingDeadlineMonths",
    sourceContent,
    ctx.model
  );
  const annualFee = assertNumberSupported(
    obj.annualFee,
    "cardOffers[].annualFee",
    sourceContent,
    ctx.model
  );

  const destinationProgramId =
    obj.destinationProgramId === null || obj.destinationProgramId === undefined
      ? null
      : requireString(
          obj.destinationProgramId,
          "cardOffers[].destinationProgramId",
          ctx.model
        );

  if (
    destinationProgramId !== null &&
    !ctx.rewardPrograms.some((program) => program.id === destinationProgramId)
  ) {
    throw new ResearchInterpreterError(
      `Card offer "${id}" references destination program "${destinationProgramId}" which was not supplied.`,
      "ollama",
      ctx.model
    );
  }

  return {
    id,
    sourceId,
    cardName: requireString(obj.cardName, "cardOffers[].cardName", ctx.model),
    issuer: requireString(obj.issuer, "cardOffers[].issuer", ctx.model),
    welcomeBonusPoints,
    spendingRequirement,
    spendingDeadlineMonths,
    annualFee,
    destinationProgramId,
  };
}

function validateInterpretedOutput(
  parsed: unknown,
  ctx: ValidationContext
): InterpretedResearch {
  const root = requireObject(parsed, "root", ctx.model);

  const awardOptionsRaw = root.awardOptions;
  if (!Array.isArray(awardOptionsRaw)) {
    throw new ResearchInterpreterError(
      'Model output missing required array field "awardOptions".',
      "ollama",
      ctx.model
    );
  }

  const cardOffersRaw = root.cardOffers;
  if (!Array.isArray(cardOffersRaw)) {
    throw new ResearchInterpreterError(
      'Model output missing required array field "cardOffers".',
      "ollama",
      ctx.model
    );
  }

  const assumptions = requireStringArray(
    root.assumptions,
    "assumptions",
    ctx.model
  );
  const warnings = requireStringArray(root.warnings, "warnings", ctx.model);

  const awardOptions = awardOptionsRaw.map((raw) =>
    validateAwardOption(raw, ctx)
  );

  const cardOffers = cardOffersRaw.map((raw) => validateCardOffer(raw, ctx));

  if (ctx.focus === "award_options" && cardOffers.length > 0) {
    throw new ResearchInterpreterError(
      `Focus is award_options but ${cardOffers.length} card offer(s) were returned.`,
      "ollama",
      ctx.model
    );
  }

  if (ctx.focus === "card_offers" && awardOptions.length > 0) {
    throw new ResearchInterpreterError(
      `Focus is card_offers but ${awardOptions.length} award option(s) were returned.`,
      "ollama",
      ctx.model
    );
  }

  return {
    awardOptions,
    cardOffers,
    sources: Array.from(ctx.sourceMap.values()).map((e) => e.source),
    assumptions,
    warnings,
  };
}

export function validateResearchModelContent(
  rawContent: string,
  input: InterpretResearchInput,
  model: string
): InterpretedResearch {
  const entries = buildSources(input.research);
  const sourceMap = new Map(entries.map((e) => [e.source.id, e]));

  const parsed = parseModelResponse(rawContent, model);

  const validationContext: ValidationContext = {
    goal: input.goal,
    rewardPrograms: input.rewardPrograms,
    sourceMap,
    model,
    focus: input.focus,
  };

  return validateInterpretedOutput(parsed, validationContext);
}

export class OllamaResearchInterpreter implements ResearchInterpreter {
  private readonly baseUrl: string;
  private readonly model: string;

  constructor(baseUrl?: string, model?: string) {
    if (typeof process === "undefined" || !process.env) {
      throw new ResearchInterpreterError(
        "Ollama research interpreter can only run in a server environment.",
        "ollama",
        model ?? "unknown"
      );
    }

    this.baseUrl = (
      baseUrl ??
      process.env.OLLAMA_BASE_URL ??
      ""
    ).replace(/\/+$/, "");

    this.model =
      model ??
      process.env.OLLAMA_STRATEGY_MODEL ??
      "";

    if (!this.baseUrl) {
      throw new ResearchInterpreterError(
        "OLLAMA_BASE_URL environment variable is required.",
        "ollama",
        this.model || "unknown"
      );
    }

    if (!this.model) {
      throw new ResearchInterpreterError(
        "OLLAMA_STRATEGY_MODEL environment variable is required.",
        "ollama",
        "unknown"
      );
    }
  }

  async interpret(input: InterpretResearchInput): Promise<InterpretedResearch> {
    const entries = buildSources(input.research);

    const context = {
      goal: input.goal,
      rewardPrograms: input.rewardPrograms,
      focus: input.focus,
      sources: entries.map((e) => ({
        id: e.source.id,
        label: e.result.title,
        url: e.result.url,
        content: e.result.content,
      })),
    };

    if (process.env.STRATEGY_DEBUG === "1") {
      const totalResultCount = input.research.reduce(
        (sum, response) => sum + response.results.length,
        0
      );
      const resultDetails = input.research.flatMap((response) =>
        response.results.map((result) => ({
          title: result.title,
          url: result.url,
          contentLength: result.content.length,
        }))
      );
      console.info(
        `[strategy-research-input-debug:${input.focus}]`,
        JSON.stringify({
          focus: input.focus,
          researchResponseCount: input.research.length,
          totalResultCount,
          results: resultDetails,
        })
      );
    }

    const raw = await this.callOllama(context, input.focus);

    if (process.env.STRATEGY_DEBUG === "1") {
      console.info(`[strategy-research-debug:${input.focus}]`, raw);
    }

    return validateResearchModelContent(raw, input, this.model);
  }

  private async callOllama(context: unknown, focus: ResearchFocus): Promise<string> {
    const controller = new AbortController();
    const timeoutId = setTimeout(
      () => controller.abort(),
      DEFAULT_TIMEOUT_MS
    );

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          model: this.model,
          messages: [
            { role: "system", content: buildResearchSystemPrompt(focus) },
            { role: "user", content: `${JSON.stringify(context)}\n${FOCUS_INSTRUCTIONS[focus]}` },
          ],
          stream: false,
          format: "json",
          think: false,
          options: {
            temperature: 0,
            num_predict: 4096,
            num_ctx: 16384,
          },
        }),
      });
    } catch (error) {
      if (controller.signal.aborted) {
        throw new ResearchInterpreterError(
          `Ollama research interpreter request timed out after ${DEFAULT_TIMEOUT_MS}ms.`,
          "ollama",
          this.model
        );
      }
      throw new ResearchInterpreterError(
        `Failed to reach Ollama at ${this.baseUrl}. ${
          error instanceof Error ? error.message : String(error)
        }`,
        "ollama",
        this.model
      );
    } finally {
      clearTimeout(timeoutId);
    }

    if (!response.ok) {
      throw new ResearchInterpreterError(
        `Ollama returned HTTP ${response.status}.`,
        "ollama",
        this.model,
        response.status
      );
    }

    let payload: { message?: { content?: unknown } };
    try {
      payload = await response.json();
    } catch {
      throw new ResearchInterpreterError(
        "Ollama returned a non-JSON response.",
        "ollama",
        this.model,
        response.status
      );
    }

    const rawText =
      typeof payload.message?.content === "string"
        ? payload.message.content.trim()
        : "";

    if (!rawText) {
      throw new ResearchInterpreterError(
        "Ollama response was missing the model text output.",
        "ollama",
        this.model,
        response.status
      );
    }

    return rawText;
  }
}
