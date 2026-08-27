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
