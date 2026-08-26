import assert from "node:assert/strict";
import { test } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { PersonalizedStrategy } from "../../lib/goals/strategyTypes";
import { AwardOptionsSection } from "./award-options-section";
import { GenerationProgress } from "./generation-progress";
import { StrategyResult } from "./strategy-result";

const strategy = {
  headline: "A customer-specific plan",
  summary: "Use the verified balance for the researched option.",
  feasibility: "gap_remaining",
  pointsGap: 10_000,
  recommendedAwardOptionId: "private-flight-option-id",
  recommendedCardOfferId: null,
  flightOptions: [
    {
      id: "private-flight-option-id",
      sourceId: "https://example.com/award",
      programName: "Example Miles",
      redemptionType: "flight",
      pricingBasis: "round_trip",
      itineraryLabel: "Example round trip",
      pointsRequired: 50_000,
      cashFees: null,
      seats: null,
      cabin: "economy",
      transferFromProgramId: null,
      transferRatio: null,
      centsPerPoint: null,
      availabilityStatus: "unknown",
    },
  ],
  hotelOptions: [],
  actions: [],
  alternatives: [],
  assumptions: [],
  warnings: [],
  followUpQuestions: [],
  pointsInventory: [
    {
      accountId: "private-account-id",
      rewardProgramId: "private-program-id",
      programName: "Example Miles",
      ownerLabel: "My points",
      ownerType: "self",
      balance: 40_000,
      balanceAsOf: "2026-08-20T12:00:00.000Z",
      origin: "manual",
      verificationStatus: "verified",
    },
  ],
  allocationScenarios: [],
} satisfies PersonalizedStrategy;

test("strategy presentation keeps customer labels and caveats without rendering raw IDs", () => {
  const html = renderToStaticMarkup(<StrategyResult strategy={strategy} />);

  assert.match(html, /A customer-specific plan/);
  assert.match(html, /My points/);
  assert.match(html, /50,000 points/);
  assert.match(html, /planning estimates only/);
  assert.doesNotMatch(html, /private-account-id/);
  assert.doesNotMatch(html, /private-program-id/);
  assert.doesNotMatch(html, /private-flight-option-id/);
});

test("complete strategy presentation retains every customer-facing section", () => {
  const completeStrategy = {
    ...strategy,
    hotelOptions: [
      {
        id: "private-hotel-option-id",
        sourceId: "https://example.com/hotel-award",
        programName: "World of Hyatt",
        redemptionType: "hotel",
        pricingBasis: "per_night",
        itineraryLabel: "Paris hotel benchmark",
        pointsRequired: 25_000,
        cashFees: null,
        seats: null,
        cabin: null,
        transferFromProgramId: null,
        transferRatio: null,
        centsPerPoint: null,
        availabilityStatus: "unknown",
      },
    ],
    actions: [
      {
        priority: 1,
        title: "Verify the award price",
        explanation: "Confirm the exact rate before transferring points.",
        deadline: "Before booking",
        sourceIds: [],
      },
    ],
    alternatives: [
      {
        title: "Use a hotel-first plan",
        tradeoff: "This leaves fewer points for flights.",
        sourceIds: [],
      },
    ],
    assumptions: ["One room is required."],
    warnings: ["Availability is not confirmed."],
    followUpQuestions: ["Are the dates flexible?"],
    pointsInventory: [
      ...strategy.pointsInventory,
      {
        accountId: "private-unverified-account-id",
        rewardProgramId: "private-unverified-program-id",
        programName: "World of Hyatt",
        ownerLabel: "Backup balance",
        ownerType: "self",
        balance: 12_500,
        balanceAsOf: "2026-08-21T12:00:00.000Z",
        origin: "connected",
        verificationStatus: "unverified",
      },
    ],
    allocationScenarios: [
      {
        id: "private-scenario-id",
        kind: "balanced",
        title: "Split points across the trip",
        status: "gap",
        flightOptionId: "private-flight-option-id",
        hotelOptionId: "private-hotel-option-id",
        flightPointsRequired: 50_000,
        hotelPointsRequired: 200_000,
        travelerCount: 2,
        tripNights: 8,
        allocations: [
          {
            accountId: "private-account-id",
            rewardProgramId: "private-program-id",
            programName: "Example Miles",
            ownerLabel: "My points",
            fundingMethod: "direct_program",
            availablePoints: 40_000,
            plannedPoints: 40_000,
            remainingPoints: 0,
            pointsGap: 10_000,
          },
        ],
        assumptions: ["The cited flight price covers this plan."],
        warnings: ["The plan still has a points gap."],
      },
    ],
  } satisfies PersonalizedStrategy;

  const html = renderToStaticMarkup(
    <StrategyResult strategy={completeStrategy} />
  );

  for (const expected of [
    "Your points",
    "Verified balances",
    "Unverified balances",
    "Ways to use your points",
    "Flight options",
    "Hotel options",
    "Recommended actions",
    "Alternatives to consider",
    "Assumptions",
    "Warnings",
    "To sharpen this plan",
    "25,000 points",
    "Hotels: 200,000 pts",
    "2 travelers",
    "8 nights",
  ]) {
    assert.match(html, new RegExp(expected));
  }

  assert.doesNotMatch(html, /private-account-id/);
  assert.doesNotMatch(html, /private-program-id/);
  assert.doesNotMatch(html, /private-flight-option-id/);
  assert.doesNotMatch(html, /private-hotel-option-id/);
  assert.doesNotMatch(html, /private-scenario-id/);
});

test("award preview retains the validated-empty state", () => {
  const html = renderToStaticMarkup(
    <AwardOptionsSection kind="hotel" options={[]} showEmpty />
  );

  assert.match(html, /No validated hotel options were found\./);
});

test("progress remains visible after a retryable final failure and hides after success", () => {
  const failedHtml = renderToStaticMarkup(
    <GenerationProgress
      isGenerating={false}
      currentStage="final"
      flightStatus="succeeded"
      flightMessage={null}
      hotelStatus="succeeded"
      hotelMessage={null}
      finalStatus="failed"
    />
  );
  const succeededHtml = renderToStaticMarkup(
    <GenerationProgress
      isGenerating={false}
      currentStage="final"
      flightStatus="idle"
      flightMessage={null}
      hotelStatus="idle"
      hotelMessage={null}
      finalStatus="succeeded"
    />
  );

  assert.match(failedHtml, /Building your strategy/);
  assert.match(failedHtml, /Could not complete/);
  assert.match(failedHtml, /role="status"/);
  assert.match(failedHtml, /aria-live="polite"/);
  assert.match(failedHtml, /aria-busy="false"/);
  assert.match(
    failedHtml,
    /Building your personalized points plan: could not complete/
  );
  assert.equal(succeededHtml, "");
});
