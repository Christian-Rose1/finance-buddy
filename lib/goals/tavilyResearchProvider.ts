import {
  OFFICIAL_DOMAINS,
  SPECIALIST_DOMAINS,
  TRUSTED_DOMAINS,
  type ResearchProvider,
  type ResearchQuery,
  type ResearchResponse,
  type ResearchResult,
  type ResearchSourceTier,
} from "./researchTypes";

const TAVILY_ENDPOINT = "https://api.tavily.com/search";
const DEFAULT_MAX_RESULTS = 5;
const MIN_MAX_RESULTS = 1;
const MAX_MAX_RESULTS = 10;
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_TITLE_LENGTH = 300;
const MAX_CONTENT_LENGTH = 5_000;

export class TavilyResearchError extends Error {
  constructor(
    message: string,
    readonly status?: number
  ) {
    super(message);
    this.name = "TavilyResearchError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hostnameOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function isWithinDomains(hostname: string, domains: string[]): boolean {
  return domains.some(
    (domain) => hostname === domain || hostname.endsWith(`.${domain}`)
  );
}

function tierForDomain(domain: string): ResearchSourceTier {
  if (OFFICIAL_DOMAINS.includes(domain)) {
    return "official";
  }

  if (SPECIALIST_DOMAINS.includes(domain)) {
    return "specialist";
  }

  return "general";
}

function mapResponse(
  payload: unknown,
  query: string,
  includeDomains: string[]
): ResearchResponse {
  if (!isRecord(payload)) {
    throw new TavilyResearchError(
      "Tavily response was not a JSON object."
    );
  }

  if (!Array.isArray(payload.results)) {
    throw new TavilyResearchError(
      'Tavily response missing required array field "results".'
    );
  }

  const results: ResearchResult[] = [];

  for (const raw of payload.results) {
    if (!isRecord(raw)) {
      throw new TavilyResearchError(
        "Tavily response contained a non-object result."
      );
    }

    if (
      typeof raw.title !== "string" ||
      typeof raw.url !== "string" ||
      typeof raw.content !== "string"
    ) {
      throw new TavilyResearchError(
        "Tavily response result missing required string fields."
      );
    }

    if (!raw.url.startsWith("https://")) {
      continue;
    }

    const hostname = hostnameOf(raw.url);

    if (!hostname || !isWithinDomains(hostname, includeDomains)) {
      continue;
    }

    const matchedDomain = includeDomains.find(
      (domain) =>
        hostname === domain || hostname.endsWith(`.${domain}`)
    );

    const score =
      raw.score === null || raw.score === undefined
        ? null
        : typeof raw.score === "number" && Number.isFinite(raw.score)
          ? raw.score
          : null;

    const publishedDate =
      typeof raw.publishedDate === "string" ? raw.publishedDate : null;

    results.push({
      title: raw.title.slice(0, MAX_TITLE_LENGTH),
      url: raw.url,
      content: raw.content.slice(0, MAX_CONTENT_LENGTH),
      score,
      publishedDate,
      sourceTier: matchedDomain
        ? tierForDomain(matchedDomain)
        : "general",
    });
  }

  return {
    query,
    results,
    searchedAt: new Date().toISOString(),
  };
}

export class TavilyResearchProvider implements ResearchProvider {
  private readonly apiKey: string;

  constructor(apiKey?: string) {
    if (typeof process === "undefined" || !process.env) {
      throw new TavilyResearchError(
        "Tavily research provider can only run in a server environment."
      );
    }

    const key = apiKey ?? process.env.TAVILY_API_KEY ?? "";

    if (!key.trim()) {
      throw new TavilyResearchError(
        "TAVILY_API_KEY environment variable is required."
      );
    }

    this.apiKey = key;
  }

  async search(input: ResearchQuery): Promise<ResearchResponse> {
    if (!input || typeof input !== "object" || Array.isArray(input)) {
      throw new TavilyResearchError(
        "Research query must be an object."
      );
    }

    const query = typeof input.query === "string" ? input.query.trim() : "";

    if (!query) {
      throw new TavilyResearchError(
        "Research query must be a nonempty string."
      );
    }

    if (
      !Array.isArray(input.includeDomains) ||
      input.includeDomains.length === 0
    ) {
      throw new TavilyResearchError(
        "includeDomains must be a nonempty array."
      );
    }

    for (const domain of input.includeDomains) {
      if (!TRUSTED_DOMAINS.includes(domain)) {
        throw new TavilyResearchError(
          `Untrusted domain "${domain}". Only trusted domains are allowed.`
        );
      }
    }

    const maxResults = input.maxResults ?? DEFAULT_MAX_RESULTS;

    if (
      !Number.isInteger(maxResults) ||
      maxResults < MIN_MAX_RESULTS ||
      maxResults > MAX_MAX_RESULTS
    ) {
      throw new TavilyResearchError(
        "maxResults must be an integer from 1 through 10."
      );
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(
      () => controller.abort(),
      REQUEST_TIMEOUT_MS
    );

    let response: Response;

    try {
      response = await fetch(TAVILY_ENDPOINT, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        signal: controller.signal,
        body: JSON.stringify({
          query,
          search_depth: input.searchDepth === "advanced" ? "advanced" : "basic",
          max_results: maxResults,
          include_domains: [...input.includeDomains],
          include_answer: false,
          include_raw_content: false,
        }),
      });
    } catch (error) {
      if (controller.signal.aborted) {
        throw new TavilyResearchError(
          `Tavily search request timed out after ${REQUEST_TIMEOUT_MS}ms.`
        );
      }

      throw new TavilyResearchError(
        `Failed to reach Tavily. ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    } finally {
      clearTimeout(timeoutId);
    }

    if (!response.ok) {
      throw new TavilyResearchError(
        `Tavily returned HTTP ${response.status}.`,
        response.status
      );
    }

    let payload: unknown;

    try {
      payload = await response.json();
    } catch {
      throw new TavilyResearchError(
        "Tavily returned a non-JSON response."
      );
    }

    return mapResponse(payload, query, input.includeDomains);
  }
}