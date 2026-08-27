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
import { buildResearchPlannerInput } from "./researchPlannerInputBuilder";
import type { ResearchPlan, ResearchPlanQuery } from "./researchPlannerTypes";
import type { ResearchProvider, ResearchResponse } from "./researchTypes";
import {
  buildSavedGoalWebTravelDiscoveryPlan,
  toSavedGoalWebDiscoveryInput,
} from "./webTravelDiscoveryPlanner";

export interface StrategyRewardProgram {
  id: string;
  name: string;
}

/**
 * Executes a set of planned research queries with Tavily, grouped by their
 * planned category. Returns one ResearchResponse per query, in plan order.
 */
async function executePlannedQueries(
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

/** Dependencies are injectable only for deterministic staged-execution tests. */
export interface StagedResearchDependencies {
  researchProvider: ResearchProvider;
  interpreter: ResearchInterpreter;
}

/**
 * Runs each staged query once. A failed query is omitted while completed
 * siblings remain available for interpretation; no query is retried here.
 */
export async function executeStagedPlannedQueries(
  queries: ResearchPlanQuery[],
  researchProvider: ResearchProvider,
): Promise<ResearchResponse[]> {
  const settled = await Promise.all(
    queries.map(async (query) => {
      try {
        return await researchProvider.search({
          query: query.query,
          includeDomains: [...query.includeDomains],
          searchDepth: query.searchDepth,
        });
      } catch {
        return null;
      }
    }),
  );
  return settled.filter((response): response is ResearchResponse => response !== null);
}

/**
 * Builds the public-web discovery plan entirely from saved, sanitized goal
 * facts. Models never select routes, dates, properties, or query count.
 */
async function resolveResearchPlan(
  context: PersonalizedStrategyContext,
  catalogRewardPrograms: StrategyRewardProgram[]
): Promise<ResearchPlan> {
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
 * Generates an automated strategy based on user goals, cards, and balances.
 * Combines Tavily Web Search, Ollama Research Interpretation, and Ollama Strategy Generation.
 *
 * @param context Complete PersonalizedStrategyContext containing customer's goal, balances, cards, and spending.
 * @param customerRewardPrograms Reward programs the customer actually owns (via reward accounts or linked wallet cards). Used to build research queries.
 * @param catalogRewardPrograms Complete reward-program catalog. Passed to the research interpreter so sourced transfer-partner options may reference any real catalog program. Never implies customer ownership.
 * @returns Generated PersonalizedStrategy.
 */
export async function generateAutomatedStrategy(
  context: PersonalizedStrategyContext,
  customerRewardPrograms: StrategyRewardProgram[],
  catalogRewardPrograms: StrategyRewardProgram[]
): Promise<PersonalizedStrategy> {
  const goal = context.goal;

  // 1. Build a deterministic saved-goal public-web plan. The plan is bounded
  // and models do not select routes, dates, properties, or query count.
  const researchPlan = await resolveResearchPlan(
    context,
    catalogRewardPrograms
  );

  // 2. Group planned queries by category and execute all Tavily searches
  // concurrently. Temporal and value queries are fetched here too so that
  // later phases can interpret them; for now they are merged into the
  // flight/hotel/card interpretation inputs by category affinity.
  const tavily = new TavilyResearchProvider();

  const flightPlanQueries = researchPlan.queries.filter(
    (q) => q.category === "flight"
  );
  const hotelPlanQueries = researchPlan.queries.filter(
    (q) => q.category === "hotel"
  );
  const cardPlanQueries = researchPlan.queries.filter(
    (q) => q.category === "card"
  );
  const temporalValuePlanQueries = researchPlan.queries.filter(
    (q) => q.category === "temporal" || q.category === "value"
  );

  const [
    flightResearchResponses,
    hotelResearchResponses,
    cardResearchResponses,
    temporalValueResearchResponses,
  ] = await Promise.all([
    executePlannedQueries(flightPlanQueries, tavily),
    executePlannedQueries(hotelPlanQueries, tavily),
    executePlannedQueries(cardPlanQueries, tavily),
    executePlannedQueries(temporalValuePlanQueries, tavily),
  ]);

  if (process.env.STRATEGY_DEBUG === "1") {
    console.log(
      "[strategy-flight-tavily-summary]",
      JSON.stringify({
        queryCount: flightPlanQueries.length,
        resultCounts: flightResearchResponses.map(
          (r) => r?.results?.length ?? 0
        ),
      })
    );
    for (let i = 0; i < hotelPlanQueries.length; i++) {
      console.log(
        "[strategy-hotel-tavily-response]",
        JSON.stringify({
          resultCount: hotelResearchResponses[i]?.results?.length ?? 0,
        })
      );
    }
    console.log(
      "[strategy-temporal-value-tavily-summary]",
      JSON.stringify({
        queryCount: temporalValuePlanQueries.length,
        resultCounts: temporalValueResearchResponses.map(
          (r) => r?.results?.length ?? 0
        ),
      })
    );
  }

  // 3. Interpret sequentially: flight first, then hotel, then optional card
  // offers. Sequential interpretation avoids simultaneous OpenRouter/free
  // requests. Each stage is independently best-effort: only
  // ResearchInterpreterError is caught; all other errors propagate.
  const interpreter = createResearchInterpreter();

  // 3a. Flight interpretation (best-effort)
  let flightInterpreted: Awaited<ReturnType<typeof interpreter.interpret>> | null = null;
  let flightRejected = false;
  try {
    flightInterpreted = await interpreter.interpret({
      goal,
      rewardPrograms: catalogRewardPrograms,
      research: flightResearchResponses,
      focus: "flight_options",
    });
  } catch (err) {
    if (err instanceof ResearchInterpreterError) {
      flightRejected = true;
    } else {
      throw err;
    }
  }

  if (process.env.STRATEGY_DEBUG === "1") {
    console.log(
      "[strategy-flight-interpreter-result]",
      JSON.stringify({
        rejected: flightRejected,
        optionCount: flightInterpreted
          ? flightInterpreted.awardOptions.length
          : 0,
        warningCount: flightInterpreted
          ? flightInterpreted.warnings.length
          : 0,
      })
    );
  }

  // 3b. Hotel interpretation (best-effort)
  let hotelInterpreted: Awaited<ReturnType<typeof interpreter.interpret>> | null = null;
  let hotelRejected = false;
  try {
    hotelInterpreted = await interpreter.interpret({
      goal,
      rewardPrograms: catalogRewardPrograms,
      research: hotelResearchResponses,
      focus: "hotel_options",
    });
  } catch (err) {
    if (err instanceof ResearchInterpreterError) {
      hotelRejected = true;
    } else {
      throw err;
    }
  }

  if (process.env.STRATEGY_DEBUG === "1") {
    console.log(
      "[strategy-hotel-interpreter-result]",
      JSON.stringify({
        rejected: hotelRejected,
        optionCount: hotelInterpreted
          ? hotelInterpreted.awardOptions.length
          : 0,
        warningCount: hotelInterpreted
          ? hotelInterpreted.warnings.length
          : 0,
      })
    );
  }

  // 3c. Card interpretation (best-effort, only when queries were sent)
  let cardInterpreted: Awaited<ReturnType<typeof interpreter.interpret>> | null = null;
  let cardRejected = false;
  if (cardPlanQueries.length > 0) {
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

  if (process.env.STRATEGY_DEBUG === "1") {
    console.log(
      "[strategy-card-interpreter-result]",
      JSON.stringify({
        queriesSent: cardPlanQueries.length > 0,
        rejected: cardRejected,
        offerCount: cardInterpreted ? cardInterpreted.cardOffers.length : 0,
      })
    );
  }

  // 3d. Temporal/value interpretation (best-effort).
  // Temporal insights feed into warnings; value insights also feed into
  // warnings for now (Phase 4). Both categories are interpreted together
  // under the temporal_insights focus since they share the same shape.
  let temporalValueInterpreted: InterpretedResearch | null = null;
  let temporalValueRejected = false;
  if (temporalValueResearchResponses.length > 0) {
    const hasResults = temporalValueResearchResponses.some(
      (r) => (r?.results?.length ?? 0) > 0
    );
    if (hasResults) {
      try {
        temporalValueInterpreted = await interpreter.interpret({
          goal,
          rewardPrograms: catalogRewardPrograms,
          research: temporalValueResearchResponses,
          focus: "temporal_insights",
        });
      } catch (err) {
        if (err instanceof ResearchInterpreterError) {
          temporalValueRejected = true;
        } else {
          throw err;
        }
      }
    }
  }

  // 4. Merge only successfully validated results.
  // awardOptions = validated flight options followed by validated hotel options.
  // Temporal/value insights contribute sources, assumptions, and warnings only.
  // Append the appropriate safe omission warning for each rejected stage.
  const interpreted = {
    awardOptions: [
      ...(flightInterpreted ? flightInterpreted.awardOptions : []),
      ...(hotelInterpreted ? hotelInterpreted.awardOptions : []),
    ],
    cardOffers: cardInterpreted ? cardInterpreted.cardOffers : [],
    sources: [
      ...(flightInterpreted ? flightInterpreted.sources : []),
      ...(hotelInterpreted ? hotelInterpreted.sources : []),
      ...(cardInterpreted ? cardInterpreted.sources : []),
      ...(temporalValueInterpreted ? temporalValueInterpreted.sources : []),
    ],
    assumptions: [
      ...(flightInterpreted ? flightInterpreted.assumptions : []),
      ...(hotelInterpreted ? hotelInterpreted.assumptions : []),
      ...(cardInterpreted ? cardInterpreted.assumptions : []),
      ...(temporalValueInterpreted ? temporalValueInterpreted.assumptions : []),
    ],
    warnings: [
      ...(flightInterpreted ? flightInterpreted.warnings : []),
      ...(hotelInterpreted ? hotelInterpreted.warnings : []),
      ...(cardInterpreted ? cardInterpreted.warnings : []),
      ...(temporalValueInterpreted ? temporalValueInterpreted.warnings : []),
      ...(flightRejected
        ? [
            "Flight recommendations were omitted because the researched flight details could not be fully validated.",
          ]
        : []),
      ...(hotelRejected
        ? [
            "Hotel recommendations were omitted because the researched hotel details could not be fully validated.",
          ]
        : []),
      ...(cardRejected
        ? [
            "Card-offer recommendations were omitted because the researched offer details could not be fully validated.",
          ]
        : []),
      ...(temporalValueRejected
        ? [
            "Temporal and value insights were omitted because the researched details could not be fully validated.",
          ]
        : []),
    ],
  };

  // 5. Merge interpreted data into a new PersonalizedStrategyContext
  // Ensure we do not mutate any input and do not use ad-hoc context fields
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

  // 6. Sanitize and send to the strategy provider.
  const strategyProvider = createStrategyProvider();
  const sanitizedPrompt = buildSanitizedStrategyPayload(
    enrichedContext,
    catalogRewardPrograms
  );
  const strategy = await strategyProvider.generateStrategy(sanitizedPrompt);

  // 7. Build a deterministic, sanitized points inventory from reward accounts
  // and the reward-program catalog. This is purely deterministic and is never
  // read from model output: each account becomes one sanitized row, mapped by
  // exact rewardProgramId to a catalog program name. userId and ownerKey are
  // excluded from the client-facing inventory.
  const pointsInventory = buildPointsInventory(
    context.rewardAccounts,
    catalogRewardPrograms
  );

  // 7a. Build deterministic allocation scenarios from the goal, the provider's
  // flight/hotel options, and the deterministic points inventory. The model
  // never produces allocationScenarios; it is assembled deterministically here.
  const allocationScenarios = buildStrategyAllocationScenarios(
    context.goal,
    strategy.flightOptions,
    strategy.hotelOptions,
    pointsInventory
  );

  // 8. Return the full PersonalizedStrategy, preserving interpreted
  // assumptions/warnings and attaching the deterministic points inventory
  // and allocation scenarios.
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
  dependencies?: StagedResearchDependencies,
): Promise<InterpretedResearch> {
  const plan = await resolveResearchPlan(context, catalogRewardPrograms);
  const flightPlanQueries = plan.queries.filter((q) => q.category === "flight");
  const researchProvider = dependencies?.researchProvider ?? new TavilyResearchProvider();
  const flightResponses = await executeStagedPlannedQueries(flightPlanQueries, researchProvider);
  if (flightPlanQueries.length > 0 && flightResponses.length === 0) {
    throw new ResearchInterpreterError(
      "No planned flight research queries completed.",
      "tavily",
      "unknown",
    );
  }

  const interpreter = dependencies?.interpreter ?? createResearchInterpreter();
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
  dependencies?: StagedResearchDependencies,
): Promise<InterpretedResearch> {
  const plan = await resolveResearchPlan(context, catalogRewardPrograms);
  const hotelPlanQueries = plan.queries.filter((q) => q.category === "hotel");
  const researchProvider = dependencies?.researchProvider ?? new TavilyResearchProvider();
  const hotelResponses = await executeStagedPlannedQueries(hotelPlanQueries, researchProvider);
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

  const interpreter = dependencies?.interpreter ?? createResearchInterpreter();
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
      const cardResearchResponses = await executePlannedQueries(
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

  // 5. Sanitize and generate the narrative once.
  const strategyProvider = createStrategyProvider();
  const sanitizedPrompt = buildSanitizedStrategyPayload(
    enrichedContext,
    catalogRewardPrograms
  );
  const strategy = await strategyProvider.generateStrategy(sanitizedPrompt);

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
