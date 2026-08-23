import {
  ResearchInterpreterError,
  RESEARCH_OUTPUT_JSON_SCHEMA,
  type InterpretedResearch,
  type InterpretResearchInput,
  type ResearchInterpreter,
} from "./researchInterpreter";
import {
  buildResearchSystemPrompt,
  buildPublicResearchPayload,
  validateResearchModelContent,
} from "./ollamaResearchInterpreter";

const OPENROUTER_ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_MODEL = "openrouter/free";

export class OpenRouterResearchInterpreter implements ResearchInterpreter {
  private readonly apiKey: string;
  private readonly model: string;

  constructor() {
    if (typeof process === "undefined" || !process.env) {
      throw new ResearchInterpreterError(
        "OpenRouter research interpreter can only run in a server environment.",
        "openrouter",
        DEFAULT_MODEL
      );
    }

    const apiKey = process.env.OPENROUTER_API_KEY?.trim() ?? "";
    if (!apiKey) {
      throw new ResearchInterpreterError(
        "OPENROUTER_API_KEY environment variable is required.",
        "openrouter",
        DEFAULT_MODEL
      );
    }

    this.apiKey = apiKey;
    this.model =
      process.env.OPENROUTER_RESEARCH_MODEL?.trim() || DEFAULT_MODEL;
  }

  async interpret(input: InterpretResearchInput): Promise<InterpretedResearch> {
    const requestedModel = this.model;

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
          model: requestedModel,
          temperature: 0,
          messages: [
            {
              role: "system",
              content: buildResearchSystemPrompt(input.focus),
            },
            {
              role: "user",
              content: buildPublicResearchPayload(input),
            },
          ],
          response_format: {
            type: "json_schema",
            json_schema: {
              name: "finance_buddy_research",
              strict: true,
              schema: RESEARCH_OUTPUT_JSON_SCHEMA,
            },
          },
          provider: {
            require_parameters: true,
          },
        }),
      });
    } catch (error) {
      if (controller.signal.aborted) {
        throw new ResearchInterpreterError(
          `OpenRouter research interpreter request timed out after ${DEFAULT_TIMEOUT_MS}ms.`,
          "openrouter",
          requestedModel
        );
      }
      throw new ResearchInterpreterError(
        "Failed to reach the OpenRouter research interpreter.",
        "openrouter",
        requestedModel
      );
    } finally {
      clearTimeout(timeoutId);
    }

    if (!response.ok) {
      throw new ResearchInterpreterError(
        `OpenRouter research interpreter returned HTTP ${response.status}.`,
        "openrouter",
        requestedModel,
        response.status
      );
    }

    let payload: {
      model?: unknown;
      choices?: { message?: { content?: unknown } }[];
    };
    try {
      payload = await response.json();
    } catch {
      throw new ResearchInterpreterError(
        "OpenRouter research interpreter returned a non-JSON response.",
        "openrouter",
        requestedModel,
        response.status
      );
    }

    const content = payload.choices?.[0]?.message?.content;

    if (typeof content !== "string" || content.trim() === "") {
      throw new ResearchInterpreterError(
        "OpenRouter response was missing the model text output.",
        "openrouter",
        requestedModel,
        response.status
      );
    }

    const responseModel =
      typeof payload.model === "string" && payload.model.trim() !== ""
        ? payload.model
        : requestedModel;

    if (process.env.STRATEGY_DEBUG === "1") {
      console.info(
        `[strategy-research-provider-debug]`,
        JSON.stringify({
          provider: "openrouter",
          requestedModel,
          responseModel,
        })
      );
    }

    return validateResearchModelContent(content, input, responseModel);
  }
}