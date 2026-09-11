import type {
  PersonalizedStrategy,
  PersonalizedStrategyContext,
  PersonalizedStrategyNarrative,
  StrategyAwardOption,
} from "./strategyTypes";
import { buildPointsInventory } from "./pointsInventoryBuilder";
import { buildStrategyAllocationScenarios } from "./strategyAllocationBuilder";
import { buildEarnPlan } from "./earnPlan";
import {
  buildAirportRegionMap,
  selectFlightAwardBenchmarks,
} from "@/lib/rewards/awardBenchmarks";
import { projectBenchmarksToAwardOptions } from "./awardBenchmarkOptions";
import {
  createSeatsAeroClient,
  type SeatsAeroCabin,
} from "./seatsAeroClient";
import { projectSeatsAeroRowsToAwardOptions } from "./seatsAeroFundingMapper";
import { TRUSTED_DOMAINS } from "./researchTypes";
import { TavilyResearchProvider } from "./tavilyResearchProvider";
import { ResearchInterpreterError } from "./researchInterpreter";
import type { InterpretedResearch, ResearchInterpreter } from "./researchInterpreter";
import { createResearchInterpreter } from "./researchInterpreterFactory";
import { buildStrategyResearchQueries } from "./strategyResearchQueries";
import { deterministicNarrativeCopy } from "./strategyNarrativeTrustGate";
import { StrategyFinalizationDeadlineError } from "./strategyFinalizationDeadline";
import { deduplicateByOptionId } from "./strategyProviderCore";
import { buildResearchPlannerInput } from "./researchPlannerInputBuilder";
import type { ResearchPlanQuery } from "./researchPlannerTypes";
import {
  buildSavedGoalWebTravelDiscoveryPlan,
  toSavedGoalWebDiscoveryInput,
} from "./webTravelDiscoveryPlanner";
import {
  assertVerifiedStageQueryExecutor,
  executeVerifiedStageQueries,
  type VerifiedStageQueryExecutor,
} from "./providerExecutionGateway";

/**
 * Extract a strictly-shaped IATA airport code from the server-validated
 * flight planning estimate. Fails closed: anything that is not exactly a
 * three-letter A–Z code yields null — goal text, city names, and provider
 * free text are never parsed into a code here.
 */
function estimateIataCode(value: unknown): string | null {
  return typeof value === "string" && /^[A-Z]{3}$/.test(value) ? value : null;
}

/**
 * Map the saved goal's cabin vocabulary onto the Seats.aero cabin set.
 * Returns null for the non-specific "flexible" preference and any unknown
 * value: an unmappable cabin yields no observed-price search at all.
 */
function seatsAeroCabinForCabin(cabin: string): SeatsAeroCabin | null {
  switch (cabin) {
    case "economy":
      return "economy";
    case "premium_economy":
      return "premium";
    case "business":
      return "business";
    case "first":
      return "first";
    default:
      return null;
  }
}

export interface StrategyRewardProgram {
  id: string;
  name: string;
}

/**
 * Executes the pre-existing optional card-offer lane during initial
 * finalization. It is intentionally separate from the authenticated staged
 * flight/hotel gateway and is not approved as web-observed candidate evidence.
 * Its trust boundary requires a dedicated future review.
 */
async function executeNonTravelPlannedQueries(
  queries: ResearchPlanQuery[],
  tavily: TavilyResearchProvider,
  signal?: AbortSignal,
): Promise<Awaited<ReturnType<TavilyResearchProvider["search"]>>[]> {
  return Promise.all(
    queries.map((q) =>
      tavily.search({
        query: q.query,
        includeDomains: [...q.includeDomains],
        searchDepth: q.searchDepth,
      }, { signal })
    )
  );
}

/** Interpreter remains injectable; execution authority is gateway-minted. */
export interface StagedResearchDependencies {
  executor: VerifiedStageQueryExecutor;
  interpreter?: ResearchInterpreter;
}

/**
 * Builds the public-web discovery plan entirely from saved, sanitized goal
 * facts. Models never select routes, dates, properties, or query count.
 */
async function resolveResearchPlan(
  context: PersonalizedStrategyContext,
  catalogRewardPrograms: StrategyRewardProgram[]
): Promise<ReturnType<typeof buildSavedGoalWebTravelDiscoveryPlan>> {
  const plannerInput = buildResearchPlannerInput(context, [
    ...catalogRewardPrograms,
  ]);
  const plan = buildSavedGoalWebTravelDiscoveryPlan(
    toSavedGoalWebDiscoveryInput(plannerInput),
  );
  if (process.env.STRATEGY_DEBUG === "1") {
    console.log("[strategy-research-plan]", JSON.stringify({ queryCount: plan.queries.length }));
  }
  return plan;
}

/**
 * Destination-mismatched hotel options are never usable recommendations for
 * the saved goal. The validated research classification contract requires a
 * `different_destination` classification to carry a "destination" mismatch
 * reason; either signal alone rejects the option. The saved goal's own
 * destination remains authoritative.
 */
function isDestinationMismatchedHotelOption(
  option: StrategyAwardOption,
): boolean {
  return (
    option.goalMatch === "different_destination" ||
    option.goalMismatchReasons?.includes("destination") === true
  );
}

/** Safe fixed warning; never names a rejected property or provider. */
const HOTEL_DESTINATION_MISMATCH_WARNING =
  "Hotel options for a different destination than your goal were omitted from your recommendations.";

/**
 * Applies the destination-mismatch boundary to a validated hotel-stage
 * interpretation before it can reach persistence or presentation:
 * - every destination-mismatched option is removed;
 * - if no matching option remains, the established safe research failure is
 *   thrown so no hotel payload is saved;
 * - if matching options remain, only sources referenced by retained options
 *   are kept (exact structured `sourceId` matching; never label, URL, or
 *   name heuristics), original option and source order is preserved, and
 *   model-generated assumptions/warnings are replaced by one fixed safe
 *   warning because their free-text provenance cannot be bounded to the
 *   retained options.
 */
function rejectDestinationMismatchedHotels(
  interpreted: InterpretedResearch,
): InterpretedResearch {
  const matching = interpreted.awardOptions.filter(
    (option) => !isDestinationMismatchedHotelOption(option),
  );
  if (matching.length === interpreted.awardOptions.length) {
    return interpreted;
  }
  if (matching.length === 0) {
    throw new ResearchInterpreterError(
      "Every researched hotel option was for a different destination than the saved goal.",
      "research",
      "deterministic_destination_gate",
    );
  }
  const retainedSourceIds = new Set(matching.map((option) => option.sourceId));
  const retainedSources = interpreted.sources.filter(
    (source) => retainedSourceIds.has(source.id),
  );
  return {
    ...interpreted,
    awardOptions: matching,
    sources: retainedSources,
    assumptions: [],
    warnings: [HOTEL_DESTINATION_MISMATCH_WARNING],
  };
}

/**
 * Researches and interprets hotel options for a goal in isolation.
 *
 * @param context Complete PersonalizedStrategyContext containing the customer's goal.
 * @param catalogRewardPrograms Complete reward-program catalog. Passed to the research interpreter so sourced options may reference any real catalog program.
 * @returns The validated hotel-focused InterpretedResearch with destination-mismatched options removed.
 */
export async function generateHotelResearchStage(
  context: PersonalizedStrategyContext,
  catalogRewardPrograms: StrategyRewardProgram[],
  dependencies: StagedResearchDependencies,
): Promise<InterpretedResearch> {
  assertVerifiedStageQueryExecutor(dependencies?.executor);
  const plan = await resolveResearchPlan(context, catalogRewardPrograms);
  const hotelPlanQueries = plan.queries.filter((q) => q.category === "hotel");
  const hotelResponses = await executeVerifiedStageQueries(dependencies.executor, plan, hotelPlanQueries);
  if (hotelPlanQueries.length > 0 && hotelResponses.length === 0) {
    throw new ResearchInterpreterError(
      "No planned hotel research queries completed.",
      "tavily",
      "unknown",
    );
  }

  if (process.env.STRATEGY_DEBUG === "1") {
    for (let i = 0; i < hotelResponses.length; i++) {
      console.log(
        "[strategy-hotel-tavily-response]",
        JSON.stringify({
          resultCount: hotelResponses[i]?.results?.length ?? 0,
        })
      );
    }
  }

  const interpreter = dependencies.interpreter ?? createResearchInterpreter();
  const interpreted = await interpreter.interpret({
    goal: context.goal,
    rewardPrograms: catalogRewardPrograms,
    research: hotelResponses,
    focus: "hotel_options",
  });
  return rejectDestinationMismatchedHotels(interpreted);
}

export interface VerifiedStrategyResearchStages {
  flight: InterpretedResearch | null;
  hotel: InterpretedResearch | null;
}

/**
 * Generates a personalized strategy from already-verified flight and hotel
 * research stages. Initial finalization may add optional card-offer research;
 * retries do not.
 *
 * This function NEVER runs flight or hotel Tavily searches and NEVER
 * reinterprets flight or hotel data: those stages are supplied directly as
 * validated InterpretedResearch. Optional card-offer research is never
 * persisted to the staged run and runs only during initial finalization.
 *
 * @param context Complete PersonalizedStrategyContext.
 * @param customerRewardPrograms Reward programs the customer owns. Used only to build the optional card query.
 * @param catalogRewardPrograms Complete reward-program catalog. Passed to the interpreter for card offers.
 * @param stages Verified flight/hotel research stages (null means omitted).
 * @param mode `retry` reuses only verified stages and skips all research work.
 * @returns A complete PersonalizedStrategy suitable for saveLatestStrategy.
 */
export type StrategyStageFinalizationMode = "initial" | "retry";

export function shouldRunOptionalCardResearch(
  mode: StrategyStageFinalizationMode
): boolean {
  return mode === "initial";
}

export async function generateAutomatedStrategyFromResearchStages(
  context: PersonalizedStrategyContext,
  customerRewardPrograms: StrategyRewardProgram[],
  catalogRewardPrograms: StrategyRewardProgram[],
  stages: VerifiedStrategyResearchStages,
  mode: StrategyStageFinalizationMode = "initial",
  signal?: AbortSignal,
): Promise<PersonalizedStrategy> {
  const goal = context.goal;

  let cardPlanQueries: ResearchPlanQuery[] = [];
  let cardInterpreted: InterpretedResearch | null = null;
  let cardRejected = false;

  // An initial finalization may perform best-effort card research. A retry
  // uses only the verified signed flight/hotel stages and regenerates the
  // narrative; it must not repeat planning, searches, or interpretation.
  if (shouldRunOptionalCardResearch(mode)) {
    try {
      const plan = await resolveResearchPlan(
        context,
        catalogRewardPrograms
      );
      cardPlanQueries = plan.queries.filter((q) => q.category === "card");
    } catch {
      cardPlanQueries = [];
    }

    const tavilyForCardFallback = new TavilyResearchProvider();
    if (cardPlanQueries.length > 0) {
      const cardResearchResponses = await executeNonTravelPlannedQueries(
        cardPlanQueries,
        tavilyForCardFallback,
        signal,
      );

      const interpreter = createResearchInterpreter();
      try {
        cardInterpreted = await interpreter.interpret({
          goal,
          rewardPrograms: catalogRewardPrograms,
          research: cardResearchResponses,
          focus: "card_offers",
        });
      } catch (err) {
        if (err instanceof ResearchInterpreterError) {
          cardRejected = true;
        } else {
          throw err;
        }
      }
    } else if (goal.allowNewCards) {
      // Fallback: template card query.
      const { cardQueries } = buildStrategyResearchQueries(
        goal,
        customerRewardPrograms
      );
      if (cardQueries.length > 0) {
        const cardResearchResponses = await Promise.all(
          cardQueries.map((q) =>
            tavilyForCardFallback.search({
              query: q,
              includeDomains: [...TRUSTED_DOMAINS],
            }, { signal })
          )
        );

        const interpreter = createResearchInterpreter();
        try {
          cardInterpreted = await interpreter.interpret({
            goal,
            rewardPrograms: catalogRewardPrograms,
            research: cardResearchResponses,
            focus: "card_offers",
          });
        } catch (err) {
          if (err instanceof ResearchInterpreterError) {
            cardRejected = true;
          } else {
            throw err;
          }
        }
      }
    }
  }

  // 3. Merge validated stage data in order:
  // flight options → hotel options → optional card offers.
  // Same order for sources, assumptions, and warnings.
  const interpreted = {
    awardOptions: [
      ...(stages.flight ? stages.flight.awardOptions : []),
      ...(stages.hotel ? stages.hotel.awardOptions : []),
    ],
    cardOffers: cardInterpreted ? cardInterpreted.cardOffers : [],
    sources: [
      ...(stages.flight ? stages.flight.sources : []),
      ...(stages.hotel ? stages.hotel.sources : []),
      ...(cardInterpreted ? cardInterpreted.sources : []),
    ],
    assumptions: [
      ...(stages.flight ? stages.flight.assumptions : []),
      ...(stages.hotel ? stages.hotel.assumptions : []),
      ...(cardInterpreted ? cardInterpreted.assumptions : []),
    ],
    warnings: [
      ...(stages.flight ? stages.flight.warnings : []),
      ...(stages.hotel ? stages.hotel.warnings : []),
      ...(cardInterpreted ? cardInterpreted.warnings : []),
      ...(!stages.flight
        ? [
            "Flight recommendations were omitted because the researched flight details could not be fully validated.",
          ]
        : []),
      ...(!stages.hotel
        ? [
            "Hotel recommendations were omitted because the researched hotel details could not be fully validated.",
          ]
        : []),
      ...(cardRejected
        ? [
            "Card-offer recommendations were omitted because the researched offer details could not be fully validated.",
          ]
        : []),
    ],
    flightPlanningEstimate: stages.flight?.flightPlanningEstimate ?? null,
    hotelPlanningEstimate: stages.hotel?.hotelPlanningEstimate ?? null,
  };

  // 4. Build an enriched context without mutating any input.
  const enrichedContext: PersonalizedStrategyContext = {
    ...context,
    awardOptions: [
      ...(context.awardOptions || []),
      ...(interpreted.awardOptions || []),
    ],
    cardOffers: [
      ...(context.cardOffers || []),
      ...(interpreted.cardOffers || []),
    ],
    sources: [
      ...(context.sources || []),
      ...(interpreted.sources || []),
    ],
    generatedAt: context.generatedAt || new Date().toISOString(),
  };

  // 5. Deterministic structured lanes: the validated award options assembled
  // above (flight options → hotel options → optional card offers) are the
  // sole source of flight/hotel options. No narrative provider is invoked:
  // headline/summary come from the same server-owned copy source the
  // narrative trust gate uses, so the persisted strategy exactly matches the
  // gate's unconditional suppression policy (structured evidence displayed
  // with its own labels; no model-authored recommendation prose exists
  // anywhere in the pipeline).
  // Source eligibility is restored from the previous provider path
  // (buildSanitizedStrategyPayload): an option whose sourceId is absent from
  // the merged sources is excluded before lane construction. Each lane is
  // then deduplicated by option id with first-occurrence ordering preserved
  // (deduplicateByOptionId); dedup is per-lane, so the same id may appear in
  // both the flight and hotel lists exactly as before.
  const sourceIds = new Set(
    enrichedContext.sources.map((source) => source.id),
  );
  const eligibleAwardOptions = enrichedContext.awardOptions.filter(
    (option) => sourceIds.has(option.sourceId),
  );
  const strategy: PersonalizedStrategyNarrative = {
    headline: "",
    summary: "",
    feasibility: "insufficient_information",
    pointsGap: null,
    recommendedAwardOptionId: null,
    recommendedCardOfferId: null,
    flightOptions: deduplicateByOptionId(
      eligibleAwardOptions.filter((option) => option.redemptionType === "flight"),
    ),
    hotelOptions: deduplicateByOptionId(
      eligibleAwardOptions.filter((option) => option.redemptionType === "hotel"),
    ),
    actions: [],
    alternatives: [],
    assumptions: [],
    warnings: [],
    followUpQuestions: [],
  };

  // 5b. Deterministic award benchmarks (R2, Route A): project verified catalog
  // benchmark rows into additional flight options. This is a server-side
  // deterministic join — no model is involved, nothing is sourced from the
  // browser, and a benchmark that cannot be projected honestly is skipped.
  // Selection fails closed: an unmapped airport, an absent flight estimate
  // (no resolved airport codes), or unknown cabin yields no benchmark options
  // at all. Airport codes come only from the server-validated flight planning
  // estimate, never from parsing saved goal text. When the saved cabin is the
  // non-specific "flexible" preference, no cabin-specific row is selected.
  const catalogProgramNames = new Map(
    catalogRewardPrograms.map((program) => [program.id, program.name]),
  );
  const goalCabin = context.goal.cabinPreference;
  const benchmarkOriginIata = estimateIataCode(
    interpreted.flightPlanningEstimate?.origin ?? null,
  );
  const benchmarkDestinationIata = estimateIataCode(
    interpreted.flightPlanningEstimate?.destination ?? null,
  );
  const benchmarkSelection =
    goalCabin === "flexible" ||
    benchmarkOriginIata === null ||
    benchmarkDestinationIata === null
      ? []
      : selectFlightAwardBenchmarks({
          benchmarks: context.awardPriceBenchmarks ?? [],
          airportRegions: buildAirportRegionMap(context.airportRegionEntries ?? []),
          originIata: benchmarkOriginIata,
          destinationIata: benchmarkDestinationIata,
          cabin: goalCabin,
          now: new Date(context.generatedAt || Date.now()),
        });
  const benchmarkProjection = projectBenchmarksToAwardOptions(
    benchmarkSelection,
    catalogProgramNames,
  );
  if (benchmarkProjection.awardOptions.length > 0) {
    strategy.flightOptions = deduplicateByOptionId([
      ...strategy.flightOptions,
      ...benchmarkProjection.awardOptions,
    ]);
    // The enriched context feeds no persistence path (the assembled strategy
    // is persisted verbatim via RPC), but keeping it complete preserves the
    // function's internal invariant that it mirrors every merged record.
    enrichedContext.awardOptions = [
      ...enrichedContext.awardOptions,
      ...benchmarkProjection.awardOptions,
    ];
    enrichedContext.sources = [
      ...enrichedContext.sources,
      ...benchmarkProjection.sources,
    ];
  }

  // 5c. Deterministic observed award prices (Seats.aero cached search):
  // one outbound request and, for round-trip goals, one return request are
  // made only when the verified flight estimate resolved exact airport codes
  // and the saved cabin maps onto the provider's cabin set. Every failure is
  // fail-closed and silent at the customer level: an error category, an abort,
  // a rejection, or zero usable rows contributes no options and no invented
  // substitutes — the chart-benchmark path below remains the fallback floor.
  // Results are ordered strictly after the deadline signal is re-checked, and
  // the deterministic funding mapper emits one option per program with a
  // complete observation, never a partially observed total.
  const observedCabin =
    goalCabin === "flexible" ? null : seatsAeroCabinForCabin(goalCabin);
  const canSearchObservedPrices =
    benchmarkOriginIata !== null &&
    benchmarkDestinationIata !== null &&
    observedCabin !== null;
  if (canSearchObservedPrices) {
    if (signal?.aborted) throw new StrategyFinalizationDeadlineError();
    const seatsAero = createSeatsAeroClient();
    const observedRequest = {
      originAirport: benchmarkOriginIata,
      destinationAirport: benchmarkDestinationIata,
      cabin: observedCabin as SeatsAeroCabin,
      startDate: interpreted.flightPlanningEstimate!.outboundDate,
      endDate: interpreted.flightPlanningEstimate!.returnDate,
    };
    const [outboundOutcome, returnOutcome] = await Promise.all([
      seatsAero.searchAvailability(observedRequest, "outbound", signal),
      // A one-way search has no return corridor; the return leg only exists
      // when the estimate itself declares a return date.
      interpreted.flightPlanningEstimate!.returnDate
        ? seatsAero.searchAvailability(observedRequest, "return", signal)
        : Promise.resolve({ rows: [] as never, error: null as never }),
    ]);
    if (signal?.aborted) throw new StrategyFinalizationDeadlineError();
    if (
      outboundOutcome.error === null &&
      returnOutcome.error === null &&
      outboundOutcome.rows !== null
    ) {
      const pricingBasis =
        interpreted.flightPlanningEstimate!.returnDate ? "round_trip" : "one_way";
      const observedProjection = projectSeatsAeroRowsToAwardOptions(
        [...outboundOutcome.rows, ...(returnOutcome.rows ?? [])],
        catalogProgramNames,
        {
          originIata: benchmarkOriginIata,
          destinationIata: benchmarkDestinationIata,
          cabin: goalCabin,
          pricingBasis,
        },
      );
      if (observedProjection.awardOptions.length > 0) {
        // Observed prices supersede the chart-benchmark floor for the exact
        // same program, pricing basis, and cabin — a same-basis benchmark
        // would otherwise present a weaker, chart-only number next to a real
        // observed one. A benchmark describing a DIFFERENT basis (e.g. a
        // one-way floor beside an observed round-trip total) is not an
        // equivalent product and is retained honestly.
        const observedKeys = new Set(
          observedProjection.awardOptions.map(
            (option) =>
              `${option.catalogRewardProgramId ?? ""}|${option.pricingBasis}|${option.cabin ?? ""}`,
          ),
        );
        const superseded = strategy.flightOptions.filter(
          (option) =>
            (option.evidenceLevel ?? "planning_benchmark") ===
              "planning_benchmark" &&
            observedKeys.has(
              `${option.catalogRewardProgramId ?? ""}|${option.pricingBasis}|${option.cabin ?? ""}`,
            ),
        );
        if (superseded.length > 0) {
          const supersededIds = new Set(superseded.map((option) => option.id));
          const supersededSourceIds = new Set(
            superseded.map((option) => option.sourceId),
          );
          strategy.flightOptions = strategy.flightOptions.filter(
            (option) => !supersededIds.has(option.id),
          );
          enrichedContext.awardOptions = enrichedContext.awardOptions.filter(
            (option) => !supersededIds.has(option.id),
          );
          enrichedContext.sources = enrichedContext.sources.filter(
            (source) => !supersededSourceIds.has(source.id),
          );
        }
        strategy.flightOptions = deduplicateByOptionId([
          ...observedProjection.awardOptions,
          ...strategy.flightOptions,
        ]);
        enrichedContext.awardOptions = [
          ...observedProjection.awardOptions,
          ...enrichedContext.awardOptions,
        ];
        enrichedContext.sources = [
          ...observedProjection.sources,
          ...enrichedContext.sources,
        ];
      }
    }
  }

  // Server-owned narrative copy, from the same deterministic source the
  // narrative trust gate uses. The gate's unconditional suppression policy is
  // therefore exactly satisfied: no model-authored recommendation prose exists
  // anywhere in the pipeline, and structured evidence is displayed with its
  // own evidence labels.
  const narrativeCopy = deterministicNarrativeCopy({
    flightOptions: strategy.flightOptions,
    hotelOptions: strategy.hotelOptions,
  });
  strategy.headline = narrativeCopy.headline;
  strategy.summary = narrativeCopy.summary;

  // 6. Deterministically attach points inventory and allocation scenarios.
  const pointsInventory = buildPointsInventory(
    context.rewardAccounts,
    catalogRewardPrograms
  );

  const allocationScenarios = buildStrategyAllocationScenarios(
    context.goal,
    strategy.flightOptions,
    strategy.hotelOptions,
    pointsInventory,
    context.verifiedTransferPartners ?? null
  );

  // 7. Deterministic earnings plan (R1): projects the customer's own balances
  // forward using only verified catalog earn rates, their recorded spending,
  // and their own accounts. Null when no verified rates exist. The searched
  // flight party-total is carried through unchanged for the cash comparison;
  // no points valuation or award pricing is performed here.
  // (catalogProgramNames is built once above, in step 5b.)
  const earnPlan = buildEarnPlan(
    context,
    catalogProgramNames,
    interpreted.flightPlanningEstimate ?? null,
  );

  // 8. Return the complete PersonalizedStrategy.
  return {
    ...strategy,
    assumptions: [
      ...(strategy.assumptions || []),
      ...(interpreted.assumptions || []),
    ],
    warnings: [
      ...(strategy.warnings || []),
      ...(interpreted.warnings || []),
    ],
    pointsInventory,
    allocationScenarios,
    flightPlanningEstimate: interpreted.flightPlanningEstimate ?? null,
    hotelPlanningEstimate: interpreted.hotelPlanningEstimate ?? null,
    earnPlan,
  };
}
