import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import type { PersonalizedStrategy } from "./strategyTypes";
import type { Goal } from "./types";

(globalThis as typeof globalThis & { React: typeof React }).React = React;

const router = {
  back() {},
  forward() {},
  refresh() {},
  push() {},
  replace() {},
  prefetch: async () => undefined,
};

const goal: Goal = {
  id: "2cb72e1e-4a90-4ea6-85bb-622dbe6fcf10",
  userId: "user-a",
  type: "travel",
  title: "Edited Europe trip",
  status: "active",
  origin: ["DEN"],
  destinations: ["CDG"],
  earliestDeparture: "2027-04-03",
  latestReturn: "2027-04-30",
  minimumNights: 8,
  maximumNights: 16,
  travelerCount: 2,
  cabinPreference: "economy",
  optimizationPriority: "balanced",
  maximumCashBudget: 2_000,
  currency: "USD",
  allowNewCards: false,
  createdAt: "2026-08-25T10:00:00.000Z",
  updatedAt: "2026-08-26T10:00:00.000Z",
};

describe("GoalCard stale strategy handling", () => {
  it("warns about and withholds a strategy generated before the latest edit", async () => {
    const { GoalCard } = await import("../../components/goal-card");
    const staleStrategy = {
      headline: "STALE STRATEGY MUST NOT RENDER",
    } as PersonalizedStrategy;

    const html = renderToStaticMarkup(
      React.createElement(
        AppRouterContext.Provider,
        { value: router },
        React.createElement(GoalCard, {
          goal,
          initialStrategy: staleStrategy,
          strategyGeneratedAt: "2026-08-26T09:59:59.999Z",
        })
      )
    );

    assert.match(html, /This goal changed after its saved strategy was generated/);
    assert.doesNotMatch(html, /STALE STRATEGY MUST NOT RENDER/);
    assert.match(html, /Build my strategy/);
    assert.match(html, /role="group"/);
    assert.match(html, /aria-label="Actions for Edited Europe trip"/);
    assert.match(html, /aria-label="Permanently delete Edited Europe trip"/);
    assert.match(html, /aria-expanded="false"/);
  });
});
