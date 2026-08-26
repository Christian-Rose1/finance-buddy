import assert from "node:assert/strict";
import { test } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { InterpretedResearch } from "@/lib/goals/researchInterpreter";
import {
  buildStrategyRunStagePayload,
  validateStrategyRunStagePayload,
} from "@/lib/goals/strategyRunPayload";
import {
  createGoalStrategyRun,
  getGoalStrategyRun,
  loadVerifiedGoalStrategyRunStage,
  saveGoalStrategyRunStage,
  startGoalStrategyRunStage,
  updateGoalStrategyRunFinalStatus,
} from "@/lib/goals/strategyRunRepository";
import {
  getLatestStrategyForGoal,
  saveLatestStrategy,
} from "@/lib/goals/strategyRepository";
import type {
  PersonalizedStrategy,
  StrategyAwardOption,
} from "@/lib/goals/strategyTypes";

const SYNTHETIC_SIGNING_SECRET =
  "integration-tests-only-0123456789abcdef";
const GOAL_ID = "goal-integration-1";
const USER_ID = "user-integration-1";

type Row = Record<string, unknown>;
type Filter = { field: string; value: unknown };
type QueryResult = { data: unknown; error: unknown };
type QueryBuilder = {
  select(columns?: string): QueryBuilder;
  eq(field: string, value: unknown): QueryBuilder;
  insert(payload: Row): QueryBuilder;
  update(payload: Row): QueryBuilder;
  upsert(payload: Row, options?: Row): QueryBuilder;
  single(): QueryResult;
  maybeSingle(): QueryResult;
};

class StrategyFlowDatabase {
  readonly client = {
    from: (table: string) => this.from(table),
  } as unknown as SupabaseClient;

  private readonly runs = new Map<string, Row>();
  private readonly strategies = new Map<string, Row>();

  tamperSavedStrategy(goalId: string): void {
    const row = this.strategies.get(goalId);
    assert.ok(row);
    row.strategy_json = {
      ...(row.strategy_json as Row),
      headline: "Unsigned replacement",
    };
  }

  tamperRunStagePayload(
    runId: string,
    stage: "flight" | "hotel"
  ): void {
    const row = this.runs.get(runId);
    assert.ok(row);
    const key = `${stage}_payload`;
    row[key] = `${String(row[key])} `;
  }

  private matches(row: Row, filters: Filter[]): boolean {
    return filters.every(({ field, value }) => row[field] === value);
  }

  private from(table: string): QueryBuilder {
    assert.ok(
      table === "goal_strategy_runs" || table === "goal_strategies",
      `Unexpected table ${table}`
    );

    const filters: Filter[] = [];
    let operation: "select" | "insert" | "update" | "upsert" = "select";
    let mutation: Row | null = null;

    const findRow = (): Row | null => {
      const rows =
        table === "goal_strategy_runs"
          ? [...this.runs.values()]
          : [...this.strategies.values()];
      return rows.find((row) => this.matches(row, filters)) ?? null;
    };

    const finish = (requiresRow: boolean): QueryResult => {
      if (operation === "insert") {
        assert.equal(table, "goal_strategy_runs");
        assert.ok(mutation);
        const now = String(mutation.updated_at);
        const row: Row = {
          ...mutation,
          flight_payload: null,
          flight_signature: null,
          hotel_payload: null,
          hotel_signature: null,
          created_at: now,
        };
        this.runs.set(row.id as string, row);
        return { data: row, error: null };
      }

      if (operation === "upsert") {
        assert.equal(table, "goal_strategies");
        assert.ok(mutation);
        const goalId = mutation.goal_id as string;
        const previous = this.strategies.get(goalId);
        const row: Row = {
          ...previous,
          ...mutation,
          created_at:
            previous?.created_at ?? "2026-08-26T12:00:00.000Z",
        };
        this.strategies.set(goalId, row);
        return { data: row, error: null };
      }

      const row = findRow();
      if (!row) {
        return {
          data: null,
          error: requiresRow ? { message: "No matching row." } : null,
        };
      }

      if (operation === "update") {
        assert.ok(mutation);
        Object.assign(row, mutation);
      }
      return { data: row, error: null };
    };

    let builder: QueryBuilder;
    builder = {
      select() {
        return builder;
      },
      eq(field, value) {
        filters.push({ field, value });
        return builder;
      },
      insert(payload) {
        operation = "insert";
        mutation = payload;
        return builder;
      },
      update(payload) {
        operation = "update";
        mutation = payload;
        return builder;
      },
      upsert(payload) {
        operation = "upsert";
        mutation = payload;
        return builder;
      },
      single() {
        return finish(true);
      },
      maybeSingle() {
        return finish(false);
      },
    };
    return builder;
  }
}

function interpretedStage(
  stage: "flight" | "hotel"
): InterpretedResearch {
  const isFlight = stage === "flight";
  const sourceId = `${stage}-source`;
  const option: StrategyAwardOption = {
    id: `${stage}-option`,
    sourceId,
    programName: isFlight ? "Example Air" : "Example Hotel",
    redemptionType: stage,
    pricingBasis: isFlight ? "round_trip" : "per_night",
    itineraryLabel: isFlight ? "Denver to Paris" : "Paris hotel",
    pointsRequired: isFlight ? 70_000 : 25_000,
    cashFees: null,
    seats: isFlight ? 2 : null,
    cabin: isFlight ? "economy" : null,
    transferFromProgramId: null,
    transferRatio: null,
    centsPerPoint: null,
    availabilityStatus: "unknown",
    travelerCountCovered: isFlight ? 2 : null,
    nightCountCovered: isFlight ? null : 1,
    coverageStatus: isFlight ? "source_explicit" : "standard_assumption",
    goalMatch: "exact",
    goalMismatchReasons: [],
  };

  return {
    awardOptions: [option],
    cardOffers: [],
    sources: [
      {
        id: sourceId,
        label: `${stage} planning source`,
        status: "catalog",
        observedAt: "2026-08-26T12:00:00.000Z",
      },
    ],
    assumptions: ["Planning estimate; availability is not confirmed."],
    warnings: [],
  };
}

function finalStrategy(
  flight: StrategyAwardOption,
  hotel: StrategyAwardOption
): PersonalizedStrategy {
  return {
    headline: "A sourced Paris points plan",
    summary: "Use the verified account only after confirming live inventory.",
    feasibility: "gap_remaining",
    pointsGap: 190_000,
    recommendedAwardOptionId: flight.id,
    recommendedCardOfferId: null,
    flightOptions: [flight],
    hotelOptions: [hotel],
    actions: [],
    alternatives: [],
    assumptions: ["Eight hotel nights are used for planning."],
    warnings: ["Award availability has not been verified."],
    followUpQuestions: [],
    pointsInventory: [],
    allocationScenarios: [],
  };
}

test("signed research stages can be finalized and persisted, while tampering is rejected", async (t) => {
  const originalSecret = process.env.STRATEGY_RUN_SIGNING_SECRET;
  process.env.STRATEGY_RUN_SIGNING_SECRET = SYNTHETIC_SIGNING_SECRET;
  t.after(() => {
    if (originalSecret === undefined) {
      delete process.env.STRATEGY_RUN_SIGNING_SECRET;
    } else {
      process.env.STRATEGY_RUN_SIGNING_SECRET = originalSecret;
    }
  });

  const database = new StrategyFlowDatabase();
  const run = await createGoalStrategyRun(GOAL_ID, USER_ID, database.client);
  assert.equal(
    await getGoalStrategyRun(run.id, GOAL_ID, "another-user", database.client),
    null
  );
  await assert.rejects(
    () =>
      startGoalStrategyRunStage(
        run.id,
        GOAL_ID,
        "another-user",
        "flight",
        database.client
      ),
    /Failed to update strategy-run stage\./
  );

  await startGoalStrategyRunStage(
    run.id,
    GOAL_ID,
    USER_ID,
    "flight",
    database.client
  );
  await saveGoalStrategyRunStage(
    run.id,
    GOAL_ID,
    USER_ID,
    "flight",
    buildStrategyRunStagePayload("flight", interpretedStage("flight")),
    database.client
  );
  await startGoalStrategyRunStage(
    run.id,
    GOAL_ID,
    USER_ID,
    "hotel",
    database.client
  );
  await saveGoalStrategyRunStage(
    run.id,
    GOAL_ID,
    USER_ID,
    "hotel",
    buildStrategyRunStagePayload("hotel", interpretedStage("hotel")),
    database.client
  );

  const flight = validateStrategyRunStagePayload(
    await loadVerifiedGoalStrategyRunStage(
      run.id,
      GOAL_ID,
      USER_ID,
      "flight",
      database.client
    ),
    "flight"
  );
  const hotel = validateStrategyRunStagePayload(
    await loadVerifiedGoalStrategyRunStage(
      run.id,
      GOAL_ID,
      USER_ID,
      "hotel",
      database.client
    ),
    "hotel"
  );

  await assert.rejects(
    () =>
      updateGoalStrategyRunFinalStatus(
        run.id,
        GOAL_ID,
        USER_ID,
        "succeeded",
        database.client
      ),
    /Failed to update strategy-run final status\./
  );

  const running = await updateGoalStrategyRunFinalStatus(
    run.id,
    GOAL_ID,
    USER_ID,
    "running",
    database.client
  );
  assert.equal(running.finalStatus, "running");

  const strategy = finalStrategy(
    flight.interpreted.awardOptions[0],
    hotel.interpreted.awardOptions[0]
  );
  const saved = await saveLatestStrategy(
    GOAL_ID,
    USER_ID,
    strategy,
    "2026-08-26T12:00:00Z",
    database.client
  );
  assert.equal(saved.integrity, "verified");

  const completed = await updateGoalStrategyRunFinalStatus(
    run.id,
    GOAL_ID,
    USER_ID,
    "succeeded",
    database.client
  );
  assert.equal(completed.finalStatus, "succeeded");

  const reloaded = await getLatestStrategyForGoal(
    GOAL_ID,
    USER_ID,
    database.client
  );
  assert.equal(reloaded?.integrity, "verified");
  assert.equal(reloaded?.strategy.flightOptions[0].id, "flight-option");
  assert.equal(reloaded?.strategy.hotelOptions[0].id, "hotel-option");
  assert.equal(
    await getLatestStrategyForGoal(GOAL_ID, "another-user", database.client),
    null
  );

  database.tamperRunStagePayload(run.id, "flight");
  await assert.rejects(
    () =>
      loadVerifiedGoalStrategyRunStage(
        run.id,
        GOAL_ID,
        USER_ID,
        "flight",
        database.client
      ),
    /Failed to load strategy-run stage\./
  );

  database.tamperSavedStrategy(GOAL_ID);
  await assert.rejects(
    () => getLatestStrategyForGoal(GOAL_ID, USER_ID, database.client),
    /Failed to load saved strategy\./
  );
});
