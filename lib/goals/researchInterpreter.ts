import type { Goal } from "./types";
import type { ResearchResponse } from "./researchTypes";
import type {
  StrategyAwardOption,
  StrategyCardOffer,
  StrategySource,
} from "./strategyTypes";

export interface InterpretedResearch {
  awardOptions: StrategyAwardOption[];
  cardOffers: StrategyCardOffer[];
  sources: StrategySource[];
  assumptions: string[];
  warnings: string[];
}

export interface ResearchRewardProgram {
  id: string;
  name: string;
}

export type ResearchFocus = "award_options" | "card_offers";

export interface InterpretResearchInput {
  goal: Goal;
  rewardPrograms: ResearchRewardProgram[];
  research: ResearchResponse[];
  focus: ResearchFocus;
}

export class ResearchInterpreterError extends Error {
  constructor(
    message: string,
    readonly provider: string,
    readonly model: string,
    readonly status?: number,
    readonly details?: string
  ) {
    super(message);
    this.name = "ResearchInterpreterError";
  }
}

export interface ResearchInterpreter {
  interpret(input: InterpretResearchInput): Promise<InterpretedResearch>;
}

export const RESEARCH_OUTPUT_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["awardOptions", "cardOffers", "assumptions", "warnings"],
  properties: {
    awardOptions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "id",
          "sourceId",
          "programName",
          "redemptionType",
          "pricingBasis",
          "itineraryLabel",
          "pointsRequired",
          "cashFees",
          "seats",
          "cabin",
          "transferFromProgramId",
          "transferRatio",
          "centsPerPoint",
          "availabilityStatus",
        ],
        properties: {
          id: { type: "string" },
          sourceId: { type: "string" },
          programName: { type: "string" },
          redemptionType: {
            enum: ["flight", "hotel"],
          },
          pricingBasis: {
            enum: ["one_way", "round_trip", "per_night", "total_stay", "unknown"],
          },
          itineraryLabel: { type: ["string", "null"] },
          pointsRequired: { type: "number" },
          cashFees: { type: ["number", "null"] },
          seats: { type: ["number", "null"] },
          cabin: { type: ["string", "null"] },
          transferFromProgramId: { type: ["string", "null"] },
          transferRatio: { type: ["number", "null"] },
          centsPerPoint: { type: ["number", "null"] },
          availabilityStatus: {
            enum: ["available", "unavailable", "unknown"],
          },
          travelerCountCovered: { type: ["number", "null"] },
          nightCountCovered: { type: ["number", "null"] },
          coverageStatus: {
            enum: ["source_explicit", "standard_assumption", "unknown"],
          },
          goalMatch: {
            enum: ["exact", "partial", "general", "different_destination"],
          },
          goalMismatchReasons: {
            type: "array",
            items: {
              enum: [
                "origin",
                "destination",
                "dates",
                "traveler_count",
                "cabin",
                "property",
              ],
            },
          },
        },
      },
    },
    cardOffers: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "id",
          "sourceId",
          "cardName",
          "issuer",
          "welcomeBonusPoints",
          "spendingRequirement",
          "spendingDeadlineMonths",
          "annualFee",
          "destinationProgramId",
        ],
        properties: {
          id: { type: "string" },
          sourceId: { type: "string" },
          cardName: { type: "string" },
          issuer: { type: "string" },
          welcomeBonusPoints: { type: "number" },
          spendingRequirement: { type: "number" },
          spendingDeadlineMonths: { type: "number" },
          annualFee: { type: "number" },
          destinationProgramId: { type: ["string", "null"] },
        },
      },
    },
    assumptions: {
      type: "array",
      items: { type: "string" },
    },
    warnings: {
      type: "array",
      items: { type: "string" },
    },
  },
};
