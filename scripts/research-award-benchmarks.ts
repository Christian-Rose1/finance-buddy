/**
 * Route B weekly runner: research award-price benchmark candidates and emit
 * reviewable seed SQL on stdout.
 *
 * Usage:
 *   TAVILY_API_KEY=... npx tsx scripts/research-award-benchmarks.ts
 *
 * Output contract:
 * - stdout: ONLY the seed SQL (empty when no new candidates were found).
 * - stderr: bounded run summary (counts and categories only — never raw
 *   provider responses, prompts, or customer data).
 * - Exit 0: run completed (with or without candidates).
 * - Exit 1: configuration/refusal (missing API key, invalid route argument).
 *
 * The emitted SQL is intentionally NOT applied automatically: a human reviews
 * every row's source quote against the claimed scope, then commits it as a
 * migration and runs `supabase db push` (catalog tables are not writable by
 * the application, by design).
 */

import { loadEnvFileIntoProcess } from "@/lib/envFile";
import { TavilyResearchProvider } from "@/lib/goals/tavilyResearchProvider";
import {
  DEFAULT_BENCHMARK_RESEARCH_ROUTES,
  dedupeBenchmarkCandidates,
  emitBenchmarkSeedSql,
  runBenchmarkResearch,
  type BenchmarkResearchRoute,
} from "@/lib/rewards/awardBenchmarkResearch";
import { isAwardBenchmarkRegion, AWARD_BENCHMARK_REGIONS } from "@/lib/rewards/awardBenchmarks";

function parseRoutes(argv: readonly string[]): BenchmarkResearchRoute[] | null {
  if (argv.length === 0) return [...DEFAULT_BENCHMARK_RESEARCH_ROUTES];
  const routes: BenchmarkResearchRoute[] = [];
  for (const arg of argv) {
    const [originRaw, destinationRaw] = arg.split("->");
    const origin = originRaw?.trim();
    const destination = destinationRaw?.trim();
    if (
      !origin ||
      !destination ||
      !isAwardBenchmarkRegion(origin) ||
      !isAwardBenchmarkRegion(destination) ||
      origin === destination
    ) {
      return null;
    }
    routes.push({ originRegion: origin, destinationRegion: destination });
  }
  return routes;
}

async function main(): Promise<number> {
  // Next.js loads .env.local for the app; standalone tsx scripts do not.
  // Load it secret-safely here (values never logged; existing environment
  // always wins, so an explicitly provided shell variable keeps precedence).
  loadEnvFileIntoProcess(".env.local");

  const apiKey = process.env.TAVILY_API_KEY ?? "";
  if (!apiKey) {
    console.error("TAVILY_API_KEY is required. Refusing to run.");
    console.error("Add TAVILY_API_KEY to .env.local or export it in your shell.");
    return 1;
  }

  const routes = parseRoutes(process.argv.slice(2));
  if (!routes) {
    console.error(
      `Invalid route argument. Use "origin->destination" with regions from: ${AWARD_BENCHMARK_REGIONS.join(", ")}.`
    );
    return 1;
  }

  const provider = new TavilyResearchProvider(apiKey);
  const extractedAt = new Date().toISOString();
  const run = await runBenchmarkResearch(routes, provider, extractedAt);
  const deduped = dedupeBenchmarkCandidates(run.candidates);
  const sql = emitBenchmarkSeedSql(deduped, extractedAt);

  console.error(
    `[award-benchmark-research] routes=${routes.length} queries=${run.queriesRun} queryFailures=${run.queryFailureCount} results=${run.resultsConsidered} rawCandidates=${run.candidates.length} deduped=${deduped.length} emitted=${sql ? deduped.length : 0}`
  );

  if (sql) {
    process.stdout.write(`${sql}\n`);
  } else {
    console.error("No new benchmark candidates passed validation this run.");
  }
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch(() => {
    console.error("[award-benchmark-research] run failed.");
    process.exit(1);
  });
