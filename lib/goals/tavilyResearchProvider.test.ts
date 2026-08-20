import { test } from "node:test";
import assert from "node:assert/strict";
import {
  TavilyResearchError,
  TavilyResearchProvider,
} from "./tavilyResearchProvider";

const TEST_KEY = "test-tavily-key-12345";

function jsonResponse(payload: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
  } as unknown as Response;
}

function installFetchStub(
  handler: (url: string, init?: RequestInit) => Response | Promise<Response>
): () => void {
  const original = globalThis.fetch;
  globalThis.fetch = (async (url: string, init?: RequestInit) =>
    handler(url, init)) as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}

test("sends correct endpoint, headers, and body", async () => {
  const restore = installFetchStub(async (url, init) => {
    assert.equal(url, "https://api.tavily.com/search");
    assert.equal(init?.method, "POST");

    const headers = init?.headers as Record<string, string> | undefined;
    assert.equal(headers?.["Authorization"], `Bearer ${TEST_KEY}`);
    assert.equal(headers?.["Content-Type"], "application/json");

    const body = JSON.parse(String(init?.body));
    assert.equal(body.query, "Chase Sapphire Preferred benefits");
    assert.equal(body.search_depth, "basic");
    assert.equal(body.max_results, 5);
    assert.deepEqual(body.include_domains, ["chase.com"]);
    assert.equal(body.include_answer, false);
    assert.equal(body.include_raw_content, false);

    return jsonResponse({ results: [] });
  });

  try {
    const provider = new TavilyResearchProvider(TEST_KEY);
    await provider.search({
      query: "  Chase Sapphire Preferred benefits  ",
      includeDomains: ["chase.com"],
    });
  } finally {
    restore();
  }
});

test("does not expose API key in returned errors", async () => {
  const restore = installFetchStub(() => jsonResponse({ error: "boom" }, 500));
  try {
    const provider = new TavilyResearchProvider(TEST_KEY);
    await assert.rejects(
      provider.search({
        query: "test",
        includeDomains: ["chase.com"],
      }),
      (error: unknown) => {
        assert.ok(error instanceof TavilyResearchError);
        assert.ok(!error.message.includes(TEST_KEY));
        return true;
      }
    );
  } finally {
    restore();
  }
});

test("does not expose API key on network failure", async () => {
  const restore = installFetchStub(() => {
    throw new Error("network down");
  });
  try {
    const provider = new TavilyResearchProvider(TEST_KEY);
    await assert.rejects(
      provider.search({
        query: "test",
        includeDomains: ["chase.com"],
      }),
      (error: unknown) => {
        assert.ok(error instanceof TavilyResearchError);
        assert.ok(!error.message.includes(TEST_KEY));
        return true;
      }
    );
  } finally {
    restore();
  }
});

test("rejects missing API key", () => {
  const original = process.env.TAVILY_API_KEY;
  delete process.env.TAVILY_API_KEY;
  try {
    assert.throws(
      () => new TavilyResearchProvider(),
      (error: unknown) =>
        error instanceof TavilyResearchError &&
        error.message.includes("TAVILY_API_KEY")
    );
  } finally {
    if (original !== undefined) {
      process.env.TAVILY_API_KEY = original;
    }
  }
});

test("rejects empty query", async () => {
  const restore = installFetchStub(() => jsonResponse({ results: [] }));
  try {
    const provider = new TavilyResearchProvider(TEST_KEY);
    await assert.rejects(
      provider.search({
        query: "   ",
        includeDomains: ["chase.com"],
      }),
      (error: unknown) =>
        error instanceof TavilyResearchError &&
        error.message.includes("query")
    );
  } finally {
    restore();
  }
});

test("rejects untrusted domain", async () => {
  const restore = installFetchStub(() => jsonResponse({ results: [] }));
  try {
    const provider = new TavilyResearchProvider(TEST_KEY);
    await assert.rejects(
      provider.search({
        query: "test",
        includeDomains: ["evil.com"],
      }),
      (error: unknown) =>
        error instanceof TavilyResearchError &&
        error.message.includes("Untrusted domain")
    );
  } finally {
    restore();
  }
});

test("validates maxResults", async () => {
  const restore = installFetchStub(() => jsonResponse({ results: [] }));
  try {
    const provider = new TavilyResearchProvider(TEST_KEY);

    for (const bad of [0, 11, 1.5, "5"]) {
      await assert.rejects(
        provider.search({
          query: "test",
          includeDomains: ["chase.com"],
          maxResults: bad as number,
        }),
        (error: unknown) =>
          error instanceof TavilyResearchError &&
          error.message.includes("maxResults")
      );
    }

    await provider.search({
      query: "test",
      includeDomains: ["chase.com"],
    });
  } finally {
    restore();
  }
});

test("maps successful response", async () => {
  const restore = installFetchStub(() =>
    jsonResponse({
      results: [
        {
          title: "Chase Sapphire Preferred",
          url: "https://www.chase.com/personal/credit-cards/sapphire-preferred",
          content: "Official benefits page",
          score: 0.95,
          publishedDate: "2026-01-15",
        },
        {
          title: "Best transfer partners",
          url: "https://thepointsguy.com/guide/transfer-partners/",
          content: "Specialist analysis",
          score: 0.8,
          publishedDate: null,
        },
      ],
    })
  );

  try {
    const provider = new TavilyResearchProvider(TEST_KEY);
    const response = await provider.search({
      query: "Chase transfer partners",
      includeDomains: ["chase.com", "thepointsguy.com"],
    });

    assert.equal(response.query, "Chase transfer partners");
    assert.equal(response.results.length, 2);
    assert.ok(!Number.isNaN(Date.parse(response.searchedAt)));

    const official = response.results[0];
    assert.equal(official.title, "Chase Sapphire Preferred");
    assert.equal(
      official.url,
      "https://www.chase.com/personal/credit-cards/sapphire-preferred"
    );
    assert.equal(official.content, "Official benefits page");
    assert.equal(official.score, 0.95);
    assert.equal(official.publishedDate, "2026-01-15");
    assert.equal(official.sourceTier, "official");

    const specialist = response.results[1];
    assert.equal(specialist.sourceTier, "specialist");
    assert.equal(specialist.publishedDate, null);
  } finally {
    restore();
  }
});

test("discards results outside includeDomains", async () => {
  const restore = installFetchStub(() =>
    jsonResponse({
      results: [
        {
          title: "Trusted",
          url: "https://www.chase.com/benefits",
          content: "ok",
        },
        {
          title: "Untrusted",
          url: "https://evil.com/phishing",
          content: "bad",
        },
      ],
    })
  );

  try {
    const provider = new TavilyResearchProvider(TEST_KEY);
    const response = await provider.search({
      query: "test",
      includeDomains: ["chase.com"],
    });

    assert.equal(response.results.length, 1);
    assert.equal(response.results[0].url, "https://www.chase.com/benefits");
  } finally {
    restore();
  }
});

test("discards non-HTTPS URLs", async () => {
  const restore = installFetchStub(() =>
    jsonResponse({
      results: [
        {
          title: "HTTP",
          url: "http://www.chase.com/benefits",
          content: "bad",
        },
        {
          title: "HTTPS",
          url: "https://www.chase.com/benefits",
          content: "ok",
        },
      ],
    })
  );

  try {
    const provider = new TavilyResearchProvider(TEST_KEY);
    const response = await provider.search({
      query: "test",
      includeDomains: ["chase.com"],
    });

    assert.equal(response.results.length, 1);
    assert.equal(response.results[0].url, "https://www.chase.com/benefits");
  } finally {
    restore();
  }
});

test("caps title and content lengths", async () => {
  const restore = installFetchStub(() =>
    jsonResponse({
      results: [
        {
          title: "x".repeat(500),
          url: "https://www.chase.com/benefits",
          content: "y".repeat(6000),
        },
      ],
    })
  );

  try {
    const provider = new TavilyResearchProvider(TEST_KEY);
    const response = await provider.search({
      query: "test",
      includeDomains: ["chase.com"],
    });

    assert.equal(response.results[0].title.length, 300);
    assert.equal(response.results[0].content.length, 5000);
  } finally {
    restore();
  }
});

test("rejects malformed response", async () => {
  const restore = installFetchStub(() => jsonResponse({ foo: "bar" }));
  try {
    const provider = new TavilyResearchProvider(TEST_KEY);
    await assert.rejects(
      provider.search({
        query: "test",
        includeDomains: ["chase.com"],
      }),
      (error: unknown) =>
        error instanceof TavilyResearchError &&
        error.message.includes("results")
    );
  } finally {
    restore();
  }
});

test("rejects non-2xx response", async () => {
  const restore = installFetchStub(() => jsonResponse({ error: "boom" }, 500));
  try {
    const provider = new TavilyResearchProvider(TEST_KEY);
    await assert.rejects(
      provider.search({
        query: "test",
        includeDomains: ["chase.com"],
      }),
      (error: unknown) =>
        error instanceof TavilyResearchError &&
        error.status === 500 &&
        error.message.includes("500")
    );
  } finally {
    restore();
  }
});

test("does not mutate input", async () => {
  const restore = installFetchStub(() => jsonResponse({ results: [] }));
  try {
    const provider = new TavilyResearchProvider(TEST_KEY);
    const input = {
      query: "  test query  ",
      includeDomains: ["chase.com"],
      maxResults: 3,
    };
    const snapshot = JSON.parse(JSON.stringify(input));
    await provider.search(input);
    assert.deepEqual(input, snapshot);
  } finally {
    restore();
  }
});