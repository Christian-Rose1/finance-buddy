/**
 * OpenRouter strategy provider.
 *
 * Sends a sanitized strategy prompt to OpenRouter's chat completions API
 * and validates the response using the shared provider core.
 *
 * Only the sanitized SanitizedStrategyPrompt is sent — never the full
 * PersonalizedStrategyContext with internal IDs, userId, ownerKey, etc.
 */

import type {
  PersonalizedStrategyNarrative,
  SanitizedStrategyPrompt,
  StrategyProvider,
} from "./strategyTypes";
import {
  StrategyProviderError,
  STRATEGY_PROMPT,
  parseModelResponse,
  validateStrategyOutput,
  type StrategyValidationContext,
} from "./strategyProviderCore";

const DEFAULT_TIMEOUT_MS = 120_000;

export { StrategyProviderError };

export class OpenRouterStrategyProvider implements StrategyProvider {
  private readonly apiKey: string;
  private readonly model: string;

  constructor(apiKey?: string, model?: string) {
    if (
      typeof process === "undefined" ||
      !process.env
    ) {
      throw new StrategyProviderError(
        "OpenRouter strategy provider can only run in a server environment.",
        "openrouter",
        model ?? "unknown"
      );
    }

    this.apiKey = (apiKey ?? process.env.OPENROUTER_API_KEY ?? "").trim();

    this.model =
      model ??
      process.env.OPENROUTER_STRATEGY_MODEL ??
      "";

    if (!this.apiKey) {
      throw new StrategyProviderError(
        "OPENROUTER_API_KEY environment variable is required.",
        "openrouter",
        this.model || "unknown"
      );
    }

    if (!this.model) {
      throw new StrategyProviderError(
        "OPENROUTER_STRATEGY_MODEL environment variable is required.",
        "openrouter",
        "unknown"
      );
    }
  }

  /**
   * Generate a strategy narrative from a sanitized prompt.
   *
   * The prompt must already be sanitized via buildSanitizedStrategyPayload
   * before calling this method. The full PersonalizedStrategyContext is
   * never accepted or sent.
   */
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
        "https://openrouter.ai/api/v1/chat/completions",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.apiKey}`,
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
            temperature: 0,
            max_tokens: 8192,
          }),
        }
      );
    } catch (error) {
      if (controller.signal.aborted) {
        throw new StrategyProviderError(
          `OpenRouter strategy request timed out after ${DEFAULT_TIMEOUT_MS}ms.`,
          "openrouter",
          this.model
        );
      }

      throw new StrategyProviderError(
        `Failed to reach OpenRouter. ${
          error instanceof Error ? error.message : String(error)
        }`,
        "openrouter",
        this.model
      );
    } finally {
      clearTimeout(timeoutId);
    }

    if (!response.ok) {
      throw new StrategyProviderError(
        `OpenRouter returned HTTP ${response.status}.`,
        "openrouter",
        this.model,
        response.status
      );
    }

    let payload: {
      choices?: Array<{
        message?: {
          content?: unknown;
        };
        finish_reason?: unknown;
      }>;
    };

    let rawBody = "";

    try {
      rawBody = await response.text();
      payload = JSON.parse(rawBody);
    } catch {
      if (process.env.STRATEGY_DEBUG === "1") {
        console.log(
          "[strategy-raw-response-error]",
          JSON.stringify({
            provider: "openrouter",
            model: this.model,
            status: response.status,
            rawBody,
          })
        );
      }

      throw new StrategyProviderError(
        "OpenRouter returned a non-JSON response.",
        "openrouter",
        this.model,
        response.status
      );
    }

    if (process.env.STRATEGY_DEBUG === "1") {
      console.log(
        "[strategy-raw-response]",
        JSON.stringify({
          provider: "openrouter",
          model: this.model,
          status: response.status,
          finishReason: payload.choices?.[0]?.finish_reason,
          body: payload,
        })
      );
    }

    const rawText =
      typeof payload.choices?.[0]?.message?.content === "string"
        ? payload.choices[0].message.content.trim()
        : "";

    if (!rawText) {
      throw new StrategyProviderError(
        "OpenRouter response was missing the model text output.",
        "openrouter",
        this.model,
        response.status
      );
    }

    const parsed = parseModelResponse(rawText, "openrouter", this.model);

    // Build a validation context from the sanitized prompt (which already
    // contains awardOptions, cardOffers, sources, and goal.allowNewCards).
    const validationContext: StrategyValidationContext = {
      awardOptions: prompt.awardOptions,
      cardOffers: prompt.cardOffers,
      sources: prompt.sources,
      goal: { allowNewCards: prompt.goal.allowNewCards },
    };

    return validateStrategyOutput(
      parsed,
      validationContext,
      "openrouter",
      this.model
    );
  }
}