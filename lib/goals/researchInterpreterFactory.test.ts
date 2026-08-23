import { test } from "node:test";
import assert from "node:assert/strict";

import {
  createResearchInterpreter,
} from "./researchInterpreterFactory";
import { OllamaResearchInterpreter } from "./ollamaResearchInterpreter";
import { OpenRouterResearchInterpreter } from "./openRouterResearchInterpreter";

const ORIGINAL_ENV = { ...process.env };

function restoreEnv(): void {
  process.env = { ...ORIGINAL_ENV };
}

function setOllamaEnv(): void {
  process.env.OLLAMA_BASE_URL = "http://localhost:11434";
  process.env.OLLAMA_STRATEGY_MODEL = "test-model";
}

test("missing STRATEGY_RESEARCH_PROVIDER selects Ollama", () => {
  restoreEnv();
  delete process.env.STRATEGY_RESEARCH_PROVIDER;
  setOllamaEnv();

  const interpreter = createResearchInterpreter();
  assert.ok(interpreter instanceof OllamaResearchInterpreter);
});

test("blank STRATEGY_RESEARCH_PROVIDER selects Ollama", () => {
  restoreEnv();
  process.env.STRATEGY_RESEARCH_PROVIDER = "   ";
  setOllamaEnv();

  const interpreter = createResearchInterpreter();
  assert.ok(interpreter instanceof OllamaResearchInterpreter);
});

test("ollama STRATEGY_RESEARCH_PROVIDER selects Ollama", () => {
  restoreEnv();
  process.env.STRATEGY_RESEARCH_PROVIDER = "ollama";
  setOllamaEnv();

  const interpreter = createResearchInterpreter();
  assert.ok(interpreter instanceof OllamaResearchInterpreter);
});

test("mixed-case whitespace OpenRouter selects OpenRouter", () => {
  restoreEnv();
  process.env.STRATEGY_RESEARCH_PROVIDER = " OpenRouter ";
  process.env.OPENROUTER_API_KEY = "test-key";

  const interpreter = createResearchInterpreter();
  assert.ok(interpreter instanceof OpenRouterResearchInterpreter);
});

test("unknown STRATEGY_RESEARCH_PROVIDER throws without calling a provider", () => {
  restoreEnv();
  process.env.STRATEGY_RESEARCH_PROVIDER = "unknown-provider";

  assert.throws(
    () => createResearchInterpreter(),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match((error as Error).message, /Unsupported research provider: unknown-provider/);
      return true;
    }
  );
});