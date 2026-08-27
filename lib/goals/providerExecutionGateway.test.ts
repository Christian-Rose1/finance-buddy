import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  createProviderExecutionGateway,
  executeVerifiedStageQueries,
  type VerifiedStageQueryExecutor,
} from "./providerExecutionGateway";
import { ResearchInterpreterError } from "./researchInterpreter";
import type { InterpretResearchInput } from "./researchInterpreter";
import type { ResearchProvider, ResearchQuery, ResearchResponse } from "./researchTypes";
import { OllamaResearchInterpreter } from "./ollamaResearchInterpreter";
import { OpenRouterResearchInterpreter } from "./openRouterResearchInterpreter";
import {
  startGoalStrategyRunStage,
  type StrategyResearchStage,
  type VerifiedRunningResearchStage,
} from "./strategyRunRepository";
import { signStrategyRunPayload } from "./strategyRunSigning";
import {
  buildSavedGoalWebTravelDiscoveryPlan,
  type SavedGoalWebDiscoveryInput,
  type WebTravelDiscoveryPlan,
} from "./webTravelDiscoveryPlanner";

const SYNTHETIC_SECRET = "gateway-test-secret-0123456789abcdef";
let priorSecret: string | undefined;

before(() => {
  priorSecret = process.env.STRATEGY_RUN_SIGNING_SECRET;
  process.env.STRATEGY_RUN_SIGNING_SECRET = SYNTHETIC_SECRET;
});

after(() => {
  if (priorSecret === undefined) delete process.env.STRATEGY_RUN_SIGNING_SECRET;
  else process.env.STRATEGY_RUN_SIGNING_SECRET = priorSecret;
});

const input: SavedGoalWebDiscoveryInput = {
  goal: {
    origin: ["DEN"],
    destinations: ["Paris"],
    earliestDeparture: "2027-04-03",
    latestReturn: "2027-04-30",
    minimumNights: 8,
    maximumNights: 8,
    travelerCount: 2,
    cabinPreference: "economy",
    optimizationPriority: "balanced",
  },
  customerRewardPrograms: [{ name: "Chase Ultimate Rewards" }],
  transferPartners: [],
};

function plan(): WebTravelDiscoveryPlan {
  return buildSavedGoalWebTravelDiscoveryPlan(input);
}

function runRow(stage: StrategyResearchStage, overrides: Record<string, unknown> = {}) {
  const runId = "run-server-id";
  const goalId = "goal-server-id";
  const userId = "user-server-id";
  const expiresAt = (overrides.expires_at as string) ?? new Date(Date.now() + 60_000).toISOString();
  return {
    id: runId,
    goal_id: goalId,
    user_id: userId,
    signature_version: 1,
    expires_at: expiresAt,
    run_signature: signStrategyRunPayload({
      version: 1,
      runId,
      goalId,
      userId,
      expiresAt,
      stage: "run",
      payload: "",
    }),
    flight_status: stage === "hotel" ? "failed" : "pending",
    flight_payload: null,
    flight_signature: null,
    hotel_status: "pending",
    hotel_payload: null,
    hotel_signature: null,
    final_status: "pending",
    created_at: "2026-08-27T00:00:00.000Z",
    updated_at: "2026-08-27T00:00:00.000Z",
    ...overrides,
  };
}

async function runningStage(
  stage: StrategyResearchStage = "flight",
  overrides: Record<string, unknown> = {},
): Promise<VerifiedRunningResearchStage> {
  const row = runRow(stage, overrides);
  const client = {
    from: () => {
      let updatePayload: Record<string, unknown> | null = null;
      return {
        select() { return this; },
        eq() { return this; },
        update(value: Record<string, unknown>) { updatePayload = value; return this; },
        maybeSingle() { return { data: row, error: null }; },
        single() {
          return updatePayload
            ? { data: { ...row, ...updatePayload }, error: null }
            : { data: row, error: null };
        },
      };
    },
  } as unknown as SupabaseClient;
  return startGoalStrategyRunStage(
    row.id,
    row.goal_id,
    row.user_id,
    stage,
    client,
  );
}

function mockProvider(
  resultFactory: (request: ResearchQuery, callIndex: number) => ResearchResponse | Promise<ResearchResponse>,
) {
  const calls: ResearchQuery[] = [];
  const provider: ResearchProvider = {
    async search(request) {
      calls.push(request);
      return resultFactory(request, calls.length - 1);
    },
  };
  return { calls, provider };
}

function response(request: ResearchQuery, results: unknown[] = []): ResearchResponse {
  return {
    query: "provider-returned-query-is-untrusted",
    searchedAt: "2026-08-27T00:00:00.000Z",
    results,
  } as ResearchResponse;
}

test("repository capability is required and a structural lookalike executes nothing", async () => {
  const mock = mockProvider((request) => response(request));
  assert.throws(
    () => createProviderExecutionGateway({} as VerifiedRunningResearchStage, mock.provider),
    ResearchInterpreterError,
  );
  assert.equal(mock.calls.length, 0);
});

test("only a gateway-minted one-shot executor can run a stage batch", async () => {
  const value = plan();
  const queries = value.queries.filter((query) => query.category === "flight");
  for (const lookalike of [{}, { ...({} as VerifiedStageQueryExecutor) }, JSON.parse("{}"), async () => []]) {
    const mock = mockProvider((request) => response(request));
    await assert.rejects(
      executeVerifiedStageQueries(lookalike as VerifiedStageQueryExecutor, value, queries),
      ResearchInterpreterError,
    );
    assert.equal(mock.calls.length, 0);
  }

  const mock = mockProvider((request) => response(request));
  const executor = createProviderExecutionGateway(await runningStage(), mock.provider);
  assert.equal(JSON.stringify(executor), "{}");
  await assert.rejects(
    executeVerifiedStageQueries(JSON.parse(JSON.stringify(executor)) as VerifiedStageQueryExecutor, value, queries),
    ResearchInterpreterError,
  );
  const firstBatch = executeVerifiedStageQueries(executor, value, queries);
  await assert.rejects(executeVerifiedStageQueries(executor, value, queries), ResearchInterpreterError);
  await firstBatch;
  assert.equal(mock.calls.length, queries.length);

  const wrongStage = mockProvider((request) => response(request));
  const hotelExecutor = createProviderExecutionGateway(await runningStage("hotel"), wrongStage.provider);
  await assert.rejects(executeVerifiedStageQueries(hotelExecutor, value, queries), ResearchInterpreterError);
  assert.equal(wrongStage.calls.length, 0);
});

test("malformed first input makes no request and does not consume the executor", async () => {
  const value = plan();
  const queries = value.queries.filter((query) => query.category === "flight");
  const malformed = { ...queries[0]!, query: " " };
  const mock = mockProvider((request) => response(request));
  const executor = createProviderExecutionGateway(await runningStage(), mock.provider);

  await assert.rejects(
    executeVerifiedStageQueries(executor, value, [malformed]),
    ResearchInterpreterError,
  );
  assert.equal(mock.calls.length, 0);

  const responses = await executeVerifiedStageQueries(executor, value, queries);
  assert.equal(responses.length, queries.length);
  assert.deepEqual(mock.calls.map((call) => call.query), queries.map((query) => query.query));
});

test("parallel sibling completion retains deterministic selected-query order", async () => {
  const value = plan();
  const queries = value.queries.filter((query) => query.category === "flight");
  const completion: string[] = [];
  const mock = mockProvider(async (request, index) => {
    await new Promise<void>((resolve) => setTimeout(resolve, index === 0 ? 15 : 0));
    completion.push(request.query);
    return response(request);
  });
  const responses = await executeVerifiedStageQueries(
    createProviderExecutionGateway(await runningStage(), mock.provider), value, queries,
  );
  assert.deepEqual(completion, [...queries].reverse().map((query) => query.query));
  assert.deepEqual(responses.map((item) => item.query), queries.map((query) => query.query));
  assert.deepEqual(mock.calls.map((item) => item.query), queries.map((query) => query.query));
});

test("gateway executes every selected planned query once and normalizes successful results", async () => {
  const value = plan();
  const queries = value.queries.filter((query) => query.category === "flight");
  const mock = mockProvider((request) => response(request, [
    { title: "Official", url: "https://WWW.UNITED.COM/path", content: "fact", score: 1, publishedDate: null, sourceTier: "general" },
    { title: "Rejected", url: "https://evil.example/path", content: "bad", score: null, publishedDate: null, sourceTier: "official" },
  ]));
  const execute = createProviderExecutionGateway(await runningStage(), mock.provider);
  const responses = await executeVerifiedStageQueries(execute, value, queries);

  assert.deepEqual(mock.calls.map((call) => call.query), queries.map((query) => query.query));
  assert.equal(new Set(mock.calls.map((call) => call.query)).size, mock.calls.length);
  assert.equal(responses.length, queries.length);
  assert.ok(responses.every((item) => item.results.length === 1));
  assert.ok(responses.every((item) => item.results[0]!.sourceTier === "official"));
  assert.deepEqual(responses.map((item) => item.query), queries.map((query) => query.query));
});

test("partial provider failure retains siblings without retry and all failures occur once", async () => {
  const value = plan();
  const queries = value.queries.filter((query) => query.category === "flight");
  const partial = mockProvider((request, index) => {
    if (index === 0) throw new Error("synthetic");
    return response(request);
  });
  const partialResponses = await executeVerifiedStageQueries(
    createProviderExecutionGateway(await runningStage(), partial.provider), value, queries,
  );
  assert.equal(partialResponses.length, queries.length - 1);
  assert.deepEqual(partial.calls.map((call) => call.query), queries.map((query) => query.query));

  const failed = mockProvider(() => { throw new Error("synthetic"); });
  const failedResponses = await executeVerifiedStageQueries(
    createProviderExecutionGateway(await runningStage(), failed.provider), value, queries,
  );
  assert.deepEqual(failedResponses, []);
  assert.deepEqual(failed.calls.map((call) => call.query), queries.map((query) => query.query));
});

test("expired executor fails before every provider request", async () => {
  const value = plan();
  const queries = value.queries.filter((query) => query.category === "flight");
  const expiresAt = new Date(Date.now() + 60_000).toISOString();
  const mock = mockProvider((request) => response(request));
  const execute = createProviderExecutionGateway(
    await runningStage("flight", { expires_at: expiresAt }),
    mock.provider,
  );
  const originalNow = Date.now;
  Date.now = () => Date.parse(expiresAt) + 1;
  try { await assert.rejects(executeVerifiedStageQueries(execute, value, queries), ResearchInterpreterError); }
  finally { Date.now = originalNow; }
  assert.equal(mock.calls.length, 0);
});

test("query invariants reject the complete selection before any provider call", async () => {
  const value = plan();
  const query = value.queries.find((item) => item.category === "flight")!;
  const changes = [
    { ...query, query: " " },
    { ...query, query: "x".repeat(501) },
    { ...query, category: "hotel" as const },
    { ...query, kind: "cash_hotel_discovery" as const },
    { ...query, tripShapeIds: [query.tripShapeIds[0]!, query.tripShapeIds[0]!] },
    { ...query, tripShapeIds: ["not-in-plan"] },
    { ...query, includeDomains: ["united.com:443"] },
  ];

  for (const changed of changes) {
    const mock = mockProvider((request) => response(request));
    const execute = createProviderExecutionGateway(await runningStage(), mock.provider);
    await assert.rejects(executeVerifiedStageQueries(execute, value, [changed]), ResearchInterpreterError);
    assert.equal(mock.calls.length, 0);
  }

  const duplicate = mockProvider((request) => response(request));
  const execute = createProviderExecutionGateway(await runningStage(), duplicate.provider);
  await assert.rejects(executeVerifiedStageQueries(execute, value, [query, { ...query }]), ResearchInterpreterError);
  assert.equal(duplicate.calls.length, 0);
});

test("identical query text under distinct trip-shape contexts stays distinct; true duplicate contexts reject", async () => {
  const base = plan();
  const original = base.queries.find((query) => query.category === "flight")!;
  const first = { ...original, tripShapeIds: [base.tripShapes[0]!.id] };
  const second = { ...original, tripShapeIds: [base.tripShapes[1]!.id] };
  const distinctPlan = {
    ...base,
    queries: [first, second, ...base.queries.filter((query) => query.category !== "flight")],
  };
  const mock = mockProvider((request) => response(request));
  const execute = createProviderExecutionGateway(await runningStage(), mock.provider);
  await executeVerifiedStageQueries(execute, distinctPlan, [{ ...first }, { ...second }]);
  assert.equal(mock.calls.length, 2);
  assert.equal(mock.calls[0]!.query, mock.calls[1]!.query);

  const duplicatePlan = { ...distinctPlan, queries: [first, { ...first }] };
  const duplicate = mockProvider((request) => response(request));
  await assert.rejects(
    executeVerifiedStageQueries(createProviderExecutionGateway(await runningStage(), duplicate.provider), duplicatePlan, [first]),
    ResearchInterpreterError,
  );
  assert.equal(duplicate.calls.length, 0);
});

test("configured domains accept canonical ASCII policy entries and reject malformed hostnames", async () => {
  const base = plan();
  const original = base.queries.find((query) => query.category === "flight")!;
  const malformed = [
    "", "united.com.", ".united.com", "united..com", "-united.com", "united-.com",
    `${"a".repeat(64)}.united.com`, `${"a".repeat(250)}.com`, "united.com:443",
    "https://united.com", "bücher.united.com", "xn--bcher-kva.united.com",
  ];

  for (const domain of ["UNITED.COM", ...malformed]) {
    const query = { ...original, includeDomains: [domain] };
    const changedPlan = { ...base, queries: base.queries.map((item) => item === original ? query : item) };
    const mock = mockProvider((request) => response(request));
    const execute = createProviderExecutionGateway(await runningStage(), mock.provider);
    if (domain === "UNITED.COM") {
      await executeVerifiedStageQueries(execute, changedPlan, [{ ...query }]);
      assert.deepEqual(mock.calls[0]!.includeDomains, ["united.com"]);
    } else {
      await assert.rejects(executeVerifiedStageQueries(execute, changedPlan, [query]), ResearchInterpreterError);
      assert.equal(mock.calls.length, 0);
    }
  }
});

test("approved domains are constrained by travel query kind, not the broad trusted catalog", async () => {
  const value = plan();
  const flight = value.queries.find((item) => item.kind === "cash_flight_discovery")!;
  const mismatched = { ...flight, includeDomains: ["hyatt.com"] };
  const changedPlan = { ...value, queries: value.queries.map((item) => item === flight ? mismatched : item) };
  const mock = mockProvider((request) => response(request));
  await assert.rejects(
    executeVerifiedStageQueries(createProviderExecutionGateway(await runningStage(), mock.provider), changedPlan, [mismatched]),
    ResearchInterpreterError,
  );
  assert.equal(mock.calls.length, 0);
});

test("source URL policy accepts ASCII subdomains only on label boundaries", async () => {
  const value = plan();
  const query = value.queries.find((item) => item.category === "flight")!;
  const urls = [
    "https://united.com/path",
    "HTTP://WWW.UNITED.COM/path",
    "ftp://united.com/path",
    "https://user:pass@united.com/path",
    "https://united.com./path",
    "https://united.com:443/path",
    "http://united.com:80/path",
    "https://united.com:8443/path",
    "http://united.com:8080/path",
    "https://evilunited.com/path",
    "https://united..com/path",
    "https://-bad.united.com/path",
    "https://bad-.united.com/path",
    `https://${"a".repeat(64)}.united.com/path`,
    `https://${"a.".repeat(126)}com/path`,
    "https://bücher.united.com/path",
    "https://xn--bcher-kva.united.com/path",
    "https://%75nited.com/path",
  ];
  const mock = mockProvider((request) => response(request, urls.map((url) => ({
    title: "source",
    url,
    content: "fact",
    score: null,
    publishedDate: null,
    sourceTier: "general",
  }))));
  const responses = await executeVerifiedStageQueries(createProviderExecutionGateway(await runningStage(), mock.provider), value, [query]);
  assert.deepEqual(responses[0]!.results.map((result) => result.url), urls.slice(0, 2));
});

async function gatewayInterpreterInput(): Promise<{
  input: InterpretResearchInput;
  providerQuery: string;
  sourceUrl: string;
  fullContentTail: string;
}> {
  const value = plan();
  const query = value.queries.find((item) => item.category === "flight")!;
  const sourceUrl = "https://united.com/private-source-path";
  const fullContentTail = "FULL_CONTENT_TAIL_ACCOUNT_BALANCE_OWNER_TRANSACTION_SIGNATURE_SECRET";
  const mock = mockProvider((request) => ({
    query: "provider-transport-query",
    searchedAt: "2026-08-27T00:00:00.000Z",
    transportMetadata: "provider-transport-metadata",
    results: [{
      title: "Public source title",
      url: sourceUrl,
      content: `${"public fact ".repeat(220)}${fullContentTail}`,
      score: 0.91,
      publishedDate: "2026-08-26T00:00:00.000Z",
      sourceTier: "general",
      customerId: "customer-db-id",
      accountId: "account-db-id",
      balance: 80000,
      owner: "owner-label",
      transaction: "transaction-data",
      signature: "signature-value",
      secret: "secret-value",
    }],
  } as unknown as ResearchResponse));
  const responses = await executeVerifiedStageQueries(createProviderExecutionGateway(await runningStage(), mock.provider), value, [query]);
  return {
    providerQuery: query.query,
    sourceUrl,
    fullContentTail,
    input: {
      focus: "flight_options",
      goal: {
        id: "goal-db-id",
        userId: "user-db-id",
        type: "travel",
        title: "Private title",
        status: "active",
        origin: ["DEN"],
        destinations: ["Paris"],
        earliestDeparture: "2027-04-03",
        latestReturn: "2027-04-30",
        minimumNights: 8,
        maximumNights: 8,
        travelerCount: 2,
        cabinPreference: "economy",
        optimizationPriority: "balanced",
        maximumCashBudget: 2000,
        currency: "USD",
        allowNewCards: false,
        createdAt: "2026-08-01T00:00:00.000Z",
        updatedAt: "2026-08-01T00:00:00.000Z",
      },
      rewardPrograms: [{ id: "program-db-id", name: "United MileagePlus" }],
      research: responses,
    },
  };
}

function assertCloudResearchPayload(
  payload: string,
  source: Awaited<ReturnType<typeof gatewayInterpreterInput>>,
): void {
  const parsed = JSON.parse(payload);
  assert.equal(parsed.research[0].requestRef, "research-1");
  assert.equal(parsed.research[0].results[0].id, "source-1");
  assert.equal(parsed.research[0].results[0].excerpt.length, 2_000);
  for (const prohibited of [
    source.providerQuery,
    source.sourceUrl,
    source.fullContentTail,
    "provider-transport-query",
    "provider-transport-metadata",
    "2026-08-27T00:00:00.000Z",
    "2026-08-26T00:00:00.000Z",
    '"score"',
    '"sourceTier"',
    "Public source title",
    "goal-db-id",
    "user-db-id",
    "program-db-id",
    "customer-db-id",
    "account-db-id",
    "80000",
    "owner-label",
    "transaction-data",
    "signature-value",
    "secret-value",
    "run-server-id",
    "goal-server-id",
    "user-server-id",
    '\"stage\":\"flight\"',
  ]) {
    assert.ok(!payload.includes(prohibited), prohibited);
  }
}

test("gateway-normalized responses reach OpenRouter through opaque bounded cloud payloads", async () => {
  const source = await gatewayInterpreterInput();
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.OPENROUTER_API_KEY;
  let body = "";
  process.env.OPENROUTER_API_KEY = "synthetic-openrouter-key";
  globalThis.fetch = async (_url, init) => {
    body = String(init?.body ?? "");
    return new Response(JSON.stringify({
      model: "synthetic-model",
      choices: [{ message: { content: JSON.stringify({ awardOptions: [], cardOffers: [], assumptions: [], warnings: [] }) } }],
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  try {
    await new OpenRouterResearchInterpreter().interpret(source.input);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = originalKey;
  }
  const requestBody = JSON.parse(body);
  assertCloudResearchPayload(requestBody.messages[1].content, source);
});

test("gateway-normalized responses reach Ollama through opaque bounded cloud payloads", async () => {
  const source = await gatewayInterpreterInput();
  const originalFetch = globalThis.fetch;
  let body = "";
  globalThis.fetch = async (_url, init) => {
    body = String(init?.body ?? "");
    return new Response(JSON.stringify({
      message: { content: JSON.stringify({ awardOptions: [], cardOffers: [], assumptions: [], warnings: [] }) },
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  try {
    await new OllamaResearchInterpreter("http://localhost:11434", "synthetic-model").interpret(source.input);
  } finally {
    globalThis.fetch = originalFetch;
  }
  const requestBody = JSON.parse(body);
  const payload = String(requestBody.messages[1].content).split("\n", 1)[0]!;
  assertCloudResearchPayload(payload, source);
});
