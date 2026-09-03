import { test } from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  getLatestStrategyForGoal,
  getLatestStrategiesForGoals,
  saveLatestStrategy,
  type SavedGoalStrategy,
} from "./strategyRepository";
import type { PersonalizedStrategy } from "./strategyTypes";

/**
 * Minimal mocked Supabase query builder.
 *
 * Records the chained operations (table, select columns, eq filters, upsert
 * payload/options) and returns configured data/error results. Never touches a
 * real database.
 */
class MockQueryBuilder {
  table: string;
  selectColumns: string | null = null;
  filters: Array<{ field: string; value: unknown }> = [];
  upsertPayload: Record<string, unknown> | null = null;
  upsertOptions: Record<string, unknown> | null = null;
  result: { data: unknown; error: unknown };

  constructor(table: string, result: { data: unknown; error: unknown }) {
    this.table = table;
    this.result = result;
  }

  select(columns: string) {
    this.selectColumns = columns;
    return this;
  }

  eq(field: string, value: unknown) {
    this.filters.push({ field, value });
    return this;
  }

  in(field: string, values: unknown[]) {
    this.filters.push({ field, value: values });
    return this.result;
  }

  upsert(payload: Record<string, unknown>, options?: Record<string, unknown>) {
    this.upsertPayload = payload;
    this.upsertOptions = options ?? null;
    return this;
  }

  maybeSingle() {
    return this.result;
  }

  single() {
    return this.result;
  }
}

/** Builds a mocked Supabase client that returns the given result. */
function mockClient(result: { data: unknown; error: unknown }): {
  client: SupabaseClient;
  builderRef: { current: MockQueryBuilder | null };
} {
  const builderRef: { current: MockQueryBuilder | null } = { current: null };
  const client = {
    from: (table: string) => {
      builderRef.current = new MockQueryBuilder(table, result);
      return builderRef.current;
    },
  } as unknown as SupabaseClient;
  return { client, builderRef };
}

/** A valid persisted row for the current schema version. */
function validRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    goal_id: "goal-1",
    user_id: "user-1",
    strategy_json: validStrategy(),
    schema_version: 1,
    generated_at: "2026-08-22T10:00:00.000Z",
    created_at: "2026-08-22T10:00:00.000Z",
    updated_at: "2026-08-22T10:00:00.000Z",
    ...overrides,
  };
}

/** A valid PersonalizedStrategy fixture. */
function validStrategy(): PersonalizedStrategy {
  return {
    headline: "Fly to Europe with points",
    summary: "A strategy to fund your trip with points.",
    feasibility: "on_track",
    pointsGap: 0,
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
}

test("get filters by both goal_id and user_id", async () => {
  const { client, builderRef } = mockClient({ data: validRow(), error: null });

  await getLatestStrategyForGoal("goal-1", "user-1", client);

  assert.ok(builderRef.current);
  assert.equal(builderRef.current.table, "goal_strategies");
  assert.deepEqual(builderRef.current.filters, [
    { field: "goal_id", value: "goal-1" },
    { field: "user_id", value: "user-1" },
  ]);
});

test("get returns null when no row exists", async () => {
  const { client } = mockClient({ data: null, error: null });

  const result = await getLatestStrategyForGoal("goal-1", "user-1", client);

  assert.equal(result, null);
});

test("get maps a valid row to SavedGoalStrategy", async () => {
  const { client } = mockClient({ data: validRow(), error: null });

  const result = await getLatestStrategyForGoal("goal-1", "user-1", client);

  assert.ok(result);
  assert.equal(result.goalId, "goal-1");
  assert.equal(result.userId, "user-1");
  assert.equal(result.schemaVersion, 1);
  assert.equal(result.generatedAt, "2026-08-22T10:00:00.000Z");
  assert.equal(result.createdAt, "2026-08-22T10:00:00.000Z");
  assert.equal(result.updatedAt, "2026-08-22T10:00:00.000Z");
  assert.equal(result.strategy.headline, "Fly to Europe with points");
  assert.equal(result.strategy.feasibility, "on_track");
});

test("get preserves a valid saved strategy while omitting its malformed estimate", async () => {
  const strategy = validStrategy();
  strategy.flightPlanningEstimate = { total: 1_000_001, rawProviderPayload: "hostile" } as never;
  const { client } = mockClient({ data: validRow({ strategy_json: strategy }), error: null });
  const result = await getLatestStrategyForGoal("goal-1", "user-1", client);
  assert.ok(result);
  assert.equal(result.strategy.headline, strategy.headline);
  assert.equal(result.strategy.flightPlanningEstimate, null);
  assert.equal(JSON.stringify(result.strategy).includes("rawProviderPayload"), false);
});

test("get rejects an unsupported schema version safely", async () => {
  const { client } = mockClient({
    data: validRow({ schema_version: 2 }),
    error: null,
  });

  await assert.rejects(
    () => getLatestStrategyForGoal("goal-1", "user-1", client),
    /Failed to load saved strategy\./
  );
});

test("get rejects malformed strategy_json safely", async () => {
  const { client } = mockClient({
    data: validRow({ strategy_json: { headline: 42 } }),
    error: null,
  });

  await assert.rejects(
    () => getLatestStrategyForGoal("goal-1", "user-1", client),
    /Failed to load saved strategy\./
  );
});

test("get throws a generic error on database read error", async () => {
  const { client } = mockClient({ data: null, error: new Error("db down") });

  await assert.rejects(
    () => getLatestStrategyForGoal("goal-1", "user-1", client),
    /Failed to load saved strategy\./
  );
});

test("save returns the persisted envelope timestamp rather than the input timestamp", async () => {
  const { client } = mockClient({
    data: validRow({ generated_at: "2027-01-03T04:05:06.000Z" }),
    error: null,
  });
  const result = await saveLatestStrategy(
    "goal-1",
    "user-1",
    validStrategy(),
    "2027-01-01T00:00:00.000Z",
    client,
  );
  assert.equal(result.generatedAt, "2027-01-03T04:05:06.000Z");
});

test("save rejects a missing or malformed persisted timestamp", async () => {
  for (const generated_at of [undefined, null, "", "not-a-date"]) {
    const row = validRow();
    delete row.generated_at;
    if (generated_at !== undefined) row.generated_at = generated_at;
    const { client } = mockClient({ data: row, error: null });
    await assert.rejects(
      () => saveLatestStrategy("goal-1", "user-1", validStrategy(), "2027-01-01T00:00:00.000Z", client),
      /Failed to save strategy\./,
    );
  }
});

test("save uses goal_id conflict upsert", async () => {
  const { client, builderRef } = mockClient({ data: validRow(), error: null });

  await saveLatestStrategy(
    "goal-1",
    "user-1",
    validStrategy(),
    "2026-08-22T10:00:00.000Z",
    client
  );

  assert.ok(builderRef.current);
  assert.equal(builderRef.current.table, "goal_strategies");
  assert.deepEqual(builderRef.current.upsertOptions, { onConflict: "goal_id" });
});

test("save payload uses function goalId and userId", async () => {
  const { client, builderRef } = mockClient({ data: validRow(), error: null });

  await saveLatestStrategy(
    "goal-1",
    "user-1",
    validStrategy(),
    "2026-08-22T10:00:00.000Z",
    client
  );

  assert.equal(builderRef.current?.upsertPayload?.goal_id, "goal-1");
  assert.equal(builderRef.current?.upsertPayload?.user_id, "user-1");
});

test("save stores schema_version=1", async () => {
  const { client, builderRef } = mockClient({ data: validRow(), error: null });

  await saveLatestStrategy(
    "goal-1",
    "user-1",
    validStrategy(),
    "2026-08-22T10:00:00.000Z",
    client
  );

  assert.equal(builderRef.current?.upsertPayload?.schema_version, 1);
});

test("save stores strategy_json unchanged", async () => {
  const strategy = validStrategy();
  const { client, builderRef } = mockClient({ data: validRow(), error: null });

  await saveLatestStrategy(
    "goal-1",
    "user-1",
    strategy,
    "2026-08-22T10:00:00.000Z",
    client
  );

  assert.equal(builderRef.current?.upsertPayload?.strategy_json, strategy);
});

test("save does not include id or created_at", async () => {
  const { client, builderRef } = mockClient({ data: validRow(), error: null });

  await saveLatestStrategy(
    "goal-1",
    "user-1",
    validStrategy(),
    "2026-08-22T10:00:00.000Z",
    client
  );

  assert.ok(builderRef.current?.upsertPayload);
  assert.equal("id" in builderRef.current.upsertPayload, false);
  assert.equal("created_at" in builderRef.current.upsertPayload, false);
});

test("save throws a generic error on database write error", async () => {
  const { client } = mockClient({ data: null, error: new Error("db down") });

  await assert.rejects(
    () =>
      saveLatestStrategy(
        "goal-1",
        "user-1",
        validStrategy(),
        "2026-08-22T10:00:00.000Z",
        client
      ),
    /Failed to save strategy\./
  );
});

test("batch get returns {} for empty goalIds without creating a client", async () => {
  let fromCalled = false;
  const client = {
    from: () => {
      fromCalled = true;
      throw new Error("should not be called");
    },
  } as unknown as SupabaseClient;

  const result = await getLatestStrategiesForGoals([], "user-1", client);

  assert.deepEqual(result, {});
  assert.equal(fromCalled, false);
});

test("batch get filters by user_id", async () => {
  const { client, builderRef } = mockClient({ data: [], error: null });

  await getLatestStrategiesForGoals(["goal-1", "goal-2"], "user-1", client);

  assert.ok(builderRef.current);
  assert.equal(builderRef.current.table, "goal_strategies");
  assert.ok(
    builderRef.current.filters.some(
      (f) => f.field === "user_id" && f.value === "user-1"
    )
  );
});

test("batch get uses goal_id IN the supplied IDs", async () => {
  const { client, builderRef } = mockClient({ data: [], error: null });

  await getLatestStrategiesForGoals(["goal-1", "goal-2"], "user-1", client);

  assert.ok(builderRef.current);
  assert.ok(
    builderRef.current.filters.some(
      (f) =>
        f.field === "goal_id" &&
        Array.isArray(f.value) &&
        (f.value as string[]).join(",") === "goal-1,goal-2"
    )
  );
});

test("batch get maps multiple valid rows to a record keyed by goalId", async () => {
  const { client } = mockClient({
    data: [
      validRow({ goal_id: "goal-1" }),
      validRow({ goal_id: "goal-2" }),
    ],
    error: null,
  });

  const result = await getLatestStrategiesForGoals(
    ["goal-1", "goal-2"],
    "user-1",
    client
  );

  assert.deepEqual(Object.keys(result).sort(), ["goal-1", "goal-2"]);
  assert.equal(result["goal-1"].goalId, "goal-1");
  assert.equal(result["goal-2"].goalId, "goal-2");
  assert.equal(result["goal-1"].strategy.headline, "Fly to Europe with points");
});

test("batch get returns {} when no rows exist", async () => {
  const { client } = mockClient({ data: [], error: null });

  const result = await getLatestStrategiesForGoals(
    ["goal-1", "goal-2"],
    "user-1",
    client
  );

  assert.deepEqual(result, {});
});

test("batch get throws a generic error on database failure", async () => {
  const { client } = mockClient({ data: null, error: new Error("db down") });

  await assert.rejects(
    () => getLatestStrategiesForGoals(["goal-1"], "user-1", client),
    /Failed to load saved strategies\./
  );
});

test("batch get throws a generic error when one row is invalid", async () => {
  const { client } = mockClient({
    data: [
      validRow({ goal_id: "goal-1" }),
      validRow({ goal_id: "goal-2", schema_version: 2 }),
    ],
    error: null,
  });

  await assert.rejects(
    () =>
      getLatestStrategiesForGoals(["goal-1", "goal-2"], "user-1", client),
    /Failed to load saved strategies\./
  );
});
