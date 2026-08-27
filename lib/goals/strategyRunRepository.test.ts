import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  createGoalStrategyRun,
  getGoalStrategyRun,
  startGoalStrategyRunStage,
  saveGoalStrategyRunStage,
  failGoalStrategyRunStage,
  loadVerifiedGoalStrategyRunStage,
  updateGoalStrategyRunFinalStatus,
  deleteGoalStrategyRun,
  inspectVerifiedRunningResearchStage,
} from "./strategyRunRepository";
import {
  signStrategyRunPayload,
  verifyStrategyRunPayload,
  serializeStrategyRunPayload,
} from "./strategyRunSigning";

const SYNTHETIC_SECRET = "0123456789abcdef0123456789abcdef"; // 32 chars, synthetic only

let originalEnv: string | undefined;

before(() => {
  originalEnv = process.env.STRATEGY_RUN_SIGNING_SECRET;
  process.env.STRATEGY_RUN_SIGNING_SECRET = SYNTHETIC_SECRET;
});

after(() => {
  if (originalEnv === undefined) {
    delete process.env.STRATEGY_RUN_SIGNING_SECRET;
  } else {
    process.env.STRATEGY_RUN_SIGNING_SECRET = originalEnv;
  }
});

/**
 * Build a valid goal_strategy_runs row that will pass isValidRunRow and
 * produce a verifiable signature.
 */
function validRunRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const runId = (overrides.id as string) ?? "run-abc-123";
  const goalId = (overrides.goal_id as string) ?? "goal-xyz-456";
  const userId = (overrides.user_id as string) ?? "user-001";
  const expiresAt =
    (overrides.expires_at as string) ??
    new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString();

  const runSignature = signStrategyRunPayload({
    version: 1,
    runId,
    goalId,
    userId,
    expiresAt,
    stage: "run",
    payload: "",
  });

  return {
    id: runId,
    goal_id: goalId,
    user_id: userId,
    signature_version: 1,
    expires_at: expiresAt,
    run_signature: runSignature,
    flight_status: "pending",
    flight_payload: null,
    flight_signature: null,
    hotel_status: "pending",
    hotel_payload: null,
    hotel_signature: null,
    final_status: "pending",
    created_at: "2026-08-23T12:00:00.000Z",
    updated_at: "2026-08-23T12:00:00.000Z",
    ...overrides,
  };
}

/**
 * Build a valid run row with a succeeded flight stage (signed payload).
 */
function validRunRowWithFlightPayload(
  payload: unknown,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  const base = validRunRow(overrides);
  const serialized = serializeStrategyRunPayload(payload);
  const normalizedExpiresAt = new Date(base.expires_at as string).toISOString();
  const flightSig = signStrategyRunPayload({
    version: 1,
    runId: base.id as string,
    goalId: base.goal_id as string,
    userId: base.user_id as string,
    expiresAt: normalizedExpiresAt,
    stage: "flight",
    payload: serialized,
  });

  return {
    ...base,
    flight_status: "succeeded",
    flight_payload: serialized,
    flight_signature: flightSig,
    ...overrides,
  };
}

/**
 * Build a valid run row with a succeeded hotel stage (signed payload).
 */
function validRunRowWithHotelPayload(
  payload: unknown,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  const base = validRunRow(overrides);
  const serialized = serializeStrategyRunPayload(payload);
  const normalizedExpiresAt = new Date(base.expires_at as string).toISOString();
  const hotelSig = signStrategyRunPayload({
    version: 1,
    runId: base.id as string,
    goalId: base.goal_id as string,
    userId: base.user_id as string,
    expiresAt: normalizedExpiresAt,
    stage: "hotel",
    payload: serialized,
  });

  return {
    ...base,
    hotel_status: "succeeded",
    hotel_payload: serialized,
    hotel_signature: hotelSig,
    ...overrides,
  };
}

/**
 * Creates a mock Supabase client that returns `getResult` for maybeSingle()
 * (the get/load call) and builds an update result from the update payload
 * merged with a valid base for single() (the update call).
 */
function mockStageClient(
  getResult: { data: unknown; error: unknown },
): {
  client: SupabaseClient;
  updatePayloadRef: { current: Record<string, unknown> | null };
  filtersRef: { current: Array<{ field: string; value: unknown }> };
} {
  const updatePayloadRef: { current: Record<string, unknown> | null } = { current: null };
  const filtersRef: { current: Array<{ field: string; value: unknown }> } = {
    current: [],
  };

  const client = {
    from: (table: string) => {
      let selectColumns: string | null = null;
      const filters: Array<{ field: string; value: unknown }> = [];
      let updatePayload: Record<string, unknown> | null = null;
      let isUpdate = false;

      const builder = {
        select(cols: string) {
          selectColumns = cols;
          return this;
        },
        eq(field: string, value: unknown) {
          filters.push({ field, value });
          return this;
        },
        update(payload: Record<string, unknown>) {
          isUpdate = true;
          updatePayload = payload;
          updatePayloadRef.current = payload;
          return this;
        },
        maybeSingle() {
          filtersRef.current = filters;
          return getResult;
        },
        single() {
          filtersRef.current = filters;
          if (isUpdate && updatePayload) {
            // Merge the update payload onto the get result (preserves expires_at)
            const base =
              getResult.data && typeof getResult.data === "object"
                ? (getResult.data as Record<string, unknown>)
                : validRunRow();
            return {
              data: { ...base, ...updatePayload },
              error: null,
            };
          }
          return getResult;
        },
      };
      return builder;
    },
  } as unknown as SupabaseClient;

  return { client, updatePayloadRef, filtersRef };
}

// ---------------------------------------------------------------------------
// createGoalStrategyRun tests
// ---------------------------------------------------------------------------

test("create uses a generated UUID and 24-hour expiry", async () => {
  let capturedPayload: Record<string, unknown> | null = null;

  const client = {
    from: (table: string) => {
      const builder = {
        table,
        insert(payload: Record<string, unknown>) {
          capturedPayload = payload;
          return this;
        },
        select() {
          return this;
        },
        single() {
          return {
            data: {
              ...capturedPayload,
              flight_payload: null,
              flight_signature: null,
              hotel_payload: null,
              hotel_signature: null,
              created_at: "2026-08-23T12:00:00.000Z",
            },
            error: null,
          };
        },
      };
      return builder;
    },
  } as unknown as SupabaseClient;

  const result = await createGoalStrategyRun("goal-xyz-456", "user-001", client);

  assert.ok(result);
  assert.ok(capturedPayload);
  const payload = capturedPayload as Record<string, unknown>;

  const id = payload.id as string;
  assert.ok(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id),
  );

  const expiresAt = new Date(payload.expires_at as string).getTime();
  const updatedAt = new Date(payload.updated_at as string).getTime();
  const diffMs = expiresAt - updatedAt;
  assert.ok(diffMs >= 24 * 60 * 60 * 1000 - 5000);
  assert.ok(diffMs <= 24 * 60 * 60 * 1000 + 5000);
});

test("create payload uses function goalId and userId", async () => {
  let capturedPayload: Record<string, unknown> | null = null;
  const client = {
    from: () => ({
      insert(payload: Record<string, unknown>) {
        capturedPayload = payload;
        return {
          select() {
            return {
              single() {
                return {
                  data: {
                    ...capturedPayload,
                    flight_payload: null,
                    flight_signature: null,
                    hotel_payload: null,
                    hotel_signature: null,
                    created_at: "2026-08-23T12:00:00.000Z",
                  },
                  error: null,
                };
              },
            };
          },
        };
      },
    }),
  } as unknown as SupabaseClient;

  await createGoalStrategyRun("goal-xyz-456", "user-001", client);

  assert.ok(capturedPayload);
  const cp = capturedPayload as Record<string, unknown>;
  assert.equal(cp.goal_id, "goal-xyz-456");
  assert.equal(cp.user_id, "user-001");
});

test("create stores signature_version=1 and pending statuses", async () => {
  let capturedPayload: Record<string, unknown> | null = null;
  const client = {
    from: () => ({
      insert(payload: Record<string, unknown>) {
        capturedPayload = payload;
        return {
          select() {
            return {
              single() {
                return {
                  data: {
                    ...capturedPayload,
                    flight_payload: null,
                    flight_signature: null,
                    hotel_payload: null,
                    hotel_signature: null,
                    created_at: "2026-08-23T12:00:00.000Z",
                  },
                  error: null,
                };
              },
            };
          },
        };
      },
    }),
  } as unknown as SupabaseClient;

  await createGoalStrategyRun("goal-xyz-456", "user-001", client);

  const cp2 = capturedPayload as Record<string, unknown> | null;
  assert.equal(cp2?.signature_version, 1);
  assert.equal(cp2?.flight_status, "pending");
  assert.equal(cp2?.hotel_status, "pending");
  assert.equal(cp2?.final_status, "pending");
});

test("create omits flight/hotel payloads and signatures", async () => {
  let capturedPayload: Record<string, unknown> | null = null;
  const client = {
    from: () => ({
      insert(payload: Record<string, unknown>) {
        capturedPayload = payload;
        return {
          select() {
            return {
              single() {
                return {
                  data: {
                    ...capturedPayload,
                    flight_payload: null,
                    flight_signature: null,
                    hotel_payload: null,
                    hotel_signature: null,
                    created_at: "2026-08-23T12:00:00.000Z",
                  },
                  error: null,
                };
              },
            };
          },
        };
      },
    }),
  } as unknown as SupabaseClient;

  await createGoalStrategyRun("goal-xyz-456", "user-001", client);

  assert.ok(capturedPayload);
  assert.equal("flight_payload" in capturedPayload, false);
  assert.equal("flight_signature" in capturedPayload, false);
  assert.equal("hotel_payload" in capturedPayload, false);
  assert.equal("hotel_signature" in capturedPayload, false);
});

test("created run signature verifies", async () => {
  let capturedPayload: Record<string, unknown> | null = null;
  const client = {
    from: () => ({
      insert(payload: Record<string, unknown>) {
        capturedPayload = payload;
        return {
          select() {
            return {
              single() {
                return {
                  data: {
                    ...capturedPayload,
                    flight_payload: null,
                    flight_signature: null,
                    hotel_payload: null,
                    hotel_signature: null,
                    created_at: "2026-08-23T12:00:00.000Z",
                  },
                  error: null,
                };
              },
            };
          },
        };
      },
    }),
  } as unknown as SupabaseClient;

  const result = await createGoalStrategyRun("goal-xyz-456", "user-001", client);

  assert.ok(result);
  const verified = verifyStrategyRunPayload(
    {
      version: 1,
      runId: result.id,
      goalId: result.goalId,
      userId: result.userId,
      expiresAt: new Date(result.expiresAt).toISOString(),
      stage: "run",
      payload: "",
    },
    result.runSignature,
  );
  assert.equal(verified, true);
});

test("create rejects malformed/tampered returned row generically", async () => {
  const tamperedRow = validRunRow({ run_signature: "a".repeat(64) });
  const client = {
    from: () => ({
      insert() {
        return {
          select() {
            return {
              single() {
                return { data: tamperedRow, error: null };
              },
            };
          },
        };
      },
    }),
  } as unknown as SupabaseClient;

  await assert.rejects(
    () => createGoalStrategyRun("goal-xyz-456", "user-001", client),
    /Failed to create strategy run\./,
  );
});

// ---------------------------------------------------------------------------
// getGoalStrategyRun tests
// ---------------------------------------------------------------------------

function mockGetClient(result: { data: unknown; error: unknown }): {
  client: SupabaseClient;
  filtersRef: { current: Array<{ field: string; value: unknown }> };
} {
  const filtersRef: { current: Array<{ field: string; value: unknown }> } = {
    current: [],
  };
  const client = {
    from: () => {
      const filters: Array<{ field: string; value: unknown }> = [];
      return {
        select() {
          return this;
        },
        eq(field: string, value: unknown) {
          filters.push({ field, value });
          return this;
        },
        maybeSingle() {
          filtersRef.current = filters;
          return result;
        },
      };
    },
  } as unknown as SupabaseClient;
  return { client, filtersRef };
}

test("get filters by id, goal_id, and user_id", async () => {
  const { client, filtersRef } = mockGetClient({ data: validRunRow(), error: null });

  await getGoalStrategyRun("run-abc-123", "goal-xyz-456", "user-001", client);

  assert.deepEqual(filtersRef.current, [
    { field: "id", value: "run-abc-123" },
    { field: "goal_id", value: "goal-xyz-456" },
    { field: "user_id", value: "user-001" },
  ]);
});

test("get returns null when no row exists", async () => {
  const { client } = mockGetClient({ data: null, error: null });

  const result = await getGoalStrategyRun("run-abc-123", "goal-xyz-456", "user-001", client);

  assert.equal(result, null);
});

test("get maps a valid signed row", async () => {
  const row = validRunRow();
  const { client } = mockGetClient({ data: row, error: null });

  const result = await getGoalStrategyRun(
    row.id as string,
    row.goal_id as string,
    row.user_id as string,
    client,
  );

  assert.ok(result);
  assert.equal(result.id, row.id);
  assert.equal(result.goalId, row.goal_id);
  assert.equal(result.userId, row.user_id);
  assert.equal(result.signatureVersion, 1);
  assert.equal(result.flightStatus, "pending");
  assert.equal(result.hotelStatus, "pending");
  assert.equal(result.finalStatus, "pending");
  assert.equal(result.flightPayload, null);
  assert.equal(result.flightSignature, null);
  assert.equal(result.hotelPayload, null);
  assert.equal(result.hotelSignature, null);
});

test("get rejects modified runId", async () => {
  const row = validRunRow();
  const { client } = mockGetClient({ data: row, error: null });

  await assert.rejects(
    () => getGoalStrategyRun("different-run-id", row.goal_id as string, row.user_id as string, client),
    /Failed to load strategy run\./,
  );
});

test("get rejects modified goalId", async () => {
  const row = validRunRow();
  const { client } = mockGetClient({ data: row, error: null });

  await assert.rejects(
    () => getGoalStrategyRun(row.id as string, "different-goal", row.user_id as string, client),
    /Failed to load strategy run\./,
  );
});

test("get rejects modified userId", async () => {
  const row = validRunRow();
  const { client } = mockGetClient({ data: row, error: null });

  await assert.rejects(
    () => getGoalStrategyRun(row.id as string, row.goal_id as string, "different-user", client),
    /Failed to load strategy run\./,
  );
});

test("get rejects modified expiresAt", async () => {
  const row = validRunRow();
  const tampered = { ...row, expires_at: "2027-01-01T00:00:00.000Z" };
  const { client } = mockGetClient({ data: tampered, error: null });

  await assert.rejects(
    () => getGoalStrategyRun(row.id as string, row.goal_id as string, row.user_id as string, client),
    /Failed to load strategy run\./,
  );
});

test("get rejects invalid run signature", async () => {
  const row = validRunRow({ run_signature: "b".repeat(64) });
  const { client } = mockGetClient({ data: row, error: null });

  await assert.rejects(
    () => getGoalStrategyRun(row.id as string, row.goal_id as string, row.user_id as string, client),
    /Failed to load strategy run\./,
  );
});

test("get rejects expired run", async () => {
  const expiredAt = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const row = validRunRow({ expires_at: expiredAt });
  const { client } = mockGetClient({ data: row, error: null });

  await assert.rejects(
    () => getGoalStrategyRun(row.id as string, row.goal_id as string, row.user_id as string, client),
    /Failed to load strategy run\./,
  );
});

test("get rejects malformed run expiry before any execution capability can exist", async () => {
  const row = validRunRow({ expires_at: "not-a-timestamp" });
  const { client } = mockGetClient({ data: row, error: null });
  await assert.rejects(
    () => getGoalStrategyRun(row.id as string, row.goal_id as string, row.user_id as string, client),
    /Failed to load strategy run\./,
  );
});

test("get rejects unsupported version", async () => {
  const row = validRunRow({ signature_version: 2 });
  const { client } = mockGetClient({ data: row, error: null });

  await assert.rejects(
    () => getGoalStrategyRun(row.id as string, row.goal_id as string, row.user_id as string, client),
    /Failed to load strategy run\./,
  );
});

test("get rejects invalid status/payload pairing", async () => {
  const row = validRunRow({
    flight_status: "succeeded",
    flight_payload: null,
    flight_signature: null,
  });
  const { client } = mockGetClient({ data: row, error: null });

  await assert.rejects(
    () => getGoalStrategyRun(row.id as string, row.goal_id as string, row.user_id as string, client),
    /Failed to load strategy run\./,
  );
});

test("get rejects tampered succeeded flight stage", async () => {
  const payload = { flights: [{ airline: "UA" }] };
  const row = validRunRowWithFlightPayload(payload, {
    flight_signature: "c".repeat(64),
  });
  const { client } = mockGetClient({ data: row, error: null });

  await assert.rejects(
    () => getGoalStrategyRun(row.id as string, row.goal_id as string, row.user_id as string, client),
    /Failed to load strategy run\./,
  );
});

test("get rejects tampered succeeded hotel stage", async () => {
  const payload = { hotel: { name: "Test" } };
  const row = validRunRowWithHotelPayload(payload, {
    hotel_signature: "d".repeat(64),
  });
  const { client } = mockGetClient({ data: row, error: null });

  await assert.rejects(
    () => getGoalStrategyRun(row.id as string, row.goal_id as string, row.user_id as string, client),
    /Failed to load strategy run\./,
  );
});

test("database errors remain generic", async () => {
  const { client } = mockGetClient({ data: null, error: new Error("db down") });

  await assert.rejects(
    () => getGoalStrategyRun("run-abc-123", "goal-xyz-456", "user-001", client),
    /Failed to load strategy run\./,
  );
});

test("no error contains a signature, payload, signing secret, or row contents", async () => {
  const row = validRunRow({ run_signature: "b".repeat(64) });
  const { client } = mockGetClient({ data: row, error: null });

  try {
    await getGoalStrategyRun(row.id as string, row.goal_id as string, row.user_id as string, client);
    assert.fail("Expected rejection");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    assert.equal(msg.includes(SYNTHETIC_SECRET), false);
    assert.equal(msg.includes("b".repeat(64)), false);
    assert.equal(msg.includes("run-abc-123"), false);
    assert.equal(msg.includes("goal-xyz-456"), false);
    assert.equal(msg.includes("user-001"), false);
  }
});

// ---------------------------------------------------------------------------
// startGoalStrategyRunStage tests
// ---------------------------------------------------------------------------

test("start flight changes only flight fields", async () => {
  const row = validRunRow();
  const { client, updatePayloadRef } = mockStageClient({ data: row, error: null });

  const started = await startGoalStrategyRunStage("run-abc-123", "goal-xyz-456", "user-001", "flight", client);

  const p = updatePayloadRef.current;
  assert.ok(p);
  assert.equal(p.flight_status, "running");
  assert.equal(p.flight_payload, null);
  assert.equal(p.flight_signature, null);
  assert.equal("hotel_status" in p, false);
  assert.equal("hotel_payload" in p, false);
  assert.equal("hotel_signature" in p, false);
  const runningStage = inspectVerifiedRunningResearchStage(started);
  assert.equal(runningStage?.stage, "flight");
  assert.equal(runningStage?.revision, updatePayloadRef.current?.updated_at);
  assert.deepEqual(Object.keys(runningStage ?? {}).sort(), ["expiresAt", "revision", "stage"]);
  assert.ok(Object.isFrozen(started));
});

test("start hotel changes only hotel fields", async () => {
  const row = validRunRow({ flight_status: "failed" });
  const { client, updatePayloadRef } = mockStageClient({ data: row, error: null });

  await startGoalStrategyRunStage("run-abc-123", "goal-xyz-456", "user-001", "hotel", client);

  const p = updatePayloadRef.current;
  assert.ok(p);
  assert.equal(p.hotel_status, "running");
  assert.equal(p.hotel_payload, null);
  assert.equal(p.hotel_signature, null);
  assert.equal("flight_status" in p, false);
  assert.equal("flight_payload" in p, false);
  assert.equal("flight_signature" in p, false);
});

test("start ownership filters are present on update", async () => {
  const row = validRunRow();
  const { client, filtersRef } = mockStageClient({ data: row, error: null });

  await startGoalStrategyRunStage("run-abc-123", "goal-xyz-456", "user-001", "flight", client);

  const filters = filtersRef.current;
  assert.ok(filters.some((f) => f.field === "id" && f.value === "run-abc-123"));
  assert.ok(filters.some((f) => f.field === "goal_id" && f.value === "goal-xyz-456"));
  assert.ok(filters.some((f) => f.field === "user_id" && f.value === "user-001"));
  assert.ok(filters.some((f) => f.field === "flight_status" && f.value === "pending"));
  assert.ok(filters.some((f) => f.field === "updated_at" && f.value === row.updated_at));
});

test("start mints no capability when stage order or transition fails", async () => {
  const wrongOrder = validRunRow({ flight_status: "pending" });
  const wrongOrderClient = mockStageClient({ data: wrongOrder, error: null }).client;
  await assert.rejects(
    startGoalStrategyRunStage("run-abc-123", "goal-xyz-456", "user-001", "hotel", wrongOrderClient),
    /Failed to update strategy-run stage\./,
  );

  const row = validRunRow();
  const failedClient = {
    from: () => ({
      select() { return this; }, eq() { return this; }, maybeSingle() { return { data: row, error: null }; },
      update() { return this; }, single() { return { data: null, error: { message: "synthetic" } }; },
    }),
  } as unknown as SupabaseClient;
  await assert.rejects(
    startGoalStrategyRunStage("run-abc-123", "goal-xyz-456", "user-001", "flight", failedClient),
    /Failed to update strategy-run stage\./,
  );
  assert.equal(inspectVerifiedRunningResearchStage({}), null);
});

// ---------------------------------------------------------------------------
// saveGoalStrategyRunStage tests
// ---------------------------------------------------------------------------

test("save flight stores exact serialized payload and valid bound signature", async () => {
  const payload = { flights: [{ airline: "UA", points: 70000 }] };
  const row = validRunRow({ flight_status: "running" });
  const { client, updatePayloadRef } = mockStageClient({ data: row, error: null });

  await saveGoalStrategyRunStage("run-abc-123", "goal-xyz-456", "user-001", "flight", payload, client);

  const p = updatePayloadRef.current;
  assert.ok(p);
  assert.equal(p.flight_status, "succeeded");

  const expectedSerialized = serializeStrategyRunPayload(payload);
  assert.equal(p.flight_payload, expectedSerialized);

  const sig = p.flight_signature as string;
  assert.ok(/^[0-9a-f]{64}$/.test(sig));
  const verified = verifyStrategyRunPayload(
    {
      version: 1,
      runId: "run-abc-123",
      goalId: "goal-xyz-456",
      userId: "user-001",
      expiresAt: new Date(row.expires_at as string).toISOString(),
      stage: "flight",
      payload: expectedSerialized,
    },
    sig,
  );
  assert.equal(verified, true);
});

test("save hotel stores exact serialized payload and valid bound signature", async () => {
  const payload = { hotel: { name: "Test Hotel", points: 50000 } };
  const row = validRunRow({ hotel_status: "running" });
  const { client, updatePayloadRef } = mockStageClient({ data: row, error: null });

  await saveGoalStrategyRunStage("run-abc-123", "goal-xyz-456", "user-001", "hotel", payload, client);

  const p = updatePayloadRef.current;
  assert.ok(p);
  assert.equal(p.hotel_status, "succeeded");

  const expectedSerialized = serializeStrategyRunPayload(payload);
  assert.equal(p.hotel_payload, expectedSerialized);

  const sig = p.hotel_signature as string;
  assert.ok(/^[0-9a-f]{64}$/.test(sig));
  const verified = verifyStrategyRunPayload(
    {
      version: 1,
      runId: "run-abc-123",
      goalId: "goal-xyz-456",
      userId: "user-001",
      expiresAt: new Date(row.expires_at as string).toISOString(),
      stage: "hotel",
      payload: expectedSerialized,
    },
    sig,
  );
  assert.equal(verified, true);
});

test("save requires current selected status='running'", async () => {
  const payload = { flights: [{ airline: "UA" }] };
  const row = validRunRow({ flight_status: "running" });
  const { client, filtersRef } = mockStageClient({ data: row, error: null });

  await saveGoalStrategyRunStage("run-abc-123", "goal-xyz-456", "user-001", "flight", payload, client);

  const filters = filtersRef.current;
  assert.ok(filters.some((f) => f.field === "flight_status" && f.value === "running"));
});

test("flight save does not alter hotel fields and vice versa", async () => {
  const payload = { flights: [{ airline: "UA" }] };
  const row = validRunRow({ flight_status: "running" });
  const { client, updatePayloadRef } = mockStageClient({ data: row, error: null });

  await saveGoalStrategyRunStage("run-abc-123", "goal-xyz-456", "user-001", "flight", payload, client);

  const p = updatePayloadRef.current;
  assert.ok(p);
  assert.equal("hotel_status" in p, false);
  assert.equal("hotel_payload" in p, false);
  assert.equal("hotel_signature" in p, false);
});

test("save ownership filters are present on update", async () => {
  const payload = { flights: [{ airline: "UA" }] };
  const row = validRunRow({ flight_status: "running" });
  const { client, filtersRef } = mockStageClient({ data: row, error: null });

  await saveGoalStrategyRunStage("run-abc-123", "goal-xyz-456", "user-001", "flight", payload, client);

  const filters = filtersRef.current;
  assert.ok(filters.some((f) => f.field === "id" && f.value === "run-abc-123"));
  assert.ok(filters.some((f) => f.field === "goal_id" && f.value === "goal-xyz-456"));
  assert.ok(filters.some((f) => f.field === "user_id" && f.value === "user-001"));
});

// ---------------------------------------------------------------------------
// loadVerifiedGoalStrategyRunStage tests
// ---------------------------------------------------------------------------

test("verified load parses valid signed payload", async () => {
  const payload = { flights: [{ airline: "UA", points: 70000 }] };
  const row = validRunRowWithFlightPayload(payload);
  const { client } = mockGetClient({ data: row, error: null });

  const result = await loadVerifiedGoalStrategyRunStage(
    row.id as string,
    row.goal_id as string,
    row.user_id as string,
    "flight",
    client,
  );

  assert.deepStrictEqual(result, payload);
});

test("non-succeeded stage returns null", async () => {
  const row = validRunRow();
  const { client } = mockGetClient({ data: row, error: null });

  const result = await loadVerifiedGoalStrategyRunStage(
    row.id as string,
    row.goal_id as string,
    row.user_id as string,
    "flight",
    client,
  );

  assert.equal(result, null);
});

test("changed payload fails", async () => {
  const payload = { flights: [{ airline: "UA" }] };
  const row = validRunRowWithFlightPayload(payload);
  const tampered = { ...row, flight_payload: '{"tampered":true}' };
  const { client } = mockGetClient({ data: tampered, error: null });

  await assert.rejects(
    () =>
      loadVerifiedGoalStrategyRunStage(
        row.id as string,
        row.goal_id as string,
        row.user_id as string,
        "flight",
        client,
      ),
    /Failed to load strategy-run stage\./,
  );
});

test("changed signature fails", async () => {
  const payload = { flights: [{ airline: "UA" }] };
  const row = validRunRowWithFlightPayload(payload);
  const tampered = { ...row, flight_signature: "e".repeat(64) };
  const { client } = mockGetClient({ data: tampered, error: null });

  await assert.rejects(
    () =>
      loadVerifiedGoalStrategyRunStage(
        row.id as string,
        row.goal_id as string,
        row.user_id as string,
        "flight",
        client,
      ),
    /Failed to load strategy-run stage\./,
  );
});

test("flight signature cannot validate as hotel", async () => {
  const payload = { flights: [{ airline: "UA" }] };
  // Create a row where hotel_status="succeeded" but the hotel_signature
  // was actually signed with stage="flight"
  const base = validRunRow();
  const serialized = serializeStrategyRunPayload(payload);
  const normalizedExpiresAt = new Date(base.expires_at as string).toISOString();
  // Sign with stage="flight" but store in hotel_signature
  const flightSig = signStrategyRunPayload({
    version: 1,
    runId: base.id as string,
    goalId: base.goal_id as string,
    userId: base.user_id as string,
    expiresAt: normalizedExpiresAt,
    stage: "flight",
    payload: serialized,
  });

  const row = {
    ...base,
    hotel_status: "succeeded",
    hotel_payload: serialized,
    hotel_signature: flightSig,
  } as Record<string, unknown>;
  const { client } = mockGetClient({ data: row, error: null });

  await assert.rejects(
    () =>
      loadVerifiedGoalStrategyRunStage(
        row.id as string,
        row.goal_id as string,
        row.user_id as string,
        "hotel",
        client,
      ),
    /Failed to load strategy-run stage\./,
  );
});

test("payload/signature from another run cannot validate", async () => {
  const payload = { flights: [{ airline: "UA" }] };
  const row = validRunRowWithFlightPayload(payload);
  const tampered = { ...row, id: "different-run-id" };
  const { client } = mockGetClient({ data: tampered, error: null });

  await assert.rejects(
    () =>
      loadVerifiedGoalStrategyRunStage(
        "different-run-id",
        row.goal_id as string,
        row.user_id as string,
        "flight",
        client,
      ),
    /Failed to load strategy-run stage\./,
  );
});

// ---------------------------------------------------------------------------
// failGoalStrategyRunStage tests
// ---------------------------------------------------------------------------

test("fail clears selected payload/signature and sets failed", async () => {
  const payload = { flights: [{ airline: "UA" }] };
  const row = validRunRowWithFlightPayload(payload);
  const { client, updatePayloadRef } = mockStageClient({ data: row, error: null });

  await failGoalStrategyRunStage("run-abc-123", "goal-xyz-456", "user-001", "flight", client);

  const p = updatePayloadRef.current;
  assert.ok(p);
  assert.equal(p.flight_status, "failed");
  assert.equal(p.flight_payload, null);
  assert.equal(p.flight_signature, null);
});

test("fail ownership filters are present on update", async () => {
  const row = validRunRow();
  const { client, filtersRef } = mockStageClient({ data: row, error: null });

  await failGoalStrategyRunStage("run-abc-123", "goal-xyz-456", "user-001", "flight", client);

  const filters = filtersRef.current;
  assert.ok(filters.some((f) => f.field === "id" && f.value === "run-abc-123"));
  assert.ok(filters.some((f) => f.field === "goal_id" && f.value === "goal-xyz-456"));
  assert.ok(filters.some((f) => f.field === "user_id" && f.value === "user-001"));
});

// ---------------------------------------------------------------------------
// updateGoalStrategyRunFinalStatus tests
// ---------------------------------------------------------------------------

/** Build a run row whose flight and hotel stages are both terminal. */
function terminalRunRow(
  finalStatus: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return validRunRow({
    flight_status: "failed",
    hotel_status: "failed",
    final_status: finalStatus,
    ...overrides,
  });
}

test("pending → running accepted when both stages terminal", async () => {
  const row = terminalRunRow("pending");
  const { client, updatePayloadRef } = mockStageClient({ data: row, error: null });

  const result = await updateGoalStrategyRunFinalStatus(
    "run-abc-123",
    "goal-xyz-456",
    "user-001",
    "running",
    client,
  );

  assert.ok(result);
  assert.equal(result.finalStatus, "running");
  assert.equal(updatePayloadRef.current?.final_status, "running");
});

test("failed → running retry accepted", async () => {
  const row = terminalRunRow("failed");
  const { client, updatePayloadRef } = mockStageClient({ data: row, error: null });

  const result = await updateGoalStrategyRunFinalStatus(
    "run-abc-123",
    "goal-xyz-456",
    "user-001",
    "running",
    client,
  );

  assert.ok(result);
  assert.equal(result.finalStatus, "running");
  assert.equal(updatePayloadRef.current?.final_status, "running");
});

test("running → succeeded accepted", async () => {
  const row = terminalRunRow("running");
  const { client, updatePayloadRef } = mockStageClient({ data: row, error: null });

  const result = await updateGoalStrategyRunFinalStatus(
    "run-abc-123",
    "goal-xyz-456",
    "user-001",
    "succeeded",
    client,
  );

  assert.ok(result);
  assert.equal(result.finalStatus, "succeeded");
  assert.equal(updatePayloadRef.current?.final_status, "succeeded");
});

test("running → failed accepted", async () => {
  const row = terminalRunRow("running");
  const { client, updatePayloadRef } = mockStageClient({ data: row, error: null });

  const result = await updateGoalStrategyRunFinalStatus(
    "run-abc-123",
    "goal-xyz-456",
    "user-001",
    "failed",
    client,
  );

  assert.ok(result);
  assert.equal(result.finalStatus, "failed");
  assert.equal(updatePayloadRef.current?.final_status, "failed");
});

test("running rejected when flight is non-terminal", async () => {
  const row = validRunRow({
    flight_status: "running",
    hotel_status: "failed",
    final_status: "pending",
  });
  const { client } = mockStageClient({ data: row, error: null });

  await assert.rejects(
    () =>
      updateGoalStrategyRunFinalStatus(
        "run-abc-123",
        "goal-xyz-456",
        "user-001",
        "running",
        client,
      ),
    /Failed to update strategy-run final status\./,
  );
});

test("running rejected when hotel is non-terminal", async () => {
  const row = validRunRow({
    flight_status: "failed",
    hotel_status: "running",
    final_status: "pending",
  });
  const { client } = mockStageClient({ data: row, error: null });

  await assert.rejects(
    () =>
      updateGoalStrategyRunFinalStatus(
        "run-abc-123",
        "goal-xyz-456",
        "user-001",
        "running",
        client,
      ),
    /Failed to update strategy-run final status\./,
  );
});

test("pending → succeeded rejected", async () => {
  const row = terminalRunRow("pending");
  const { client } = mockStageClient({ data: row, error: null });

  await assert.rejects(
    () =>
      updateGoalStrategyRunFinalStatus(
        "run-abc-123",
        "goal-xyz-456",
        "user-001",
        "succeeded",
        client,
      ),
    /Failed to update strategy-run final status\./,
  );
});

test("pending → failed rejected", async () => {
  const row = terminalRunRow("pending");
  const { client } = mockStageClient({ data: row, error: null });

  await assert.rejects(
    () =>
      updateGoalStrategyRunFinalStatus(
        "run-abc-123",
        "goal-xyz-456",
        "user-001",
        "failed",
        client,
      ),
    /Failed to update strategy-run final status\./,
  );
});

test("succeeded → running rejected", async () => {
  const row = terminalRunRow("succeeded");
  const { client } = mockStageClient({ data: row, error: null });

  await assert.rejects(
    () =>
      updateGoalStrategyRunFinalStatus(
        "run-abc-123",
        "goal-xyz-456",
        "user-001",
        "running",
        client,
      ),
    /Failed to update strategy-run final status\./,
  );
});

test("succeeded → failed rejected", async () => {
  const row = terminalRunRow("succeeded");
  const { client } = mockStageClient({ data: row, error: null });

  await assert.rejects(
    () =>
      updateGoalStrategyRunFinalStatus(
        "run-abc-123",
        "goal-xyz-456",
        "user-001",
        "failed",
        client,
      ),
    /Failed to update strategy-run final status\./,
  );
});

test("update filters exact prior final_status plus id/goal_id/user_id", async () => {
  const row = terminalRunRow("pending");
  const { client, filtersRef } = mockStageClient({ data: row, error: null });

  await updateGoalStrategyRunFinalStatus(
    "run-abc-123",
    "goal-xyz-456",
    "user-001",
    "running",
    client,
  );

  assert.deepEqual(filtersRef.current, [
    { field: "id", value: "run-abc-123" },
    { field: "goal_id", value: "goal-xyz-456" },
    { field: "user_id", value: "user-001" },
    { field: "final_status", value: "pending" },
  ]);
});

test("update changes only final_status and updated_at", async () => {
  const row = terminalRunRow("running");
  const { client, updatePayloadRef } = mockStageClient({ data: row, error: null });

  await updateGoalStrategyRunFinalStatus(
    "run-abc-123",
    "goal-xyz-456",
    "user-001",
    "succeeded",
    client,
  );

  const p = updatePayloadRef.current;
  assert.ok(p);
  assert.deepEqual(Object.keys(p).sort(), ["final_status", "updated_at"]);
  assert.equal(p.final_status, "succeeded");
  assert.equal(typeof p.updated_at, "string");
});

test("tampered or expired run cannot transition", async () => {
  const expiredAt = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const cases = [
    terminalRunRow("pending", { expires_at: expiredAt }),
    terminalRunRow("pending", { run_signature: "e".repeat(64) }),
  ];

  for (const row of cases) {
    const { client } = mockStageClient({ data: row, error: null });
    await assert.rejects(
      () =>
        updateGoalStrategyRunFinalStatus(
          "run-abc-123",
          "goal-xyz-456",
          "user-001",
          "running",
          client,
        ),
      /Failed to update strategy-run final status\./,
    );
  }
});

test("update database errors remain generic", async () => {
  const row = terminalRunRow("running");
  const client = {
    from: () => ({
      select() {
        return this;
      },
      eq() {
        return this;
      },
      update() {
        return this;
      },
      maybeSingle() {
        return { data: row, error: null };
      },
      single() {
        return { data: null, error: new Error("db down") };
      },
    }),
  } as unknown as SupabaseClient;

  await assert.rejects(
    () =>
      updateGoalStrategyRunFinalStatus(
        "run-abc-123",
        "goal-xyz-456",
        "user-001",
        "succeeded",
        client,
      ),
    /Failed to update strategy-run final status\./,
  );
});

// ---------------------------------------------------------------------------
// deleteGoalStrategyRun tests
// ---------------------------------------------------------------------------

function mockDeleteClient(
  getResult: { data: unknown; error: unknown },
  deleteError: unknown,
): {
  client: SupabaseClient;
  deleteFiltersRef: { current: Array<{ field: string; value: unknown }> };
} {
  const deleteFiltersRef: { current: Array<{ field: string; value: unknown }> } = {
    current: [],
  };

  const client = {
    from: () => {
      const filters: Array<{ field: string; value: unknown }> = [];
      return {
        select() {
          return this;
        },
        delete() {
          return this;
        },
        eq(field: string, value: unknown) {
          filters.push({ field, value });
          return this;
        },
        maybeSingle() {
          return getResult;
        },
        then(resolve: (value: { error: unknown }) => void) {
          deleteFiltersRef.current = filters;
          resolve({ error: deleteError });
        },
      };
    },
  } as unknown as SupabaseClient;

  return { client, deleteFiltersRef };
}

test("delete succeeds only for verified succeeded run", async () => {
  const row = validRunRow({
    flight_status: "failed",
    hotel_status: "failed",
    final_status: "succeeded",
  });
  const { client } = mockDeleteClient({ data: row, error: null }, null);

  await deleteGoalStrategyRun("run-abc-123", "goal-xyz-456", "user-001", client);
});

test("delete rejects pending final status", async () => {
  const row = validRunRow({
    flight_status: "failed",
    hotel_status: "failed",
    final_status: "pending",
  });
  const { client } = mockDeleteClient({ data: row, error: null }, null);

  await assert.rejects(
    () => deleteGoalStrategyRun("run-abc-123", "goal-xyz-456", "user-001", client),
    /Failed to delete strategy run\./,
  );
});

test("delete rejects running final status", async () => {
  const row = validRunRow({
    flight_status: "failed",
    hotel_status: "failed",
    final_status: "running",
  });
  const { client } = mockDeleteClient({ data: row, error: null }, null);

  await assert.rejects(
    () => deleteGoalStrategyRun("run-abc-123", "goal-xyz-456", "user-001", client),
    /Failed to delete strategy run\./,
  );
});

test("delete rejects failed final status", async () => {
  const row = validRunRow({
    flight_status: "failed",
    hotel_status: "failed",
    final_status: "failed",
  });
  const { client } = mockDeleteClient({ data: row, error: null }, null);

  await assert.rejects(
    () => deleteGoalStrategyRun("run-abc-123", "goal-xyz-456", "user-001", client),
    /Failed to delete strategy run\./,
  );
});

test("delete filters id/goal_id/user_id/final_status", async () => {
  const row = validRunRow({
    flight_status: "failed",
    hotel_status: "failed",
    final_status: "succeeded",
  });
  const { client, deleteFiltersRef } = mockDeleteClient({ data: row, error: null }, null);

  await deleteGoalStrategyRun("run-abc-123", "goal-xyz-456", "user-001", client);

  assert.deepEqual(deleteFiltersRef.current, [
    { field: "id", value: "run-abc-123" },
    { field: "goal_id", value: "goal-xyz-456" },
    { field: "user_id", value: "user-001" },
    { field: "final_status", value: "succeeded" },
  ]);
});

test("tampered or expired run cannot delete", async () => {
  const expiredAt = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const cases = [
    validRunRow({
      flight_status: "failed",
      hotel_status: "failed",
      final_status: "succeeded",
      expires_at: expiredAt,
    }),
    validRunRow({
      flight_status: "failed",
      hotel_status: "failed",
      final_status: "succeeded",
      run_signature: "e".repeat(64),
    }),
  ];

  for (const row of cases) {
    const { client } = mockDeleteClient({ data: row, error: null }, null);
    await assert.rejects(
      () => deleteGoalStrategyRun("run-abc-123", "goal-xyz-456", "user-001", client),
      /Failed to delete strategy run\./,
    );
  }
});

test("delete database errors remain generic", async () => {
  const row = validRunRow({
    flight_status: "failed",
    hotel_status: "failed",
    final_status: "succeeded",
  });
  const { client } = mockDeleteClient({ data: row, error: null }, new Error("db down"));

  await assert.rejects(
    () => deleteGoalStrategyRun("run-abc-123", "goal-xyz-456", "user-001", client),
    /Failed to delete strategy run\./,
  );
});
