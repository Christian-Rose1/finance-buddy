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
const MAX_TOTAL_ATTEMPTS = 2;
const DEFAULT_RATE_LIMIT_RETRY_DELAY_MS = 1_000;
const MAX_RATE_LIMIT_RETRY_DELAY_MS = 5_000;
const RETRYABLE_HTTP_STATUSES = new Set([429, 500, 502, 503, 504]);

function retryAfterDelayMs(retryAfter: string | null): number | null {
  if (!retryAfter) {
    return DEFAULT_RATE_LIMIT_RETRY_DELAY_MS;
  }

  const seconds = Number(retryAfter);
  if (Number.isFinite(seconds) && seconds >= 0) {
    const delayMs = Math.ceil(seconds * 1_000);
    return delayMs <= MAX_RATE_LIMIT_RETRY_DELAY_MS ? delayMs : null;
  }

  const dateMs = Date.parse(retryAfter);
  if (Number.isNaN(dateMs)) {
    return DEFAULT_RATE_LIMIT_RETRY_DELAY_MS;
  }

  const delayMs = Math.max(0, dateMs - Date.now());
  return delayMs <= MAX_RATE_LIMIT_RETRY_DELAY_MS ? delayMs : null;
}

function waitForRetry(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

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
    // Serialize once so every bounded retry sends exactly the same sanitized
    // request. The full personalized context is never accepted here.
    const requestBody = JSON.stringify({
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
    });

    for (let attempt = 1; attempt <= MAX_TOTAL_ATTEMPTS; attempt += 1) {
      const controller = new AbortController();
      const timeoutId = setTimeout(
        () => controller.abort(),
        DEFAULT_TIMEOUT_MS
      );
      let response: Response | null = null;
      let networkFailure = false;

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
            body: requestBody,
          }
        );
      } catch {
        if (controller.signal.aborted) {
          throw new StrategyProviderError(
            `OpenRouter strategy request timed out after ${DEFAULT_TIMEOUT_MS}ms.`,
            "openrouter",
            this.model
          );
        }

        networkFailure = true;
      } finally {
        clearTimeout(timeoutId);
      }

      if (networkFailure) {
        if (attempt < MAX_TOTAL_ATTEMPTS) {
          await waitForRetry(DEFAULT_RATE_LIMIT_RETRY_DELAY_MS);
          continue;
        }

        throw new StrategyProviderError(
          "Failed to reach OpenRouter.",
          "openrouter",
          this.model
        );
      }

      if (!response) {
        throw new StrategyProviderError(
          "OpenRouter strategy request did not return a response.",
          "openrouter",
          this.model
        );
      }

      if (!response.ok) {
        if (
          RETRYABLE_HTTP_STATUSES.has(response.status) &&
          attempt < MAX_TOTAL_ATTEMPTS
        ) {
          const delayMs = retryAfterDelayMs(
            response.headers.get("Retry-After")
          );
          if (delayMs !== null) {
            await waitForRetry(delayMs);
            continue;
          }
        }

        throw new StrategyProviderError(
          `OpenRouter returned HTTP ${response.status}.`,
          "openrouter",
          this.model,
          response.status
        );
      }

      let parsed: unknown;
      try {
        const rawBody = await response.text();
        const payload: {
          choices?: Array<{
            message?: { content?: unknown };
          }>;
        } = JSON.parse(rawBody);
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

        parsed = parseModelResponse(rawText, "openrouter", this.model);
      } catch {
        const outputError = new StrategyProviderError(
          "OpenRouter returned an invalid model response.",
          "openrouter",
          this.model,
          response.status
        );

        // A malformed model response is transient on free-model infrastructure.
        // Retry once, without logging the response body or model output.
        if (attempt < MAX_TOTAL_ATTEMPTS) {
          await waitForRetry(DEFAULT_RATE_LIMIT_RETRY_DELAY_MS);
          continue;
        }

        throw outputError;
      }

      const validationContext: StrategyValidationContext = {
        awardOptions: prompt.awardOptions,
        cardOffers: prompt.cardOffers,
        sources: prompt.sources,
        goal: { allowNewCards: prompt.goal.allowNewCards },
      };

      // Shared validation failures are not transport/provider transients.
      // Do not retry a completed response that violates the strategy contract.
      try {
        return validateStrategyOutput(
          parsed,
          validationContext,
          "openrouter",
          this.model
        );
      } catch {
        throw new StrategyProviderError(
          "OpenRouter returned an invalid strategy output.",
          "openrouter",
          this.model,
          response.status
        );
      }
    }

    throw new StrategyProviderError(
      "OpenRouter strategy request did not return a response.",
      "openrouter",
      this.model
    );
  }
}
