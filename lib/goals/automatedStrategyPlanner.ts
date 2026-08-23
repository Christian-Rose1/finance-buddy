import type {
  PersonalizedStrategy,
  PersonalizedStrategyContext,
} from "./strategyTypes";
import { buildPointsInventory } from "./pointsInventoryBuilder";
import { buildStrategyAllocationScenarios } from "./strategyAllocationBuilder";
import { TRUSTED_DOMAINS } from "./researchTypes";
import { TavilyResearchProvider } from "./tavilyResearchProvider";
import { ResearchInterpreterError } from "./ollamaResearchInterpreter";
import { createResearchInterpreter } from "./researchInterpreterFactory";
import { OllamaStrategyProvider } from "./ollamaStrategyProvider";
import { buildStrategyResearchQueries } from "./strategyResearchQueries";

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

  // 2. Search automatically with TavilyResearchProvider using trusted domains.
  // Flight and hotel queries are sent together; both are interpreted in the
  // single award_options interpretation below.
  const tavily = new TavilyResearchProvider();
  const awardQueries = [...flightQueries, ...hotelQueries];
  const awardResearchPromises = awardQueries.map((q) =>
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

  const [awardResearchResponses, cardResearchResponses] = await Promise.all([
    Promise.all(awardResearchPromises),
    Promise.all(cardResearchPromises),
  ]);

  // 3. Interpret award research first, then card research, using the
  // catalog reward programs (IDs and names) so sourced transfer-partner
  // options may reference any real catalog program (without implying customer
  // ownership).
  //
  // The award_options interpretation is required and runs first: any error
  // (including ResearchInterpreterError) must propagate.
  // The card_offers interpretation is best-effort and only runs when a card
  // query was sent. Only ResearchInterpreterError is treated as a non-fatal
  // omission (no card query never produces a warning); unexpected error types
  // are rethrown.
  const interpreter = createResearchInterpreter();
  const awardInterpreted = await interpreter.interpret({
    goal,
    rewardPrograms: catalogRewardPrograms,
    research: awardResearchResponses,
    focus: "award_options",
  });

  let cardInterpretationRejected = false;
  let cardInterpreted: typeof awardInterpreted | null = null;
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
        cardInterpretationRejected = true;
      } else {
        throw err;
      }
    }
  }

  // 4. Merge only validated card offers/sources/assumptions/warnings.
  // Append the safe omission warning when the card interpretation was rejected.
  const interpreted = {
    awardOptions: awardInterpreted.awardOptions,
    cardOffers: cardInterpreted ? cardInterpreted.cardOffers : [],
    sources: [
      ...awardInterpreted.sources,
      ...(cardInterpreted ? cardInterpreted.sources : []),
    ],
    assumptions: [
      ...awardInterpreted.assumptions,
      ...(cardInterpreted ? cardInterpreted.assumptions : []),
    ],
    warnings: [
      ...awardInterpreted.warnings,
      ...(cardInterpreted ? cardInterpreted.warnings : []),
      ...(cardInterpretationRejected
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

  // 6. Send that enriched context to OllamaStrategyProvider
  const strategyProvider = new OllamaStrategyProvider();
  const strategy = await strategyProvider.generateStrategy(enrichedContext);

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