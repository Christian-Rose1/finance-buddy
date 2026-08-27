/**
 * Request-scoped execution for authenticated staged public-web research.
 *
 * The only production entry point requires a repository-minted
 * VerifiedRunningResearchStage. Provider responses are normalized before they
 * become ordinary interpreter inputs or server-only observations. Executor
 * state is held weakly: copied/serialized empty objects lose identity, and
 * observations are garbage-collection eligible when the request's executor is
 * no longer reachable. Nothing here persists or projects them. Fixed-size
 * excerpts are segmentation only; they are not candidate claim evidence.
 */
import { randomUUID } from "node:crypto";

import { ResearchInterpreterError } from "./researchInterpreter";
import {
  CARD_PROGRAM_DOMAINS,
  FLIGHT_OFFICIAL_DOMAINS,
  HOTEL_OFFICIAL_DOMAINS,
  OFFICIAL_DOMAINS,
  SPECIALIST_DOMAINS,
} from "./researchTypes";
import type { ResearchProvider, ResearchResponse, ResearchResult, ResearchSourceTier } from "./researchTypes";
import {
  inspectVerifiedRunningResearchStage,
  type StrategyResearchStage,
  type VerifiedRunningResearchStage,
} from "./strategyRunRepository";
import type {
  WebTravelDiscoveryPlan,
  WebTravelDiscoveryQuery,
  WebTravelQueryKind,
} from "./webTravelDiscoveryPlanner";

const MAX_QUERY = 500;
const MAX_TITLE = 500;
const MAX_CONTENT = 24_000;
const EXCERPT_CHARS = 500;
const MAX_EXCERPTS = 8;

const STAGE_KINDS: Record<StrategyResearchStage, ReadonlySet<WebTravelQueryKind>> = {
  flight: new Set(["cash_flight_discovery", "award_flight_discovery"]),
  hotel: new Set(["cash_hotel_discovery", "award_hotel_discovery"]),
};

declare const VERIFIED_STAGE_QUERY_EXECUTOR: unique symbol;

/** Runtime-opaque authority for exactly one authenticated stage query batch. */
export interface VerifiedStageQueryExecutor {
  readonly [VERIFIED_STAGE_QUERY_EXECUTOR]: true;
}

interface ExecutorState {
  runningStage: VerifiedRunningResearchStage;
  context: NonNullable<ReturnType<typeof inspectVerifiedRunningResearchStage>>;
  provider: ResearchProvider;
  execution: InternalExecution;
  consumed: boolean;
}

const verifiedExecutors = new WeakMap<object, ExecutorState>();

/** Fails unless the value has gateway-owned runtime capability identity. */
export function assertVerifiedStageQueryExecutor(
  value: unknown,
): asserts value is VerifiedStageQueryExecutor {
  if (!value || typeof value !== "object" || !verifiedExecutors.has(value as object)) {
    invariantFailure();
  }
}

interface NormalizedPlannedRequest {
  requestRef: string;
  plannedQueryRef: string;
  tripShapeRefs: string[];
  query: string;
  approvedDomains: string[];
  searchDepth: "basic" | "advanced";
  category: "flight" | "hotel";
  kind: WebTravelQueryKind;
}

interface ProviderObservation {
  observationRef: string;
  requestRef: string;
  plannedQueryRef: string;
  tripShapeRef: string;
  sourceRef: string;
  publisherDomain: string;
  sourceTier: ResearchSourceTier;
  sourceRole: "official_publisher" | "specialist_publisher";
  title: string;
  observedAt: string;
  excerpts: Array<{
    excerptRef: string;
    ordinal: number;
    start: number;
    end: number;
    text: string;
  }>;
}

interface InternalExecution {
  invocationRef: string;
  observations: ProviderObservation[];
  requests: NormalizedPlannedRequest[];
}

interface ValidatedQuery {
  query: WebTravelDiscoveryQuery;
  contextIdentity: string;
  request: Omit<NormalizedPlannedRequest, "requestRef" | "plannedQueryRef">;
}

function invariantFailure(): never {
  throw new ResearchInterpreterError(
    "The authenticated research stage could not be executed safely.",
    "tavily",
    "unknown",
  );
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`)
    .join(",")}}`;
}

function normalizeAsciiHostname(value: string): string | null {
  if (
    !value ||
    value !== value.trim() ||
    value.length > 253 ||
    value.endsWith(".") ||
    !/^[\x00-\x7F]+$/.test(value)
  ) {
    return null;
  }

  const normalized = value.toLowerCase();
  const labels = normalized.split(".");
  if (
    labels.some(
      (label) =>
        label.length === 0 ||
        label.length > 63 ||
        label.startsWith("xn--") ||
        !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label),
    )
  ) {
    return null;
  }
  return normalized;
}

function normalizeConfiguredDomain(value: unknown): string | null {
  if (
    typeof value !== "string" ||
    value.includes(":") ||
    value.includes("/") ||
    value.includes("@") ||
    value.includes("?") ||
    value.includes("#") ||
    value.includes("%")
  ) {
    return null;
  }
  return normalizeAsciiHostname(value);
}

function normalizeSourceHostname(value: unknown): string | null {
  if (typeof value !== "string" || !/^[\x00-\x7F]+$/.test(value)) return null;
  try {
    const url = new URL(value);
    if (
      (url.protocol !== "https:" && url.protocol !== "http:") ||
      url.username ||
      url.password ||
      !url.hostname ||
      url.port
    ) {
      return null;
    }
    const authority = value.slice(value.indexOf("//") + 2).split(/[/?#]/, 1)[0] ?? "";
    if (!authority || authority.includes("%") || /:(?:80|443)$/.test(authority)) return null;
    return normalizeAsciiHostname(url.hostname);
  } catch {
    return null;
  }
}

function domainMatches(host: string, approved: string): boolean {
  return host === approved || host.endsWith(`.${approved}`);
}

function sourceTier(host: string): ResearchSourceTier | null {
  if (OFFICIAL_DOMAINS.some((domain) => domainMatches(host, domain))) return "official";
  if (SPECIALIST_DOMAINS.some((domain) => domainMatches(host, domain))) return "specialist";
  return null;
}

function normalizeApprovedDomains(values: unknown): string[] | null {
  if (!Array.isArray(values) || values.length === 0) return null;
  const normalized: string[] = [];
  for (const value of values) {
    const domain = normalizeConfiguredDomain(value);
    if (!domain || normalized.includes(domain)) return null;
    normalized.push(domain);
  }
  return normalized.sort();
}

function kindAllowsDomain(kind: WebTravelQueryKind, domain: string): boolean {
  const allowed = kind === "cash_flight_discovery"
    ? FLIGHT_OFFICIAL_DOMAINS
    : kind === "award_flight_discovery"
      ? [...CARD_PROGRAM_DOMAINS, ...FLIGHT_OFFICIAL_DOMAINS, ...SPECIALIST_DOMAINS]
      : kind === "cash_hotel_discovery"
        ? HOTEL_OFFICIAL_DOMAINS
        : kind === "award_hotel_discovery"
          ? [...CARD_PROGRAM_DOMAINS, ...HOTEL_OFFICIAL_DOMAINS, ...SPECIALIST_DOMAINS]
          : [];
  return allowed.includes(domain);
}

function validDate(value: unknown): value is string | null {
  return value === null || (typeof value === "string" && !Number.isNaN(Date.parse(value)));
}

function normalizeResult(raw: unknown, approvedDomains: string[]): ResearchResult | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const result = raw as ResearchResult;
  const host = normalizeSourceHostname(result.url);
  const tier = host ? sourceTier(host) : null;
  if (
    !host ||
    !approvedDomains.some((domain) => domainMatches(host, domain)) ||
    !tier ||
    typeof result.title !== "string" ||
    !result.title.trim() ||
    result.title.length > MAX_TITLE ||
    typeof result.content !== "string" ||
    result.content.length > MAX_CONTENT ||
    !validDate(result.publishedDate) ||
    (result.score !== null &&
      (typeof result.score !== "number" || !Number.isFinite(result.score)))
  ) {
    return null;
  }
  return {
    title: result.title.trim(),
    url: result.url,
    content: result.content,
    score: result.score,
    publishedDate: result.publishedDate,
    sourceTier: tier,
  };
}

function segmentContent(content: string): ProviderObservation["excerpts"] {
  const segments: ProviderObservation["excerpts"] = [];
  for (
    let start = 0;
    start < content.length && segments.length < MAX_EXCERPTS;
    start += EXCERPT_CHARS
  ) {
    const end = Math.min(content.length, start + EXCERPT_CHARS);
    segments.push({
      excerptRef: `excerpt-${randomUUID()}`,
      ordinal: segments.length,
      start,
      end,
      text: content.slice(start, end),
    });
  }
  return segments;
}

function validateQuery(
  plan: WebTravelDiscoveryPlan,
  query: WebTravelDiscoveryQuery,
  stage: StrategyResearchStage,
): ValidatedQuery {
  if (
    !query ||
    typeof query.query !== "string" ||
    !query.query.trim() ||
    query.query !== query.query.trim() ||
    query.query.length > MAX_QUERY ||
    query.category !== stage ||
    !STAGE_KINDS[stage].has(query.kind) ||
    (query.searchDepth !== undefined &&
      query.searchDepth !== "basic" &&
      query.searchDepth !== "advanced")
  ) {
    invariantFailure();
  }

  if (
    !Array.isArray(query.tripShapeIds) ||
    query.tripShapeIds.length === 0 ||
    new Set(query.tripShapeIds).size !== query.tripShapeIds.length
  ) {
    invariantFailure();
  }
  const planShapeIds = new Set(plan.tripShapes.map((shape) => shape.id));
  if (
    query.tripShapeIds.some(
      (tripShapeRef) =>
        typeof tripShapeRef !== "string" ||
        !tripShapeRef ||
        !planShapeIds.has(tripShapeRef),
    )
  ) {
    invariantFailure();
  }

  const approvedDomains = normalizeApprovedDomains(query.includeDomains);
  if (!approvedDomains || approvedDomains.some((domain) => !kindAllowsDomain(query.kind, domain))) {
    invariantFailure();
  }
  const request = {
    tripShapeRefs: [...query.tripShapeIds],
    query: query.query,
    approvedDomains,
    searchDepth: query.searchDepth ?? "basic",
    category: query.category,
    kind: query.kind,
  } as Omit<NormalizedPlannedRequest, "requestRef" | "plannedQueryRef">;
  return { query, request, contextIdentity: canonical(request) };
}

/**
 * Creates the sole production staged-query executor. Stage authority comes
 * exclusively from the repository capability; callers cannot select it here.
 */
export function createProviderExecutionGateway(
  runningStage: VerifiedRunningResearchStage,
  provider: ResearchProvider,
): VerifiedStageQueryExecutor {
  const context = inspectVerifiedRunningResearchStage(runningStage);
  if (!context || !Number.isFinite(Date.parse(context.expiresAt))) invariantFailure();

  const executor = Object.freeze({}) as VerifiedStageQueryExecutor;
  verifiedExecutors.set(executor as object, {
    runningStage,
    context,
    provider,
    execution: {
      invocationRef: `stage-invocation-${randomUUID()}`,
      observations: [],
      requests: [],
    },
    consumed: false,
  });
  return executor;
}

/** Executes a gateway-minted batch once; structural substitutes are rejected. */
export async function executeVerifiedStageQueries(
  executor: VerifiedStageQueryExecutor,
  plan: WebTravelDiscoveryPlan,
  selectedQueries: WebTravelDiscoveryQuery[],
): Promise<ResearchResponse[]> {
    assertVerifiedStageQueryExecutor(executor);
    const state = verifiedExecutors.get(executor as object);
    if (!state || state.consumed) invariantFailure();

    const current = inspectVerifiedRunningResearchStage(state.runningStage);
    if (!current || current !== state.context || !current.revision || Date.parse(current.expiresAt) <= Date.now()) {
      invariantFailure();
    }
    if (
      !plan ||
      typeof plan !== "object" ||
      !Array.isArray(plan.queries) ||
      !Array.isArray(plan.tripShapes) ||
      !Array.isArray(selectedQueries)
    ) {
      invariantFailure();
    }
    const planQueries = plan.queries
      .filter((query) => query.category === current.stage)
      .map((query) => validateQuery(plan, query, current.stage));
    const duplicateContexts = new Set<string>();
    for (const query of planQueries) {
      if (duplicateContexts.has(query.contextIdentity)) invariantFailure();
      duplicateContexts.add(query.contextIdentity);
    }

    const selected = selectedQueries.map((query) => {
      const validated = validateQuery(plan, query, current.stage);
      const matches = planQueries.filter(
        (planned) => planned.contextIdentity === validated.contextIdentity,
      );
      if (matches.length !== 1) invariantFailure();
      const planIndex = plan.queries.indexOf(matches[0]!.query);
      const plannedQueryRef = canonical({
        position: planIndex,
        context: validated.request,
      });
      return { ...validated, planIndex, plannedQueryRef };
    });
    if (new Set(selected.map((query) => query.plannedQueryRef)).size !== selected.length) {
      invariantFailure();
    }

    const requests = selected.map((selectedQuery) => ({
      requestRef: `request-${randomUUID()}`,
      plannedQueryRef: selectedQuery.plannedQueryRef,
      ...selectedQuery.request,
    } satisfies NormalizedPlannedRequest));

    // No await occurs between identity/invariant validation and this write.
    // Malformed input leaves the executor reusable; a valid concurrent or
    // reentrant second call observes consumed before provider work begins.
    state.consumed = true;
    state.execution.requests.push(...requests);

    const settled = await Promise.all(requests.map(async (request) => {
      const beforeRequest = inspectVerifiedRunningResearchStage(state.runningStage);
      if (
        !beforeRequest ||
        beforeRequest !== state.context ||
        Date.parse(beforeRequest.expiresAt) <= Date.now()
      ) {
        invariantFailure();
      }
      try {
        const response = await state.provider.search({
          query: request.query,
          includeDomains: [...request.approvedDomains],
          searchDepth: request.searchDepth,
        });
        if (
          !response ||
          !Array.isArray(response.results) ||
          typeof response.searchedAt !== "string" ||
          Number.isNaN(Date.parse(response.searchedAt))
        ) {
          return null;
        }

        const normalizedResults: ResearchResult[] = [];
        for (const raw of response.results) {
          const result = normalizeResult(raw, request.approvedDomains);
          if (!result) continue;
          normalizedResults.push(result);
          const host = normalizeSourceHostname(result.url)!;
          const tier = sourceTier(host)!;
          const sourceRef = `source-observation-${randomUUID()}`;
          for (const tripShapeRef of request.tripShapeRefs) {
            state.execution.observations.push({
              observationRef: `observation-${randomUUID()}`,
              requestRef: request.requestRef,
              plannedQueryRef: request.plannedQueryRef,
              tripShapeRef,
              sourceRef,
              publisherDomain: host,
              sourceTier: tier,
              sourceRole: tier === "official" ? "official_publisher" : "specialist_publisher",
              title: result.title,
              observedAt: response.searchedAt,
              excerpts: segmentContent(result.content),
            });
          }
        }
        return {
          query: request.query,
          searchedAt: new Date(response.searchedAt).toISOString(),
          results: normalizedResults,
        } satisfies ResearchResponse;
      } catch (error) {
        if (error instanceof ResearchInterpreterError) throw error;
        // Provider failures are isolated; successful siblings remain available.
        return null;
      }
    }));
    return settled.filter((response): response is ResearchResponse => response !== null);
}
