import type {
  PersonalizedStrategy,
  PersonalizedStrategyContext,
} from "./strategyTypes";
import { buildPointsInventory } from "./pointsInventoryBuilder";
import { buildStrategyAllocationScenarios } from "./strategyAllocationBuilder";
import { TRUSTED_DOMAINS } from "./researchTypes";
import { TavilyResearchProvider } from "./tavilyResearchProvider";
import { ResearchInterpreterError } from "./researchInterpreter";
import type { InterpretedResearch } from "./researchInterpreter";
import { createResearchInterpreter } from "./researchInterpreterFactory";
import { createStrategyProvider } from "./strategyProviderFactory";
import { buildStrategyResearchQueries } from "./strategyResearchQueries";
import { buildSanitizedStrategyPayload } from "./sanitizedStrategyPayload";

export interface StrategyRewardProgram {
  id: string;
  name: string;
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

  // 1. Build a small, bounded set of goal-specific research queries:
  // at most 1 flight query, 1 hotel query, and 1 card-offer query
  // (card query only when allowNewCards=true). Total <= 3 Tavily searches.
  const { flightQueries, hotelQueries, cardQueries } = buildStrategyResearchQueries(
    goal,
    customerRewardPrograms
  );

  // 2. Search the three categories independently with TavilyResearchProvider
  // using trusted domains. All Tavily searches may run concurrently.
  const tavily = new TavilyResearchProvider();
  const flightResearchPromises = flightQueries.map((q) =>
    tavily.search({
      query: q,
      includeDomains: [...TRUSTED_DOMAINS],
    })
  );
  const hotelResearchPromises = hotelQueries.map((q) =>
    tavily.search({
      query: q,
      includeDomains: [...TRUSTED_DOMAINS],
    })
  );
  const cardResearchPromises = cardQueries.map((q) =>
    tavily.search({
      query: q,
      includeDomains: [...TRUSTED_DOMAINS],
    })
  );

  const [
    flightResearchResponses,
    hotelResearchResponses,
    cardResearchResponses,
  ] = await Promise.all([
    Promise.all(flightResearchPromises),
    Promise.all(hotelResearchPromises),
    Promise.all(cardResearchPromises),
  ]);

  if (process.env.STRATEGY_DEBUG === "1") {
    for (let i = 0; i < hotelQueries.length; i++) {
      console.log(
        "[strategy-hotel-tavily-response]",
        JSON.stringify({
          query: hotelQueries[i],
          resultCount: hotelResearchResponses[i]?.results?.length ?? 0,
          results: hotelResearchResponses[i]?.results ?? [],
        })
      );
    }
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
      if (process.env.STRATEGY_DEBUG === "1") {
        console.log(
          "[strategy-hotel-validation-error]",
          JSON.stringify({ error: err.message })
        );
      }
      hotelRejected = true;
    } else {
      throw err;
    }
  }

  // 3c. Card interpretation (best-effort, only when queries were sent)
  let cardInterpreted: Awaited<ReturnType<typeof interpreter.interpret>> | null = null;
  let cardRejected = false;
  if (cardQueries.length > 0) {
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

  // 4. Merge only successfully validated results.
  // awardOptions = validated flight options followed by validated hotel options.
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
    ],
    assumptions: [
      ...(flightInterpreted ? flightInterpreted.assumptions : []),
      ...(hotelInterpreted ? hotelInterpreted.assumptions : []),
      ...(cardInterpreted ? cardInterpreted.assumptions : []),
    ],
    warnings: [
      ...(flightInterpreted ? flightInterpreted.warnings : []),
      ...(hotelInterpreted ? hotelInterpreted.warnings : []),
      ...(cardInterpreted ? cardInterpreted.warnings : []),
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
 * @param customerRewardPrograms Reward programs the customer actually owns. Used to build research queries.
 * @param catalogRewardPrograms Complete reward-program catalog. Passed to the research interpreter so sourced options may reference any real catalog program.
 * @returns The validated flight-focused InterpretedResearch.
 */
export async function generateFlightResearchStage(
  context: PersonalizedStrategyContext,
  customerRewardPrograms: StrategyRewardProgram[],
  catalogRewardPrograms: StrategyRewardProgram[]
): Promise<InterpretedResearch> {
  const { flightQueries } = buildStrategyResearchQueries(
    context.goal,
    customerRewardPrograms
  );

  const tavily = new TavilyResearchProvider();
  const flightResearchResponses = await Promise.all(
    flightQueries.map((q) =>
      tavily.search({
        query: q,
        includeDomains: [...TRUSTED_DOMAINS],
      })
    )
  );

  const interpreter = createResearchInterpreter();
  return interpreter.interpret({
    goal: context.goal,
    rewardPrograms: catalogRewardPrograms,
    research: flightResearchResponses,
    focus: "flight_options",
  });
}

/**
 * Researches and interprets hotel options for a goal in isolation.
 *
 * @param context Complete PersonalizedStrategyContext containing the customer's goal.
 * @param customerRewardPrograms Reward programs the customer actually owns. Used to build research queries.
 * @param catalogRewardPrograms Complete reward-program catalog. Passed to the research interpreter so sourced options may reference any real catalog program.
 * @returns The validated hotel-focused InterpretedResearch.
 */
export async function generateHotelResearchStage(
  context: PersonalizedStrategyContext,
  customerRewardPrograms: StrategyRewardProgram[],
  catalogRewardPrograms: StrategyRewardProgram[]
): Promise<InterpretedResearch> {
  const { hotelQueries } = buildStrategyResearchQueries(
    context.goal,
    customerRewardPrograms
  );

  const tavily = new TavilyResearchProvider();
  const hotelResearchResponses = await Promise.all(
    hotelQueries.map((q) =>
      tavily.search({
        query: q,
        includeDomains: [...TRUSTED_DOMAINS],
      })
    )
  );

  if (process.env.STRATEGY_DEBUG === "1") {
    for (let i = 0; i < hotelQueries.length; i++) {
      console.log(
        "[strategy-hotel-tavily-response]",
        JSON.stringify({
          query: hotelQueries[i],
          resultCount: hotelResearchResponses[i]?.results?.length ?? 0,
          results: hotelResearchResponses[i]?.results ?? [],
        })
      );
    }
  }

  const interpreter = createResearchInterpreter();
  return interpreter.interpret({
    goal: context.goal,
    rewardPrograms: catalogRewardPrograms,
    research: hotelResearchResponses,
    focus: "hotel_options",
  });
}

export interface VerifiedStrategyResearchStages {
  flight: InterpretedResearch | null;
  hotel: InterpretedResearch | null;
}

/**
 * Generates a personalized strategy from already-verified flight and hotel
 * research stages plus optional card-offer research.
 *
 * This function NEVER runs flight or hotel Tavily searches and NEVER
 * reinterprets flight or hotel data: those stages are supplied directly as
 * validated InterpretedResearch. Card-offer research (when a card query
 * exists) is still performed here and is never persisted to the staged run.
 *
 * @param context Complete PersonalizedStrategyContext.
 * @param customerRewardPrograms Reward programs the customer owns. Used only to build the optional card query.
 * @param catalogRewardPrograms Complete reward-program catalog. Passed to the interpreter for card offers.
 * @param stages Verified flight/hotel research stages (null means omitted).
 * @returns A complete PersonalizedStrategy suitable for saveLatestStrategy.
 */
export async function generateAutomatedStrategyFromResearchStages(
  context: PersonalizedStrategyContext,
  customerRewardPrograms: StrategyRewardProgram[],
  catalogRewardPrograms: StrategyRewardProgram[],
  stages: VerifiedStrategyResearchStages
): Promise<PersonalizedStrategy> {
  const goal = context.goal;

  // 1. Build only the optional card-offer query. No flight/hotel queries.
  const { cardQueries } = buildStrategyResearchQueries(
    goal,
    customerRewardPrograms
  );

  // 2. Card-offer research (best-effort, only when a card query exists).
  // No card query → no search, no interpretation, no warning.
  let cardInterpreted: InterpretedResearch | null = null;
  let cardRejected = false;
  if (cardQueries.length > 0) {
    const tavily = new TavilyResearchProvider();
    const cardResearchResponses = await Promise.all(
      cardQueries.map((q) =>
        tavily.search({
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
