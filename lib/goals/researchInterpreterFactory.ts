import { type ResearchInterpreter } from "./researchInterpreter";
import { OllamaResearchInterpreter } from "./ollamaResearchInterpreter";
import { OpenRouterResearchInterpreter } from "./openRouterResearchInterpreter";

export function createResearchInterpreter(): ResearchInterpreter {
  const provider = (
    process.env.STRATEGY_RESEARCH_PROVIDER ?? ""
  ).trim().toLowerCase();

  if (provider === "" || provider === "ollama") {
    return new OllamaResearchInterpreter();
  }

  if (provider === "openrouter") {
    return new OpenRouterResearchInterpreter();
  }

  throw new Error(`Unsupported research provider: ${provider}`);
}