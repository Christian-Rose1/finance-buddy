import { test } from "node:test";
import assert from "node:assert/strict";

import type { Goal } from "./types";
import type { ResearchResponse } from "./researchTypes";
import { ResearchInterpreterError } from "./researchInterpreter";
import {
  buildResearchSystemPrompt,
  validateResearchModelContent,
} from "./ollamaResearchInterpreter";

function makeGoal(): Goal {
  return {
    id: "goal-1",
    userId: "user-1",
    type: "travel",
    title: "Euro Trip",
    status: "active",
    origin: ["DEN"],
    destinations: ["Paris"],
    earliestDeparture: "2027-04-03",
    latestReturn: "2027-04-30",
    minimumNights: 8,
    maximumNights: 16,
    travelerCount: 2,
    cabinPreference: "economy",
    optimizationPriority: "lowest_cash",
    maximumCashBudget: 2000,
    currency: "USD",
    allowNewCards: true,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
  };
}

function makeResearchResponse(query: string): ResearchResponse {
  return {
    query,
    results: [
      {
        title: "United Award Booking Window",
        url: "https://thepointsguy.com/united-award-booking-window",
        content:
          "United MileagePlus releases award space 337 days before departure. Flights can cost 30000 miles one way. New card offers come with a 60000 mile bonus and a 3 month spend deadline.",
        score: 0.9,
        publishedDate: "2026-01-01",
        sourceTier: "specialist",
      },
    ],
    searchedAt: "2026-08-24T00:00:00.000Z",
  };
}

test("temporal_insights focus is accepted by buildResearchSystemPrompt", () => {
  const prompt = buildResearchSystemPrompt("temporal_insights");
  assert.ok(prompt.includes("temporal_insights"));
  assert.ok(prompt.includes("booking-window"));
});

test("temporal_insights focus rejects awardOptions in model output", () => {
  const sourceId = "https://thepointsguy.com/united-award-booking-window";
  const rawContent = JSON.stringify({
    awardOptions: [
      {
        id: "opt-1",
        sourceId,
        programName: "United MileagePlus",
        redemptionType: "flight",
        pricingBasis: "one_way",
        itineraryLabel: null,
        pointsRequired: 30000,
        cashFees: null,
        seats: null,
        cabin: null,
        transferFromProgramId: null,
        transferRatio: null,
        centsPerPoint: null,
        availabilityStatus: "unknown",
      },
    ],
    cardOffers: [],
    assumptions: [],
    warnings: [],
  });

  assert.throws(
    () =>
      validateResearchModelContent(
        rawContent,
        {
          goal: makeGoal(),
          rewardPrograms: [{ id: "prog-1", name: "United MileagePlus" }],
          research: [makeResearchResponse("united booking window")],
          focus: "temporal_insights",
        },
        "test-model"
      ),
    (err: unknown) => {
      assert.ok(err instanceof ResearchInterpreterError);
      assert.match(
        (err as Error).message,
        /Focus is temporal_insights but.*award option/
      );
      return true;
    }
  );
});

test("temporal_insights focus rejects cardOffers in model output", () => {
  const sourceId = "https://thepointsguy.com/united-award-booking-window";
  // All numeric fields appear verbatim in the source content so
  // content-validation passes and the focus-rejection rule fires.
  const rawContent = JSON.stringify({
    awardOptions: [],
    cardOffers: [
      {
        id: "card-1",
        sourceId,
        cardName: "United Explorer",
        issuer: "Chase",
        welcomeBonusPoints: 60000,
        spendingRequirement: 60000,
        spendingDeadlineMonths: 3,
        annualFee: 60000,
        destinationProgramId: null,
      },
    ],
    assumptions: [],
    warnings: [],
  });

  assert.throws(
    () =>
      validateResearchModelContent(
        rawContent,
        {
          goal: makeGoal(),
          rewardPrograms: [{ id: "prog-1", name: "United MileagePlus" }],
          research: [makeResearchResponse("united booking window")],
          focus: "temporal_insights",
        },
        "test-model"
      ),
    (err: unknown) => {
      assert.ok(err instanceof ResearchInterpreterError);
      return true;
    }
  );
});

test("temporal_insights focus accepts empty awardOptions and cardOffers with warnings", () => {
  const rawContent = JSON.stringify({
    awardOptions: [],
    cardOffers: [],
    assumptions: [],
    warnings: [
      "United MileagePlus releases award space 337 days before departure.",
    ],
  });

  const result = validateResearchModelContent(
    rawContent,
    {
      goal: makeGoal(),
      rewardPrograms: [{ id: "prog-1", name: "United MileagePlus" }],
      research: [makeResearchResponse("united booking window")],
      focus: "temporal_insights",
    },
    "test-model"
  );

  assert.equal(result.awardOptions.length, 0);
  assert.equal(result.cardOffers.length, 0);
  assert.ok(result.warnings.length >= 0);
});