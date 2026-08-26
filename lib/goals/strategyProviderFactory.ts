/**
 * Strategy provider factory.
 *
 * Selects the appropriate StrategyProvider based on environment
 * configuration and places a deterministic fallback behind it. When
 * OPENROUTER_API_KEY is set, the OpenRouter cloud provider is used (with
 * sanitized prompts). Otherwise, the local Ollama provider is used.
 */

import type { StrategyProvider } from "./strategyTypes";
import {
  DeterministicStrategyProvider,
  StrategyProviderWithFallback,
} from "./deterministicStrategyProvider";
import { OllamaStrategyProvider } from "./ollamaStrategyProvider";
import { OpenRouterStrategyProvider } from "./openRouterStrategyProvider";
import { StrategyProviderError } from "./strategyProviderCore";

/**
 * Creates the configured strategy provider.
 *
 * Priority:
 * 1. If OPENROUTER_API_KEY is set → OpenRouterStrategyProvider
 * 2. Otherwise → OllamaStrategyProvider (local)
 * 3. If provider construction or generation raises StrategyProviderError →
 *    deterministic degraded narrative
 */
export function createStrategyProvider(): StrategyProvider {
  try {
    const configured = (process.env.STRATEGY_RESEARCH_PROVIDER ?? "").trim().toLowerCase();
    const useOpenRouter = configured === "openrouter" ||
      (configured === "" && Boolean(process.env.OPENROUTER_API_KEY));
    const primary = useOpenRouter
      ? new OpenRouterStrategyProvider()
      : new OllamaStrategyProvider();

    return new StrategyProviderWithFallback(primary);
  } catch (error) {
    if (!(error instanceof StrategyProviderError)) {
      throw error;
    }

    // Missing or invalid provider configuration is handled by the same
    // explicit degraded narrative as runtime provider failures.
    return new DeterministicStrategyProvider();
  }
}
