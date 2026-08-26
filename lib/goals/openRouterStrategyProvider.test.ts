import assert from "node:assert/strict";
import { test } from "node:test";

import {
  OpenRouterStrategyProvider,
  StrategyProviderError,
} from "./openRouterStrategyProvider";
import type { SanitizedStrategyPrompt } from "./strategyTypes";

const REQUEST_TIMEOUT_MS = 120_000;
const DEFAULT_RETRY_DELAY_MS = 1_000;

const prompt: SanitizedStrategyPrompt = {
  goal: {
    type: "travel",
    title: "Paris trip",
    origin: ["DEN"],
    destinations: ["CDG"],
    earliestDeparture: null,
    latestReturn: null,
    minimumNights: null,
    maximumNights: null,
    travelerCount: 1,
    cabinPreference: "economy",
    optimizationPriority: "balanced",
    maximumCashBudget: null,
    currency: "USD",
    allowNewCards: false,
  },
  pointsInventory: [],
  walletCards: [],
  monthlySpendingByCategory: [],
  awardOptions: [],
  cardOffers: [],
  sources: [],
  generatedAt: "2026-08-25T00:00:00.000Z",
  brief: {
    goal: {
      type: "travel",
      title: "Paris trip",
      origin: ["DEN"],
      destinations: ["CDG"],
      earliestDeparture: null,
      latestReturn: null,
      minimumNights: null,
      maximumNights: null,
      travelerCount: 1,
      cabinPreference: "economy",
      optimizationPriority: "balanced",
      maximumCashBudget: null,
      currency: "USD",
      allowNewCards: false,
      resolvedTripNights: null,
    },
    pointsSummary: [],
    optionRequirements: [],
    allocationScenarios: [],
    sanitizationWarnings: [],
  },
  referenceMap: { awardOptions: [], cardOffers: [], sources: [], excludedSourceBoundRecords: false },
};

const validNarrative = {
  headline: "More information needed",
  summary: "No sourced redemption options are available yet.",
  feasibility: "insufficient_information",
  pointsGap: null,
  recommendedAwardOptionId: null,
  recommendedCardOfferId: null,
  actions: [],
  alternatives: [],
  assumptions: [],
  warnings: [],
  followUpQuestions: ["Which dates work best for your trip?"],
};

function validResponse(): Response {
  return new Response(
    JSON.stringify({
      choices: [{ message: { content: JSON.stringify(validNarrative) } }],
    }),
    { status: 200 }
  );
}

function installMockedRuntime(
  fetchImplementation: typeof fetch,
  options: { abortRequestTimeout?: boolean } = {}
) {
  const originalFetch = globalThis.fetch;
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  const delays: number[] = [];
  const callbacks = new Map<number, () => void>();
  let nextTimerId = 1;

  globalThis.fetch = fetchImplementation;
  globalThis.setTimeout = ((callback: () => void, delay?: number) => {
    const timerId = nextTimerId;
    nextTimerId += 1;
    const delayMs = Number(delay ?? 0);
    delays.push(delayMs);
    callbacks.set(timerId, callback);

    if (delayMs !== REQUEST_TIMEOUT_MS || options.abortRequestTimeout) {
      queueMicrotask(() => {
        const scheduledCallback = callbacks.get(timerId);
        if (!scheduledCallback) {
          return;
        }

        callbacks.delete(timerId);
        scheduledCallback();
      });
    }

    return timerId as unknown as ReturnType<typeof setTimeout>;
  }) as typeof setTimeout;
  globalThis.clearTimeout = ((timerId: ReturnType<typeof setTimeout>) => {
    callbacks.delete(Number(timerId));
  }) as typeof clearTimeout;

  return {
    delays,
    restore() {
      globalThis.fetch = originalFetch;
      globalThis.setTimeout = originalSetTimeout;
      globalThis.clearTimeout = originalClearTimeout;
    },
  };
}

test("retries HTTP 429 and preserves the exact sanitized request payload", async () => {
  let calls = 0;
  const requestBodies: string[] = [];
  const runtime = installMockedRuntime(
    (async (_input, init) => {
      calls += 1;
      requestBodies.push(String(init?.body));
      if (calls === 1) {
        return new Response(null, {
          status: 429,
          headers: { "Retry-After": "0" },
        });
      }

      return validResponse();
    }) as typeof fetch
  );

  try {
    const provider = new OpenRouterStrategyProvider("test-key", "test-model");
    const result = await provider.generateStrategy(prompt);

    assert.equal(calls, 2);
    assert.equal(result.headline, validNarrative.headline);
    assert.deepEqual(requestBodies, [requestBodies[0], requestBodies[0]]);
  } finally {
    runtime.restore();
  }
});

test("stops after the bounded number of HTTP 429 attempts", async () => {
  let calls = 0;
  const runtime = installMockedRuntime(
    (async () => {
      calls += 1;
      return new Response(null, {
        status: 429,
        headers: { "Retry-After": "0" },
      });
    }) as typeof fetch
  );

  try {
    const provider = new OpenRouterStrategyProvider("test-key", "test-model");

    await assert.rejects(
      () => provider.generateStrategy(prompt),
      /OpenRouter returned HTTP 429/
    );
    assert.equal(calls, 2);
  } finally {
    runtime.restore();
  }
});

test("honors a valid Retry-After delay before retrying", async () => {
  let calls = 0;
  const runtime = installMockedRuntime(
    (async () => {
      calls += 1;
      if (calls === 1) {
        return new Response(null, {
          status: 429,
          headers: { "Retry-After": "2" },
        });
      }

      return validResponse();
    }) as typeof fetch
  );

  try {
    const provider = new OpenRouterStrategyProvider("test-key", "test-model");
    await provider.generateStrategy(prompt);

    assert.equal(calls, 2);
    assert.ok(runtime.delays.includes(2_000));
  } finally {
    runtime.restore();
  }
});

test("honors a valid HTTP-date Retry-After delay before retrying", async () => {
  const now = Date.UTC(2026, 0, 1, 0, 0, 0);
  const originalDateNow = Date.now;
  let calls = 0;
  const runtime = installMockedRuntime(
    (async () => {
      calls += 1;
      if (calls === 1) {
        return new Response(null, {
          status: 429,
          headers: {
            "Retry-After": new Date(now + 2_000).toUTCString(),
          },
        });
      }

      return validResponse();
    }) as typeof fetch
  );

  Date.now = () => now;
  try {
    const provider = new OpenRouterStrategyProvider("test-key", "test-model");
    await provider.generateStrategy(prompt);

    assert.equal(calls, 2);
    assert.ok(runtime.delays.includes(2_000));
  } finally {
    Date.now = originalDateNow;
    runtime.restore();
  }
});

test("uses the bounded fallback delay for a malformed Retry-After value", async () => {
  let calls = 0;
  const runtime = installMockedRuntime(
    (async () => {
      calls += 1;
      if (calls === 1) {
        return new Response(null, {
          status: 429,
          headers: { "Retry-After": "not-a-delay" },
        });
      }

      return validResponse();
    }) as typeof fetch
  );

  try {
    const provider = new OpenRouterStrategyProvider("test-key", "test-model");
    await provider.generateStrategy(prompt);

    assert.equal(calls, 2);
    assert.ok(runtime.delays.includes(DEFAULT_RETRY_DELAY_MS));
  } finally {
    runtime.restore();
  }
});

test("does not retry when Retry-After exceeds the bounded delay cap", async () => {
  let calls = 0;
  const runtime = installMockedRuntime(
    (async () => {
      calls += 1;
      return new Response(null, {
        status: 429,
        headers: { "Retry-After": "60" },
      });
    }) as typeof fetch
  );

  try {
    const provider = new OpenRouterStrategyProvider("test-key", "test-model");

    await assert.rejects(
      () => provider.generateStrategy(prompt),
      /OpenRouter returned HTTP 429/
    );
    assert.equal(calls, 1);
  } finally {
    runtime.restore();
  }
});

test("retries a transient HTTP 503 response", async () => {
  let calls = 0;
  const runtime = installMockedRuntime(
    (async () => {
      calls += 1;
      return calls === 1 ? new Response(null, { status: 503 }) : validResponse();
    }) as typeof fetch
  );

  try {
    const provider = new OpenRouterStrategyProvider("test-key", "test-model");
    const result = await provider.generateStrategy(prompt);

    assert.equal(calls, 2);
    assert.equal(result.headline, validNarrative.headline);
    assert.ok(runtime.delays.includes(DEFAULT_RETRY_DELAY_MS));
  } finally {
    runtime.restore();
  }
});

test("does not retry permanent HTTP 4xx responses", async () => {
  let calls = 0;
  const runtime = installMockedRuntime(
    (async () => {
      calls += 1;
      return new Response(null, { status: 401 });
    }) as typeof fetch
  );

  try {
    const provider = new OpenRouterStrategyProvider("test-key", "test-model");

    await assert.rejects(
      () => provider.generateStrategy(prompt),
      /OpenRouter returned HTTP 401/
    );
    assert.equal(calls, 1);
  } finally {
    runtime.restore();
  }
});

test("retries a network failure without exposing its cause", async () => {
  let calls = 0;
  const runtime = installMockedRuntime(
    (async () => {
      calls += 1;
      if (calls === 1) {
        throw new Error("network details must not escape");
      }

      return validResponse();
    }) as typeof fetch
  );

  try {
    const provider = new OpenRouterStrategyProvider("test-key", "test-model");
    const result = await provider.generateStrategy(prompt);

    assert.equal(calls, 2);
    assert.equal(result.headline, validNarrative.headline);
    assert.ok(runtime.delays.includes(DEFAULT_RETRY_DELAY_MS));
  } finally {
    runtime.restore();
  }
});

test("preserves the abort timeout and does not retry an aborted request", async () => {
  let calls = 0;
  const runtime = installMockedRuntime(
    ((_, init) => {
      calls += 1;
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new Error("timeout cause must not escape"));
        });
      });
    }) as typeof fetch,
    { abortRequestTimeout: true }
  );

  try {
    const provider = new OpenRouterStrategyProvider("test-key", "test-model");

    await assert.rejects(
      () => provider.generateStrategy(prompt),
      /timed out after 120000ms/
    );
    assert.equal(calls, 1);
  } finally {
    runtime.restore();
  }
});

test("keeps the abort timeout active while consuming the response body", async () => {
  let calls = 0;
  const runtime = installMockedRuntime(
    (async (_input, init) => {
      calls += 1;
      const signal = init?.signal;
      return {
        ok: true,
        status: 200,
        headers: new Headers(),
        body: null,
        text: () =>
          new Promise<string>((_resolve, reject) => {
            if (signal?.aborted) {
              reject(new Error("body read was aborted"));
              return;
            }
            signal?.addEventListener("abort", () => {
              reject(new Error("body read was aborted"));
            });
          }),
      } as unknown as Response;
    }) as typeof fetch,
    { abortRequestTimeout: true }
  );

  try {
    const provider = new OpenRouterStrategyProvider("test-key", "test-model");

    await assert.rejects(
      () => provider.generateStrategy(prompt),
      /timed out after 120000ms/
    );
    assert.equal(calls, 1);
  } finally {
    runtime.restore();
  }
});

test("sets no-store for the OpenRouter POST", async () => {
  let requestCache: RequestCache | undefined;
  const runtime = installMockedRuntime(
    (async (_input, init) => {
      requestCache = init?.cache;
      return validResponse();
    }) as typeof fetch
  );

  try {
    const provider = new OpenRouterStrategyProvider("test-key", "test-model");
    await provider.generateStrategy(prompt);

    assert.equal(requestCache, "no-store");
  } finally {
    runtime.restore();
  }
});

test("cancels a retryable HTTP response body before retrying", async () => {
  let calls = 0;
  let cancellations = 0;
  const runtime = installMockedRuntime(
    (async () => {
      calls += 1;
      if (calls === 1) {
        return new Response(
          new ReadableStream({
            cancel() {
              cancellations += 1;
            },
          }),
          {
            status: 503,
            headers: { "Retry-After": "0" },
          }
        );
      }
      return validResponse();
    }) as typeof fetch
  );

  try {
    const provider = new OpenRouterStrategyProvider("test-key", "test-model");
    await provider.generateStrategy(prompt);

    assert.equal(calls, 2);
    assert.equal(cancellations, 1);
  } finally {
    runtime.restore();
  }
});

test("accepts an unambiguous OpenRouter text content array", async () => {
  const runtime = installMockedRuntime(
    (async () =>
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: [
                  { type: "text", text: JSON.stringify(validNarrative) },
                ],
              },
            },
          ],
        }),
        { status: 200 }
      )) as typeof fetch
  );

  try {
    const provider = new OpenRouterStrategyProvider("test-key", "test-model");
    const result = await provider.generateStrategy(prompt);

    assert.equal(result.headline, validNarrative.headline);
  } finally {
    runtime.restore();
  }
});

test("retries empty model content only once", async () => {
  let calls = 0;
  const runtime = installMockedRuntime(
    (async () => {
      calls += 1;
      return new Response(
        JSON.stringify({ choices: [{ message: { content: "" } }] }),
        { status: 200 }
      );
    }) as typeof fetch
  );

  try {
    const provider = new OpenRouterStrategyProvider("test-key", "test-model");

    await assert.rejects(
      () => provider.generateStrategy(prompt),
      /OpenRouter returned an invalid model response/
    );
    assert.equal(calls, 2);
  } finally {
    runtime.restore();
  }
});

test("retries an invalid outer OpenRouter response envelope only once", async () => {
  let calls = 0;
  const runtime = installMockedRuntime(
    (async () => {
      calls += 1;
      return new Response(JSON.stringify({ id: "missing-choices" }), {
        status: 200,
      });
    }) as typeof fetch
  );

  try {
    const provider = new OpenRouterStrategyProvider("test-key", "test-model");

    await assert.rejects(
      () => provider.generateStrategy(prompt),
      /OpenRouter returned an invalid model response/
    );
    assert.equal(calls, 2);
  } finally {
    runtime.restore();
  }
});

test("retries malformed model JSON but not shared strategy-output validation", async () => {
  let calls = 0;
  const runtime = installMockedRuntime(
    (async () => {
      calls += 1;
      const content = calls === 1 ? "not valid JSON" : JSON.stringify(validNarrative);
      return new Response(
        JSON.stringify({ choices: [{ message: { content } }] }),
        { status: 200 }
      );
    }) as typeof fetch
  );

  try {
    const provider = new OpenRouterStrategyProvider("test-key", "test-model");
    const result = await provider.generateStrategy(prompt);

    assert.equal(calls, 2);
    assert.equal(result.headline, validNarrative.headline);
  } finally {
    runtime.restore();
  }
});

test("does not retry a shared strategy-output validation failure", async () => {
  let calls = 0;
  const runtime = installMockedRuntime(
    (async () => {
      calls += 1;
      return new Response(
        JSON.stringify({ choices: [{ message: { content: "{}" } }] }),
        { status: 200 }
      );
    }) as typeof fetch
  );

  try {
    const provider = new OpenRouterStrategyProvider("test-key", "test-model");

    await assert.rejects(
      () => provider.generateStrategy(prompt),
      (error: unknown) => {
        assert.ok(error instanceof StrategyProviderError);
        assert.equal(error.message, "OpenRouter returned an invalid strategy output.");
        assert.equal(error.details, undefined);
        return true;
      }
    );
    assert.equal(calls, 1);
  } finally {
    runtime.restore();
  }
});
