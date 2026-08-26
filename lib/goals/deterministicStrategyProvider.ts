import type {
  PersonalizedStrategyNarrative,
  SanitizedStrategyPrompt,
  StrategyAction,
  StrategyAwardOption,
  StrategyCardOffer,
  StrategyProvider,
} from "./strategyTypes";
import {
  deduplicateByOptionId,
  StrategyProviderError,
} from "./strategyProviderCore";

const FALLBACK_WARNING =
  "The narrative provider was unavailable or returned invalid output, so this conservative plan was generated deterministically from the supplied data.";

function knownSourceIds(
  sourceIds: string[],
  prompt: SanitizedStrategyPrompt
): string[] {
  const suppliedSourceIds = new Set(prompt.sources.map((source) => source.id));
  return [...new Set(sourceIds)].filter((sourceId) =>
    suppliedSourceIds.has(sourceId)
  );
}

function optionSourceIds(
  options: StrategyAwardOption[],
  prompt: SanitizedStrategyPrompt
): string[] {
  return knownSourceIds(
    options.map((option) => option.sourceId),
    prompt
  );
}

function offerSourceIds(
  offers: StrategyCardOffer[],
  prompt: SanitizedStrategyPrompt
): string[] {
  return knownSourceIds(
    offers.map((offer) => offer.sourceId),
    prompt
  );
}

function routeDescription(prompt: SanitizedStrategyPrompt): string {
  const origins = prompt.goal.origin.filter(Boolean).join(", ");
  const destinations = prompt.goal.destinations.filter(Boolean).join(", ");

  if (origins && destinations) {
    return ` from ${origins} to ${destinations}`;
  }

  if (destinations) {
    return ` to ${destinations}`;
  }

  return "";
}

function destinationDescription(prompt: SanitizedStrategyPrompt): string {
  const destinations = prompt.goal.destinations.filter(Boolean).join(", ");
  return destinations ? ` in ${destinations}` : "";
}

function appendAction(
  actions: StrategyAction[],
  action: Omit<StrategyAction, "priority" | "deadline">
): void {
  actions.push({
    priority: actions.length + 1,
    deadline: null,
    ...action,
  });
}

export function buildDeterministicStrategyNarrative(
  prompt: SanitizedStrategyPrompt
): PersonalizedStrategyNarrative {
  const flightOptions = deduplicateByOptionId(
    prompt.awardOptions.filter((option) => option.redemptionType === "flight")
  );
  const hotelOptions = deduplicateByOptionId(
    prompt.awardOptions.filter((option) => option.redemptionType === "hotel")
  );
  const actions: StrategyAction[] = [];

  if (flightOptions.length > 0) {
    appendAction(actions, {
      title: "Verify the supplied flight options",
      explanation: `Review the ${flightOptions.length} supplied flight planning option${flightOptions.length === 1 ? "" : "s"}${routeDescription(prompt)}. Confirm current availability, points price, fees, traveler coverage, and transfer terms before booking or moving points.`,
      sourceIds: optionSourceIds(flightOptions, prompt),
    });
  } else {
    appendAction(actions, {
      title: "Collect current flight evidence",
      explanation: `Obtain a current points quote${routeDescription(prompt)} for the requested travelers before choosing a flight redemption.`,
      sourceIds: [],
    });
  }

  if (hotelOptions.length > 0) {
    appendAction(actions, {
      title: "Verify the supplied hotel options",
      explanation: `Review the ${hotelOptions.length} supplied hotel planning option${hotelOptions.length === 1 ? "" : "s"}${destinationDescription(prompt)}. Confirm current room availability, points price, fees, stay coverage, and transfer terms before booking or moving points.`,
      sourceIds: optionSourceIds(hotelOptions, prompt),
    });
  } else {
    appendAction(actions, {
      title: "Collect current hotel evidence",
      explanation: `Obtain a current points quote${destinationDescription(prompt)} for the requested stay before choosing a hotel redemption.`,
      sourceIds: [],
    });
  }

  const verifiedSelfBalances = prompt.pointsInventory.filter(
    (item) =>
      item.ownerType === "self" && item.verificationStatus === "verified"
  );

  if (verifiedSelfBalances.length > 0) {
    appendAction(actions, {
      title: "Review the calculated funding scenarios",
      explanation:
        "Compare the deterministic allocation scenarios with the supplied verified self-owned balances, and reconfirm each balance before an irreversible transfer.",
      sourceIds: [],
    });
  } else if (prompt.pointsInventory.length > 0) {
    appendAction(actions, {
      title: "Verify an eligible points balance",
      explanation:
        "The supplied balances cannot be treated as confirmed funding unless they are both self-owned and verified.",
      sourceIds: [],
    });
  } else {
    appendAction(actions, {
      title: "Add reward-account balances",
      explanation:
        "Add the reward-account balances to consider, including their verification status, before selecting a redemption.",
      sourceIds: [],
    });
  }

  if (prompt.goal.allowNewCards && prompt.cardOffers.length > 0) {
    appendAction(actions, {
      title: "Review supplied card offers separately",
      explanation:
        "This fallback does not recommend an offer. Confirm current eligibility and complete terms before applying for any supplied offer.",
      sourceIds: offerSourceIds(prompt.cardOffers, prompt),
    });
  }

  const followUpQuestions: string[] = [];

  if (!prompt.goal.earliestDeparture || !prompt.goal.latestReturn) {
    followUpQuestions.push(
      "What complete departure and return date range should this plan use?"
    );
  }
  if (flightOptions.length === 0) {
    followUpQuestions.push(
      "Can you confirm a current flight award quote for the requested route and travelers?"
    );
  }
  if (hotelOptions.length === 0) {
    followUpQuestions.push(
      "Can you confirm a current hotel award quote for the requested destination and stay length?"
    );
  }
  if (verifiedSelfBalances.length === 0) {
    followUpQuestions.push(
      "Which self-owned reward-account balances can be verified for funding?"
    );
  }
  if (followUpQuestions.length === 0) {
    followUpQuestions.push(
      "Which supplied flight or hotel option should be verified first?"
    );
  }

  const goalTitle = prompt.goal.title.trim();
  const hasPlanningOptions = flightOptions.length + hotelOptions.length > 0;

  return {
    deterministicFallback: true,
    headline: goalTitle
      ? `${goalTitle}: details need verification`
      : "Travel plan details need verification",
    summary: hasPlanningOptions
      ? "The supplied planning options are preserved for review, and points allocations are calculated separately. A booking recommendation cannot be made safely until current details are verified."
      : "No flight or hotel planning options were supplied, so a booking recommendation and points gap cannot be determined safely.",
    feasibility: "insufficient_information",
    pointsGap: null,
    recommendedAwardOptionId: null,
    recommendedCardOfferId: null,
    flightOptions,
    hotelOptions,
    actions,
    alternatives: [],
    assumptions: [],
    warnings: [
      FALLBACK_WARNING,
      "No booking recommendation, points gap, award availability, price, transfer term, deadline, or card offer was inferred by this fallback.",
      "Verify current availability and all redemption or offer terms before acting.",
    ],
    followUpQuestions,
  };
}

export class DeterministicStrategyProvider implements StrategyProvider {
  async generateStrategy(
    prompt: SanitizedStrategyPrompt
  ): Promise<PersonalizedStrategyNarrative> {
    if (
      typeof process !== "undefined" &&
      process.env?.STRATEGY_DEBUG === "1"
    ) {
      console.warn("[strategy-provider-fallback]");
    }

    return buildDeterministicStrategyNarrative(prompt);
  }
}

export class StrategyProviderWithFallback implements StrategyProvider {
  constructor(
    private readonly primary: StrategyProvider,
    private readonly fallback: StrategyProvider =
      new DeterministicStrategyProvider()
  ) {}

  async generateStrategy(
    prompt: SanitizedStrategyPrompt
  ): Promise<PersonalizedStrategyNarrative> {
    try {
      return await this.primary.generateStrategy(prompt);
    } catch (error) {
      if (!(error instanceof StrategyProviderError)) {
        throw error;
      }

      return this.fallback.generateStrategy(prompt);
    }
  }
}
