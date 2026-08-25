/**
 * AI-driven research planner — core building blocks.
 *
 * Contains the system prompt, JSON schema, validation, JSON extraction, and
 * the deterministic fallback planner. Provider implementations and the
 * factory live in researchPlanner.ts.
 *
 * Guarantees:
 * - Never sends userId, internal database IDs, ownerKey, ownerLabel,
 *   balanceAsOf, or goal.status to any provider or into any query string.
 * - Every query's includeDomains must be a subset of TRUSTED_DOMAINS; any
 *   untrusted domain causes the entire plan to be rejected.
 * - Maximum 8 queries per plan; at least 1 query is required.
 */

import { TRUSTED_DOMAINS } from "./researchTypes";
import { buildStrategyResearchQueries } from "./strategyResearchQueries";
import type {
  ResearchPlan,
  ResearchPlanQuery,
  ResearchPlannerInput,
} from "./researchPlannerTypes";

// ---------------------------------------------------------------------------
// Error and constants
// ---------------------------------------------------------------------------

export class ResearchPlannerError extends Error {
  constructor(
    message: string,
    readonly provider: string = "unknown",
    readonly model: string = "unknown"
  ) {
    super(message);
    this.name = "ResearchPlannerError";
  }
}

export const MAX_PLAN_QUERIES = 8;
export const MAX_QUERY_LENGTH = 400;
const MAX_PURPOSE_LENGTH = 300;
const MAX_REASONING_LENGTH = 2000;
// Generous enough to allow the full trusted-domain list in one query
// (used by the deterministic fallback planner); the true safety boundary is
// the trusted-domain whitelist itself, not the count.
const MAX_DOMAINS_PER_QUERY = 25;

const RESEARCH_QUERY_CATEGORIES = [
  "flight",
  "hotel",
  "card",
  "temporal",
  "value",
] as const;

// ---------------------------------------------------------------------------
// Public prompt payload
// ---------------------------------------------------------------------------

/**
 * Serializes the planner input for a model. ResearchPlannerInput is already
 * sanitized by construction; this function exists so the boundary is
 * explicit and reviewable.
 */
export function buildPublicPlannerPayload(
  input: ResearchPlannerInput
): string {
  return JSON.stringify(input);
}

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

export const RESEARCH_PLANNER_SYSTEM_PROMPT = `You are the research planner for Finance Buddy, a credit-card points strategist.

Your job: given a user's travel goal and financial context, produce a targeted web-research plan that finds the information needed to build a personalized points strategy.

You will receive JSON describing:
- goal: travel details (origin, destinations, dates, nights, travelers, cabin, cash budget, allowNewCards)
- rewardAccounts: points/miles balances the user owns, by program
- walletCards: credit cards the user owns
- monthlySpendingByCategory: average monthly spend per category
- customerRewardPrograms: reward programs the user participates in
- transferPartners: which programs the user's points can transfer to
- currentDate: today's date
- daysUntilDeparture: days until the trip starts (may be null)

Produce a JSON object with exactly this shape:
{
  "reasoning": "<2-4 sentences: what information gaps exist and how your queries address them>",
  "queries": [
    {
      "query": "<search string, max ${MAX_QUERY_LENGTH} chars>",
      "includeDomains": ["<domain>", ...],
      "purpose": "<why this query exists>",
      "category": "flight" | "hotel" | "card" | "temporal" | "value",
      "searchDepth": "basic" | "advanced"
    }
  ]
}

Rules:
1. Produce between 2 and ${MAX_PLAN_QUERIES} queries.
2. Every includeDomains entry must be exactly one of the allowed domains listed below. Never invent domains. Use at most ${MAX_DOMAINS_PER_QUERY} domains per query and choose domains likely to have the content you seek.
3. Allowed domains: ${JSON.stringify(TRUSTED_DOMAINS)}.
4. Query strings must be concise web-search phrases. Do NOT include any user identifiers or account IDs. Program names, destinations, and dates are fine.
5. category "flight": flight award redemptions for the goal's route and dates, using the user's actual programs and transfer partners.
6. category "hotel": ALWAYS produce exactly 2 hotel queries: a. A program-specific query naming the destination and the hotel programs the user's points can transfer to (e.g. "Paris World of Hyatt award points per night Chase Ultimate Rewards transfer"). Use searchDepth "advanced" for this query. b. A destination-generic benchmark query that does NOT name Chase or any transfer source — only the destination and hotel program names (e.g. "Paris hotel points per night award category pricing World of Hyatt Marriott IHG"). Use searchDepth "basic" for this query. For this query, prefer includeDomains from specialist sites: thepointsguy.com, upgradedpoints.com, onemileatatime.com, liveandletsfly.com, nerdwallet.com.
7. category "card": credit-card welcome bonuses or spending multipliers relevant to closing the points gap. Only include card queries if goal.allowNewCards is true. When monthlySpendingByCategory is nonempty, you MUST reference the user's top 1-2 spending categories by name in the card query (e.g. "best credit card welcome bonus dining travel") so results target what the user actually spends. When the goal's cash budget is set, prefer queries that surface cards whose welcome bonus could close the points gap within the timeframe implied by daysUntilDeparture. Include the current year (e.g. "2026") in card queries to surface current offers with concrete bonus amounts and spending requirements. For card queries, prefer includeDomains from sites known to publish structured offer data: thepointsguy.com, nerdwallet.com, upgradedpoints.com, frequentmiler.com.
8. category "temporal": booking windows, award-release timing, current or upcoming transfer-bonus promotions, and award-program devaluation news relevant to the goal's timeframe. For temporal queries, prefer includeDomains: thepointsguy.com, onemileatatime.com, frequentmiler.com, upgradedpoints.com.
9. category "value": disproportionately good redemptions (sweet spots), transfer bonuses, or off-peak pricing for the goal's destination and programs. For value queries, prefer includeDomains: thepointsguy.com, onemileatatime.com, milevalue.com, upgradedpoints.com.
10. Use "advanced" searchDepth for flight queries; use "basic" for everything else unless the topic is obscure.
11. Base every query on the actual data provided. Never invent balances, transfer partners, programs, or award prices. If a field is missing, do not assume it.
12. If the user has no reward accounts and no cards, still produce flight and hotel queries using the goal's destinations and dates.
13. Earning runway: when daysUntilDeparture and monthlySpendingByCategory are both available, reason in your "reasoning" field about whether the user's current monthly earning pace is likely sufficient to close any points gap before departure, and let that reasoning influence which queries you prioritize (e.g. if earning runway is short, prioritize card welcome-bonus queries over incremental earning queries).

Respond with JSON only. Do not include markdown fences or commentary outside the JSON object.`;

// ---------------------------------------------------------------------------
// JSON schema (documentation + for structured-output providers)
// ---------------------------------------------------------------------------

export const RESEARCH_PLAN_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["reasoning", "queries"],
  properties: {
    reasoning: { type: "string" },
    queries: {
      type: "array",
      minItems: 1,
      maxItems: MAX_PLAN_QUERIES,
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "query",
          "includeDomains",
          "purpose",
          "category",
          "searchDepth",
        ],
        properties: {
          query: { type: "string", minLength: 1, maxLength: MAX_QUERY_LENGTH },
          includeDomains: {
            type: "array",
            minItems: 1,
            maxItems: MAX_DOMAINS_PER_QUERY,
            items: { type: "string" },
          },
          purpose: {
            type: "string",
            minLength: 1,
            maxLength: MAX_PURPOSE_LENGTH,
          },
          category: { type: "string", enum: [...RESEARCH_QUERY_CATEGORIES] },
          searchDepth: { type: "string", enum: ["basic", "advanced"] },
        },
      },
    },
  },
} as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Extracts the first balanced JSON object from a model response string.
 * Tolerates markdown code fences and leading/trailing commentary.
 */
export function extractJsonBlock(raw: string): string {
  const trimmed = raw.trim();
  const start = trimmed.indexOf("{");
  if (start === -1) return trimmed;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < trimmed.length; i++) {
    const char = trimmed[i];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
    } else if (char === "{") {
      depth++;
    } else if (char === "}") {
      depth--;
      if (depth === 0) {
        return trimmed.slice(start, i + 1);
      }
    }
  }

  return trimmed.slice(start);
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Validates unknown parsed JSON into a ResearchPlan.
 * Throws ResearchPlannerError when the shape is invalid or any domain is not
 * in TRUSTED_DOMAINS.
 */
export function validateResearchPlan(parsed: unknown): ResearchPlan {
  if (!isRecord(parsed)) {
    throw new ResearchPlannerError("Research plan must be a JSON object.");
  }

  const reasoning =
    typeof parsed.reasoning === "string" ? parsed.reasoning.trim() : "";

  if (!reasoning) {
    throw new ResearchPlannerError(
      'Research plan missing required string field "reasoning".'
    );
  }

  if (!Array.isArray(parsed.queries)) {
    throw new ResearchPlannerError(
      'Research plan missing required array field "queries".'
    );
  }

  if (parsed.queries.length === 0) {
    throw new ResearchPlannerError("Research plan contains no queries.");
  }

  if (parsed.queries.length > MAX_PLAN_QUERIES) {
    throw new ResearchPlannerError(
      `Research plan contains ${parsed.queries.length} queries; maximum is ${MAX_PLAN_QUERIES}.`
    );
  }

  const queries: ResearchPlanQuery[] = [];

  for (let i = 0; i < parsed.queries.length; i++) {
    const raw = parsed.queries[i];

    if (!isRecord(raw)) {
      throw new ResearchPlannerError(`Query at index ${i} is not an object.`);
    }

    const query = typeof raw.query === "string" ? raw.query.trim() : "";
    if (!query) {
      throw new ResearchPlannerError(
        `Query at index ${i} missing required string field "query".`
      );
    }
    if (query.length > MAX_QUERY_LENGTH) {
      throw new ResearchPlannerError(
        `Query at index ${i} exceeds ${MAX_QUERY_LENGTH} characters.`
      );
    }

    if (
      !Array.isArray(raw.includeDomains) ||
      raw.includeDomains.length === 0
    ) {
      throw new ResearchPlannerError(
        `Query at index ${i} missing nonempty "includeDomains" array.`
      );
    }
    if (raw.includeDomains.length > MAX_DOMAINS_PER_QUERY) {
      throw new ResearchPlannerError(
        `Query at index ${i} has more than ${MAX_DOMAINS_PER_QUERY} domains.`
      );
    }

    const includeDomains: string[] = [];
    for (const domain of raw.includeDomains) {
      if (typeof domain !== "string" || !domain.trim()) {
        throw new ResearchPlannerError(
          `Query at index ${i} contains a non-string domain.`
        );
      }
      const normalized = domain.trim().toLowerCase();
      if (!TRUSTED_DOMAINS.includes(normalized)) {
        throw new ResearchPlannerError(
          `Query at index ${i} contains untrusted domain "${normalized}".`
        );
      }
      if (!includeDomains.includes(normalized)) {
        includeDomains.push(normalized);
      }
    }

    const purpose = typeof raw.purpose === "string" ? raw.purpose.trim() : "";
    if (!purpose) {
      throw new ResearchPlannerError(
        `Query at index ${i} missing required string field "purpose".`
      );
    }

    const category = raw.category;
    if (
      typeof category !== "string" ||
      !RESEARCH_QUERY_CATEGORIES.includes(
        category as (typeof RESEARCH_QUERY_CATEGORIES)[number]
      )
    ) {
      throw new ResearchPlannerError(
        `Query at index ${i} has invalid category "${String(category)}".`
      );
    }

    const searchDepth = raw.searchDepth === "advanced" ? "advanced" : "basic";

    queries.push({
      query: query.slice(0, MAX_QUERY_LENGTH),
      includeDomains,
      purpose: purpose.slice(0, MAX_PURPOSE_LENGTH),
      category: category as ResearchPlanQuery["category"],
      searchDepth,
    });
  }

  return {
    reasoning: reasoning.slice(0, MAX_REASONING_LENGTH),
    queries,
    generatedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Fallback planner (deterministic, no model required)
// ---------------------------------------------------------------------------

/**
 * Builds a deterministic ResearchPlan from the template-based
 * buildStrategyResearchQueries output. Used when OpenRouter is not
 * configured or when the AI planner fails.
 *
 * ResearchPlannerInput.goal is structurally compatible with the template
 * builder's expected goal shape.
 */
export function buildFallbackResearchPlan(
  input: ResearchPlannerInput
): ResearchPlan {
  const { flightQueries, hotelQueries, cardQueries } =
    buildStrategyResearchQueries(input.goal, input.customerRewardPrograms);

  const queries: ResearchPlanQuery[] = [];

  for (const q of flightQueries) {
    queries.push({
      query: q,
      includeDomains: [...TRUSTED_DOMAINS],
      purpose: "Template fallback: flight award redemption options.",
      category: "flight",
      searchDepth: "advanced",
    });
  }

  for (const q of hotelQueries) {
    queries.push({
      query: q,
      includeDomains: [...TRUSTED_DOMAINS],
      purpose: "Template fallback: hotel award redemption options.",
      category: "hotel",
      searchDepth: "basic",
    });
  }

  // Second hotel query: destination-generic benchmark that does NOT name
  // the user's points source programs. This broadens intersection coverage
  // when the program-specific query is too constrained.
  if (input.goal.destinations && input.goal.destinations.length > 0) {
    const destGeneric = input.goal.destinations.join(", ");
    const dateGeneric =
      input.goal.earliestDeparture && input.goal.latestReturn
        ? ` in ${input.goal.earliestDeparture} to ${input.goal.latestReturn}`
        : "";
    queries.push({
      query: `${destGeneric} hotel award points per night category pricing${dateGeneric}`,
      includeDomains: [
        "thepointsguy.com",
        "upgradedpoints.com",
        "onemileatatime.com",
        "liveandletsfly.com",
        "nerdwallet.com",
      ],
      purpose:
        "Fallback: destination-generic hotel award pricing benchmark (no transfer source named).",
      category: "hotel",
      searchDepth: "basic",
    });
  }

  for (const q of cardQueries) {
    queries.push({
      query: q,
      includeDomains: [...TRUSTED_DOMAINS],
      purpose: "Template fallback: credit card welcome bonus offers.",
      category: "card",
      searchDepth: "basic",
    });
  }

  return {
    reasoning:
      "Deterministic fallback plan generated from templates (AI planner unavailable).",
    queries,
    generatedAt: new Date().toISOString(),
  };
}
