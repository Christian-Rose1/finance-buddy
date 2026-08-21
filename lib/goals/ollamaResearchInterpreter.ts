import type { Goal } from "./types";
import type { ResearchResponse, ResearchResult } from "./researchTypes";
import type {
  StrategyAwardOption,
  StrategyCardOffer,
  StrategySource,
  StrategyDataStatus,
} from "./strategyTypes";

const DEFAULT_TIMEOUT_MS = 120_000;
const DIAGNOSTIC_SNIPPET_LENGTH = 300;

export class ResearchInterpreterError extends Error {
  constructor(
    message: string,
    readonly provider: string,
    readonly model: string,
    readonly status?: number,
    readonly details?: string
  ) {
    super(message);
    this.name = "ResearchInterpreterError";
  }
}

export interface InterpretedResearch {
  awardOptions: StrategyAwardOption[];
  cardOffers: StrategyCardOffer[];
  sources: StrategySource[];
  assumptions: string[];
  warnings: string[];
}

export interface InterpretResearchInput {
  goal: Goal;
  rewardPrograms: string[];
  research: ResearchResponse[];
}

interface SourceEntry {
  source: StrategySource;
  result: ResearchResult;
}

interface ValidationContext {
  goal: Goal;
  rewardPrograms: string[];
  sourceMap: Map<string, SourceEntry>;
  model: string;
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

const INTERPRET_PROMPT = `You are a strict research interpreter. You convert supplied
web research results into structured award-planning facts.

You will be given:
- A travel goal.
- A list of reward-program names/IDs the user has access to.
- A list of research sources, each with an id, label, and content.

Your job is to extract ONLY facts that are explicitly supported by the supplied
research content. You must never invent, infer, or guess.

Return ONLY valid JSON matching this exact contract:

{
  "awardOptions": [
    {
      "id": string,
      "sourceId": string,
      "programName": string,
      "itineraryLabel": string,
      "pointsRequired": number,
      "cashFees": number,
      "seats": number,
      "cabin": string,
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
- Every numeric value (pointsRequired, cashFees, seats, welcomeBonusPoints,
  spendingRequirement, spendingDeadlineMonths, annualFee, transferRatio,
  centsPerPoint) MUST appear verbatim in the cited source content. Do not
  compute, round, or estimate numbers.
- programName and transferFromProgramId MUST come from the supplied
  reward-program list.
- Do not invent availability, award space, points prices, taxes, fees, transfer
  ratios, welcome bonuses, annual fees, URLs, dates, or program IDs.
- Set availabilityStatus to "available" ONLY if a source explicitly reports
  current bookable inventory for the requested route/date. Public award charts,
  examples, or search snippets are catalog information, not live availability.
- Preserve ranges when sources provide ranges; do not convert them into false
  exact values.
- Conflicting or incomplete claims become warnings, not silently selected facts.
- Unknown values must be null or cause the candidate to be omitted.
- If no award options or card offers can be supported, return empty arrays.
- Do not explain anything. Output JSON only.`;

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

function assertNumberSupported(
  value: unknown,
  field: string,
  sourceContent: string,
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
  const tokens = sourceContent.match(/\d+(?:[\d,.]*\d)?/g) || [];
  const matched = tokens.some((token) => {
    const normalizedToken = token.replace(/,/g, "");
    return Number(normalizedToken) === value;
  });
  if (!matched) {
    throw new ResearchInterpreterError(
      `Model output field "${field}" value "${value}" is not supported by the cited source content.`,
      "ollama",
      model
    );
  }
  return value;
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
  return assertNumberSupported(value, field, sourceContent, model);
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

function validateAwardOption(
  raw: unknown,
  ctx: ValidationContext
): StrategyAwardOption {
  const obj = requireObject(raw, "awardOptions[]", ctx.model);

  const id = requireString(obj.id, "awardOptions[].id", ctx.model);
  const sourceId = requireString(obj.sourceId, "awardOptions[].sourceId", ctx.model);
  const programName = requireString(obj.programName, "awardOptions[].programName", ctx.model);

  const sourceEntry = ctx.sourceMap.get(sourceId);
  if (!sourceEntry) {
    throw new ResearchInterpreterError(
      `Award option "${id}" references unknown source "${sourceId}".`,
      "ollama",
      ctx.model
    );
  }
  const sourceContent = sourceEntry.result.content;

  if (!ctx.rewardPrograms.includes(programName)) {
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
  const cashFees = assertNumberSupported(
    obj.cashFees,
    "awardOptions[].cashFees",
    sourceContent,
    ctx.model
  );
  const seats = assertNumberSupported(
    obj.seats,
    "awardOptions[].seats",
    sourceContent,
    ctx.model
  );

  const cabin = requireString(obj.cabin, "awardOptions[].cabin", ctx.model);

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
    !ctx.rewardPrograms.includes(transferFromProgramId)
  ) {
    throw new ResearchInterpreterError(
      `Award option "${id}" references transfer program "${transferFromProgramId}" which was not supplied.`,
      "ollama",
      ctx.model
    );
  }

  const transferRatio =
    obj.transferRatio === null || obj.transferRatio === undefined
      ? null
      : assertNumberSupported(
          obj.transferRatio,
          "awardOptions[].transferRatio",
          sourceContent,
          ctx.model
        );

  const centsPerPoint =
    obj.centsPerPoint === null || obj.centsPerPoint === undefined
      ? null
      : assertNumberSupported(
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

  return {
    id,
    sourceId,
    programName,
    itineraryLabel: requireString(
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
  const sourceId = requireString(obj.sourceId, "cardOffers[].sourceId", ctx.model);

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
    !ctx.rewardPrograms.includes(destinationProgramId)
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

  return {
    awardOptions,
    cardOffers,
    sources: Array.from(ctx.sourceMap.values()).map((e) => e.source),
    assumptions,
    warnings,
  };
}

export class OllamaResearchInterpreter {
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
    const sourceMap = new Map(entries.map((e) => [e.source.id, e]));

    const context = {
      goal: input.goal,
      rewardPrograms: input.rewardPrograms,
      sources: entries.map((e) => ({
        id: e.source.id,
        label: e.result.title,
        url: e.result.url,
        content: e.result.content,
      })),
    };

    const raw = await this.callOllama(context);

    const parsed = parseModelResponse(raw, this.model);

    const validationContext: ValidationContext = {
      goal: input.goal,
      rewardPrograms: input.rewardPrograms,
      sourceMap,
      model: this.model,
    };

    return validateInterpretedOutput(parsed, validationContext);
  }

  private async callOllama(context: unknown): Promise<string> {
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
            { role: "system", content: INTERPRET_PROMPT },
            { role: "user", content: JSON.stringify(context) },
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
