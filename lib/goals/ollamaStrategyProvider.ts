import type {
  PersonalizedStrategyNarrative,
  SanitizedStrategyPrompt,
  StrategyProvider,
} from "./strategyTypes";
import {
  StrategyProviderError,
  STRATEGY_PROMPT,
  unavailableFollowUpTopics,
  parseModelResponse,
  validateStrategyOutput,
  type StrategyValidationContext,
} from "./strategyProviderCore";

const DEFAULT_TIMEOUT_MS = 120_000;

export { StrategyProviderError };

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
    prompt: SanitizedStrategyPrompt
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
                content: JSON.stringify(prompt),
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

    const parsed = parseModelResponse(rawText, "ollama", this.model);

      const validationContext: StrategyValidationContext = {
      awardOptions: prompt.awardOptions,
      cardOffers: prompt.cardOffers,
      sources: prompt.sources,
        goal: { allowNewCards: prompt.goal.allowNewCards },
        referenceMap: prompt.referenceMap,
        unavailableFollowUpTopics: unavailableFollowUpTopics(prompt),
      };

    return validateStrategyOutput(
      parsed,
      validationContext,
      "ollama",
      this.model
    );
  }
}
