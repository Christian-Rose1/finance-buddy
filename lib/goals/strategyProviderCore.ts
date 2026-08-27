/**
 * Shared provider-neutral strategy generation core.
 *
 * Extracted from OllamaStrategyProvider so that any LLM provider (Ollama,
 * OpenRouter, etc.) can reuse the same system prompt, JSON schema, response
 * parsing, output validation, and deterministic flight/hotel attachment
 * without duplicating logic.
 */

import type {
  FollowUpDecisionTopic,
  StrategyAwardOption,
  StrategyCardOffer,
  StrategyFeasibility,
  StrategySource,
  PersonalizedStrategyNarrative,
} from "./strategyTypes";
import { evidenceLevelOf } from "./travelEvidence";
import { FOLLOW_UP_DECISION_TOPICS } from "./strategyTypes";
import { filterCustomerSentences } from "./customerTextPolicy";

// ---------------------------------------------------------------------------
// Error
// ---------------------------------------------------------------------------

export class StrategyProviderError extends Error {
  constructor(
    message: string,
    readonly provider: string,
    readonly model: string,
    readonly status?: number,
    readonly details?: string
  ) {
    super(message);
    this.name = "StrategyProviderError";
  }
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const FEASIBILITY_VALUES: StrategyFeasibility[] = [
  "on_track",
  "gap_remaining",
  "depends_on_new_card",
  "insufficient_information",
];

/**
 * Fixed neutral server-owned fallbacks when syntactic filtering empties a
 * required narrative field. The deterministic narrative trust gate may later
 * replace these with the stronger fixed trust-stop copy.
 */
export const NEUTRAL_HEADLINE_FALLBACK = "Your planning strategy";
export const NEUTRAL_SUMMARY_FALLBACK =
  "Planning guidance based on your saved goal.";

export const STRATEGY_PROMPT = `You are a personalized credit-card points strategy planner.

The user supplied a travel goal, owned reward-account balances, owned cards,
monthly spending, candidate award options, and candidate card offers. Your job
is to produce a personalized, actionable plan that respects exactly the data
supplied.

Return ONLY valid JSON matching this exact contract:

{
  "headline": string,
  "summary": string,
  "feasibility": "on_track" | "gap_remaining" | "depends_on_new_card" | "insufficient_information",
  "pointsGap": number | null,
  "recommendedAwardOptionId": string | null,
  "recommendedCardOfferId": string | null,
  "actions": [
    {
      "priority": number,
      "title": string,
      "explanation": string,
      "deadline": string | null,
      "sourceIds": string[]
    }
  ],
  "alternatives": [
    {
      "title": string,
      "tradeoff": string,
      "sourceIds": string[]
    }
  ],
  "assumptions": string[],
  "warnings": string[],
  "followUpTopics": ("flight_time_preference" | "layover_tolerance" | "hotel_neighborhood_preference" | "room_preference" | "cash_vs_points_preference")[]
}

Rules:
- The supplied brief is authoritative server-built context. Treat its goal facts,
  resolved trip nights, calculations, and allocation scenarios as fixed constraints.
- Select followUpTopics only from the contract. Do not write question prose.
- Do not substitute a city, route, date, cabin, traveler count, or stay length.
- Compare the supplied award options and card offers against each other.
- Never invent award availability, prices, transfer ratios, balances, cards,
  offers, deadlines, or sources.
- Planning benchmarks are not live availability. Promotions, transfer ratios,
  cash estimates, fees, and deadlines require supplied evidence or a "verify
  before booking or transfer" warning; never present them as assumptions.
- Named award recommendations may only reference supplied awardOptions.
- Named card recommendations may only reference supplied cardOffers.
- When an optional decision is needed, select its allowlisted followUpTopics value.
- Distinguish assumptions and warnings.
- Respect goal.allowNewCards:
  - If goal.allowNewCards is false, do not recommend a new card and set
    recommendedCardOfferId to null.
- Prioritize according to goal.optimizationPriority.
- Treat user-confirmed balances as authoritative.
- Return actionable ordered steps.
- sourceIds may reference only supplied sources.
- Do not explain anything.
- Output JSON only.`;

// ---------------------------------------------------------------------------
// Minimal validation context
// ---------------------------------------------------------------------------

/**
 * The subset of PersonalizedStrategyContext needed by the shared validation
 * functions. Providers pass this instead of the full context so the shared
 * core never depends on the complete customer-data shape.
 */
export interface StrategyValidationContext {
  awardOptions: StrategyAwardOption[];
  cardOffers: StrategyCardOffer[];
  sources: StrategySource[];
  goal: { allowNewCards: boolean };
  referenceMap?: {
    awardOptions: StrategyAwardOption[];
    cardOffers: StrategyCardOffer[];
    sources: StrategySource[];
  };
  unavailableFollowUpTopics?: ReadonlySet<FollowUpDecisionTopic>;
}

const FOLLOW_UP_QUESTION_TEXT: Record<FollowUpDecisionTopic, string> = {
  flight_time_preference: "Do you prefer a morning, afternoon, or evening departure?",
  layover_tolerance: "What is the longest layover you would accept?",
  hotel_neighborhood_preference: "Do you have a preferred hotel neighborhood or area?",
  room_preference: "Do you need a specific room type or bedding arrangement?",
  cash_vs_points_preference: "Would you rather minimize cash cost or preserve points?",
};

export function unavailableFollowUpTopics(prompt: { goal: { optimizationPriority: string } }): ReadonlySet<FollowUpDecisionTopic> {
  return prompt.goal.optimizationPriority === "lowest_cash"
    ? new Set<FollowUpDecisionTopic>(["cash_vs_points_preference"])
    : new Set();
}

// ---------------------------------------------------------------------------
// JSON parsing
// ---------------------------------------------------------------------------

const DIAGNOSTIC_SNIPPET_LENGTH = 300;

export function parseModelResponse(
  raw: string,
  provider: string,
  model: string
): unknown {
  const trimmed = raw.trim();

  const fencedMatch = trimmed.match(
    /```(?:json)?\s*([\s\S]*?)```/
  );

  const candidate = fencedMatch
    ? fencedMatch[1].trim()
    : trimmed;

  try {
    return JSON.parse(candidate);
  } catch {
    const firstBrace = candidate.indexOf("{");
    const lastBrace = candidate.lastIndexOf("}");

    if (firstBrace !== -1 && lastBrace > firstBrace) {
      try {
        return JSON.parse(
          candidate.slice(firstBrace, lastBrace + 1)
        );
      } catch {
        // Fall through.
      }
    }
  }

  throw new StrategyProviderError(
    `${provider} model did not return valid JSON. See details for a truncated response.`,
    provider,
    model,
    undefined,
    `Response (truncated to ${DIAGNOSTIC_SNIPPET_LENGTH} chars): ${trimmed.slice(
      0,
      DIAGNOSTIC_SNIPPET_LENGTH
    )}`
  );
}

// ---------------------------------------------------------------------------
// Primitive helpers
// ---------------------------------------------------------------------------

export function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function optionalFiniteNumber(
  value: unknown,
  provider: string,
  model: string
): number | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (!isFiniteNumber(value)) {
    throw new StrategyProviderError(
      "Model output contained a non-finite numeric value.",
      provider,
      model,
      undefined,
      `Expected finite number or null, received: ${String(value)}`
    );
  }

  return value;
}

export function requireString(
  value: unknown,
  field: string,
  provider: string,
  model: string
): string {
  if (typeof value !== "string") {
    throw new StrategyProviderError(
      `Model output missing required string field "${field}".`,
      provider,
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
  provider: string,
  model: string
): string[] {
  if (!Array.isArray(value)) {
    throw new StrategyProviderError(
      `Model output missing required array field "${field}".`,
      provider,
      model,
      undefined,
      `Field "${field}" received: ${String(value)}`
    );
  }

  const strings: string[] = [];

  for (const item of value) {
    if (typeof item !== "string") {
      throw new StrategyProviderError(
        `Model output field "${field}" must contain only strings.`,
        provider,
        model
      );
    }

    strings.push(item);
  }

  return strings;
}

export function requireStringArrayField(
  source: Record<string, unknown>,
  field: string,
  provider: string,
  model: string
): string[] {
  if (!(field in source) || source[field] === undefined) {
    throw new StrategyProviderError(
      `Model output missing required array field "${field}".`,
      provider,
      model
    );
  }

  return requireStringArray(source[field], field, provider, model);
}

export function requireObject(
  value: unknown,
  field: string,
  provider: string,
  model: string
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new StrategyProviderError(
      `Model output missing required object field "${field}".`,
      provider,
      model,
      undefined,
      `Field "${field}" received: ${String(value)}`
    );
  }

  return value as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Deduplication
// ---------------------------------------------------------------------------

export function deduplicateByOptionId(
  options: StrategyAwardOption[]
): StrategyAwardOption[] {
  const seen = new Set<string>();
  const deduplicated: StrategyAwardOption[] = [];

  for (const option of options) {
    if (seen.has(option.id)) {
      continue;
    }
    seen.add(option.id);
    deduplicated.push(option);
  }

  return deduplicated;
}

// ---------------------------------------------------------------------------
// Action / Alternative validation
// ---------------------------------------------------------------------------

export function validateAction(
  raw: unknown,
  context: StrategyValidationContext,
  provider: string,
  model: string
): {
  priority: number;
  title: string;
  explanation: string;
  deadline: string | null;
  sourceIds: string[];
} {
  const source = requireObject(raw, "actions[]", provider, model);

  const priorityRaw = source.priority;

  if (!isFiniteNumber(priorityRaw)) {
    throw new StrategyProviderError(
      'Model output action "priority" must be a finite number.',
      provider,
      model
    );
  }

  const title = requireString(source.title, "actions[].title", provider, model);
  const explanation = requireString(
    source.explanation,
    "actions[].explanation",
    provider,
    model
  );

  const deadlineRaw =
    source.deadline === undefined ? null : source.deadline;

  const deadline =
    deadlineRaw === null
      ? null
      : requireString(
          deadlineRaw,
          "actions[].deadline",
          provider,
          model
        );

  const sourceIds = requireStringArrayField(
    source,
    "sourceIds",
    provider,
    model
  );

  for (const sourceId of sourceIds) {
    if (!context.sources.some((s) => s.id === sourceId) && !context.referenceMap?.sources.some((s) => s.id === sourceId)) {
      throw new StrategyProviderError(
        `Action source ID "${sourceId}" is not present in context.sources.`,
        provider,
        model
      );
    }
  }

  const mappedSourceIds = sourceIds.map((sourceId) =>
    context.referenceMap?.sources.find((_, index) => `source-${index + 1}` === sourceId)?.id ?? sourceId
  );
  return {
    priority: priorityRaw,
    title,
    explanation,
    deadline,
    sourceIds: mappedSourceIds,
  };
}

export function validateAlternative(
  raw: unknown,
  context: StrategyValidationContext,
  provider: string,
  model: string
): {
  title: string;
  tradeoff: string;
  sourceIds: string[];
} {
  const source = requireObject(raw, "alternatives[]", provider, model);

  const title = requireString(
    source.title,
    "alternatives[].title",
    provider,
    model
  );

  const tradeoff = requireString(
    source.tradeoff,
    "alternatives[].tradeoff",
    provider,
    model
  );

  const sourceIds = requireStringArrayField(
    source,
    "sourceIds",
    provider,
    model
  );

  for (const sourceId of sourceIds) {
    if (!context.sources.some((s) => s.id === sourceId) && !context.referenceMap?.sources.some((s) => s.id === sourceId)) {
      throw new StrategyProviderError(
        `Alternative source ID "${sourceId}" is not present in context.sources.`,
        provider,
        model
      );
    }
  }

  const mappedSourceIds = sourceIds.map((sourceId) =>
    context.referenceMap?.sources.find((_, index) => `source-${index + 1}` === sourceId)?.id ?? sourceId
  );
  return {
    title,
    tradeoff,
    sourceIds: mappedSourceIds,
  };
}

// ---------------------------------------------------------------------------
// Strategy output validation
// ---------------------------------------------------------------------------

export function validateStrategyOutput(
  parsed: unknown,
  context: StrategyValidationContext,
  provider: string,
  model: string
): PersonalizedStrategyNarrative {
  const root = requireObject(parsed, "strategy", provider, model);

  // Model-authored narrative prose is customer-visible text. Discard complete
  // unsafe sentences (internal references such as award-1/source-2, URLs, and
  // technical pipeline terms) before the narrative can be persisted. A
  // required headline/summary must never persist as an empty string: use the
  // fixed neutral server-owned fallback when every sentence is unsafe.
  const headline =
    filterCustomerSentences(
      requireString(root.headline, "headline", provider, model),
    ) || NEUTRAL_HEADLINE_FALLBACK;
  const summary =
    filterCustomerSentences(
      requireString(root.summary, "summary", provider, model),
    ) || NEUTRAL_SUMMARY_FALLBACK;

  const feasibility = requireString(
    root.feasibility,
    "feasibility",
    provider,
    model
  ) as StrategyFeasibility;

  if (!FEASIBILITY_VALUES.includes(feasibility)) {
    throw new StrategyProviderError(
      `Model output has invalid feasibility "${feasibility}".`,
      provider,
      model
    );
  }

  // Retain structural validation for the legacy field, but never allow a
  // model-authored aggregate to become a customer funding claim. Deterministic
  // allocation scenarios carry the authoritative per-account gaps.
  const modelPointsGap = optionalFiniteNumber(root.pointsGap, provider, model);

  if (modelPointsGap !== null && modelPointsGap < 0) {
    throw new StrategyProviderError(
      `Model output has negative pointsGap "${modelPointsGap}".`,
      provider,
      model
    );
  }
  const pointsGap = null;

  const recommendedAwardOptionIdRaw =
    root.recommendedAwardOptionId === undefined
      ? null
      : root.recommendedAwardOptionId;

  let recommendedAwardOptionId =
    recommendedAwardOptionIdRaw === null
      ? null
      : requireString(
          recommendedAwardOptionIdRaw,
          "recommendedAwardOptionId",
          provider,
          model
        );

  const finalizationWarnings: string[] = [];
  if (recommendedAwardOptionId !== null) {
    if (
      !context.awardOptions.some(
        (option: StrategyAwardOption) => option.id === recommendedAwardOptionId
      ) && !context.referenceMap?.awardOptions.some((option) => option.id === recommendedAwardOptionId)
    ) {
      finalizationWarnings.push(
        `The recommended award option "${recommendedAwardOptionId}" could not be verified and was cleared.`
      );
      recommendedAwardOptionId = null;
    }
    if (recommendedAwardOptionId !== null && context.referenceMap) {
      const index = context.awardOptions.findIndex((option) => option.id === recommendedAwardOptionId);
      if (index >= 0) recommendedAwardOptionId = context.referenceMap.awardOptions[index]?.id ?? null;
    }
  }

  const recommendedCardOfferIdRaw =
    root.recommendedCardOfferId === undefined
      ? null
      : root.recommendedCardOfferId;

  let recommendedCardOfferId =
    recommendedCardOfferIdRaw === null
      ? null
      : requireString(
          recommendedCardOfferIdRaw,
          "recommendedCardOfferId",
          provider,
          model
        );

  if (recommendedCardOfferId !== null) {
    if (!context.goal.allowNewCards) {
      finalizationWarnings.push(
        "The recommended card offer could not be verified because goal.allowNewCards is false; the recommendation was cleared."
      );
      recommendedCardOfferId = null;
    } else if (
      !context.cardOffers.some(
        (offer: StrategyCardOffer) => offer.id === recommendedCardOfferId
      ) && !context.referenceMap?.cardOffers.some((offer) => offer.id === recommendedCardOfferId)
    ) {
      finalizationWarnings.push(
        `The recommended card offer "${recommendedCardOfferId}" could not be verified and was cleared.`
      );
      recommendedCardOfferId = null;
    }
    if (recommendedCardOfferId !== null && context.referenceMap) {
      const index = context.cardOffers.findIndex((offer) => offer.id === recommendedCardOfferId);
      if (index >= 0) recommendedCardOfferId = context.referenceMap.cardOffers[index]?.id ?? null;
    }
  }

  const assumptions = requireStringArrayField(
    root,
    "assumptions",
    provider,
    model
  )
    .map(filterCustomerSentences)
    .filter((value) => value.length > 0);

  // Model-authored warnings are sanitized the same way. Server-generated
  // finalization warnings (which name only the model's own fabricated
  // reference that was cleared) are appended afterwards and never treated as
  // model prose.
  const warnings = requireStringArrayField(root, "warnings", provider, model)
    .map(filterCustomerSentences)
    .filter((value) => value.length > 0);
  if (finalizationWarnings.length > 0) {
    warnings.unshift(...finalizationWarnings);
  }

  const rawFollowUpTopics = root.followUpTopics;
  const followUpTopics = Array.isArray(rawFollowUpTopics) ? rawFollowUpTopics : [];
  const followUpQuestions: string[] = [];
  let droppedFollowUpTopic =
    (rawFollowUpTopics !== undefined && !Array.isArray(rawFollowUpTopics)) ||
    root.followUpQuestions !== undefined;
  const selectedTopics = new Set<FollowUpDecisionTopic>();
  for (const rawTopic of followUpTopics) {
    if (typeof rawTopic !== "string" || !FOLLOW_UP_DECISION_TOPICS.includes(rawTopic as FollowUpDecisionTopic)) {
      droppedFollowUpTopic = true;
      continue;
    }
    const topic = rawTopic as FollowUpDecisionTopic;
    if (selectedTopics.has(topic) || context.unavailableFollowUpTopics?.has(topic)) {
      droppedFollowUpTopic = true;
      continue;
    }
    selectedTopics.add(topic);
    followUpQuestions.push(FOLLOW_UP_QUESTION_TEXT[topic]);
  }
  if (droppedFollowUpTopic) {
    // Optional model fields are not customer financial warnings. Keep their
    // rejection observable only in development, without logging model prose
    // or topic values.
    if (process.env.STRATEGY_DEBUG === "1") {
      console.info("[strategy-follow-up-topic-dropped]", {
        category: "invalid_optional_follow_up_topic",
      });
    }
  }

  const rawActions = root.actions;

  if (!Array.isArray(rawActions)) {
    throw new StrategyProviderError(
      'Model output missing required array field "actions".',
      provider,
      model
    );
  }

  // If an action loses its required title or explanation after syntactic
  // filtering, drop the complete action rather than persisting a partial one.
  const actions = rawActions
    .map((rawAction) => validateAction(rawAction, context, provider, model))
    .map((action) => ({
      ...action,
      title: filterCustomerSentences(action.title),
      explanation: filterCustomerSentences(action.explanation),
      deadline:
        action.deadline === null
          ? null
          : filterCustomerSentences(action.deadline),
    }))
    .filter(
      (action) => action.title.length > 0 && action.explanation.length > 0,
    );

  const rawAlternatives = root.alternatives;

  if (!Array.isArray(rawAlternatives)) {
    throw new StrategyProviderError(
      'Model output missing required array field "alternatives".',
      provider,
      model
    );
  }

  // If an alternative loses its required title or tradeoff after syntactic
  // filtering, drop the complete alternative rather than persisting a partial
  // one.
  const alternatives = rawAlternatives
    .map((rawAlternative) =>
      validateAlternative(rawAlternative, context, provider, model)
    )
    .map((alternative) => ({
      ...alternative,
      title: filterCustomerSentences(alternative.title),
      tradeoff: filterCustomerSentences(alternative.tradeoff),
    }))
    .filter(
      (alternative) =>
        alternative.title.length > 0 && alternative.tradeoff.length > 0,
    );

  // flightOptions and hotelOptions are server-attached validated research
  // facts. They are attached deterministically from context.awardOptions and
  // are never generated by the strategy model: any model-supplied
  // flightOptions/hotelOptions fields are ignored entirely. This guarantees
  // the model cannot invent an option, remove a validated option, or alter
  // its price, source, program, type, or pricing basis.
  const serverAwardOptions = context.referenceMap?.awardOptions ?? context.awardOptions;
  // A research benchmark can inform points planning, but it cannot be the
  // model's primary exact-trip recommendation.
  if (
    recommendedAwardOptionId !== null &&
    evidenceLevelOf(
      serverAwardOptions.find((option) => option.id === recommendedAwardOptionId) ?? {
        evidenceLevel: "planning_benchmark",
      }
    ) === "planning_benchmark"
  ) {
    recommendedAwardOptionId = null;
  }
  const flightOptions = deduplicateByOptionId(
    serverAwardOptions.filter((option) => option.redemptionType === "flight")
  );
  const hotelOptions = deduplicateByOptionId(
    serverAwardOptions.filter((option) => option.redemptionType === "hotel")
  );

  return {
    headline,
    summary,
    feasibility,
    pointsGap,
    recommendedAwardOptionId,
    recommendedCardOfferId,
    flightOptions,
    hotelOptions,
    actions,
    alternatives,
    assumptions,
    warnings,
    followUpQuestions,
  };
}
