import {
  ResearchInterpreterError,
  type InterpretedResearch,
  type InterpretResearchInput,
} from "./researchInterpreter";
import type {
  StrategyAwardOption,
  StrategyCardOffer,
} from "./strategyTypes";
import {
  assertNumberSupported,
  assertOptionalNumberSupported,
  buildResearchSources,
  hotelCategoryRangeSupported,
  numberIsSupportedBySource,
  parseModelResponse,
  requireFiniteNonNegativeNumber,
  requireObject,
  requireOptionalString,
  requireString,
  requireStringArray,
  resolveCanonicalSourceId,
  validateCoverage,
  validateGoalClassification,
  type ValidationContext,
} from "./researchInterpreterValidationHelpers";

function validateAwardOption(
  raw: unknown,
  ctx: ValidationContext
): StrategyAwardOption {
  const obj = requireObject(raw, "awardOptions[]", ctx.model);

  const id = requireString(obj.id, "awardOptions[].id", ctx.model);
  const rawSourceId = requireString(obj.sourceId, "awardOptions[].sourceId", ctx.model);
  const programName = requireString(obj.programName, "awardOptions[].programName", ctx.model);

  const sourceId = resolveCanonicalSourceId(
    rawSourceId,
    ctx,
    `Award option "${id}"`
  );
  const sourceEntry = ctx.sourceMap.get(sourceId);
  if (!sourceEntry) {
    throw new ResearchInterpreterError(
      `Award option "${id}" references unknown source "${sourceId}".`,
      "ollama",
      ctx.model
    );
  }

  const redemptionTypeRaw = requireString(
    obj.redemptionType,
    "awardOptions[].redemptionType",
    ctx.model
  );
  if (redemptionTypeRaw !== "flight" && redemptionTypeRaw !== "hotel") {
    throw new ResearchInterpreterError(
      `Award option "${id}" has invalid redemptionType "${redemptionTypeRaw}".`,
      "ollama",
      ctx.model
    );
  }

  const pricingBasisRaw = requireString(
    obj.pricingBasis,
    "awardOptions[].pricingBasis",
    ctx.model
  );
  if (
    pricingBasisRaw !== "one_way" &&
    pricingBasisRaw !== "round_trip" &&
    pricingBasisRaw !== "per_night" &&
    pricingBasisRaw !== "total_stay" &&
    pricingBasisRaw !== "unknown"
  ) {
    throw new ResearchInterpreterError(
      `Award option "${id}" has invalid pricingBasis "${pricingBasisRaw}".`,
      "ollama",
      ctx.model
    );
  }

  if (redemptionTypeRaw === "flight") {
    if (pricingBasisRaw === "per_night" || pricingBasisRaw === "total_stay") {
      throw new ResearchInterpreterError(
        `Award option "${id}" is a flight but has pricingBasis "${pricingBasisRaw}".`,
        "ollama",
        ctx.model
      );
    }
  }

  if (redemptionTypeRaw === "hotel") {
    if (pricingBasisRaw === "one_way" || pricingBasisRaw === "round_trip") {
      throw new ResearchInterpreterError(
        `Award option "${id}" is a hotel but has pricingBasis "${pricingBasisRaw}".`,
        "ollama",
        ctx.model
      );
    }
  }

  const sourceContent = sourceEntry.result.content;

  let finalProgramName = programName;
  const exactMatch = ctx.rewardPrograms.find((p) => p.name === programName);
  if (!exactMatch) {
    const partialMatches = ctx.rewardPrograms.filter((p) =>
      p.name.toLowerCase().includes(programName.toLowerCase())
    );
    if (partialMatches.length === 1) {
      finalProgramName = partialMatches[0].name;
    }
  }

  if (!ctx.rewardPrograms.some((program) => program.name === finalProgramName)) {
    throw new ResearchInterpreterError(
      `Award option "${id}" references program "${programName}" which was not supplied.`,
      "ollama",
      ctx.model
    );
  }

  // For hotel per_night options, allow category-range pricing as a fallback:
  // if the exact points value is not verbatim in the source but the source
  // contains a numeric range (e.g. "8,000–15,000 points per night") that
  // includes the value, accept it. All other options still require exact match.
  const pointsRequiredNum = requireFiniteNonNegativeNumber(
    obj.pointsRequired,
    "awardOptions[].pointsRequired",
    ctx.model
  );
  const pointsRequired: number = (() => {
    if (numberIsSupportedBySource(pointsRequiredNum, sourceContent, "pointsRequired")) {
      return pointsRequiredNum;
    }
    if (
      redemptionTypeRaw === "hotel" &&
      pricingBasisRaw === "per_night" &&
      hotelCategoryRangeSupported(pointsRequiredNum, sourceContent)
    ) {
      return pointsRequiredNum;
    }
    throw new ResearchInterpreterError(
      `Model output field "awardOptions[].pointsRequired" value "${pointsRequiredNum}" is not supported by the cited source content.`,
      "ollama",
      ctx.model
    );
  })();
  const cashFees = assertOptionalNumberSupported(
    obj.cashFees,
    "awardOptions[].cashFees",
    sourceContent,
    ctx.model
  );
  const seats = assertOptionalNumberSupported(
    obj.seats,
    "awardOptions[].seats",
    sourceContent,
    ctx.model
  );

  const cabin = requireOptionalString(obj.cabin, "awardOptions[].cabin", ctx.model);

  const transferFromProgramId =
    obj.transferFromProgramId === null || obj.transferFromProgramId === undefined
      ? null
      : requireString(
          obj.transferFromProgramId,
          "awardOptions[].transferFromProgramId",
          ctx.model
        );

  if (
    transferFromProgramId !== null &&
    !ctx.rewardPrograms.some((program) => program.id === transferFromProgramId)
  ) {
    throw new ResearchInterpreterError(
      `Award option "${id}" references transfer program "${transferFromProgramId}" which was not supplied.`,
      "ollama",
      ctx.model
    );
  }

  const transferRatio = assertOptionalNumberSupported(
    obj.transferRatio,
    "awardOptions[].transferRatio",
    sourceContent,
    ctx.model
  );

  const centsPerPoint = assertOptionalNumberSupported(
    obj.centsPerPoint,
    "awardOptions[].centsPerPoint",
    sourceContent,
    ctx.model
  );

  const availabilityStatusRaw = requireString(
    obj.availabilityStatus,
    "awardOptions[].availabilityStatus",
    ctx.model
  );
  if (
    availabilityStatusRaw !== "available" &&
    availabilityStatusRaw !== "unavailable" &&
    availabilityStatusRaw !== "unknown"
  ) {
    throw new ResearchInterpreterError(
      `Award option "${id}" has invalid availabilityStatus "${availabilityStatusRaw}".`,
      "ollama",
      ctx.model
    );
  }

  if (availabilityStatusRaw === "available") {
    throw new ResearchInterpreterError(
      `Award option "${id}" has availabilityStatus "available", which is rejected. Research is planning evidence, not live inventory.`,
      "ollama",
      ctx.model
    );
  }

  const coverage = validateCoverage(
    obj,
    sourceContent,
    redemptionTypeRaw,
    pricingBasisRaw,
    id,
    ctx.model
  );

  const goalClassification = validateGoalClassification(obj, id, ctx.model, ctx.goal);

  return {
    id,
    sourceId,
    programName: finalProgramName,
    redemptionType: redemptionTypeRaw,
    pricingBasis: pricingBasisRaw,
    itineraryLabel: requireOptionalString(
      obj.itineraryLabel,
      "awardOptions[].itineraryLabel",
      ctx.model
    ),
    pointsRequired,
    cashFees,
    seats,
    cabin,
    transferFromProgramId,
    transferRatio,
    centsPerPoint,
    availabilityStatus: availabilityStatusRaw,
    travelerCountCovered: coverage.travelerCountCovered,
    nightCountCovered: coverage.nightCountCovered,
    coverageStatus: coverage.coverageStatus,
    goalMatch: goalClassification.goalMatch,
    goalMismatchReasons: goalClassification.goalMismatchReasons,
  };
}

function validateCardOffer(
  raw: unknown,
  ctx: ValidationContext
): StrategyCardOffer {
  if (!ctx.goal.allowNewCards) {
    throw new ResearchInterpreterError(
      "Model output contains a card offer but goal.allowNewCards is false.",
      "ollama",
      ctx.model
    );
  }

  const obj = requireObject(raw, "cardOffers[]", ctx.model);

  const id = requireString(obj.id, "cardOffers[].id", ctx.model);
  const rawSourceId = requireString(obj.sourceId, "cardOffers[].sourceId", ctx.model);

  const sourceId = resolveCanonicalSourceId(
    rawSourceId,
    ctx,
    `Card offer "${id}"`
  );
  const sourceEntry = ctx.sourceMap.get(sourceId);
  if (!sourceEntry) {
    throw new ResearchInterpreterError(
      `Card offer "${id}" references unknown source "${sourceId}".`,
      "ollama",
      ctx.model
    );
  }
  const sourceContent = sourceEntry.result.content;

  const welcomeBonusPoints = assertNumberSupported(
    obj.welcomeBonusPoints,
    "cardOffers[].welcomeBonusPoints",
    sourceContent,
    ctx.model
  );
  const spendingRequirement = assertNumberSupported(
    obj.spendingRequirement,
    "cardOffers[].spendingRequirement",
    sourceContent,
    ctx.model
  );
  const spendingDeadlineMonths = assertNumberSupported(
    obj.spendingDeadlineMonths,
    "cardOffers[].spendingDeadlineMonths",
    sourceContent,
    ctx.model
  );
  const annualFee = assertNumberSupported(
    obj.annualFee,
    "cardOffers[].annualFee",
    sourceContent,
    ctx.model
  );

  const destinationProgramId =
    obj.destinationProgramId === null || obj.destinationProgramId === undefined
      ? null
      : requireString(
          obj.destinationProgramId,
          "cardOffers[].destinationProgramId",
          ctx.model
        );

  if (
    destinationProgramId !== null &&
    !ctx.rewardPrograms.some((program) => program.id === destinationProgramId)
  ) {
    throw new ResearchInterpreterError(
      `Card offer "${id}" references destination program "${destinationProgramId}" which was not supplied.`,
      "ollama",
      ctx.model
    );
  }

  return {
    id,
    sourceId,
    cardName: requireString(obj.cardName, "cardOffers[].cardName", ctx.model),
    issuer: requireString(obj.issuer, "cardOffers[].issuer", ctx.model),
    welcomeBonusPoints,
    spendingRequirement,
    spendingDeadlineMonths,
    annualFee,
    destinationProgramId,
  };
}

/**
 * Returns true when an award-option validation error is a *trust-boundary*
 * failure (a numeric/coverage value that is not supported by the cited source
 * content, or a live-availability claim) rather than a *structural* contract
 * violation (invalid redemptionType, invalid pricingBasis, type/basis
 * mismatches, invalid/ill-formed coverage fields, or references to unknown
 * sources/programs).
 *
 * Only trust-boundary errors are safe to drop per-option in the tolerant
 * per-option validation loop: a single structurally-malformed option signals
 * the model failed to follow the output contract and must still reject the
 * whole stage.
 */
function isDropableAwardError(message: string): boolean {
  return (
    /is not supported by the cited source content\.$/.test(message) ||
    /Model output claims live availability/.test(message)
  );
}

function validateInterpretedOutput(
  parsed: unknown,
  ctx: ValidationContext
): InterpretedResearch {
  const root = requireObject(parsed, "root", ctx.model);

  const awardOptionsRaw = root.awardOptions;
  if (!Array.isArray(awardOptionsRaw)) {
    throw new ResearchInterpreterError(
      'Model output missing required array field "awardOptions".',
      "ollama",
      ctx.model
    );
  }

  const cardOffersRaw = root.cardOffers;
  if (!Array.isArray(cardOffersRaw)) {
    throw new ResearchInterpreterError(
      'Model output missing required array field "cardOffers".',
      "ollama",
      ctx.model
    );
  }

  const assumptions = requireStringArray(
    root.assumptions,
    "assumptions",
    ctx.model
  );
  const warnings = requireStringArray(root.warnings, "warnings", ctx.model);

  // Tolerant per-option award validation. Research stages like hotel can
  // receive many candidates; one invalid candidate (e.g. claims live
  // "available", an unsupported price, or an unsupported coverage count) should
  // not discard every option and reject the whole stage. The invalid option is
  // dropped and a warning names it; every option that does validate is kept.
  // This preserves the "only validated facts" trust boundary — an invalid
  // option is never surfaced — while letting valid options survive a bad peer.
  //
  // Only TRUST-BOUNDARY errors (a value not supported by the cited source, or
  // a live-availability claim) are droppable. STRUCTURAL errors (invalid
  // redemptionType, invalid pricingBasis, flight/hotel/pricingBasis
  // mismatches, invalid coverageStatus, null counts that violate the status
  // contract, references to unknown sources/programs) still propagate and
  // reject the whole stage, because they indicate the model fundamentally
  // misunderstood the output contract rather than merely over-claimed a fact.
  const awardOptions: StrategyAwardOption[] = [];
  const awardRejections: string[] = [];
  for (const raw of awardOptionsRaw) {
    // Pre-extract the redemptionType so per-option tolerance can be scoped to
    // hotels only (flights always retain strict whole-stage rejection — they
    // are never dropped). If the type is missing or structural, fall back to
    // whole-stage rejection by letting validateAwardOption throw.
    let rawRedemptionType: string | null = null;
    try {
      const obj =
        raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
      const rt = obj?.redemptionType;
      if (typeof rt === "string") rawRedemptionType = rt;
    } catch {
      /* fall through to validation below */
    }

    try {
      awardOptions.push(validateAwardOption(raw, ctx));
    } catch (err) {
      // Only hotel options are eligible for per-option tolerance: a single
      // hotel source often yields several candidate prices, and a single bad
      // price must not discard the entire hotel stage. Flight options (and any
      // structural error) still propagate as a whole-stage rejection.
      const isHotel = rawRedemptionType === "hotel";
      if (
        isHotel &&
        err instanceof ResearchInterpreterError &&
        isDropableAwardError(err.message)
      ) {
        awardRejections.push(
          `Dropped an unverifiable award option: ${err.message}`
        );
      } else {
        throw err;
      }
    }
  }
  if (awardRejections.length > 0) {
    warnings.push(...awardRejections);
  }

  const cardOffers = cardOffersRaw.map((raw) => validateCardOffer(raw, ctx));

  if (ctx.focus === "award_options" && cardOffers.length > 0) {
    throw new ResearchInterpreterError(
      `Focus is award_options but ${cardOffers.length} card offer(s) were returned.`,
      "ollama",
      ctx.model
    );
  }

  if (ctx.focus === "card_offers" && awardOptions.length > 0) {
    throw new ResearchInterpreterError(
      `Focus is card_offers but ${awardOptions.length} award option(s) were returned.`,
      "ollama",
      ctx.model
    );
  }

  // Focused award-option type restrictions
  if (ctx.focus === "flight_options") {
    if (cardOffers.length > 0) {
      throw new ResearchInterpreterError(
        `Focus is flight_options but ${cardOffers.length} card offer(s) were returned.`,
        "ollama",
        ctx.model
      );
    }
    const hotelOptions = awardOptions.filter((o) => o.redemptionType === "hotel");
    if (hotelOptions.length > 0) {
      throw new ResearchInterpreterError(
        `Focus is flight_options but ${hotelOptions.length} hotel award option(s) were returned.`,
        "ollama",
        ctx.model
      );
    }
  }

  if (ctx.focus === "hotel_options") {
    if (cardOffers.length > 0) {
      throw new ResearchInterpreterError(
        `Focus is hotel_options but ${cardOffers.length} card offer(s) were returned.`,
        "ollama",
        ctx.model
      );
    }
    const flightOptions = awardOptions.filter((o) => o.redemptionType === "flight");
    if (flightOptions.length > 0) {
      throw new ResearchInterpreterError(
        `Focus is hotel_options but ${flightOptions.length} flight award option(s) were returned.`,
        "ollama",
        ctx.model
      );
    }
  }

  if (ctx.focus === "temporal_insights") {
    if (awardOptions.length > 0) {
      throw new ResearchInterpreterError(
        `Focus is temporal_insights but ${awardOptions.length} award option(s) were returned.`,
        "ollama",
        ctx.model
      );
    }
    if (cardOffers.length > 0) {
      throw new ResearchInterpreterError(
        `Focus is temporal_insights but ${cardOffers.length} card offer(s) were returned.`,
        "ollama",
        ctx.model
      );
    }
  }

  return {
    awardOptions,
    cardOffers,
    sources: Array.from(ctx.sourceMap.values()).map((e) => e.source),
    assumptions,
    warnings,
  };
}

export function validateResearchModelContent(
  rawContent: string,
  input: InterpretResearchInput,
  model: string
): InterpretedResearch {
  const entries = buildResearchSources(input.research);
  const sourceMap = new Map(entries.map((e) => [e.source.id, e]));

  const parsed = parseModelResponse(rawContent, model);

  const validationContext: ValidationContext = {
    goal: input.goal,
    rewardPrograms: input.rewardPrograms,
    sourceMap,
    model,
    focus: input.focus,
  };

  return validateInterpretedOutput(parsed, validationContext);
}
