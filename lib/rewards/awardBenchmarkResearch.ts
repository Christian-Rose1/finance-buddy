/**
 * Award-benchmark research lane (Route B).
 *
 * Deterministic research pipeline that turns web-search results into
 * STRICTLY VALIDATED, human-reviewable award-price benchmark candidate rows
 * for `award_price_benchmarks`. Designed to run on a schedule (weekly) and to
 * emit reviewable seed SQL — never to write to the database directly (the
 * catalog tables are authenticated-read-only by RLS, and service-role access
 * is forbidden in ordinary flows).
 *
 * Trust rules enforced here:
 * - No LLM interprets research output. Extraction is deterministic and
 *   sentence-scoped: a candidate exists only when ONE sentence contains a
 *   whole points/miles figure, exactly one cabin term, one pricing basis,
 *   and a known reward-program name. Everything else fails closed.
 * - Every candidate carries the exact source quote (the sentence) and URL
 *   it came from. Nothing is ever paraphrased into provenance.
 * - All numbers are re-validated against bounded, defensible ranges before
 *   emission; the seed emitter re-validates again.
 * - Region scope comes only from the deterministic query plan (the caller's
 *   declared route pair), never from parsing prose; candidates are flagged
 *   so a human reviewer must confirm the quoted sentence actually matches
 *   that scope before applying.
 * - Output is a fresh object; inputs are never mutated.
 */

import type { ResearchProvider, ResearchQuery, ResearchResult } from "@/lib/goals/researchTypes";
import {
  isAwardBenchmarkRegion,
  type AwardBenchmarkRegion,
  type AwardPriceBenchmark,
} from "./awardBenchmarks";

/** Domains a benchmark fact is allowed to come from (official + specialist). */
export const BENCHMARK_SOURCE_DOMAINS: readonly string[] = Object.freeze([
  "aircanada.com",
  "united.com",
  "flyingblue.us",
  "britishairways.com",
  "frequentmiler.com",
  "onemileatatime.com",
  "upgradedpoints.com",
  "thepointsguy.com",
]);

/** Program names known to the catalog seed (joined case-insensitively). */
export const BENCHMARK_PROGRAM_NAMES: readonly string[] = Object.freeze([
  "Air Canada Aeroplan",
  "United MileagePlus",
  "Air France-KLM Flying Blue",
  "The British Airways Club",
  "Virgin Atlantic Flying Club",
]);

const CABIN_TERMS: ReadonlyArray<{ term: string; cabin: string }> = Object.freeze([
  { term: "premium economy", cabin: "premium_economy" },
  { term: "business class", cabin: "business" },
  { term: "business", cabin: "business" },
  { term: "first class", cabin: "first" },
  { term: "economy", cabin: "economy" },
]);

/**
 * Canonical program names with the common short aliases real sources use.
 * A sentence may identify a program by either form; both must resolve to
 * exactly one canonical catalog name or the sentence is rejected.
 */
const PROGRAM_ALIASES: ReadonlyArray<{ alias: string; canonical: string }> = Object.freeze([
  { alias: "air canada aeroplan", canonical: "Air Canada Aeroplan" },
  { alias: "aeroplan", canonical: "Air Canada Aeroplan" },
  { alias: "united mileageplus", canonical: "United MileagePlus" },
  { alias: "mileageplus", canonical: "United MileagePlus" },
  { alias: "air france-klm flying blue", canonical: "Air France-KLM Flying Blue" },
  { alias: "air france klm flying blue", canonical: "Air France-KLM Flying Blue" },
  { alias: "flying blue", canonical: "Air France-KLM Flying Blue" },
  { alias: "the british airways club", canonical: "The British Airways Club" },
  { alias: "british airways club", canonical: "The British Airways Club" },
  { alias: "virgin atlantic flying club", canonical: "Virgin Atlantic Flying Club" },
  { alias: "virgin atlantic", canonical: "Virgin Atlantic Flying Club" },
  { alias: "flying club", canonical: "Virgin Atlantic Flying Club" },
]);

export interface AwardBenchmarkCandidate {
  programName: string;
  originRegion: AwardBenchmarkRegion;
  destinationRegion: AwardBenchmarkRegion;
  cabin: string;
  pricingBasis: "one_way" | "round_trip";
  pointsRequired: number;
  cashFees: number | null;
  currency: string;
  travelerCountCovered: number;
  sourceUrl: string;
  sourceDomain: string;
  /** Exact sentence the numbers were extracted from. Reviewer must confirm it matches the region scope. */
  sourceQuote: string;
  extractedAt: string;
  /** Always "from_query": the region pair is the query plan's declaration, not prose parsing. */
  regionScopeProvenance: "from_query";
}

export interface BenchmarkResearchRoute {
  originRegion: AwardBenchmarkRegion;
  destinationRegion: AwardBenchmarkRegion;
}

interface ExtractedNumbers {
  pointsRequired: number;
  cashFees: number | null;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hostnameOf(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" ? parsed.hostname.toLowerCase() : null;
  } catch {
    return null;
  }
}

function isAllowedDomain(hostname: string): boolean {
  return BENCHMARK_SOURCE_DOMAINS.some(
    (domain) => hostname === domain || hostname.endsWith(`.${domain}`)
  );
}

/** Splits content into bounded sentences for quote-scoped extraction.
 * Common abbreviations ("U.S.", "U.K.") are protected so they cannot split a
 * sentence mid-phrase; restored verbatim so quotes stay exact. */
const SENTENCE_ABBREVIATIONS: ReadonlyArray<[RegExp, string, string]> = Object.freeze([
  [/\bU\.S\./g, "U§S§", "U.S."],
  [/\bU\.K\./g, "U§K§", "U.K."],
]);

function sentencesOf(content: string): string[] {
  let guarded = content.replace(/\s+/g, " ");
  for (const [pattern, marker] of SENTENCE_ABBREVIATIONS) {
    guarded = guarded.replace(pattern, marker);
  }
  return guarded
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => {
      let restored = sentence.trim();
      for (const [, marker, original] of SENTENCE_ABBREVIATIONS) {
        restored = restored.split(marker).join(original);
      }
      return restored;
    })
    .filter((sentence) => sentence.length >= 20 && sentence.length <= 400);
}

const POINTS_FIGURE_PATTERN =
  /\b(\d{1,3}(?:,\d{3})+|\d{4,7}|\d{1,3}K)\s*(?:points|miles)\b/i;

/**
 * Extracts a whole points/miles figure and an optional dollar fees figure
 * from one sentence. Points must be integers (comma-grouped, plain 4–7
 * digits, or the specialist-blog "60K" shorthand; no decimals, no
 * exponents). A sentence offering a RANGE of figures or more than one dollar
 * amount cannot yield one honest number and is rejected outright. Fees are
 * accepted only as "$N" or "$N.NN".
 */
function extractNumbers(sentence: string): ExtractedNumbers | null {
  const pointsMatch = sentence.match(POINTS_FIGURE_PATTERN);
  if (!pointsMatch) return null;
  // Fail closed on mixed figures: a sentence offering a RANGE cannot yield
  // one honest number, so it is rejected outright.
  const distinctFigures = new Set<string>();
  for (const figureMatch of sentence.matchAll(
    /\b\d{1,3}(?:,\d{3})+\b|\b\d{4,7}\b|\b\d{1,3}K\b/gi,
  )) {
    distinctFigures.add(figureMatch[0].toUpperCase());
  }
  if (distinctFigures.size > 1) return null;
  const isKNotation = /K$/i.test(pointsMatch[1]);
  const pointsRequired =
    Number(pointsMatch[1].replace(/,/g, "").replace(/K$/i, "")) *
    (isKNotation ? 1000 : 1);
  if (!Number.isSafeInteger(pointsRequired)) return null;

  let cashFees: number | null = null;
  const dollarFigures = new Set<string>();
  for (const dollarMatch of sentence.matchAll(/\$\s*\d{1,4}(?:\.\d{2})?\b/g)) {
    dollarFigures.add(dollarMatch[0].replace(/\s/g, ""));
  }
  if (dollarFigures.size > 1) return null;
  const feesMatch = sentence.match(/(?:\+|\bplus\b)\s*\$(\d{1,4}(?:\.\d{2})?)\b/i);
  if (feesMatch) {
    const parsed = Number(feesMatch[1]);
    if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 2000) return null;
    cashFees = parsed;
  }
  return { pointsRequired, cashFees };
}

/**
 * Exactly one cabin must be identified. "Premium economy" contains the
 * substring "economy", so multi-term matches are resolved by keeping only
 * the LONGEST matched term per position — two genuinely different cabins in
 * one sentence still fail closed.
 */
function extractCabin(sentence: string): string | null {
  const lower = sentence.toLowerCase();
  const matched = CABIN_TERMS.filter(({ term }) => lower.includes(term));
  if (matched.length === 0) return null;
  // Drop terms that are strict substrings of another matched term
  // ("economy" inside "premium economy") before the uniqueness check.
  const nonSubsumed = matched.filter(
    ({ term }) => !matched.some((other) => other.term !== term && other.term.includes(term))
  );
  const unique = [...new Set(nonSubsumed.map(({ cabin }) => cabin))];
  return unique.length === 1 ? unique[0] : null;
}

/**
 * Explicit party/multi-traveler scope means the stated figure is a PARTY
 * TOTAL, not a per-person chart price. Such sentences are rejected outright:
 * storing a party total as per-traveler would multiply it by the goal's
 * traveler count downstream (2x inflation), and deriving a per-person figure
 * by division is forbidden. Per-person wording and unstated scope (the
 * standard award-chart convention) are the only accepted bases.
 */
const PARTY_SCOPE_PATTERN =
  /\b(?:for\s+(?:two|three|four|five|six|a\s+couple|a\s+family|both)\b|per\s+couple\b|combined\b|total\s+for\b|for\s+(?:two|three|four)\s+travelers\b)/i;

/**
 * Page furniture — verdict boxes, related-article links, and markdown
 * remnants — is not authored prose and cannot prove a price. The first live
 * run emitted exactly this defect: "Winner: Aeroplan Related: How to book
 * Star Alliance business-class flights to Europe for 45,000 miles each way
 * ## Flights to South America" swallowed a related-article headline and a
 * section heading from a different region. Such sentences are rejected
 * outright so the human review gate never sees furniture as provenance.
 * Unanchored label matching is deliberately conservative: a false positive
 * costs one candidate, never a fabricated row.
 */
const PAGE_FURNITURE_PATTERN =
  /(?:winner|related|read more|learn more|advertisement|sponsored|newsletter|subscribe|editors?'?s? note|published|updated)\s*:/i;

function isPageFurniture(sentence: string): boolean {
  return sentence.includes("##") || PAGE_FURNITURE_PATTERN.test(sentence);
}

function hasExplicitPartyScope(sentence: string): boolean {
  return PARTY_SCOPE_PATTERN.test(sentence);
}

function extractPricingBasis(sentence: string): "one_way" | "round_trip" | null {
  const lower = sentence.toLowerCase();
  const oneWay =
    lower.includes("one-way") ||
    lower.includes("one way") ||
    lower.includes("each way");
  const roundTrip =
    lower.includes("round-trip") ||
    lower.includes("round trip") ||
    lower.includes("return flights") ||
    lower.includes("return trip");
  if (oneWay && roundTrip) return null;
  if (oneWay) return "one_way";
  if (roundTrip) return "round_trip";
  return null;
}

/**
 * Well-known loyalty programs OUTSIDE the benchmark catalog. If a sentence
 * names one of these, the price subject may be the non-catalog program with
 * the catalog program only mentioned incidentally ("transfer 1:1 to Flying
 * Blue, with AAdvantage partner awards from 57,500 miles" — the extractor
 * previously mis-attributed that figure to Flying Blue). Attribution is
 * then unresolvable, so the sentence fails closed. Airline operator
 * mentions ("awards on Delta") are deliberately absent: a carrier name is
 * not its loyalty program, and crediting a partner airline's operator is
 * exactly how partner-award prices are stated.
 */
const NON_CATALOG_PROGRAM_PATTERN = new RegExp(
  [
    "aadvantage",
    "skymiles",
    "trueblue",
    "rapid rewards",
    "mileage plan",
    "bonvoy",
    "world of hyatt",
    "hilton honors",
    "ihg one rewards",
    "choice privileges",
    "etihad guest",
    "emirates skywards",
    "privilege club",
    "krisflyer",
    "lifemiles",
    "miles&smiles",
    "miles and smiles",
    "infinity mileagelands",
  ].join("|"),
  "i",
);

/**
 * Resolves a sentence's program via canonical names and common aliases.
 * Ambiguity fails closed: a sentence naming two programs (or an alias that
 * matches more than one canonical program) is rejected.
 */
function extractProgramName(sentence: string): string | null {
  const lower = sentence.toLowerCase();
  if (NON_CATALOG_PROGRAM_PATTERN.test(lower)) return null;
  const canonical = new Set<string>();
  for (const name of BENCHMARK_PROGRAM_NAMES) {
    if (lower.includes(name.toLowerCase())) canonical.add(name);
  }
  for (const { alias, canonical: name } of PROGRAM_ALIASES) {
    if (lower.includes(alias)) canonical.add(name);
  }
  return canonical.size === 1 ? [...canonical][0] : null;
}

function isValidCandidateShape(value: unknown): value is AwardBenchmarkCandidate {
  if (!isPlainObject(value)) return false;
  const quote = String(value.sourceQuote ?? "");
  const numbers = extractNumbers(quote);
  const cabin = extractCabin(quote);
  const pricingBasis = extractPricingBasis(quote);
  const programName = extractProgramName(quote);
  // Provenance integrity: the URL's parsed HTTPS hostname — not a substring
  // match — must equal the claimed domain. A crafted URL like
  // https://evil.com/?u=https://www.aircanada.com must not pass by merely
  // containing a trusted domain as text.
  const urlHostname = hostnameOf(String(value.sourceUrl ?? ""));
  return (
    // Quote-consistency gate: the quote must independently support every
    // structured claim, with the same single-value rules extraction enforces.
    cabin === value.cabin &&
    pricingBasis === value.pricingBasis &&
    programName === value.programName &&
    !hasExplicitPartyScope(quote) &&
    !isPageFurniture(quote) &&
    // The quote is embedded in a SQL line comment by the emitter; any control
    // character (including a newline) could terminate the comment and inject
    // SQL. Fail closed regardless of where the candidate originated.
    !/[\u0000-\u001f\u007f]/.test(quote) &&
    !/[\u0000-\u001f\u007f]/.test(String(value.sourceUrl ?? "")) &&
    urlHostname !== null &&
    urlHostname === value.sourceDomain &&
    typeof value.programName === "string" &&
    (BENCHMARK_PROGRAM_NAMES as readonly string[]).includes(value.programName) &&
    isAwardBenchmarkRegion(value.originRegion) &&
    isAwardBenchmarkRegion(value.destinationRegion) &&
    typeof value.cabin === "string" &&
    ["economy", "premium_economy", "business", "first"].includes(value.cabin) &&
    (value.pricingBasis === "one_way" || value.pricingBasis === "round_trip") &&
    typeof value.pointsRequired === "number" &&
    Number.isSafeInteger(value.pointsRequired) &&
    value.pointsRequired >= 1000 &&
    value.pointsRequired <= 2_000_000 &&
    (value.cashFees === null ||
      (typeof value.cashFees === "number" &&
        Number.isFinite(value.cashFees) &&
        value.cashFees > 0 &&
        value.cashFees <= 2000)) &&
    value.currency === "USD" &&
    value.travelerCountCovered === 1 &&
    typeof value.sourceUrl === "string" &&
    typeof value.sourceDomain === "string" &&
    isAllowedDomain(value.sourceDomain) &&
    value.sourceUrl.includes(value.sourceDomain) &&
    typeof value.sourceQuote === "string" &&
    value.sourceQuote.length >= 20 &&
    value.sourceQuote.length <= 400 &&
    numbers !== null &&
    numbers.pointsRequired === value.pointsRequired &&
    (value.cashFees === null || numbers.cashFees === value.cashFees) &&
    typeof value.extractedAt === "string" &&
    isStrictIsoUtcInstant(value.extractedAt) &&
    value.regionScopeProvenance === "from_query"
  );
}

/**
 * Strict ISO-8601 UTC instant. Date.parse leniency is engine-defined, so the
 * emitter's own boundary must not depend on it: `extractedAt` is interpolated
 * into emitted SQL and only a tightly-bounded character set is acceptable.
 */
function isStrictIsoUtcInstant(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value) &&
    !Number.isNaN(Date.parse(value));
}

/**
 * Extracts benchmark candidates from research results for one declared route
 * pair. Only sentences from allowed HTTPS domains are considered; every other
 * sentence, cabin ambiguity, missing pricing basis, or unknown program fails
 * closed. Deterministic: result and sentence order are preserved.
 */
export function extractBenchmarkCandidates(
  results: readonly ResearchResult[],
  route: BenchmarkResearchRoute,
  extractedAt: string
): AwardBenchmarkCandidate[] {
  if (!Array.isArray(results)) return [];
  if (!isAwardBenchmarkRegion(route.originRegion) || !isAwardBenchmarkRegion(route.destinationRegion)) {
    return [];
  }
  if (route.originRegion === route.destinationRegion) return [];
  if (!isStrictIsoUtcInstant(extractedAt)) return [];

  const candidates: AwardBenchmarkCandidate[] = [];
  for (const result of results) {
    if (!isPlainObject(result)) continue;
    const domain = hostnameOf(String(result.url ?? ""));
    if (!domain || !isAllowedDomain(domain)) continue;
    const content = typeof result.content === "string" ? result.content : "";
    for (const sentence of sentencesOf(content)) {
      // Page furniture (link boxes, headings) is not authored provenance.
      if (isPageFurniture(sentence)) continue;
      // Party-scope sentences state a party total, never a per-person price.
      if (hasExplicitPartyScope(sentence)) continue;
      const numbers = extractNumbers(sentence);
      if (!numbers) continue;
      const cabin = extractCabin(sentence);
      if (!cabin) continue;
      const pricingBasis = extractPricingBasis(sentence);
      if (!pricingBasis) continue;
      const programName = extractProgramName(sentence);
      if (!programName) continue;
      const candidate: AwardBenchmarkCandidate = {
        programName,
        originRegion: route.originRegion,
        destinationRegion: route.destinationRegion,
        cabin,
        pricingBasis,
        pointsRequired: numbers.pointsRequired,
        cashFees: numbers.cashFees,
        currency: "USD",
        travelerCountCovered: 1,
        sourceUrl: String(result.url),
        sourceDomain: domain,
        sourceQuote: sentence,
        extractedAt,
        regionScopeProvenance: "from_query",
      };
      // Re-validate through the same gate used before emission.
      if (isValidCandidateShape(candidate)) {
        candidates.push(candidate);
      }
    }
  }
  return candidates;
}

/**
 * Deterministic query plan for one route pair: two query variants per
 * program — an award-chart lookup and a natural-language price question —
 * both fully derived from the route input. Models never choose queries.
 * Region phrases are role-aware nouns so searches read naturally
 * ("from the U.S. to Europe"), instead of concatenating directional
 * region labels into keyword soup.
 */
export function buildBenchmarkResearchQueries(
  route: BenchmarkResearchRoute,
  programNames: readonly string[] = BENCHMARK_PROGRAM_NAMES
): ResearchQuery[] {
  if (
    !isAwardBenchmarkRegion(route.originRegion) ||
    !isAwardBenchmarkRegion(route.destinationRegion) ||
    route.originRegion === route.destinationRegion
  ) {
    return [];
  }
  const ORIGIN_NOUNS: Record<AwardBenchmarkRegion, string> = {
    us_domestic: "the U.S.",
    transatlantic_europe: "Europe",
    intra_europe: "Europe",
    caribbean_central_america: "the Caribbean",
    south_america: "South America",
    hawaii_pacific: "Hawaii",
    east_asia: "East Asia",
    southeast_asia_oceania: "Southeast Asia",
    south_asia_middle_east: "South Asia and the Middle East",
    africa: "Africa",
    canada: "Canada",
    mexico: "Mexico",
  };
  const DESTINATION_NOUNS: Record<AwardBenchmarkRegion, string> = {
    us_domestic: "the U.S.",
    transatlantic_europe: "Europe",
    intra_europe: "within Europe",
    caribbean_central_america: "the Caribbean and Central America",
    south_america: "South America",
    hawaii_pacific: "Hawaii and the Pacific",
    east_asia: "East Asia",
    southeast_asia_oceania: "Southeast Asia and Oceania",
    south_asia_middle_east: "South Asia and the Middle East",
    africa: "Africa",
    canada: "Canada",
    mexico: "Mexico",
  };
  const originNoun = ORIGIN_NOUNS[route.originRegion];
  const destinationNoun = DESTINATION_NOUNS[route.destinationRegion];
  const queries: ResearchQuery[] = [];
  for (const programName of programNames) {
    queries.push({
      query: `${programName} award chart from ${originNoun} to ${destinationNoun} points miles economy business`,
      includeDomains: [...BENCHMARK_SOURCE_DOMAINS],
      maxResults: 10,
      searchDepth: "advanced",
    });
    queries.push({
      query: `how many ${programName} miles from ${originNoun} to ${destinationNoun} business class first class one-way cost`,
      includeDomains: [...BENCHMARK_SOURCE_DOMAINS],
      maxResults: 10,
      searchDepth: "advanced",
    });
  }
  return queries;
}

export interface BenchmarkResearchRunResult {
  queriesRun: number;
  resultsConsidered: number;
  candidates: AwardBenchmarkCandidate[];
  /** Query-level failures are surfaced by category, never by raw error text. */
  queryFailureCount: number;
}

/**
 * Executes the full research run for the given routes using the injected
 * provider. Provider failures degrade per query (counted, never thrown) so
 * one flaky query cannot discard completed work.
 */
export async function runBenchmarkResearch(
  routes: readonly BenchmarkResearchRoute[],
  provider: ResearchProvider,
  extractedAt: string
): Promise<BenchmarkResearchRunResult> {
  const candidates: AwardBenchmarkCandidate[] = [];
  let queriesRun = 0;
  let resultsConsidered = 0;
  let queryFailureCount = 0;

  for (const route of routes) {
    for (const query of buildBenchmarkResearchQueries(route)) {
      queriesRun += 1;
      try {
        const response = await provider.search(query);
        resultsConsidered += response.results.length;
        candidates.push(
          ...extractBenchmarkCandidates(response.results, route, extractedAt)
        );
      } catch {
        queryFailureCount += 1;
      }
    }
  }

  return { queriesRun, resultsConsidered, candidates, queryFailureCount };
}

// ---------------------------------------------------------------------------
// Seed SQL emitter
// ---------------------------------------------------------------------------

function sqlQuote(value: string): string {
  return value.replace(/'/g, "''");
}

/**
 * Emits idempotent seed SQL for validated candidates. Every row joins
 * `reward_programs` by exact catalog name, carries its source quote as a SQL
 * comment for human review, and is guarded by not-exists so re-running is
 * safe. The emitter re-validates every candidate and rejects the whole batch
 * (returns null) if any row fails — no partial, silently-weakened output.
 */
export function emitBenchmarkSeedSql(
  candidates: readonly AwardBenchmarkCandidate[],
  extractedAt: string
): string | null {
  if (candidates.length === 0) return null;
  if (!isStrictIsoUtcInstant(extractedAt)) return null;
  for (const candidate of candidates) {
    if (!isValidCandidateShape(candidate)) return null;
  }

  const lines: string[] = [
    `-- Award-price benchmark rows extracted by the Route B research lane on ${extractedAt}.`,
    "-- Every row below carries its source quote; a human reviewer must confirm each quote",
    "-- supports the row's program, route scope, cabin, basis, and figures before applying.",
    "-- Region scope comes from the deterministic query plan (regionScopeProvenance: from_query).",
    "-- Idempotent: existing rows are skipped (not-exists guard).",
    "insert into public.award_price_benchmarks",
    "  (reward_program_id, redemption_type, origin_region, destination_region, cabin,",
    "   pricing_basis, points_required, cash_fees, currency, traveler_count_covered,",
    "   night_count_covered, valid_from, valid_until, source, last_verified_at, active)",
    "select",
    "  rp.id, 'flight', v.origin_region, v.destination_region, v.cabin,",
    "  v.pricing_basis, v.points_required, v.cash_fees, v.currency, v.traveler_count_covered,",
    "  null, now(), null, v.source, v.last_verified_at::timestamptz, true",
    "from (",
    "  values",
  ];

  const valueRows = candidates.map((candidate) => {
    // In a values list Postgres infers an all-null column as text, which
    // cannot assign into the numeric cash_fees column (SQLSTATE 42804).
    // Null fees therefore carry an explicit cast.
    const fees =
      candidate.cashFees === null ? "null::numeric" : candidate.cashFees.toFixed(2);
    return [
      `    (`,
      `      '${sqlQuote(candidate.programName)}', -- ${sqlQuote(candidate.sourceQuote)}`,
      `      '${candidate.originRegion}', '${candidate.destinationRegion}', '${candidate.cabin}',`,
      `      '${candidate.pricingBasis}', ${candidate.pointsRequired}, ${fees}, '${candidate.currency}',`,
      `      ${candidate.travelerCountCovered}, '${sqlQuote(candidate.sourceUrl)}',`,
      `      '${candidate.extractedAt}'`,
      `    )`,
    ].join("\n");
  });

  lines.push(valueRows.join(",\n"));
  lines.push(") as v(program_name, origin_region, destination_region, cabin, pricing_basis, points_required, cash_fees, currency, traveler_count_covered, source, last_verified_at)");
  lines.push("join public.reward_programs rp on lower(rp.name) = lower(v.program_name)");
  lines.push("where not exists (");
  lines.push("  select 1 from public.award_price_benchmarks b");
  lines.push("  where b.reward_program_id = rp.id");
  lines.push("    and b.origin_region = v.origin_region");
  lines.push("    and b.destination_region = v.destination_region");
  lines.push("    and b.cabin = v.cabin");
  lines.push("    and b.pricing_basis = v.pricing_basis");
  lines.push("    and b.points_required = v.points_required");
  lines.push(");");
  return lines.join("\n");
}

/**
 * Deduplicates candidates for review: identical (program, route, cabin,
 * basis) rows collapse to the first occurrence, preserving deterministic
 * order. Figures differing within a group are all kept for human review —
 * conflicting sources are never averaged or silently preferred.
 */
export function dedupeBenchmarkCandidates(
  candidates: readonly AwardBenchmarkCandidate[]
): AwardBenchmarkCandidate[] {
  const seen = new Set<string>();
  const result: AwardBenchmarkCandidate[] = [];
  for (const candidate of candidates) {
    const key = [
      candidate.programName,
      candidate.originRegion,
      candidate.destinationRegion,
      candidate.cabin,
      candidate.pricingBasis,
      candidate.pointsRequired,
      candidate.cashFees ?? "null",
    ].join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(candidate);
  }
  return result;
}

/** Type guard re-export for the CLI script. */
export function isValidBenchmarkCandidate(
  value: unknown
): value is AwardBenchmarkCandidate {
  return isValidCandidateShape(value);
}

/** Compatibility alias used by tests to reference the benchmark row shape. */
export type BenchmarkCandidateRow = Pick<AwardPriceBenchmark, "pointsRequired" | "cashFees" | "cabin">;
