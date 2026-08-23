import type {
  PersonalizedStrategyContext,
  PersonalizedStrategyNarrative,
  StrategyAwardOption,
  StrategyCardOffer,
  StrategyFeasibility,
  StrategyProvider,
} from "./strategyTypes";

const DEFAULT_TIMEOUT_MS = 120_000;
const DIAGNOSTIC_SNIPPET_LENGTH = 300;

const FEASIBILITY_VALUES: StrategyFeasibility[] = [
  "on_track",
  "gap_remaining",
  "depends_on_new_card",
  "insufficient_information",
];

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

const STRATEGY_PROMPT = `You are a personalized credit-card points strategy planner.

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

function parseModelResponse(
  raw: string,
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

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function optionalFiniteNumber(value: unknown): number | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (!isFiniteNumber(value)) {
    throw new StrategyProviderError(
      "Model output contained a non-finite numeric value.",
      "ollama",
      "unknown",
      undefined,
      `Expected finite number or null, received: ${String(value)}`
    );
  }

  return value;
}

function requireString(
  value: unknown,
  field: string,
  model: string
): string {
  if (typeof value !== "string") {
    throw new StrategyProviderError(
      `Model output missing required string field "${field}".`,
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
    throw new StrategyProviderError(
      `Model output missing required array field "${field}".`,
      "ollama",
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
        "ollama",
        model
      );
    }

    strings.push(item);
  }

  return strings;
}

function requireStringArrayField(
  source: Record<string, unknown>,
  field: string,
  model: string
): string[] {
  if (!(field in source) || source[field] === undefined) {
    throw new StrategyProviderError(
      `Model output missing required array field "${field}".`,
      "ollama",
      model
    );
  }

  return requireStringArray(source[field], field, model);
}

function requireObject(
  value: unknown,
  field: string,
  model: string
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new StrategyProviderError(
      `Model output missing required object field "${field}".`,
      "ollama",
      model,
      undefined,
      `Field "${field}" received: ${String(value)}`
    );
  }

  return value as Record<string, unknown>;
}

function deduplicateByOptionId(
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

function validateAction(
  raw: unknown,
  context: PersonalizedStrategyContext,
  model: string
): {
  priority: number;
  title: string;
  explanation: string;
  deadline: string | null;
  sourceIds: string[];
} {
  const source = requireObject(raw, "actions[]", model);

  const priorityRaw = source.priority;

  if (!isFiniteNumber(priorityRaw)) {
    throw new StrategyProviderError(
      'Model output action "priority" must be a finite number.',
      "ollama",
      model
    );
  }

  const title = requireString(source.title, "actions[].title", model);
  const explanation = requireString(
    source.explanation,
    "actions[].explanation",
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
          model
        );

  const sourceIds = requireStringArrayField(
    source,
    "sourceIds",
    model
  );

  for (const sourceId of sourceIds) {
    if (!context.sources.some((s) => s.id === sourceId)) {
      throw new StrategyProviderError(
        `Action source ID "${sourceId}" is not present in context.sources.`,
        "ollama",
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

function validateAlternative(
  raw: unknown,
  context: PersonalizedStrategyContext,
  model: string
): {
  title: string;
  tradeoff: string;
  sourceIds: string[];
} {
  const source = requireObject(raw, "alternatives[]", model);

  const title = requireString(
    source.title,
    "alternatives[].title",
    model
  );

  const tradeoff = requireString(
    source.tradeoff,
    "alternatives[].tradeoff",
    model
  );

  const sourceIds = requireStringArrayField(
    source,
    "sourceIds",
    model
  );

  for (const sourceId of sourceIds) {
    if (!context.sources.some((s) => s.id === sourceId)) {
      throw new StrategyProviderError(
        `Alternative source ID "${sourceId}" is not present in context.sources.`,
        "ollama",
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

function validateStrategyOutput(
  parsed: unknown,
  context: PersonalizedStrategyContext,
  model: string
): PersonalizedStrategyNarrative {
  const root = requireObject(parsed, "strategy", model);

  const headline = requireString(root.headline, "headline", model);
  const summary = requireString(root.summary, "summary", model);

  const feasibility = requireString(
    root.feasibility,
    "feasibility",
    model
  ) as StrategyFeasibility;

  if (!FEASIBILITY_VALUES.includes(feasibility)) {
    throw new StrategyProviderError(
      `Model output has invalid feasibility "${feasibility}".`,
      "ollama",
      model
    );
  }

  const pointsGap = optionalFiniteNumber(root.pointsGap);

  if (pointsGap !== null && pointsGap < 0) {
    throw new StrategyProviderError(
      `Model output has negative pointsGap "${pointsGap}".`,
      "ollama",
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
        "ollama",
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
          model
        );

  if (recommendedCardOfferId !== null) {
    if (!context.goal.allowNewCards) {
      throw new StrategyProviderError(
        "Model recommended a new card but goal.allowNewCards is false.",
        "ollama",
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
        "ollama",
        model
      );
    }
  }

  const assumptions = requireStringArrayField(
    root,
    "assumptions",
    model
  );

  const warnings = requireStringArrayField(root, "warnings", model);

  const followUpQuestions = requireStringArrayField(
    root,
    "followUpQuestions",
    model
  );

  const rawActions = root.actions;

  if (!Array.isArray(rawActions)) {
    throw new StrategyProviderError(
      'Model output missing required array field "actions".',
      "ollama",
      model
    );
  }

  const actions = rawActions.map(
    (rawAction) => validateAction(rawAction, context, model)
  );

  const rawAlternatives = root.alternatives;

  if (!Array.isArray(rawAlternatives)) {
    throw new StrategyProviderError(
      'Model output missing required array field "alternatives".',
      "ollama",
      model
    );
  }

  const alternatives = rawAlternatives.map(
    (rawAlternative) =>
      validateAlternative(rawAlternative, context, model)
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

export class OllamaStrategyProvider implements StrategyProvider {
  private readonly baseUrl: string;
  private readonly model: string;

  constructor(baseUrl?: string, model?: string) {
    if (
      typeof process === "undefined" ||
      !process.env
    ) {
      throw new StrategyProviderError(
        "Ollama strategy provider can only run in a server environment.",
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
      throw new StrategyProviderError(
        "OLLAMA_BASE_URL environment variable is required.",
        "ollama",
        this.model || "unknown"
      );
    }

    if (!this.model) {
      throw new StrategyProviderError(
        "OLLAMA_STRATEGY_MODEL environment variable is required.",
        "ollama",
        "unknown"
      );
    }
  }

  async generateStrategy(
    context: PersonalizedStrategyContext
  ): Promise<PersonalizedStrategyNarrative> {
    const controller = new AbortController();

    const timeoutId = setTimeout(
      () => controller.abort(),
      DEFAULT_TIMEOUT_MS
    );

    let response: Response;

    try {
      response = await fetch(
        `${this.baseUrl}/api/chat`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          signal: controller.signal,
          body: JSON.stringify({
            model: this.model,

            messages: [
              {
                role: "system",
                content: STRATEGY_PROMPT,
              },
              {
                role: "user",
                content: JSON.stringify(context),
              },
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
        }
      );
    } catch (error) {
      if (controller.signal.aborted) {
        throw new StrategyProviderError(
          `Ollama strategy request timed out after ${DEFAULT_TIMEOUT_MS}ms.`,
          "ollama",
          this.model
        );
      }

      throw new StrategyProviderError(
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
      throw new StrategyProviderError(
        `Ollama returned HTTP ${response.status}.`,
        "ollama",
        this.model,
        response.status
      );
    }

    let payload: {
      message?: {
        content?: unknown;
      };
    };

    try {
      payload = await response.json();
    } catch {
      throw new StrategyProviderError(
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
      throw new StrategyProviderError(
        "Ollama response was missing the model text output.",
        "ollama",
        this.model,
        response.status
      );
    }

    const parsed = parseModelResponse(rawText, this.model);

    return validateStrategyOutput(parsed, context, this.model);
  }
}