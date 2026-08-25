/**
 * AI-driven research planner — provider implementations and factory.
 *
 * Provider selection (createResearchPlanner):
 * - OPENROUTER_API_KEY set -> OpenRouterResearchPlanner (cloud)
 * - OPENROUTER_API_KEY unset -> FallbackResearchPlanner (deterministic
 *   template-based, wraps buildStrategyResearchQueries)
 *
 * Validation, prompt, and fallback building blocks live in
 * researchPlannerCore.ts.
 */

import type {
  ResearchPlan,
  ResearchPlanner,
  ResearchPlannerInput,
} from "./researchPlannerTypes";
import {
  ResearchPlannerError,
  RESEARCH_PLANNER_SYSTEM_PROMPT,
  buildFallbackResearchPlan,
  buildPublicPlannerPayload,
  extractJsonBlock,
  validateResearchPlan,
} from "./researchPlannerCore";

export {
  ResearchPlannerError,
  buildFallbackResearchPlan,
  validateResearchPlan,
} from "./researchPlannerCore";

const OPENROUTER_ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_TIMEOUT_MS = 60_000;

/**
 * Deterministic planner that never calls a model. Used when OpenRouter is
 * not configured.
 */
export class FallbackResearchPlanner implements ResearchPlanner {
  async generateResearchPlan(
    input: ResearchPlannerInput
  ): Promise<ResearchPlan> {
    return buildFallbackResearchPlan(input);
  }
}

export class OpenRouterResearchPlanner implements ResearchPlanner {
  private readonly apiKey: string;
  private readonly model: string;

  constructor() {
    if (typeof process === "undefined" || !process.env) {
      throw new ResearchPlannerError(
        "OpenRouter research planner can only run in a server environment.",
        "openrouter",
        "unknown"
      );
    }

    const apiKey = process.env.OPENROUTER_API_KEY?.trim() ?? "";
    if (!apiKey) {
      throw new ResearchPlannerError(
        "OPENROUTER_API_KEY environment variable is required.",
        "openrouter",
        "unknown"
      );
    }

    this.apiKey = apiKey;
    this.model =
      process.env.OPENROUTER_RESEARCH_MODEL?.trim() || "openrouter/free";
  }

  async generateResearchPlan(
    input: ResearchPlannerInput
  ): Promise<ResearchPlan> {
    const controller = new AbortController();
    const timeoutId = setTimeout(
      () => controller.abort(),
      DEFAULT_TIMEOUT_MS
    );

    let response: Response;
    try {
      response = await fetch(OPENROUTER_ENDPOINT, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        signal: controller.signal,
        body: JSON.stringify({
          model: this.model,
          temperature: 0,
          // Reasoning-capable free models can consume the shared token budget
          // on hidden reasoning; keep headroom above the expected answer size.
          max_tokens: 8192,
          messages: [
            {
              role: "system",
              content: RESEARCH_PLANNER_SYSTEM_PROMPT,
            },
            {
              role: "user",
              content: buildPublicPlannerPayload(input),
            },
          ],
        }),
      });
    } catch (error) {
      if (controller.signal.aborted) {
        throw new ResearchPlannerError(
          `OpenRouter research planner request timed out after ${DEFAULT_TIMEOUT_MS}ms.`,
          "openrouter",
          this.model
        );
      }
      throw new ResearchPlannerError(
        `Failed to reach the OpenRouter research planner. ${
          error instanceof Error ? error.message : String(error)
        }`,
        "openrouter",
        this.model
      );
    } finally {
      clearTimeout(timeoutId);
    }

    if (!response.ok) {
      throw new ResearchPlannerError(
        `OpenRouter research planner returned HTTP ${response.status}.`,
        "openrouter",
        this.model
      );
    }

    let payload: {
      choices?: { message?: { content?: unknown } }[];
    };
    try {
      payload = await response.json();
    } catch {
      throw new ResearchPlannerError(
        "OpenRouter research planner returned a non-JSON response.",
        "openrouter",
        this.model
      );
    }

    const content = payload.choices?.[0]?.message?.content;

    if (typeof content !== "string" || content.trim() === "") {
      throw new ResearchPlannerError(
        "OpenRouter research planner response was missing the model text output.",
        "openrouter",
        this.model
      );
    }

    if (process.env.STRATEGY_DEBUG === "1") {
      console.info(
        "[strategy-research-planner-raw]",
        JSON.stringify({ model: this.model, content })
      );
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(extractJsonBlock(content));
    } catch {
      throw new ResearchPlannerError(
        "OpenRouter research planner returned invalid JSON.",
        "openrouter",
        this.model
      );
    }

    return validateResearchPlan(parsed);
  }
}

/**
 * Creates the configured research planner.
 *
 * - OPENROUTER_API_KEY set -> OpenRouterResearchPlanner
 * - otherwise -> FallbackResearchPlanner (deterministic templates)
 *
 * This factory never throws for a missing key; callers that want explicit
 * provider selection should construct the classes directly.
 */
export function createResearchPlanner(): ResearchPlanner {
  const hasOpenRouterKey =
    (process.env.OPENROUTER_API_KEY ?? "").trim() !== "";

  if (hasOpenRouterKey) {
    return new OpenRouterResearchPlanner();
  }

  return new FallbackResearchPlanner();
}