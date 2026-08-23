/**
 * Strategy provider factory.
 *
 * Selects the appropriate StrategyProvider based on environment
 * configuration. When OPENROUTER_API_KEY is set, the OpenRouter cloud
 * provider is used (with sanitized prompts). Otherwise, the local Ollama
 * provider is used.
 */

import type { StrategyProvider } from "./strategyTypes";
import { OllamaStrategyProvider } from "./ollamaStrategyProvider";
import { OpenRouterStrategyProvider } from "./openRouterStrategyProvider";

/**
 * Creates the configured strategy provider.
 *
 * Priority:
 * 1. If OPENROUTER_API_KEY is set → OpenRouterStrategyProvider
 * 2. Otherwise → OllamaStrategyProvider (local)
 */
export function createStrategyProvider(): StrategyProvider {
  if (process.env.OPENROUTER_API_KEY) {
    return new OpenRouterStrategyProvider();
  }

  return new OllamaStrategyProvider();
}