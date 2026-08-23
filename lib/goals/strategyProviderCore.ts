/**
 * Shared provider-neutral strategy generation core.
 *
 * Extracted from OllamaStrategyProvider so that any LLM provider (Ollama,
 * OpenRouter, etc.) can reuse the same system prompt, JSON schema, response
 * parsing, output validation, and deterministic flight/hotel attachment
 * without duplicating logic.
 */

import type {
  StrategyAwardOption,
  StrategyCardOffer,
  StrategyFeasibility,
  StrategySource,
  PersonalizedStrategyNarrative,
} from "./strategyTypes";

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
  "followUpQuestions": string[]
}

Rules:
- Personalize the plan using the supplied goal, balances, cards, and spending.
- Compare the supplied award options and card offers against each other.
- Never invent award availability, prices, transfer ratios, balances, cards,
  offers, deadlines, or sources.
- Named award recommendations may only reference supplied awardOptions.
- Named card recommendations may only reference supplied cardOffers.
- When required information is missing, return "insufficient_information" and
  ask focused follow-up questions.
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
    if (!context.sources.some((s) => s.id === sourceId)) {
      throw new StrategyProviderError(
        `Action source ID "${sourceId}" is not present in context.sources.`,
        provider,
        model
      );
    }
  }

  return {
    priority: priorityRaw,
    title,
    explanation,
    deadline,
    sourceIds,
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
    if (!context.sources.some((s) => s.id === sourceId)) {
      throw new StrategyProviderError(
        `Alternative source ID "${sourceId}" is not present in context.sources.`,
        provider,
        model
      );
    }
  }

  return {
    title,
    tradeoff,
    sourceIds,
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

  const headline = requireString(root.headline, "headline", provider, model);
  const summary = requireString(root.summary, "summary", provider, model);

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

  const pointsGap = optionalFiniteNumber(root.pointsGap, provider, model);

  if (pointsGap !== null && pointsGap < 0) {
    throw new StrategyProviderError(
      `Model output has negative pointsGap "${pointsGap}".`,
      provider,
      model
    );
  }

  const recommendedAwardOptionIdRaw =
    root.recommendedAwardOptionId === undefined
      ? null
      : root.recommendedAwardOptionId;

  const recommendedAwardOptionId =
    recommendedAwardOptionIdRaw === null
      ? null
      : requireString(
          recommendedAwardOptionIdRaw,
          "recommendedAwardOptionId",
          provider,
          model
        );

  if (recommendedAwardOptionId !== null) {
    if (
      !context.awardOptions.some(
        (option: StrategyAwardOption) =>
          option.id === recommendedAwardOptionId
      )
    ) {
      throw new StrategyProviderError(
        `Model recommended award option "${recommendedAwardOptionId}" is not present in context.awardOptions.`,
        provider,
        model
      );
    }
  }

  const recommendedCardOfferIdRaw =
    root.recommendedCardOfferId === undefined
      ? null
      : root.recommendedCardOfferId;

  const recommendedCardOfferId =
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
      throw new StrategyProviderError(
        "Model recommended a new card but goal.allowNewCards is false.",
        provider,
        model
      );
    }

    if (
      !context.cardOffers.some(
        (offer: StrategyCardOffer) =>
          offer.id === recommendedCardOfferId
      )
    ) {
      throw new StrategyProviderError(
        `Model recommended card offer "${recommendedCardOfferId}" is not present in context.cardOffers.`,
        provider,
        model
      );
    }
  }

  const assumptions = requireStringArrayField(
    root,
    "assumptions",
    provider,
    model
  );

  const warnings = requireStringArrayField(root, "warnings", provider, model);

  const followUpQuestions = requireStringArrayField(
    root,
    "followUpQuestions",
    provider,
    model
  );

  const rawActions = root.actions;

  if (!Array.isArray(rawActions)) {
    throw new StrategyProviderError(
      'Model output missing required array field "actions".',
      provider,
      model
    );
  }

  const actions = rawActions.map(
    (rawAction) => validateAction(rawAction, context, provider, model)
  );

  const rawAlternatives = root.alternatives;

  if (!Array.isArray(rawAlternatives)) {
    throw new StrategyProviderError(
      'Model output missing required array field "alternatives".',
      provider,
      model
    );
  }

  const alternatives = rawAlternatives.map(
    (rawAlternative) =>
      validateAlternative(rawAlternative, context, provider, model)
  );

  // flightOptions and hotelOptions are server-attached validated research
  // facts. They are attached deterministically from context.awardOptions and
  // are never generated by the strategy model: any model-supplied
  // flightOptions/hotelOptions fields are ignored entirely. This guarantees
  // the model cannot invent an option, remove a validated option, or alter
  // its price, source, program, type, or pricing basis.
  const flightOptions = deduplicateByOptionId(
    context.awardOptions.filter((option) => option.redemptionType === "flight")
  );
  const hotelOptions = deduplicateByOptionId(
    context.awardOptions.filter((option) => option.redemptionType === "hotel")
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