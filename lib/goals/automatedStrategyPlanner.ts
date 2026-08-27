import type {
  PersonalizedStrategy,
  PersonalizedStrategyContext,
} from "./strategyTypes";
import { buildPointsInventory } from "./pointsInventoryBuilder";
import { buildStrategyAllocationScenarios } from "./strategyAllocationBuilder";
import { TRUSTED_DOMAINS } from "./researchTypes";
import { TavilyResearchProvider } from "./tavilyResearchProvider";
import { ResearchInterpreterError } from "./researchInterpreter";
import type { InterpretedResearch, ResearchInterpreter } from "./researchInterpreter";
import { createResearchInterpreter } from "./researchInterpreterFactory";
import { createStrategyProvider } from "./strategyProviderFactory";
import { buildStrategyResearchQueries } from "./strategyResearchQueries";
import { buildSanitizedStrategyPayload } from "./sanitizedStrategyPayload";
import { applyNarrativeTrustGateToNarrative } from "./strategyNarrativeTrustGate";
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
  tavily: TavilyResearchProvider
): Promise<Awaited<ReturnType<TavilyResearchProvider["search"]>>[]> {
  return Promise.all(
    queries.map((q) =>
      tavily.search({
        query: q.query,
        includeDomains: [...q.includeDomains],
        searchDepth: q.searchDepth,
      })
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
 * Researches and interprets flight options for a goal in isolation.
 *
 * @param context Complete PersonalizedStrategyContext containing the customer's goal.
 * @param catalogRewardPrograms Complete reward-program catalog. Passed to the research interpreter so sourced options may reference any real catalog program.
 * @returns The validated flight-focused InterpretedResearch.
 */
export async function generateFlightResearchStage(
  context: PersonalizedStrategyContext,
  catalogRewardPrograms: StrategyRewardProgram[],
  dependencies: StagedResearchDependencies,
): Promise<InterpretedResearch> {
  assertVerifiedStageQueryExecutor(dependencies?.executor);
  const plan = await resolveResearchPlan(context, catalogRewardPrograms);
  const flightPlanQueries = plan.queries.filter((q) => q.category === "flight");
  const flightResponses = await executeVerifiedStageQueries(dependencies.executor, plan, flightPlanQueries);
  if (flightPlanQueries.length > 0 && flightResponses.length === 0) {
    throw new ResearchInterpreterError(
      "No planned flight research queries completed.",
      "tavily",
      "unknown",
    );
  }

  const interpreter = dependencies.interpreter ?? createResearchInterpreter();
  return interpreter.interpret({
    goal: context.goal,
    rewardPrograms: catalogRewardPrograms,
    research: flightResponses,
    focus: "flight_options",
  });
}

/**
 * Researches and interprets hotel options for a goal in isolation.
 *
 * @param context Complete PersonalizedStrategyContext containing the customer's goal.
 * @param catalogRewardPrograms Complete reward-program catalog. Passed to the research interpreter so sourced options may reference any real catalog program.
 * @returns The validated hotel-focused InterpretedResearch.
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
  return interpreter.interpret({
    goal: context.goal,
    rewardPrograms: catalogRewardPrograms,
    research: hotelResponses,
    focus: "hotel_options",
  });
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
  mode: StrategyStageFinalizationMode = "initial"
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
        tavilyForCardFallback
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
            })
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

  // 5. Sanitize and generate the narrative once, then apply the deterministic
  // narrative trust gate. When only planning benchmarks exist, the model
  // narrative is replaced with fixed server-owned copy before anything is
  // merged or persisted.
  const strategyProvider = createStrategyProvider();
  const sanitizedPrompt = buildSanitizedStrategyPayload(
    enrichedContext,
    catalogRewardPrograms
  );
  const strategy = applyNarrativeTrustGateToNarrative(
    await strategyProvider.generateStrategy(sanitizedPrompt),
  );

  // 6. Deterministically attach points inventory and allocation scenarios.
  const pointsInventory = buildPointsInventory(
    context.rewardAccounts,
    catalogRewardPrograms
  );

  const allocationScenarios = buildStrategyAllocationScenarios(
    context.goal,
    strategy.flightOptions,
    strategy.hotelOptions,
    pointsInventory
  );

  // 7. Return the complete PersonalizedStrategy.
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
  };
}
