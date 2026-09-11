import assert from "node:assert/strict";
import { test } from "node:test";
import {
  RETAINED_RESEARCH_HEADING,
  buildStrategyFailureMessage,
  buildStrategyPreviewPresentation,
  buildStrategyProgressPresentation,
  createInitialStrategyPanelRunState,
  isStrategyRetryAvailable,
  transitionStrategyPanelRun,
  type StrategyPanelRunEvent,
  type StrategyPanelRunState,
} from "./strategyPanelLifecycle";
import type { PersonalizedStrategy, StrategyAwardOption } from "./strategyTypes";

const flightOption: StrategyAwardOption = {
  id: "flight-option-1",
  sourceId: "source-1",
  programName: "Test flight program",
  redemptionType: "flight",
  pricingBasis: "one_way",
  itineraryLabel: null,
  pointsRequired: 25000,
  cashFees: null,
  seats: null,
  cabin: null,
  transferFromProgramId: null,
  transferRatio: null,
  centsPerPoint: null,
  availabilityStatus: "unknown",
};

const hotelOption: StrategyAwardOption = {
  ...flightOption,
  id: "hotel-option-1",
  programName: "Test hotel program",
  redemptionType: "hotel",
  pricingBasis: "per_night",
};

const strategy: PersonalizedStrategy = {
  headline: "Test strategy",
  summary: "Test summary",
  feasibility: "on_track",
  pointsGap: null,
  recommendedAwardOptionId: null,
  recommendedCardOfferId: null,
  flightOptions: [],
  hotelOptions: [],
  actions: [],
  alternatives: [],
  assumptions: [],
  warnings: [],
  followUpQuestions: [],
  pointsInventory: [],
  allocationScenarios: [],
};

const GENERATED_AT = "2027-01-02T03:04:05.000Z";
const RUN_ID = "run-1";

function start(): StrategyPanelRunState {
  return transitionStrategyPanelRun(createInitialStrategyPanelRunState(), { type: "run_started" }).state;
}

function flightSucceeded(from: StrategyPanelRunState = start()): StrategyPanelRunState {
  return transitionStrategyPanelRun(from, {
    type: "flight_stage_completed",
    runId: RUN_ID,
    stageStatus: "succeeded",
    options: [flightOption],
  }).state;
}

function flightDegraded(from: StrategyPanelRunState = start()): StrategyPanelRunState {
  return transitionStrategyPanelRun(from, {
    type: "flight_stage_completed",
    runId: RUN_ID,
    stageStatus: "failed",
    options: [],
  }).state;
}

function hotelSucceeded(from: StrategyPanelRunState = flightSucceeded()): StrategyPanelRunState {
  return transitionStrategyPanelRun(from, {
    type: "hotel_stage_completed",
    stageStatus: "succeeded",
    options: [hotelOption],
  }).state;
}

function hotelDegraded(from: StrategyPanelRunState = flightSucceeded()): StrategyPanelRunState {
  return transitionStrategyPanelRun(from, {
    type: "hotel_stage_completed",
    stageStatus: "failed",
    options: [],
  }).state;
}

function retryableFinalFailure(from: StrategyPanelRunState = hotelSucceeded()): StrategyPanelRunState {
  return transitionStrategyPanelRun(from, { type: "finalization_failed", retryable: true }).state;
}

test("active progress is visible only while the attempt is executing", () => {
  const initial = createInitialStrategyPanelRunState();
  assert.equal(buildStrategyProgressPresentation(initial, false), null);
  assert.equal(buildStrategyProgressPresentation(initial, true), null);

  const started = start();
  assert.equal(buildStrategyProgressPresentation(started, false)?.heading, "Building your plan");
  assert.equal(buildStrategyProgressPresentation(started, true)?.heading, "Refreshing your plan");
  assert.equal(buildStrategyProgressPresentation(started, false)?.stageLabel, "Updating flight research");

  const hotelStage = flightSucceeded();
  assert.equal(buildStrategyProgressPresentation(hotelStage, false)?.stageLabel, "Updating hotel research");
  const degradedHotelStage = flightDegraded();
  assert.equal(buildStrategyProgressPresentation(degradedHotelStage, false)?.stageLabel, "Updating hotel research");
});

test("failure notices use the fixed allowlisted customer-safe wording", () => {
  assert.equal(
    buildStrategyFailureMessage("flight_action_failed", true),
    "We couldn’t update the flight research. Your saved plan is unchanged.",
  );
  assert.equal(
    buildStrategyFailureMessage("flight_action_failed", false),
    "We couldn’t complete the flight research. Try building the plan again.",
  );
  assert.equal(
    buildStrategyFailureMessage("hotel_action_failed", true),
    "We couldn’t update the hotel research. Your saved plan is unchanged.",
  );
  assert.equal(
    buildStrategyFailureMessage("hotel_action_failed", false),
    "We couldn’t complete the hotel research. Try building the plan again.",
  );
  assert.equal(
    buildStrategyFailureMessage("final_retryable", false),
    "The research finished, but we couldn’t finish your plan. Try finishing again—flight and hotel research will not be repeated.",
  );
  assert.equal(
    buildStrategyFailureMessage("final_retryable", true),
    "The research finished, but we couldn’t finish the updated plan. Try finishing again—flight and hotel research will not be repeated.",
  );
  assert.equal(
    buildStrategyFailureMessage("final_non_retryable", true),
    "This refresh can’t be continued. Your saved plan is unchanged.",
  );
  assert.equal(
    buildStrategyFailureMessage("final_non_retryable", false),
    "This plan couldn’t be completed. Build it again when you’re ready.",
  );
});

test("first-build and saved-refresh final copy differ correctly", () => {
  const finalStage = hotelSucceeded();
  assert.equal(buildStrategyProgressPresentation(finalStage, false)?.stageLabel, "Finishing your plan");
  assert.equal(buildStrategyProgressPresentation(finalStage, true)?.stageLabel, "Finishing your updated plan");
  const degradedFinalStage = hotelDegraded();
  assert.equal(buildStrategyProgressPresentation(degradedFinalStage, false)?.stageLabel, "Finishing your plan");
  assert.equal(buildStrategyProgressPresentation(degradedFinalStage, true)?.stageLabel, "Finishing your updated plan");
  assert.notEqual(
    buildStrategyFailureMessage("final_retryable", false),
    buildStrategyFailureMessage("final_retryable", true),
  );
});

test("an isolated degraded flight stage continues to hotel research without a failure notice", () => {
  const result = transitionStrategyPanelRun(start(), {
    type: "flight_stage_completed",
    runId: RUN_ID,
    stageStatus: "failed",
    options: [],
  });
  assert.equal(result.state.stage, "hotel");
  assert.equal(result.state.flightStageStatus, "failed");
  assert.deepEqual(result.state.flightOptions, []);
  assert.equal(result.state.runId, RUN_ID);
  assert.equal(result.state.failure, null);
  assert.equal(result.strategyUpdate, null);
  assert.equal(buildStrategyProgressPresentation(result.state, false)?.stageLabel, "Updating hotel research");
});

test("an isolated degraded hotel stage continues to finalization", () => {
  const result = transitionStrategyPanelRun(flightSucceeded(), {
    type: "hotel_stage_completed",
    stageStatus: "failed",
    options: [],
  });
  assert.equal(result.state.stage, "final");
  assert.equal(result.state.hotelStageStatus, "failed");
  assert.deepEqual(result.state.hotelOptions, []);
  assert.deepEqual(result.state.flightOptions, [flightOption]);
  assert.equal(result.state.runId, RUN_ID);
  assert.equal(result.state.failure, null);
  assert.equal(result.strategyUpdate, null);
});

test("both degraded stages still reach finalization with the run retained", () => {
  const state = hotelDegraded(flightDegraded());
  assert.equal(state.stage, "final");
  assert.equal(state.flightStageStatus, "failed");
  assert.equal(state.hotelStageStatus, "failed");
  assert.deepEqual(state.flightOptions, []);
  assert.deepEqual(state.hotelOptions, []);
  assert.equal(state.runId, RUN_ID);
  assert.equal(state.failure, null);
});

test("successful sibling options survive the other lane’s degradation", () => {
  const hotelDegradedLane = hotelDegraded();
  assert.deepEqual(hotelDegradedLane.flightOptions, [flightOption]);
  assert.deepEqual(hotelDegradedLane.hotelOptions, []);

  const flightDegradedLane = hotelSucceeded(flightDegraded());
  assert.deepEqual(flightDegradedLane.flightOptions, []);
  assert.deepEqual(flightDegradedLane.hotelOptions, [hotelOption]);
});

test("a deadline's terminal degraded shape clears active stage progress and retains the prior saved strategy", () => {
  const priorSavedStrategy = strategy;
  const afterFlightDeadline = flightDegraded();
  assert.equal(afterFlightDeadline.stage, "hotel");
  const afterHotel = hotelSucceeded(afterFlightDeadline);
  assert.equal(afterHotel.stage, "final");
  const completed = transitionStrategyPanelRun(afterHotel, {
    type: "finalization_succeeded",
    strategy: priorSavedStrategy,
    generatedAt: GENERATED_AT,
  });
  assert.equal(completed.state.isGenerating, false);
  assert.equal(buildStrategyProgressPresentation(completed.state, true), null);
  assert.deepEqual(completed.strategyUpdate, { strategy: priorSavedStrategy, generatedAt: GENERATED_AT });
});

test("an action-level flight failure stops the workflow and clears the run", () => {
  const result = transitionStrategyPanelRun(start(), { type: "flight_action_failed" });
  const state = result.state;
  assert.equal(state.isGenerating, false);
  assert.equal(state.stage, "idle");
  assert.equal(state.failure, "flight_action_failed");
  assert.equal(state.runId, null);
  assert.deepEqual(state.flightOptions, []);
  assert.equal(isStrategyRetryAvailable(state), false);
  assert.equal(result.strategyUpdate, null);
  assert.equal(buildStrategyProgressPresentation(state, false), null);
  assert.equal(buildStrategyProgressPresentation(state, true), null);
});

test("an action-level hotel failure stops the workflow without finalization retry", () => {
  const result = transitionStrategyPanelRun(flightSucceeded(), { type: "hotel_action_failed" });
  const state = result.state;
  assert.equal(state.isGenerating, false);
  assert.equal(state.stage, "idle");
  assert.equal(state.failure, "hotel_action_failed");
  assert.equal(state.runId, null);
  assert.deepEqual(state.flightOptions, []);
  assert.equal(isStrategyRetryAvailable(state), false);
  assert.equal(result.strategyUpdate, null);
  assert.equal(buildStrategyProgressPresentation(state, false), null);
  assert.deepEqual(buildStrategyPreviewPresentation(state, false), { mode: "hidden", heading: null });
});

test("a retryable finalization failure preserves the reusable run and enables finalization-only retry", () => {
  const result = transitionStrategyPanelRun(hotelSucceeded(), { type: "finalization_failed", retryable: true });
  assert.equal(result.state.isGenerating, false);
  assert.equal(result.state.stage, "idle");
  assert.equal(result.state.failure, "final_retryable");
  assert.equal(result.state.runId, RUN_ID);
  assert.deepEqual(result.state.flightOptions, [flightOption]);
  assert.deepEqual(result.state.hotelOptions, [hotelOption]);
  assert.equal(result.strategyUpdate, null);
  assert.equal(isStrategyRetryAvailable(result.state), true);
  assert.deepEqual(buildStrategyPreviewPresentation(result.state, false), {
    mode: "retained",
    heading: RETAINED_RESEARCH_HEADING,
  });
  assert.equal(buildStrategyPreviewPresentation(result.state, true).mode, "hidden");
});

test("retryable finalization after one degraded stage retains the run and successful sibling previews", () => {
  const state = hotelSucceeded(flightDegraded());
  const failed = transitionStrategyPanelRun(state, { type: "finalization_failed", retryable: true });
  assert.equal(failed.state.runId, RUN_ID);
  assert.equal(failed.state.failure, "final_retryable");
  assert.deepEqual(failed.state.hotelOptions, [hotelOption]);
  assert.deepEqual(failed.state.flightOptions, []);
  assert.equal(isStrategyRetryAvailable(failed.state), true);
  assert.deepEqual(buildStrategyPreviewPresentation(failed.state, false), {
    mode: "retained",
    heading: RETAINED_RESEARCH_HEADING,
  });
});

test("a non-retryable finalization failure clears the run, retry eligibility, and retained previews", () => {
  const result = transitionStrategyPanelRun(hotelSucceeded(), { type: "finalization_failed", retryable: false });
  assert.equal(result.state.isGenerating, false);
  assert.equal(result.state.stage, "idle");
  assert.equal(result.state.failure, "final_non_retryable");
  assert.equal(result.state.runId, null);
  assert.deepEqual(result.state.flightOptions, []);
  assert.deepEqual(result.state.hotelOptions, []);
  assert.equal(result.strategyUpdate, null);
  assert.equal(isStrategyRetryAvailable(result.state), false);
  assert.deepEqual(buildStrategyPreviewPresentation(result.state, false), { mode: "hidden", heading: null });
});

test("retry starts only from a retained reusable run and clears stale error state", () => {
  const initial = createInitialStrategyPanelRunState();
  assert.equal(transitionStrategyPanelRun(initial, { type: "retry_started" }).state, initial);

  const failed = retryableFinalFailure();
  const retrying = transitionStrategyPanelRun(failed, { type: "retry_started" });
  assert.equal(retrying.state.isGenerating, true);
  assert.equal(retrying.state.isFinalizationRetry, true);
  assert.equal(retrying.state.stage, "final");
  assert.equal(retrying.state.failure, null);
  assert.equal(retrying.state.runId, RUN_ID);
  // Retry is temporarily unavailable while the attempt executes.
  assert.equal(isStrategyRetryAvailable(retrying.state), false);

  // A new run cannot start while an attempt is executing.
  assert.equal(transitionStrategyPanelRun(retrying.state, { type: "run_started" }).state, retrying.state);
});

test("a successful finalization-only retry clears the run and updates the plan", () => {
  const retrying = transitionStrategyPanelRun(retryableFinalFailure(), { type: "retry_started" }).state;
  const done = transitionStrategyPanelRun(retrying, {
    type: "finalization_succeeded",
    strategy,
    generatedAt: GENERATED_AT,
  });
  assert.deepEqual(done.state, {
    isGenerating: false,
    isFinalizationRetry: false,
    stage: "idle",
    flightStageStatus: null,
    hotelStageStatus: null,
    flightOptions: [],
    hotelOptions: [],
    runId: null,
    failure: null,
  });
  assert.deepEqual(done.strategyUpdate, { strategy, generatedAt: GENERATED_AT });
  assert.equal(isStrategyRetryAvailable(done.state), false);
  // After the plan update the panel has a saved strategy: no temporary previews.
  assert.deepEqual(buildStrategyPreviewPresentation(done.state, true), { mode: "hidden", heading: null });
});

test("a retried finalization failure restores retry only when the result explicitly allows it", () => {
  const retrying = transitionStrategyPanelRun(retryableFinalFailure(), { type: "retry_started" }).state;

  const retryableAgain = transitionStrategyPanelRun(retrying, { type: "finalization_failed", retryable: true });
  assert.equal(retryableAgain.state.runId, RUN_ID);
  assert.equal(retryableAgain.state.failure, "final_retryable");
  assert.equal(isStrategyRetryAvailable(retryableAgain.state), true);

  const nonRetryable = transitionStrategyPanelRun(retrying, { type: "finalization_failed", retryable: false });
  assert.equal(nonRetryable.state.runId, null);
  assert.equal(nonRetryable.state.failure, "final_non_retryable");
  assert.equal(isStrategyRetryAvailable(nonRetryable.state), false);
});

test("a finalization transport exception uses the conservative reusable-run safe state", () => {
  const result = transitionStrategyPanelRun(hotelSucceeded(), { type: "finalization_transport_exception" });
  assert.equal(result.state.isGenerating, false);
  assert.equal(result.state.stage, "idle");
  assert.equal(result.state.failure, "final_retryable");
  assert.equal(result.state.runId, RUN_ID);
  assert.equal(result.strategyUpdate, null);
  assert.equal(isStrategyRetryAvailable(result.state), true);
  // A transport exception with no client run reference cannot claim reusability.
  // (Defensive: valid transitions always set runId when the flight stage completes.)
  const withoutRun: StrategyPanelRunState = { ...hotelSucceeded(), runId: null };
  const noRunResult = transitionStrategyPanelRun(withoutRun, { type: "finalization_transport_exception" });
  assert.equal(noRunResult.state.failure, "final_non_retryable");
  assert.equal(noRunResult.state.runId, null);
});

test("finalization retry never creates a flight or hotel stage or action transition", () => {
  const retrying = transitionStrategyPanelRun(retryableFinalFailure(), { type: "retry_started" }).state;
  const ignoredFlightStage = transitionStrategyPanelRun(retrying, {
    type: "flight_stage_completed",
    runId: "run-2",
    stageStatus: "succeeded",
    options: [flightOption],
  });
  assert.equal(ignoredFlightStage.state, retrying);
  const ignoredHotelStage = transitionStrategyPanelRun(retrying, {
    type: "hotel_stage_completed",
    stageStatus: "succeeded",
    options: [hotelOption],
  });
  assert.equal(ignoredHotelStage.state, retrying);
  assert.equal(transitionStrategyPanelRun(retrying, { type: "flight_action_failed" }).state, retrying);
  assert.equal(transitionStrategyPanelRun(retrying, { type: "hotel_action_failed" }).state, retrying);
  // A successful retry clears the run without any stage transition.
  const done = transitionStrategyPanelRun(retrying, {
    type: "finalization_succeeded",
    strategy,
    generatedAt: GENERATED_AT,
  });
  assert.equal(done.state.stage, "idle");
  assert.equal(done.state.runId, null);
  assert.deepEqual(done.strategyUpdate, { strategy, generatedAt: GENERATED_AT });
});

test("completed first-build previews stay active during the run and retained only while the reusable run remains", () => {
  const started = start();
  assert.deepEqual(buildStrategyPreviewPresentation(started, false), { mode: "active", heading: null });
  const afterFlight = flightSucceeded();
  assert.deepEqual(buildStrategyPreviewPresentation(afterFlight, false), { mode: "active", heading: null });
  const afterHotel = hotelSucceeded();
  assert.deepEqual(buildStrategyPreviewPresentation(afterHotel, false), { mode: "active", heading: null });
  // A degraded sibling lane does not remove the successful lane's active preview.
  assert.deepEqual(buildStrategyPreviewPresentation(hotelDegraded(), false), { mode: "active", heading: null });

  // While the finalization-only retry executes, previews are retained, not active work.
  const retrying = transitionStrategyPanelRun(retryableFinalFailure(), { type: "retry_started" }).state;
  assert.deepEqual(buildStrategyPreviewPresentation(retrying, false), {
    mode: "retained",
    heading: RETAINED_RESEARCH_HEADING,
  });

  // An action failure leaves the run unusable: no retained previews.
  const actionFailed = transitionStrategyPanelRun(afterFlight, { type: "hotel_action_failed" }).state;
  assert.deepEqual(buildStrategyPreviewPresentation(actionFailed, false), { mode: "hidden", heading: null });
  const flightActionFailed = transitionStrategyPanelRun(start(), { type: "flight_action_failed" }).state;
  assert.deepEqual(buildStrategyPreviewPresentation(flightActionFailed, false), { mode: "hidden", heading: null });
});

test("a saved-strategy refresh never displays temporary previews", () => {
  const states: StrategyPanelRunState[] = [
    createInitialStrategyPanelRunState(),
    start(),
    flightSucceeded(),
    hotelSucceeded(),
    flightDegraded(),
    hotelDegraded(),
    hotelDegraded(flightDegraded()),
    retryableFinalFailure(),
    transitionStrategyPanelRun(hotelSucceeded(), { type: "finalization_failed", retryable: false }).state,
    transitionStrategyPanelRun(retryableFinalFailure(), { type: "retry_started" }).state,
    transitionStrategyPanelRun(hotelSucceeded(), {
      type: "finalization_succeeded",
      strategy,
      generatedAt: GENERATED_AT,
    }).state,
  ];
  for (const state of states) {
    assert.deepEqual(buildStrategyPreviewPresentation(state, true), { mode: "hidden", heading: null });
  }
});

test("active progress disappears after every terminal result", () => {
  const terminalStates: StrategyPanelRunState[] = [
    transitionStrategyPanelRun(start(), { type: "flight_action_failed" }).state,
    transitionStrategyPanelRun(flightSucceeded(), { type: "hotel_action_failed" }).state,
    retryableFinalFailure(),
    transitionStrategyPanelRun(hotelSucceeded(), { type: "finalization_failed", retryable: false }).state,
    transitionStrategyPanelRun(hotelSucceeded(), { type: "finalization_transport_exception" }).state,
    transitionStrategyPanelRun(hotelSucceeded(), {
      type: "finalization_succeeded",
      strategy,
      generatedAt: GENERATED_AT,
    }).state,
  ];
  for (const state of terminalStates) {
    assert.equal(state.isGenerating, false);
    assert.equal(state.stage, "idle");
    assert.equal(buildStrategyProgressPresentation(state, false), null);
    assert.equal(buildStrategyProgressPresentation(state, true), null);
  }
});

test("no failure transition produces a strategy or timestamp update", () => {
  const cases: Array<{ from: StrategyPanelRunState; event: StrategyPanelRunEvent }> = [
    { from: start(), event: { type: "flight_action_failed" } },
    { from: flightSucceeded(), event: { type: "hotel_action_failed" } },
    { from: hotelSucceeded(), event: { type: "finalization_failed", retryable: true } },
    { from: hotelSucceeded(), event: { type: "finalization_failed", retryable: false } },
    { from: hotelSucceeded(), event: { type: "finalization_transport_exception" } },
  ];
  for (const { from, event } of cases) {
    const result = transitionStrategyPanelRun(from, event);
    assert.equal(result.strategyUpdate, null);
    // The run state itself never carries strategy or timestamp data; the
    // saved strategy and timestamp can only change through a successful
    // finalization outcome.
    assert.deepEqual(Object.keys(result.state).sort(), [
      "failure",
      "flightOptions",
      "flightStageStatus",
      "hotelOptions",
      "hotelStageStatus",
      "isFinalizationRetry",
      "isGenerating",
      "runId",
      "stage",
    ]);
  }
});

// Render the real panel with inert action imports. No server initialization,
// authentication, network, or provider work is needed for these UI checks.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createElement, useState, type ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { transpileModule, ModuleKind, JsxEmit, ScriptTarget } from "typescript";
import type { Goal } from "./types";
import { buildCustomerSafeStrategyPresentation, type CustomerSafeStrategyPresentation } from "./customerSafeStrategyPresentation";
import {
  HOTEL_PLANNING_ESTIMATE_AVAILABILITY_LABEL,
  HOTEL_PLANNING_ESTIMATE_EVIDENCE_LABEL,
  HOTEL_PLANNING_ESTIMATE_LABEL,
  HOTEL_PLANNING_ESTIMATE_VERIFICATION_LABEL,
  type HotelPlanningEstimate,
} from "./hotelPlanningEstimate";

const panelSource = readFileSync(new URL("../../components/goal-strategy-panel.tsx", import.meta.url), "utf8");
const localRequire = createRequire(import.meta.url);
const uiGoal: Goal = {
  id: "goal-private", userId: "user-private", type: "travel", title: "Copenhagen trip", status: "active",
  origin: ["DEN"], destinations: ["Copenhagen"], earliestDeparture: "2027-04-03", latestReturn: "2027-04-11",
  minimumNights: 8, maximumNights: 8, travelerCount: 2, cabinPreference: "economy",
  optimizationPriority: "balanced", maximumCashBudget: 4000, currency: "USD", allowNewCards: false,
  createdAt: GENERATED_AT, updatedAt: GENERATED_AT,
};
const hotelEstimate: HotelPlanningEstimate = {
  schemaVersion: 1, label: HOTEL_PLANNING_ESTIMATE_LABEL, destination: "Copenhagen",
  checkInDate: "2027-04-03", checkOutDate: "2027-04-11", nights: 8, travelers: 2, currency: "USD",
  options: [{ id: "option-private", propertyName: "Example Grand Hotel", locationText: "Copenhagen",
    nightlyPrice: 120, nightlyPriceCurrency: "USD", totalPrice: 960, totalPriceCurrency: "USD",
    rating: 4.5, reviewCount: 812, hotelClass: 4, neighborhood: "Vesterbro", amenities: ["Free Wi-Fi"],
    propertyUrl: "https://example.com/property", imageUrl: "https://example.com/image.jpg", trustStatus: "search_estimate" }],
  disclosure: HOTEL_PLANNING_ESTIMATE_AVAILABILITY_LABEL, evidenceLabel: HOTEL_PLANNING_ESTIMATE_EVIDENCE_LABEL,
  verificationLabel: HOTEL_PLANNING_ESTIMATE_VERIFICATION_LABEL, availabilityLabel: HOTEL_PLANNING_ESTIMATE_AVAILABILITY_LABEL,
};
const uiStrategy: PersonalizedStrategy = { ...strategy, hotelPlanningEstimate: hotelEstimate,
  warnings: ["Taxes and fees need confirmation."], assumptions: ["Room coverage needs confirmation."] };

function panelModule(runOverride?: StrategyPanelRunState) {
  let stateIndex = 0;
  const compiled = transpileModule(`${panelSource}\nexport { PlanResults };`, {
    compilerOptions: { target: ScriptTarget.ES2020, module: ModuleKind.CommonJS, jsx: JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
  const uiModule = { exports: {} as {
    PlanResults: ComponentType<{ presentation: CustomerSafeStrategyPresentation; isPrevious: boolean }>;
    GoalStrategyPanel: ComponentType<{ goalId: string; goal: Goal; initialStrategy: PersonalizedStrategy | null; initialGeneratedAt: string }>;
  } };
  const requireUi = (name: string): unknown => {
    if (name === "@/lib/goals/strategyActions") return new Proxy({}, { get: () => () => { throw new Error("UI render must not call actions"); } });
    if (name === "react") return { ...localRequire("react"), useState: (initial: unknown) => {
      const index = stateIndex++;
      return useState(index === 2 && runOverride ? runOverride : initial);
    } };
    return localRequire(name.startsWith("@/lib/goals/") ? `./${name.slice("@/lib/goals/".length)}` : name);
  };
  new Function("require", "module", "exports", compiled)(requireUi, uiModule, uiModule.exports);
  return uiModule.exports;
}

function renderPanel(run = createInitialStrategyPanelRunState(), savedStrategy: PersonalizedStrategy | null = uiStrategy) {
  const { GoalStrategyPanel } = panelModule(run);
  return renderToStaticMarkup(createElement(GoalStrategyPanel, {
    goalId: uiGoal.id, goal: uiGoal, initialStrategy: savedStrategy, initialGeneratedAt: GENERATED_AT,
  }));
}
function renderResults(presentation = buildCustomerSafeStrategyPresentation(uiGoal, uiStrategy, GENERATED_AT)) {
  return renderToStaticMarkup(createElement(panelModule().PlanResults, { presentation, isPrevious: false }));
}

test("completed results prioritize trip context, overview, flight, hotels, rewards, and disclosures", () => {
  const html = renderPanel();
  const labels = ["Copenhagen trip", "Plan overview", 'aria-label="Flight result"', 'aria-label="Hotel results"', 'aria-label="Rewards strategy and alternatives"', 'aria-label="Important details"', "Delete strategy"];
  for (let i = 1; i < labels.length; i++) assert.ok(html.indexOf(labels[i - 1]) < html.indexOf(labels[i]), labels[i]);
  for (const label of ["DEN", "Apr 3, 2027", "2 travelers", "Economy", "4,000", "Partial results saved.", "Next step: verify before booking"]) assert.ok(html.includes(label), label);
  assert.doesNotMatch(html, /Working…|View \d+ planning paths|Trip total/);
});

test("hotel cards render customer-safe estimates with distinct whole-stay and nightly prices", () => {
  const html = renderResults();
  for (const text of ["Example Grand Hotel", "Whole-stay total", "USD 960 total stay", "Nightly price", "USD 120 per night", "4.5 (812 reviews)", "4-star", "Free Wi-Fi", "Vesterbro", "8 nights", "Not customer-verified", "Search estimate only; verify current price and availability"]) assert.ok(html.includes(text), text);
  assert.match(html, /alt="Property photo of Example Grand Hotel"/);
  assert.match(html, /href="https:\/\/example.com\/property"/);
  assert.match(html, /rel="noopener noreferrer"/);
  assert.match(html, /referrerPolicy="no-referrer"/);
});

test("missing nightly and whole-stay amounts stay independent and never become zero or calculated totals", () => {
  for (const missing of ["nightly", "total", "both"] as const) {
    const option = { ...hotelEstimate.options[0], imageUrl: null, propertyUrl: null,
      ...(missing !== "total" ? { nightlyPrice: null, nightlyPriceCurrency: null } : {}),
      ...(missing !== "nightly" ? { totalPrice: null, totalPriceCurrency: null } : {}),
    };
    const view = buildCustomerSafeStrategyPresentation(uiGoal, { ...uiStrategy, hotelPlanningEstimate: { ...hotelEstimate, options: [option] } });
    const html = renderResults(view);
    if (missing !== "total") assert.match(html, /Nightly price not confirmed/);
    if (missing !== "nightly") assert.match(html, /Whole-stay total not confirmed/);
    if (missing === "nightly") assert.match(html, /USD 960 total stay/);
    if (missing === "total") assert.match(html, /USD 120 per night/);
    assert.doesNotMatch(html, /USD 0|\$0|src=|href=/);
    assert.match(html, /Photo unavailable/);
    assert.match(html, /Property link unavailable/);
  }
  // Static SSR cannot dispatch an image error; this checks wiring only.
  assert.match(panelSource, /onError=\{\(\) => setFailedUrl\(option.imageUrl\)\}/);
});

test("flight card uses supplied searched-party total and itinerary without multiplying travelers", () => {
  const view = buildCustomerSafeStrategyPresentation(uiGoal, uiStrategy);
  view.flightPlanningEstimate = {
    label: "Flight planning estimate", route: "DEN → CPH", dates: "2027-04-03 – 2027-04-11",
    travelersLabel: "2 travelers · searched-party total", cabin: "Economy", priceLabel: "USD 1,736 total",
    retrievedAt: GENERATED_AT, segments: ["DEN 2027-04-03T08:00 → CPH 2027-04-04T08:00"],
    unknowns: ["operating_carrier"], evidenceLabel: "Planning estimate", verificationLabel: "Not customer-verified",
    availabilityLabel: "Not live or bookable; verify before booking",
  };
  const html = renderResults(view);
  for (const text of ["DEN → CPH", "USD 1,736 total", "2 travelers · searched-party total", "Total searched-party price", "Not live or bookable; verify before booking"]) assert.ok(html.includes(text), text);
  assert.doesNotMatch(html, /3,472|868|per person/);
});

test("active UI has one progress area and marks existing results as previous until replacement succeeds", () => {
  for (const [run, currentLabel] of [[start(), "Searching flights"], [flightSucceeded(), "Searching hotels"], [hotelSucceeded(), "Building plan"], [transitionStrategyPanelRun(retryableFinalFailure(), { type: "retry_started" }).state, "Building plan"]] as const) {
    const html = renderPanel(run);
    assert.equal((html.match(/role="status"/g) ?? []).length, 1);
    assert.match(html, new RegExp(`aria-current="step"[^>]*><span[^>]*>${currentLabel}`));
    assert.match(html, /Previous plan/);
    assert.match(html, /until an updated plan is saved successfully/);
    assert.doesNotMatch(html, /Ready · Saved planning results|Working…/);
    assert.match(html, /disabled=""/);
  }
  assert.match(renderPanel(hotelDegraded(flightDegraded())), /No usable estimates/);
  assert.doesNotMatch(renderPanel(), /Previous plan|aria-current="step"/);
});

test("failed refresh keeps prior results and finalization-only retry control; terminal states clear progress", () => {
  const html = renderPanel(retryableFinalFailure());
  assert.match(html, /Previous plan/);
  assert.match(html, /Try finishing again/);
  assert.match(html, /Example Grand Hotel/);
  assert.doesNotMatch(html, /aria-current="step"|Ready · Saved planning results/);
  const nonRetryable = transitionStrategyPanelRun(hotelSucceeded(), { type: "finalization_failed", retryable: false }).state;
  assert.doesNotMatch(renderPanel(nonRetryable), /Try finishing again|aria-current="step"/);
  const retryBody = panelSource.slice(panelSource.indexOf("async function handleRetry"), panelSource.indexOf("async function handleDelete"));
  assert.match(retryBody, /finalizeGoalStrategyRunAction\(goalId, retainedRunId\)/);
  assert.doesNotMatch(retryBody, /generateGoalFlightStageAction|generateGoalHotelStageAction/);
});

test("deletion source retains confirmation, guards, and failure-preservation statements (not an interaction test)", () => {
  const body = panelSource.slice(panelSource.indexOf("async function handleDelete"), panelSource.indexOf('return <div className="mt-6 min-w-0'));
  assert.match(body, /if \(!strategy \|\| runState.isGenerating \|\| isDeleting\) return/);
  assert.match(body, /window.confirm/);
  assert.match(body, /if \(!confirmed\) return/);
  assert.match(body, /deleteGoalStrategyAction\(goalId\)/);
  assert.ok(body.indexOf("if (!result.success)") < body.indexOf("setStrategy(null)"));
  assert.match(body, /Your saved plan is unchanged/);
  assert.match(body, /setGeneratedAt\(null\)/);
  assert.match(body, /setRunState\(createInitialStrategyPanelRunState\(\)\)/);
  assert.doesNotMatch(body, /\.rpc\(|\.from\(/);
  assert.match(panelSource, /focus-visible:outline-sky-300/);
});

test("rendered disclosures preserve financial warnings and exclude unsafe raw fields and provider names", () => {
  const hostile = { ...uiStrategy, provider: "SerpAPI", rawResponse: "Tavily", signature: "private-signature", sourceId: "private-source", departureToken: "private-token" };
  const html = renderResults(buildCustomerSafeStrategyPresentation(uiGoal, hostile, GENERATED_AT));
  for (const text of ["Important details", "Taxes and fees need confirmation.", "Room coverage needs confirmation.", "not a booking recommendation", "Planning estimates may not match every constraint", HOTEL_PLANNING_ESTIMATE_AVAILABILITY_LABEL, "Last researched"]) assert.ok(html.includes(text), text);
  assert.equal(html.split(HOTEL_PLANNING_ESTIMATE_AVAILABILITY_LABEL).length - 1, 1);
  assert.doesNotMatch(html, /SerpAPI|Tavily|provider|rawResponse|signature|private-source|private-token|user-private|goal-private|option-private/i);
  assert.doesNotMatch(panelSource, /(?<!\.)\bstrategy\.(?:hotelPlanningEstimate|flightPlanningEstimate|headline|summary|warnings)|dangerouslySetInnerHTML/);
});


function scopedQuotes(): CustomerSafeStrategyPresentation["currentCash"] {
  return [
    { key: "quote-flight", kind: "flight", sourceLabel: "Flight quote", evidenceLabel: "Exact cash quote",
      priceLabel: "EUR 450 per person", coverageLabel: "1 traveler · one way", datesLabel: "Apr 3, 2027",
      taxesLabel: "Taxes included", cancellationLabel: null, baggageLabel: null, unknownCount: 0 },
    { key: "quote-hotel", kind: "hotel", sourceLabel: "Hotel quote", evidenceLabel: "Exact cash quote",
      priceLabel: "DKK 1,200 per night", coverageLabel: "2 travelers · 1 night · 1 room", datesLabel: "Apr 3, 2027 – Apr 4, 2027",
      taxesLabel: null, cancellationLabel: "Check cancellation terms", baggageLabel: null, unknownCount: 1 },
  ];
}

function overviewHtml(view: CustomerSafeStrategyPresentation) {
  return renderResults(view).split('aria-label="Plan overview"')[1].split('</section>')[0];
}

function withFlightEstimate(view: CustomerSafeStrategyPresentation): CustomerSafeStrategyPresentation {
  return { ...view, flightPlanningEstimate: {
    label: "Flight planning estimate", route: "DEN → CPH", dates: "2027-04-03 – 2027-04-11",
    travelersLabel: "2 travelers · searched-party total", cabin: "Economy", priceLabel: "USD 1,736 total",
    retrievedAt: GENERATED_AT, segments: [], unknowns: [], evidenceLabel: "Planning estimate",
    verificationLabel: "Not customer-verified", availabilityLabel: "Not live or bookable; verify before booking",
  } };
}

test("exact cash quotes without planning estimates retain actual currency, coverage, dates, and price basis", () => {
  const view = buildCustomerSafeStrategyPresentation(uiGoal, strategy);
  view.currentCash = scopedQuotes();
  const html = renderResults(view);
  const overview = overviewHtml(view);
  for (const quote of view.currentCash) {
    for (const label of [quote.sourceLabel, quote.priceLabel, quote.coverageLabel, quote.datesLabel!, quote.evidenceLabel]) assert.ok(overview.includes(label), label);
  }
  assert.doesNotMatch(html, /Total not confirmed|Whole-stay total not confirmed|Price and itinerary are not confirmed|Nightly prices and whole-stay totals are not confirmed/);
  assert.doesNotMatch(overview, /total searched-party price|whole-stay estimates|EUR 900|DKK 9,600/);
});

test("planning estimates without exact quotes keep their party and stay scopes", () => {
  const view = withFlightEstimate(buildCustomerSafeStrategyPresentation(uiGoal, uiStrategy));
  const overview = overviewHtml(view);
  for (const label of ["USD 1,736 total", "2 travelers · searched-party total", "USD 960 total stay", "USD 120 per night"]) assert.ok(overview.includes(label), label);
  assert.doesNotMatch(overview, /Exact cash quote|per person/);
});

test("neither planning estimates nor exact quotes produces honest unknown prices", () => {
  const view = buildCustomerSafeStrategyPresentation(uiGoal, strategy);
  const html = renderResults(view);
  assert.match(html, /Total not confirmed/);
  assert.match(html, /Whole-stay total not confirmed/);
  assert.match(html, /Price and itinerary are not confirmed/);
  assert.doesNotMatch(html, /USD 0|Exact cash quote/);
});

test("both evidence lanes remain distinguished without choosing or combining quotes", () => {
  const view = withFlightEstimate(buildCustomerSafeStrategyPresentation(uiGoal, uiStrategy));
  view.currentCash = scopedQuotes();
  const html = renderResults(view);
  const overview = overviewHtml(view);
  assert.match(overview, /USD 1,736 total/);
  assert.match(overview, /USD 960 total stay/);
  for (const quote of view.currentCash) {
    for (const label of [quote.priceLabel, quote.coverageLabel, quote.datesLabel!, quote.evidenceLabel]) assert.ok(html.includes(label), label);
  }
  assert.match(html, /Planning estimate/);
  assert.doesNotMatch(html, /Selected hotel|Recommended hotel|Combined total|Trip total/);
});

test("polite status persists in rendered generation → completed, partial, and failed transitions", () => {
  const active = hotelSucceeded();
  // A valid hotel planning estimate plus customer-verified flight record represent
  // saved results in both lanes without claiming all details are confirmed.
  const both: PersonalizedStrategy = { ...uiStrategy, customerVerifiedOptions: [{
    id: "verified-flight", kind: "flight", evidenceLevel: "customer_verified", summary: "Flight details confirmed by customer.", confirmedAt: GENERATED_AT,
    unknownFields: [],
  }] };
  const completed = transitionStrategyPanelRun(active, { type: "finalization_succeeded", strategy: both, generatedAt: GENERATED_AT });
  const partial = transitionStrategyPanelRun(hotelSucceeded(flightDegraded()), { type: "finalization_succeeded", strategy: uiStrategy, generatedAt: GENERATED_AT });
  const failed = transitionStrategyPanelRun(active, { type: "finalization_failed", retryable: true });
  const outputs = [renderPanel(active), renderPanel(completed.state, both), renderPanel(partial.state), renderPanel(failed.state)];
  const statusTexts = outputs.map((html) => {
    assert.equal((html.match(/role="status"/g) ?? []).length, 1);
    assert.match(html, /role="status" aria-live="polite" aria-atomic="true"/);
    return html.split('role="status"')[1].split('</div>')[0];
  });
  assert.match(statusTexts[0], /Refreshing your plan/);
  assert.match(statusTexts[1], /Plan saved. Flight and hotel results are ready to review/);
  assert.match(statusTexts[2], /Partial results saved. Hotel results found; no flight search results saved/);
  assert.match(statusTexts[3], /Plan update failed. Your previous saved plan is unchanged/);
  for (const html of outputs.slice(1)) assert.doesNotMatch(html, /aria-current="step"|In progress/);
  assert.match(outputs[3], /Previous plan/);
  assert.match(renderPanel(completed.state, strategy), /Plan saved without flight or hotel search results/);
  const initial = renderPanel(createInitialStrategyPanelRunState(), null);
  assert.match(initial, /role="status" aria-live="polite" aria-atomic="true"/);
  assert.match(initial, /No saved plan yet/);
  assert.match(renderPanel(failed.state, null), /Plan generation failed. Review the recovery options below/);
  // These are rendered state transitions; static SSR does not verify actual
  // screen-reader announcements, DOM reconciliation, or event-driven focus.
});
