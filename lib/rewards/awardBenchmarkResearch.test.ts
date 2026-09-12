import assert from "node:assert/strict";
import { test } from "node:test";

import {
  DEFAULT_BENCHMARK_RESEARCH_ROUTES,
  BENCHMARK_PROGRAM_NAMES,
  BENCHMARK_SOURCE_DOMAINS,
  buildBenchmarkResearchQueries,
  dedupeBenchmarkCandidates,
  emitBenchmarkSeedSql,
  extractBenchmarkCandidates,
  runBenchmarkResearch,
  isValidBenchmarkCandidate,
  type AwardBenchmarkCandidate,
} from "./awardBenchmarkResearch";
import type { ResearchQuery, ResearchResponse, ResearchResult } from "@/lib/goals/researchTypes";

const ROUTE = { originRegion: "us_domestic", destinationRegion: "transatlantic_europe" } as const;
const NOW = "2026-09-10T00:00:00.000Z";

function result(overrides: Partial<ResearchResult> = {}): ResearchResult {
  return {
    title: "Award chart",
    url: "https://www.aircanada.com/aeroplan/chart",
    content:
      "Air Canada Aeroplan flights from the U.S. to Europe in economy start at 60,000 points one-way plus $80. " +
      "Air Canada Aeroplan business class on the same route requires 120,000 points one-way plus $120.",
    score: 0.9,
    publishedDate: null,
    sourceTier: "official",
    ...overrides,
  };
}

function candidate(overrides: Partial<AwardBenchmarkCandidate> = {}): AwardBenchmarkCandidate {
  return {
    programName: "Air Canada Aeroplan",
    originRegion: "us_domestic",
    destinationRegion: "transatlantic_europe",
    cabin: "economy",
    pricingBasis: "one_way",
    pointsRequired: 60000,
    cashFees: 80,
    currency: "USD",
    travelerCountCovered: 1,
    sourceUrl: "https://www.aircanada.com/aeroplan/chart",
    sourceDomain: "www.aircanada.com",
    sourceQuote:
      "Air Canada Aeroplan flights from the U.S. to Europe in economy start at 60,000 points one-way plus $80.",
    extractedAt: NOW,
    regionScopeProvenance: "from_query",
    ...overrides,
  };
}

test("query builder emits two deterministic query variants per program for a valid route", () => {
  const queries = buildBenchmarkResearchQueries(ROUTE);
  assert.equal(queries.length, BENCHMARK_PROGRAM_NAMES.length * 2);
  const first = queries[0]!;
  assert.equal(first.includeDomains.length, BENCHMARK_SOURCE_DOMAINS.length);
  assert.equal(first.maxResults, 10);
  assert.equal(first.searchDepth, "advanced");
  // Natural-language route phrases, not concatenated directional labels.
  assert.ok(first.query.includes("from the U.S. to Europe"));
  assert.ok(!first.query.includes("Europe from the U.S. to"));
  // Each program gets one chart lookup and one natural-language variant.
  for (const name of BENCHMARK_PROGRAM_NAMES) {
    const programQueries = queries.filter((q) => q.query.includes(name));
    assert.equal(programQueries.length, 2, name);
    assert.ok(programQueries.some((q) => q.query.includes("award chart")), name);
    assert.ok(programQueries.some((q) => q.query.includes("how many")), name);
  }
  // Deterministic: same input, same order.
  assert.deepEqual(buildBenchmarkResearchQueries(ROUTE).map((q) => q.query), queries.map((q) => q.query));
});

test("query builder fails closed on invalid routes", () => {
  assert.deepEqual(buildBenchmarkResearchQueries({ originRegion: "us_domestic", destinationRegion: "us_domestic" }), []);
  // @ts-expect-error hostile input
  assert.deepEqual(buildBenchmarkResearchQueries({ originRegion: "atlantis", destinationRegion: "canada" }), []);
});

test("extracts exact figures from a qualifying sentence", () => {
  const candidates = extractBenchmarkCandidates([result()], ROUTE, NOW);
  assert.equal(candidates.length, 2);
  const economy = candidates[0]!;
  assert.equal(economy.programName, "Air Canada Aeroplan");
  assert.equal(economy.cabin, "economy");
  assert.equal(economy.pricingBasis, "one_way");
  assert.equal(economy.pointsRequired, 60000);
  assert.equal(economy.cashFees, 80);
  assert.equal(economy.currency, "USD");
  assert.equal(economy.travelerCountCovered, 1);
  assert.equal(economy.regionScopeProvenance, "from_query");
  // Provenance is the exact sentence, not a paraphrase.
  assert.ok(economy.sourceQuote.includes("60,000 points one-way plus $80"));
  assert.equal(economy.sourceUrl, "https://www.aircanada.com/aeroplan/chart");
});

test("extracts comma-grouped points exactly and rejects malformed numbers", () => {
  const good = extractBenchmarkCandidates(
    [result({ content: "United MileagePlus charges 30,000 miles one-way in economy within the U.S. region." })],
    ROUTE,
    NOW,
  );
  assert.equal(good[0]?.pointsRequired, 30000);
  assert.equal(good[0]?.cashFees, null);

  const hostile = [
    "1,2,3 miles one-way economy",
    "60,000.50 points one-way economy",
    "12abc points one-way economy",
    "1e6 points one-way economy",
    "99 points one-way economy",
  ];
  for (const content of hostile) {
    const candidates = extractBenchmarkCandidates([result({ content: `${content} for United MileagePlus.` })], ROUTE, NOW);
    assert.equal(candidates.length, 0, `should reject: ${content}`);
  }
});

test("ambiguous sentences fail closed", () => {
  const ambiguous: Array<[string, string]> = [
    ["two cabins", "United MileagePlus offers 30000 miles one-way in economy or business plus $80."],
    ["two programs", "United MileagePlus and Air Canada Aeroplan charge 30000 points one-way in economy."],
    ["no pricing basis", "Air Canada Aeroplan economy flights to Europe cost 60000 points plus $80 per person."],
    ["no program", "Economy flights to Europe start at 60000 points one-way plus $80."],
    ["no points", "Air Canada Aeroplan economy flights to Europe are affordable one-way plus $80."],
    ["both bases", "Air Canada Aeroplan economy one-way round-trip fares cost 60000 points plus $80."],
  ];
  for (const [label, content] of ambiguous) {
    const candidates = extractBenchmarkCandidates([result({ content })], ROUTE, NOW);
    assert.equal(candidates.length, 0, `should reject ${label}`);
  }
});

test("non-HTTPS, disallowed, and malformed source URLs are rejected", () => {
  const urls = [
    "http://www.aircanada.com/aeroplan/chart",
    "https://random-blog.example.com/chart",
    "not-a-url",
    "https://aircanada.com.evil.example/chart",
  ];
  for (const url of urls) {
    const candidates = extractBenchmarkCandidates([result({ url })], ROUTE, NOW);
    assert.equal(candidates.length, 0, `should reject: ${url}`);
  }
});

test("results from disallowed domains never contribute even with perfect sentences", () => {
  const candidates = extractBenchmarkCandidates(
    [result({ url: "https://some-forum.com/thread", content: "Air Canada Aeroplan economy to Europe costs 60000 points one-way plus $80." })],
    ROUTE,
    NOW,
  );
  assert.equal(candidates.length, 0);
});

test("dedupe collapses identical rows, keeps conflicting figures for review, preserves order", () => {
  const a = candidate();
  const aClone = candidate({ extractedAt: "2026-09-11T00:00:00.000Z" });
  const conflicting = candidate({ pointsRequired: 65000 });
  const business = candidate({ cabin: "business", pointsRequired: 120000, cashFees: 120 });
  const deduped = dedupeBenchmarkCandidates([a, aClone, conflicting, business]);
  assert.equal(deduped.length, 3);
  assert.deepEqual(deduped.map((c) => c.pointsRequired), [60000, 65000, 120000]);
  assert.equal(deduped[0]?.extractedAt, NOW, "first occurrence wins");
});

test("emitter produces idempotent SQL with provenance comments and escaping", () => {
  const sql = emitBenchmarkSeedSql([candidate({ sourceQuote: "Air Canada Aeroplan economy awards cost 60,000 points one-way plus $80; O'Brien's finding" })], NOW);
  assert.ok(sql);
  assert.ok(sql!.includes("insert into public.award_price_benchmarks"));
  assert.ok(sql!.includes("join public.reward_programs rp on lower(rp.name) = lower(v.program_name)"));
  assert.ok(sql!.includes("where not exists ("));
  assert.ok(sql!.includes("on conflict") === false, "guard is not-exists, not conflict clause");
  // Single quotes escaped; provenance quote present.
  assert.ok(sql!.includes("O''Brien''s finding"), "escaped apostrophes present");
  assert.ok(sql!.includes("60,000 points one-way plus $80"));
  assert.ok(sql!.includes("'https://www.aircanada.com/aeroplan/chart'"));
  // Idempotent: emitting twice yields identical SQL.
  assert.equal(emitBenchmarkSeedSql([candidate()], NOW), emitBenchmarkSeedSql([candidate()], NOW));
});

test("validator rejects quotes whose provenance does not support the structured claims", () => {
  // Quote lacks any cabin term: cannot support cabin: "economy".
  assert.equal(isValidBenchmarkCandidate(candidate({ sourceQuote: "Air Canada Aeroplan awards cost 60,000 points one-way plus $80." })), false);
  // Quote names a different program than the structured field.
  assert.equal(isValidBenchmarkCandidate(candidate({ sourceQuote: "United MileagePlus economy awards cost 60,000 points one-way plus $80." })), false);
  // Quote states a party total: the figure is not per-person.
  assert.equal(isValidBenchmarkCandidate(candidate({ sourceQuote: "Air Canada Aeroplan economy awards for two travelers cost 60,000 points one-way plus $80." })), false);
  // Quote contains two figures where only one is claimed with fees.
  assert.equal(isValidBenchmarkCandidate(candidate({ sourceQuote: "Air Canada Aeroplan economy costs 60,000 points or business costs 120,000 points one-way plus $80." })), false);
});

test("party-total sentences are rejected rather than stored as per-person figures", () => {
  const rejected = extractBenchmarkCandidates(
    [result({ content: "Air Canada Aeroplan round-trip economy awards for two travelers cost 120,000 points plus $80." })],
    ROUTE,
    NOW,
  );
  assert.equal(rejected.length, 0);
  // Per-person wording remains accepted.
  const perPerson = extractBenchmarkCandidates(
    [result({ content: "Air Canada Aeroplan round-trip economy awards cost 60,000 points per person plus $80." })],
    ROUTE,
    NOW,
  );
  assert.equal(perPerson.length, 1);
  assert.equal(perPerson[0]?.travelerCountCovered, 1);
  assert.equal(perPerson[0]?.pointsRequired, 60000);
});

test("emitted SQL casts null fees to numeric so Postgres can type the values list", () => {
  // A values list with an all-null column is inferred as text by Postgres,
  // which cannot assign into numeric cash_fees (SQLSTATE 42804) — the exact
  // failure the first applied seed migration hit. Null fees must be emitted
  // with an explicit cast; present fees stay a plain numeric literal.
  const withNullFees = emitBenchmarkSeedSql([candidate({ cashFees: null })], NOW);
  assert.ok(withNullFees !== null);
  assert.ok(withNullFees.includes("null::numeric"), "null fees must carry a numeric cast");
  const withFees = emitBenchmarkSeedSql([candidate({ cashFees: 80 })], NOW);
  assert.ok(withFees !== null);
  assert.ok(!withFees.includes("null::numeric"), "present fees stay a plain literal");
  assert.ok(withFees.includes("80.00"));
});

test("emitter rejects the whole batch if any candidate is invalid — no partial output", () => {
  assert.equal(emitBenchmarkSeedSql([], NOW), null);
  assert.equal(emitBenchmarkSeedSql([candidate()], NOW), emitBenchmarkSeedSql([candidate()], NOW));
  const bad = candidate({ pointsRequired: 999_999_999 });
  assert.equal(emitBenchmarkSeedSql([candidate(), bad], NOW), null);
  assert.equal(emitBenchmarkSeedSql([candidate()], "not-a-date"), null);
});

test("candidates with control characters in provenance are rejected outright", () => {
  // The emitter embeds the quote in a SQL line comment: a newline would
  // terminate the comment and allow SQL injection into the emitted migration.
  const injection = candidate({
    sourceQuote:
      "Air Canada Aeroplan economy awards cost 60,000 points one-way plus $80.\n) as v; DROP TABLE public.award_price_benchmarks; --",
  });
  assert.equal(isValidBenchmarkCandidate(injection), false);
  assert.equal(emitBenchmarkSeedSql([injection], NOW), null);
  // Control characters in the URL are equally rejected.
  assert.equal(
    isValidBenchmarkCandidate(candidate({ sourceUrl: "https://www.aircanada.com/c\u0000" })),
    false,
  );
});

test("claimed domain must equal the URL's parsed HTTPS hostname exactly", () => {
  // A trusted domain appearing as substring text must not legitimize an
  // attacker-controlled URL.
  const trick = candidate({
    sourceUrl: "https://evil.com/?u=https://www.aircanada.com/chart",
    sourceDomain: "www.aircanada.com",
  });
  assert.equal(isValidBenchmarkCandidate(trick), false);
  assert.equal(emitBenchmarkSeedSql([trick], NOW), null);
  // Non-HTTPS and hostname/claim mismatches are equally rejected.
  assert.equal(
    isValidBenchmarkCandidate(candidate({ sourceUrl: "http://www.aircanada.com/c", sourceDomain: "www.aircanada.com" })),
    false,
  );
  assert.equal(
    isValidBenchmarkCandidate(candidate({ sourceDomain: "united.com" })),
    false,
  );
});

test("extractedAt must be a strict ISO-8601 UTC instant", () => {
  // extractedAt is interpolated into emitted SQL; Date.parse leniency is
  // engine-defined, so the boundary is a strict shape, not parse validity.
  for (const at of [
    "2026-09-10T00:00:00.000Z'",
    "2026-09-10T00:00:00.000Z; DROP TABLE x",
    "2026-09-10", // date-only
    "2026-09-10T00:00:00+01:00", // non-UTC offset
  ]) {
    assert.equal(emitBenchmarkSeedSql([candidate()], at), null, `emitter must reject ${at}`);
    assert.equal(
      extractBenchmarkCandidates([result()], ROUTE, at).length,
      0,
      `extraction must reject ${at}`,
    );
  }
});

test("emitted candidates satisfy the production validator gate", () => {
  const candidates = extractBenchmarkCandidates([result()], ROUTE, NOW);
  for (const value of candidates) {
    assert.equal(isValidBenchmarkCandidate(value), true);
  }
  assert.equal(isValidBenchmarkCandidate({ ...candidate(), pointsRequired: 12 }), false);
  assert.equal(isValidBenchmarkCandidate({ ...candidate(), travelerCountCovered: 2 }), false);
  assert.equal(isValidBenchmarkCandidate({ ...candidate(), currency: "EUR" }), false);
});

test("research run degrades per query and never throws on provider failure", async () => {
  const calls: string[] = [];
  const provider = {
    async search(query: ResearchQuery): Promise<ResearchResponse> {
      calls.push(query.query);
      if (calls.length === 1) {
        return { query: query.query, results: [result()], searchedAt: NOW };
      }
      throw new Error("provider down");
    },
  };
  const run = await runBenchmarkResearch([ROUTE], provider, NOW);
  assert.equal(run.queriesRun, calls.length);
  assert.equal(run.queryFailureCount, run.queriesRun - 1);
  assert.equal(run.resultsConsidered, 1);
  assert.ok(run.candidates.length >= 1);
});

test("research run emits zero queries for hostile routes", async () => {
  let searched = 0;
  const provider = {
    async search(): Promise<ResearchResponse> {
      searched += 1;
      throw new Error("should not be called");
    },
  };
  const run = await runBenchmarkResearch(
    [{ originRegion: "us_domestic", destinationRegion: "us_domestic" }],
    provider,
    NOW,
  );
  assert.equal(searched, 0);
  assert.deepEqual(run.candidates, []);
});

test("extraction does not mutate input results", () => {
  const input = [result()];
  const snapshot = JSON.stringify(input);
  extractBenchmarkCandidates(input, ROUTE, NOW);
  assert.equal(JSON.stringify(input), snapshot);
});

test("specialist-blog K shorthand extracts exactly in both cases", () => {
  const upper = extractBenchmarkCandidates(
    [result({ url: "https://www.united.com/awards", content: "Economy awards from the U.S. to Europe cost 60K points round trip with United MileagePlus." })],
    ROUTE,
    NOW,
  );
  assert.equal(upper.length, 1);
  assert.equal(upper[0].pointsRequired, 60000);
  const lower = extractBenchmarkCandidates(
    [result({ url: "https://www.united.com/awards", content: "Economy awards from the U.S. to Europe cost 60k points round trip with United MileagePlus." })],
    ROUTE,
    NOW,
  );
  assert.equal(lower.length, 1);
  assert.equal(lower[0].pointsRequired, 60000);
});

test("floor phrasing (start at, begin at, as low as) yields the exact stated figure", () => {
  for (const [phrase, points] of [
    ["start at", 60000],
    ["begin at", 45000],
    ["are as low as", 45000],
  ] as const) {
    const sentence = `Economy round-trip awards from the U.S. to Europe ${phrase} ${points.toLocaleString("en-US")} points with United MileagePlus.`;
    const out = extractBenchmarkCandidates(
      [result({ url: "https://www.united.com/awards", content: sentence })],
      ROUTE,
      NOW,
    );
    assert.equal(out.length, 1, sentence);
    assert.equal(out[0].pointsRequired, points, sentence);
    assert.equal(out[0].pricingBasis, "round_trip");
    assert.equal(out[0].cashFees, null);
  }
});

test("premium economy sentences resolve to premium_economy instead of rejecting on the economy substring", () => {
  const out = extractBenchmarkCandidates(
    [result({ content: "Premium economy awards between the U.S. and Europe are 90,000 points round trip with Air Canada Aeroplan." })],
    ROUTE,
    NOW,
  );
  assert.equal(out.length, 1);
  assert.equal(out[0].cabin, "premium_economy");
  assert.equal(out[0].pointsRequired, 90000);
});

test("fee ranges and numeric point ranges are rejected outright", () => {
  const feeRange = extractBenchmarkCandidates(
    [result({ url: "https://www.united.com/awards", content: "Economy awards from the U.S. to Europe cost 60,000 points round trip plus $80 or $120 in fees with United MileagePlus." })],
    ROUTE,
    NOW,
  );
  assert.deepEqual(feeRange, []);
  const pointRange = extractBenchmarkCandidates(
    [result({ url: "https://www.united.com/awards", content: "Economy awards from the U.S. to Europe cost 45,000 to 60,000 points round trip with United MileagePlus." })],
    ROUTE,
    NOW,
  );
  assert.deepEqual(pointRange, []);
});

test("each-way fees alongside a round-trip price are rejected as mis-scoped", () => {
  // A round-trip price paired with an each-way fee figure would store a
  // half-scope fee; storing it would understate fees 2x. Fail closed.
  const out = extractBenchmarkCandidates(
    [result({ content: "Economy awards between the U.S. and Europe start at 60,000 points round trip plus $80 in taxes and fees each way with Air France-KLM Flying Blue." })],
    ROUTE,
    NOW,
  );
  assert.deepEqual(out, []);
});

test("page furniture (related links, verdict boxes, headings) is rejected as provenance", () => {
  // The exact defect the first live run emitted: a swallowed related-article
  // headline and section heading posed as a price statement.
  const furniture = extractBenchmarkCandidates(
    [result({ content: "Winner: Aeroplan Related: How to book Star Alliance business-class flights to Europe for 45,000 miles each way ## Flights to South America" })],
    ROUTE,
    NOW,
  );
  assert.deepEqual(furniture, []);
  // The heading remnant alone also rejects.
  const heading = extractBenchmarkCandidates(
    [result({ content: "Air Canada Aeroplan business-class flights to Europe cost 45,000 miles each way ## Flights to South America" })],
    ROUTE,
    NOW,
  );
  assert.deepEqual(heading, []);
  // Editor's notes and sponsored labels cannot carry prices either.
  const note = extractBenchmarkCandidates(
    [result({ content: "Editor's note: Air Canada Aeroplan business-class flights to Europe cost 45,000 miles each way." })],
    ROUTE,
    NOW,
  );
  assert.deepEqual(note, []);
  // And the validator (emitter boundary) enforces the same rule.
  assert.equal(isValidBenchmarkCandidate(candidate({ sourceQuote: "Winner: Aeroplan Related: How to book Star Alliance business-class flights to Europe for 45,000 miles each way ## Flights to South America" })), false);
});

test("prices belonging to non-catalog programs are never mis-attributed to a catalog program", () => {
  // The exact sentence the second live run mis-attributed: the 57,500 figure
  // belongs to American AAdvantage; Flying Blue appeared only in the transfer
  // clause. The extractor passed it because AAdvantage was unknown.
  const misattributed = extractBenchmarkCandidates(
    [result({ url: "https://www.upgradedpoints.com/travel/best-ways-to-fly-to-europe-with-points", content: "Citi Strata Premier Card: Points transfer 1:1 to American AAdvantage and Flying Blue, with AAdvantage fixed-rate partner business class to Europe available from 57,500 miles one-way." })],
    ROUTE,
    NOW,
  );
  assert.deepEqual(misattributed, []);
  // Direct prices for other well-known non-catalog programs reject too.
  for (const sentence of [
    "Delta SkyMiles business class to Europe costs 80,000 miles one-way.",
    "Turkish Miles&Smiles business class to Europe costs 45,000 miles one-way.",
    "Alaska Mileage Plan business class to Europe costs 55,000 miles one-way.",
    "Marriott Bonvoy points transfer to Flying Blue at 1:0.75.",
  ]) {
    assert.deepEqual(
      extractBenchmarkCandidates([result({ content: sentence })], ROUTE, NOW),
      [],
      sentence,
    );
  }
  // A partner airline named as the OPERATOR (not a program) stays valid —
  // that is exactly how partner-award prices are stated.
  const operator = extractBenchmarkCandidates(
    [result({ url: "https://thepointsguy.com/loyalty-programs/points-lab-booking-delta-awards-with-virgin-atlantic", content: "Virgin Atlantic will charge 30,000 miles for one-way nonstop economy awards from the US to Europe on Delta, and that number doesn't change." })],
    ROUTE,
    NOW,
  );
  assert.equal(operator.length, 1);
  assert.equal(operator[0].programName, "Virgin Atlantic Flying Club");
  assert.equal(operator[0].pointsRequired, 30000);
});

test("default route plan leads with the human-verified transatlantic pair and stays valid", () => {
  // Transatlantic Europe must remain first: it is the pair whose emitted rows
  // were individually human-verified and seeded.
  assert.equal(DEFAULT_BENCHMARK_RESEARCH_ROUTES[0].originRegion, "us_domestic");
  assert.equal(DEFAULT_BENCHMARK_RESEARCH_ROUTES[0].destinationRegion, "transatlantic_europe");
  for (const route of DEFAULT_BENCHMARK_RESEARCH_ROUTES) {
    assert.notEqual(route.originRegion, route.destinationRegion, JSON.stringify(route));
  }
  const seen = new Set(
    DEFAULT_BENCHMARK_RESEARCH_ROUTES.map((r) => `${r.originRegion}->${r.destinationRegion}`),
  );
  assert.equal(seen.size, DEFAULT_BENCHMARK_RESEARCH_ROUTES.length);
});

test("query builder emits deterministic queries for every default route", () => {
  const all: string[] = [];
  for (const route of DEFAULT_BENCHMARK_RESEARCH_ROUTES) {
    const queries = buildBenchmarkResearchQueries(route);
    assert.equal(queries.length, BENCHMARK_PROGRAM_NAMES.length * 2, JSON.stringify(route));
    assert.ok(queries.length > 0);
    for (const query of queries) {
      assert.equal(query.query, query.query.trim());
      assert.ok(query.query.length > 0);
      all.push(query.query);
    }
  }
  // Determinism: re-running the plan reproduces the exact same query list.
  const rerun: string[] = [];
  for (const route of DEFAULT_BENCHMARK_RESEARCH_ROUTES) {
    for (const query of buildBenchmarkResearchQueries(route)) rerun.push(query.query);
  }
  assert.deepEqual(rerun, all);
});

test("recency gate rejects stale, malformed, and future publication dates", () => {
  const dayMs = 24 * 60 * 60 * 1000;
  const fresh = new Date(Date.parse(NOW) - 30 * dayMs).toISOString();
  const insideCutoff = new Date(Date.parse(NOW) - 540 * dayMs).toISOString();
  const pastCutoff = new Date(Date.parse(NOW) - 549 * dayMs).toISOString();
  const stale = new Date(Date.parse(NOW) - 600 * dayMs).toISOString();
  const future = new Date(Date.parse(NOW) + 30 * dayMs).toISOString();

  const extract = (publishedDate: string | null) =>
    extractBenchmarkCandidates([result({ publishedDate })], ROUTE, NOW);

  // Fresh and within-cutoff articles extract exactly as before the gate.
  assert.equal(extract(fresh).length > 0, true, "fresh article must stay eligible");
  assert.equal(extract(insideCutoff).length > 0, true, "~18-month-old article must stay eligible");

  // One day past the cutoff, and a 600-day-old article (the observed
  // 2023-United case): rejected — no candidates survive.
  assert.deepEqual(extract(pastCutoff), [], "just-past-cutoff article must reject");
  assert.deepEqual(extract(stale), [], "stale article must reject");

  // Absent stays eligible (null and empty): human quote review is the backstop.
  assert.equal(extract(null).length > 0, true, "absent date must stay eligible");
  assert.equal(extract("").length > 0, true, "empty date is absent, not malformed");

  // Present-but-malformed never degrades to absent, and an implausibly
  // future publication date rejects rather than passing through.
  assert.deepEqual(extract("not-a-date"), [], "malformed date must reject");
  assert.deepEqual(extract(future), [], "future-dated article must reject");
});

test("past-tense price sentences fail closed at extraction and validation", () => {
  const extract = (content: string) =>
    extractBenchmarkCandidates([result({ content })], ROUTE, NOW);

  // Historical-price phrasings (the observed "was 70000" East Asia row and
  // its siblings) are rejected even when every other gate would pass.
  for (const sentence of [
    "United MileagePlus partner redemption in business class from the US to East Asia was 70,000 miles one way.",
    "United MileagePlus used to price Europe business class at 70,000 miles one-way.",
    "United MileagePlus previously charged 70,000 miles for Europe business class one-way.",
    "United MileagePlus no longer charges 70,000 miles for Europe business class one-way.",
  ]) {
    assert.deepEqual(extract(sentence), [], sentence);
  }

  // Legitimate current-price phrasings must survive the gate — yield is
  // real cost, so only unambiguous historical markers reject.
  const present = extract(
    "United MileagePlus charges 80,000 miles for a one-way flight to Europe in business class.",
  );
  assert.equal(present.length, 1);
  assert.equal(present[0].pointsRequired, 80000);

  // The emitter-side validator independently enforces the same gate, so a
  // candidate whose quote is swapped for a past-tense sentence cannot pass.
  assert.equal(isValidBenchmarkCandidate({ ...present[0], sourceQuote: "United MileagePlus partner redemption in business class from the US to East Asia was 70,000 miles one way." }), false);
});
