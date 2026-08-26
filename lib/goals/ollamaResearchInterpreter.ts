import {
  ResearchInterpreterError,
  type InterpretedResearch,
  type ResearchRewardProgram,
  type ResearchFocus,
  type InterpretResearchInput,
  type ResearchInterpreter,
} from "./researchInterpreter";
import {
  buildResearchSystemPrompt,
  getResearchFocusInstruction,
} from "./researchInterpreterPrompt";
import { buildResearchSources } from "./researchInterpreterValidationHelpers";
import { validateResearchModelContent } from "./researchInterpreterValidation";

export {
  ResearchInterpreterError,
  type InterpretedResearch,
  type ResearchRewardProgram,
  type ResearchFocus,
  type InterpretResearchInput,
} from "./researchInterpreter";
export {
  buildPublicResearchPayload,
  buildResearchSystemPrompt,
} from "./researchInterpreterPrompt";
export { validateResearchModelContent } from "./researchInterpreterValidation";

const DEFAULT_TIMEOUT_MS = 120_000;

export class OllamaResearchInterpreter implements ResearchInterpreter {
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
    const entries = buildResearchSources(input.research);

    const context = {
      goal: input.goal,
      rewardPrograms: input.rewardPrograms,
      focus: input.focus,
      sources: entries.map((e) => ({
        id: e.source.id,
        label: e.result.title,
        url: e.result.url,
        content: e.result.content,
      })),
    };

    if (process.env.STRATEGY_DEBUG === "1") {
      const totalResultCount = input.research.reduce(
        (sum, response) => sum + response.results.length,
        0
      );
      const resultDetails = input.research.flatMap((response) =>
        response.results.map((result) => ({
          title: result.title,
          url: result.url,
          contentLength: result.content.length,
        }))
      );
      console.info(
        `[strategy-research-input-debug:${input.focus}]`,
        JSON.stringify({
          focus: input.focus,
          researchResponseCount: input.research.length,
          totalResultCount,
          results: resultDetails,
        })
      );
    }

    const raw = await this.callOllama(context, input.focus);

    return validateResearchModelContent(raw, input, this.model);
  }

  private async callOllama(context: unknown, focus: ResearchFocus): Promise<string> {
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
            { role: "system", content: buildResearchSystemPrompt(focus) },
            { role: "user", content: `${JSON.stringify(context)}\n${getResearchFocusInstruction(focus)}` },
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
