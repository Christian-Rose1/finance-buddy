/**
 * Strategy-run persistence repository.
 *
 * Stores temporary signed server-generated research-stage payloads for
 * staged strategy runs (flight, hotel). Each run is signed with an HMAC
 * that application code verifies before finalization.
 *
 * Ordinary operations use the cookie-aware server Supabase client and RLS.
 * The five deadline-fence RPCs use a narrowly scoped server-only executor
 * after the action has derived `userId` from the authenticated session.
 */

import { createServerClient } from "@/lib/supabase-server";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  signStrategyRunPayload,
  verifyStrategyRunPayload,
  serializeStrategyRunPayload,
  parseStrategyRunPayload,
} from "./strategyRunSigning";
import type { StrategyStageFenceRpcExecutor } from "./strategyStageFenceRpcExecutor";
import type { PersonalizedStrategy } from "./strategyTypes";

/** Current signature version. */
const CURRENT_SIGNATURE_VERSION = 1;

/** Supported status values for staged runs. */
const SUPPORTED_STATUSES = ["pending", "running", "succeeded", "failed"] as const;
interface VerifiedRunningResearchStageContext {
  runId: string;
  goalId: string;
  userId: string;
  attemptId: string;
  gatewayView: VerifiedRunningResearchStageInspection;
}
const runningStageCapabilities = new WeakMap<object, VerifiedRunningResearchStageContext>();
interface RecoverableResearchStageStartContext {
  runId: string;
  goalId: string;
  userId: string;
  stage: StrategyResearchStage;
  recoveryToken: string;
}
const recoverableStageStarts = new WeakMap<object, RecoverableResearchStageStartContext>();
interface VerifiedFinalizationAttemptContext {
  runId: string;
  goalId: string;
  userId: string;
  attemptId: string;
}
interface RecoverableFinalizationStartContext {
  runId: string;
  goalId: string;
  userId: string;
  recoveryToken: string;
}
const finalizationAttempts = new WeakMap<object, VerifiedFinalizationAttemptContext>();
const recoverableFinalizationStarts = new WeakMap<object, RecoverableFinalizationStartContext>();

export type StrategyRunStatus = "pending" | "running" | "succeeded" | "failed";
export type StrategyResearchStage = "flight" | "hotel";
export type StrategyRunFinalStatus = "running" | "succeeded" | "failed";

export interface SavedGoalStrategyRun {
  id: string;
  goalId: string;
  userId: string;
  signatureVersion: 1;
  expiresAt: string;
  runSignature: string;
  flightStatus: StrategyRunStatus;
  flightPayload: string | null;
  flightSignature: string | null;
  hotelStatus: StrategyRunStatus;
  hotelPayload: string | null;
  hotelSignature: string | null;
  finalStatus: StrategyRunStatus;
  createdAt: string;
  updatedAt: string;
}

/** Opaque proof of an owned, verified, successfully started research stage. */
export interface VerifiedRunningResearchStage { readonly _verifiedRunningStage?: never }
/** Opaque recovery authority minted before the database stage-start request. */
export interface RecoverableResearchStageStart { readonly _recoverableResearchStageStart?: never }
/** Opaque server-held authority for one database-owned finalization attempt. */
export interface VerifiedFinalizationAttempt { readonly _verifiedFinalizationAttempt?: never }
/** Opaque recovery authority minted before the finalization-start request. */
export interface RecoverableFinalizationStart { readonly _recoverableFinalizationStart?: never }

/** Safe classification used only for an authoritative database-clock expiry. */
export class StrategyRunStageSaveDeadlineError extends Error {
  constructor() {
    super("Strategy-run stage deadline reached.");
    this.name = "StrategyRunStageSaveDeadlineError";
  }
}

export class StrategyRunFinalizationDeadlineError extends Error {
  constructor() {
    super("Strategy-run finalization deadline reached.");
    this.name = "StrategyRunFinalizationDeadlineError";
  }
}

export interface VerifiedRunningResearchStageInspection {
  stage: StrategyResearchStage;
  expiresAt: string;
  revision: string;
}

function immutableSavedRun(run: SavedGoalStrategyRun): SavedGoalStrategyRun {
  return Object.freeze(run);
}

/** Runtime inspection succeeds only for a repository-minted capability. */
export function inspectVerifiedRunningResearchStage(
  capability: VerifiedRunningResearchStage,
): Readonly<VerifiedRunningResearchStageInspection> | null {
  if (!capability || typeof capability !== "object") return null;
  return runningStageCapabilities.get(capability as object)?.gatewayView ?? null;
}

const SELECT_COLUMNS =
  "id, goal_id, user_id, signature_version, expires_at, run_signature, flight_status, flight_payload, flight_signature, hotel_status, hotel_payload, hotel_signature, final_status, created_at, updated_at";

/** Maps a goal_strategy_runs row (snake_case) to a SavedGoalStrategyRun (camelCase). */
function toSavedGoalStrategyRun(row: Record<string, unknown>): SavedGoalStrategyRun {
  return {
    id: row.id as string,
    goalId: row.goal_id as string,
    userId: row.user_id as string,
    signatureVersion: row.signature_version as 1,
    expiresAt: row.expires_at as string,
    runSignature: row.run_signature as string,
    flightStatus: row.flight_status as StrategyRunStatus,
    flightPayload: (row.flight_payload as string) ?? null,
    flightSignature: (row.flight_signature as string) ?? null,
    hotelStatus: row.hotel_status as StrategyRunStatus,
    hotelPayload: (row.hotel_payload as string) ?? null,
    hotelSignature: (row.hotel_signature as string) ?? null,
    finalStatus: row.final_status as StrategyRunStatus,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

/**
 * Validates the persisted shape of a loaded goal_strategy_runs row.
 *
 * Returns true when the row is a non-array object, the signature version is
 * the current version, all status values are supported, and payload/signature
 * pairing is consistent.
 */
function isValidRunRow(row: unknown): row is Record<string, unknown> {
  if (typeof row !== "object" || row === null || Array.isArray(row)) {
    return false;
  }

  const r = row as Record<string, unknown>;

  if (r.signature_version !== CURRENT_SIGNATURE_VERSION) {
    return false;
  }

  if (
    typeof r.id !== "string" ||
    typeof r.goal_id !== "string" ||
    typeof r.user_id !== "string" ||
    typeof r.expires_at !== "string" ||
    typeof r.run_signature !== "string" ||
    typeof r.created_at !== "string" ||
    typeof r.updated_at !== "string"
  ) {
    return false;
  }

  const statuses = [r.flight_status, r.hotel_status, r.final_status];
  for (const s of statuses) {
    if (typeof s !== "string" || !SUPPORTED_STATUSES.includes(s as StrategyRunStatus)) {
      return false;
    }
  }

  // Validate flight payload/signature pairing
  if (r.flight_status === "succeeded") {
    if (typeof r.flight_payload !== "string" || typeof r.flight_signature !== "string") {
      return false;
    }
  } else {
    if (r.flight_payload !== null || r.flight_signature !== null) {
      return false;
    }
  }

  // Validate hotel payload/signature pairing
  if (r.hotel_status === "succeeded") {
    if (typeof r.hotel_payload !== "string" || typeof r.hotel_signature !== "string") {
      return false;
    }
  } else {
    if (r.hotel_payload !== null || r.hotel_signature !== null) {
      return false;
    }
  }

  return true;
}

/**
 * Verify the HMAC signature for a succeeded stage.
 */
function verifyStageSignature(
  saved: SavedGoalStrategyRun,
  stage: StrategyResearchStage,
): boolean {
  const status = stage === "flight" ? saved.flightStatus : saved.hotelStatus;
  if (status !== "succeeded") {
    return true;
  }

  const payload = stage === "flight" ? saved.flightPayload : saved.hotelPayload;
  const signature = stage === "flight" ? saved.flightSignature : saved.hotelSignature;

  if (payload === null || signature === null) {
    return false;
  }

  const normalizedExpiresAt = new Date(saved.expiresAt).toISOString();

  return verifyStrategyRunPayload(
    {
      version: 1,
      runId: saved.id,
      goalId: saved.goalId,
      userId: saved.userId,
      expiresAt: normalizedExpiresAt,
      stage,
      payload,
    },
    signature,
  );
}

/**
 * Verifies the run signature and expiration, and optionally the stage HMACs.
 */
function verifyRunIntegrity(saved: SavedGoalStrategyRun, verifyStages: boolean): void {
  const expiresAtTimestamp = Date.parse(saved.expiresAt);
  if (!Number.isFinite(expiresAtTimestamp)) {
    throw new Error("Failed to load strategy run.");
  }
  const normalizedExpiresAt = new Date(expiresAtTimestamp).toISOString();

  const runVerified = verifyStrategyRunPayload(
    {
      version: 1,
      runId: saved.id,
      goalId: saved.goalId,
      userId: saved.userId,
      expiresAt: normalizedExpiresAt,
      stage: "run",
      payload: "",
    },
    saved.runSignature,
  );

  if (!runVerified) {
    throw new Error("Failed to load strategy run.");
  }

  if (verifyStages) {
    if (!verifyStageSignature(saved, "flight")) {
      throw new Error("Failed to load strategy run.");
    }
    if (!verifyStageSignature(saved, "hotel")) {
      throw new Error("Failed to load strategy run.");
    }
  }

  if (new Date(normalizedExpiresAt).getTime() <= Date.now()) {
    throw new Error("Failed to load strategy run.");
  }
}

/**
 * Internal loader for a goal_strategy_runs row. Validates shape, ownership,
 * run signature, expiration, and optionally stage HMACs.
 */
async function loadRunInternal(
  runId: string,
  goalId: string,
  userId: string,
  client: SupabaseClient | undefined,
  verifyStages: boolean,
): Promise<SavedGoalStrategyRun | null> {
  if (!runId || !goalId || !userId) {
    throw new Error("Failed to load strategy run.");
  }

  const supabase = client ?? (await createServerClient());

  const { data: row, error } = await supabase
    .from("goal_strategy_runs")
    .select(SELECT_COLUMNS)
    .eq("id", runId)
    .eq("goal_id", goalId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    throw new Error("Failed to load strategy run.");
  }

  if (!row) {
    return null;
  }

  if (!isValidRunRow(row)) {
    throw new Error("Failed to load strategy run.");
  }

  const saved = toSavedGoalStrategyRun(row);

  if (saved.id !== runId || saved.goalId !== goalId || saved.userId !== userId) {
    throw new Error("Failed to load strategy run.");
  }

  verifyRunIntegrity(saved, verifyStages);

  return immutableSavedRun(saved);
}

/**
 * Create a new signed strategy run for a goal belonging to an authenticated user.
 */
export async function createGoalStrategyRun(
  goalId: string,
  userId: string,
  client?: SupabaseClient,
): Promise<SavedGoalStrategyRun> {
  if (!goalId || !userId) {
    throw new Error("Failed to create strategy run.");
  }

  const supabase = client ?? (await createServerClient());

  const runId = crypto.randomUUID();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();

  const runSignature = signStrategyRunPayload({
    version: 1,
    runId,
    goalId,
    userId,
    expiresAt,
    stage: "run",
    payload: "",
  });

  const payload = {
    id: runId,
    goal_id: goalId,
    user_id: userId,
    signature_version: CURRENT_SIGNATURE_VERSION,
    expires_at: expiresAt,
    run_signature: runSignature,
    flight_status: "pending",
    hotel_status: "pending",
    final_status: "pending",
    updated_at: now.toISOString(),
  };

  const { data: row, error } = await supabase
    .from("goal_strategy_runs")
    .insert(payload)
    .select(SELECT_COLUMNS)
    .single();

  if (error || !row) {
    throw new Error("Failed to create strategy run.");
  }

  if (!isValidRunRow(row)) {
    throw new Error("Failed to create strategy run.");
  }

  const saved = toSavedGoalStrategyRun(row);

  if (saved.id !== runId || saved.goalId !== goalId || saved.userId !== userId) {
    throw new Error("Failed to create strategy run.");
  }

  if (saved.signatureVersion !== CURRENT_SIGNATURE_VERSION) {
    throw new Error("Failed to create strategy run.");
  }

  if (new Date(saved.expiresAt).toISOString() !== expiresAt) {
    throw new Error("Failed to create strategy run.");
  }

  if (
    saved.flightStatus !== "pending" ||
    saved.hotelStatus !== "pending" ||
    saved.finalStatus !== "pending"
  ) {
    throw new Error("Failed to create strategy run.");
  }

  if (
    saved.flightPayload !== null ||
    saved.flightSignature !== null ||
    saved.hotelPayload !== null ||
    saved.hotelSignature !== null
  ) {
    throw new Error("Failed to create strategy run.");
  }

  const verified = verifyStrategyRunPayload(
    {
      version: 1,
      runId: saved.id,
      goalId: saved.goalId,
      userId: saved.userId,
      expiresAt: new Date(saved.expiresAt).toISOString(),
      stage: "run",
      payload: "",
    },
    saved.runSignature,
  );

  if (!verified) {
    throw new Error("Failed to create strategy run.");
  }

  return immutableSavedRun(saved);
}

/**
 * Load a strategy run by id, goalId, and userId. Fully verifies the run
 * signature, stage HMACs, and expiration.
 */
export async function getGoalStrategyRun(
  runId: string,
  goalId: string,
  userId: string,
  client?: SupabaseClient,
): Promise<SavedGoalStrategyRun | null> {
  return loadRunInternal(runId, goalId, userId, client, true);
}

// ---------------------------------------------------------------------------
// Stage operations
// ---------------------------------------------------------------------------

interface StartedStageRpcRow {
  attempt_id: string;
  deadline_at: string;
  revision: string;
}

function getRunningStageContext(
  capability: VerifiedRunningResearchStage,
  expectedStage?: StrategyResearchStage,
): VerifiedRunningResearchStageContext {
  if (!capability || typeof capability !== "object") {
    throw new Error("Failed to update strategy-run stage.");
  }
  const context = runningStageCapabilities.get(capability as object);
  if (!context || (expectedStage !== undefined && context.gatewayView.stage !== expectedStage)) {
    throw new Error("Failed to update strategy-run stage.");
  }
  return context;
}

/**
 * Start a stage by setting its status to "running" and clearing payload/signature.
 */
export async function startGoalStrategyRunStage(
  runId: string,
  goalId: string,
  userId: string,
  stage: StrategyResearchStage,
  client: SupabaseClient,
  fenceExecutor: StrategyStageFenceRpcExecutor,
  signal?: AbortSignal,
  onRecoveryReady?: (recovery: RecoverableResearchStageStart) => void,
): Promise<VerifiedRunningResearchStage> {
  if (stage !== "flight" && stage !== "hotel") {
    throw new Error("Failed to update strategy-run stage.");
  }

  let existing: SavedGoalStrategyRun;
  try {
    const loaded = await getGoalStrategyRun(runId, goalId, userId, client);
    if (!loaded) {
      throw new Error("Failed to update strategy-run stage.");
    }
    existing = loaded;
  } catch {
    throw new Error("Failed to update strategy-run stage.");
  }

  const stageOrderValid = stage === "flight"
    ? (existing.flightStatus === "pending" || existing.flightStatus === "failed") && existing.hotelStatus === "pending"
    : (existing.flightStatus === "succeeded" || existing.flightStatus === "failed") &&
      (existing.hotelStatus === "pending" || existing.hotelStatus === "failed");
  if (!stageOrderValid) {
    throw new Error("Failed to update strategy-run stage.");
  }

  if (signal?.aborted) throw new Error("Failed to update strategy-run stage.");
  const recoveryToken = crypto.randomUUID();
  const recoveryCapability = Object.freeze({}) as RecoverableResearchStageStart;
  recoverableStageStarts.set(recoveryCapability as object, Object.freeze({
    runId,
    goalId,
    userId,
    stage,
    recoveryToken,
  }));
  onRecoveryReady?.(recoveryCapability);
  try {
    const { data: prepareOutcome, error: prepareError } = await fenceExecutor.execute(
      "prepare_goal_strategy_run_research_stage_start",
      {
      p_user_id: userId,
      p_run_id: runId,
      p_goal_id: goalId,
      p_stage: stage,
      p_start_recovery_token: recoveryToken,
      },
      signal,
    );
    if (prepareError || prepareOutcome !== "prepared") {
      throw new Error("Failed to update strategy-run stage.");
    }
  } catch {
    throw new Error("Failed to update strategy-run stage.");
  }
  if (signal?.aborted) throw new Error("Failed to update strategy-run stage.");
  let data: unknown;
  let error: unknown;
  try {
    ({ data, error } = await fenceExecutor.execute("start_goal_strategy_run_research_stage", {
      p_user_id: userId,
      p_run_id: runId,
      p_goal_id: goalId,
      p_stage: stage,
      p_start_recovery_token: recoveryToken,
    }, signal));
  } catch {
    throw new Error("Failed to update strategy-run stage.");
  }
  const row = Array.isArray(data) && data.length === 1 ? data[0] : null;
  if (error || !row || typeof row !== "object") {
    throw new Error("Failed to update strategy-run stage.");
  }
  const started = row as Partial<StartedStageRpcRow>;
  if (
    typeof started.attempt_id !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(started.attempt_id) ||
    typeof started.deadline_at !== "string" ||
    typeof started.revision !== "string"
  ) {
    throw new Error("Failed to update strategy-run stage.");
  }
  const deadlineTimestamp = Date.parse(started.deadline_at);
  const revisionTimestamp = Date.parse(started.revision);
  if (
    !Number.isFinite(deadlineTimestamp) ||
    !Number.isFinite(revisionTimestamp) ||
    deadlineTimestamp <= revisionTimestamp ||
    deadlineTimestamp > Date.parse(existing.expiresAt)
  ) {
    throw new Error("Failed to update strategy-run stage.");
  }

  const gatewayView = Object.freeze({
    stage,
    expiresAt: started.deadline_at,
    revision: started.revision,
  });
  const context = Object.freeze({
    runId,
    goalId,
    userId,
    attemptId: started.attempt_id,
    gatewayView,
  });
  const capability = Object.freeze({}) as VerifiedRunningResearchStage;
  runningStageCapabilities.set(capability as object, context);
  return capability;
}

/**
 * Recover a stage-start request whose response was lost to cancellation.
 * The database updates only the exact owned running stage carrying this
 * server-held recovery token.
 */
export async function recoverGoalStrategyRunStageStart(
  recovery: RecoverableResearchStageStart,
  fenceExecutor: StrategyStageFenceRpcExecutor,
  signal?: AbortSignal,
): Promise<"failed" | "succeeded"> {
  if (signal?.aborted || !recovery || typeof recovery !== "object") {
    throw new Error("Failed to recover strategy-run stage start.");
  }
  const context = recoverableStageStarts.get(recovery as object);
  if (!context) throw new Error("Failed to recover strategy-run stage start.");
  try {
    const { data: outcome, error } = await fenceExecutor.execute(
      "recover_goal_strategy_run_research_stage_start",
      {
      p_user_id: context.userId,
      p_run_id: context.runId,
      p_goal_id: context.goalId,
      p_stage: context.stage,
      p_start_recovery_token: context.recoveryToken,
      },
      signal,
    );
    if (!error && (outcome === "failed" || outcome === "succeeded")) return outcome;
  } catch {
    // Collapse transport/runtime details into the repository's fixed failure.
  }
  throw new Error("Failed to recover strategy-run stage start.");
}

/**
 * Save a serialized and signed payload for a stage. The stage must currently
 * be "running".
 */
export async function saveGoalStrategyRunStage(
  capability: VerifiedRunningResearchStage,
  value: unknown,
  client: SupabaseClient,
  fenceExecutor: StrategyStageFenceRpcExecutor,
  signal?: AbortSignal,
): Promise<SavedGoalStrategyRun> {
  if (signal?.aborted) throw new Error("Failed to save strategy-run stage.");
  let context: VerifiedRunningResearchStageContext;
  try {
    context = getRunningStageContext(capability);
  } catch {
    throw new Error("Failed to save strategy-run stage.");
  }
  const { runId, goalId, userId, attemptId } = context;
  const stage = context.gatewayView.stage;
  let existing: SavedGoalStrategyRun;
  try {
    const loaded = await getGoalStrategyRun(runId, goalId, userId, client);
    if (!loaded) {
      throw new Error("Failed to save strategy-run stage.");
    }
    existing = loaded;
  } catch {
    throw new Error("Failed to save strategy-run stage.");
  }
  if (signal?.aborted) throw new Error("Failed to save strategy-run stage.");

  const serialized = serializeStrategyRunPayload(value);
  const normalizedExpiresAt = new Date(existing.expiresAt).toISOString();

  const signature = signStrategyRunPayload({
    version: 1,
    runId,
    goalId,
    userId,
    expiresAt: normalizedExpiresAt,
    stage,
    payload: serialized,
  });

  const { data: outcome, error } = await fenceExecutor.execute("save_goal_strategy_run_research_stage", {
    p_user_id: userId,
    p_run_id: runId,
    p_goal_id: goalId,
    p_stage: stage,
    p_attempt_id: attemptId,
    p_payload: serialized,
    p_signature: signature,
  }, signal);
  if (!error && outcome === "deadline_expired") {
    throw new StrategyRunStageSaveDeadlineError();
  }
  if (error || outcome !== "succeeded") {
    throw new Error("Failed to save strategy-run stage.");
  }
  const saved = await getGoalStrategyRun(runId, goalId, userId, client);
  if (!saved || (stage === "flight" ? saved.flightStatus : saved.hotelStatus) !== "succeeded") {
    throw new Error("Failed to save strategy-run stage.");
  }

  return immutableSavedRun(saved);
}

/**
 * Mark a stage as failed, clearing payload/signature.
 */
export async function failGoalStrategyRunStage(
  capability: VerifiedRunningResearchStage,
  client: SupabaseClient,
  fenceExecutor: StrategyStageFenceRpcExecutor,
  signal?: AbortSignal,
): Promise<"failed" | "succeeded"> {
  if (signal?.aborted) throw new Error("Failed to update strategy-run stage.");
  let context: VerifiedRunningResearchStageContext;
  try {
    context = getRunningStageContext(capability);
  } catch {
    throw new Error("Failed to update strategy-run stage.");
  }
  if (signal?.aborted) throw new Error("Failed to update strategy-run stage.");

  const { data: outcome, error } = await fenceExecutor.execute("fail_goal_strategy_run_research_stage", {
    p_user_id: context.userId,
    p_run_id: context.runId,
    p_goal_id: context.goalId,
    p_stage: context.gatewayView.stage,
    p_attempt_id: context.attemptId,
  }, signal);
  if (error || (outcome !== "failed" && outcome !== "succeeded")) {
    throw new Error("Failed to update strategy-run stage.");
  }
  return outcome;
}

/**
 * Load and verify a succeeded stage payload. Returns the parsed payload, or
 * null if the stage is not succeeded.
 */
export async function loadVerifiedGoalStrategyRunStage(
  runId: string,
  goalId: string,
  userId: string,
  stage: StrategyResearchStage,
  client?: SupabaseClient,
): Promise<unknown | null> {
  let saved: SavedGoalStrategyRun;
  try {
    const loaded = await loadRunInternal(runId, goalId, userId, client, false);
    if (!loaded) {
      throw new Error("Failed to load strategy-run stage.");
    }
    saved = loaded;
  } catch {
    throw new Error("Failed to load strategy-run stage.");
  }

  const status = stage === "flight" ? saved.flightStatus : saved.hotelStatus;
  if (status !== "succeeded") {
    return null;
  }

  const payload = stage === "flight" ? saved.flightPayload : saved.hotelPayload;
  const signature = stage === "flight" ? saved.flightSignature : saved.hotelSignature;

  if (payload === null || signature === null) {
    throw new Error("Failed to load strategy-run stage.");
  }

  const normalizedExpiresAt = new Date(saved.expiresAt).toISOString();

  const verified = verifyStrategyRunPayload(
    {
      version: 1,
      runId: saved.id,
      goalId: saved.goalId,
      userId: saved.userId,
      expiresAt: normalizedExpiresAt,
      stage,
      payload,
    },
    signature,
  );

  if (!verified) {
    throw new Error("Failed to load strategy-run stage.");
  }

  return parseStrategyRunPayload(payload);
}

// ---------------------------------------------------------------------------
// Finalization and deletion
// ---------------------------------------------------------------------------

/** Delete an owned saved strategy through the database-authoritative fence. */
export async function deleteOwnedGoalStrategy(
  goalId: string,
  userId: string,
  fenceExecutor: StrategyStageFenceRpcExecutor,
): Promise<void> {
  if (!goalId || !userId) throw new Error("Failed to delete saved strategy.");
  try {
    const result = await fenceExecutor.execute("delete_owned_goal_strategy", {
      p_user_id: userId,
      p_goal_id: goalId,
    });
    if (!result.error && result.data === "deleted") return;
  } catch {}
  throw new Error("Failed to delete saved strategy.");
}

interface StartedFinalizationRpcRow {
  attempt_id: string;
  deadline_at: string;
  revision: string;
}

/**
 * Atomically enter finalization through a database-owned attempt/deadline.
 * The recovery capability is registered before either start RPC is awaited so
 * a lost response can never strand a newly committed running status.
 */
export async function startGoalStrategyRunFinalization(
  runId: string,
  goalId: string,
  userId: string,
  client: SupabaseClient,
  fenceExecutor: StrategyStageFenceRpcExecutor,
  signal?: AbortSignal,
  onRecoveryReady?: (recovery: RecoverableFinalizationStart) => void,
): Promise<VerifiedFinalizationAttempt> {
  let existing: SavedGoalStrategyRun;
  try {
    const loaded = await getGoalStrategyRun(runId, goalId, userId, client);
    if (!loaded) throw new Error("unavailable");
    existing = loaded;
  } catch {
    throw new Error("Failed to start strategy-run finalization.");
  }
  const terminal = (status: StrategyRunStatus) => status === "succeeded" || status === "failed";
  if (!terminal(existing.flightStatus) || !terminal(existing.hotelStatus) ||
      (existing.finalStatus !== "pending" && existing.finalStatus !== "failed") || signal?.aborted) {
    throw new Error("Failed to start strategy-run finalization.");
  }

  const recoveryToken = crypto.randomUUID();
  const recovery = Object.freeze({}) as RecoverableFinalizationStart;
  recoverableFinalizationStarts.set(recovery as object, Object.freeze({ runId, goalId, userId, recoveryToken }));
  onRecoveryReady?.(recovery);

  try {
    const prepared = await fenceExecutor.execute("prepare_goal_strategy_run_finalization_start", {
      p_user_id: userId, p_run_id: runId, p_goal_id: goalId,
      p_start_recovery_token: recoveryToken,
    }, signal);
    if (prepared.error || prepared.data !== "prepared" || signal?.aborted) throw new Error("rejected");

    const startedResult = await fenceExecutor.execute("start_goal_strategy_run_finalization", {
      p_user_id: userId, p_run_id: runId, p_goal_id: goalId,
      p_start_recovery_token: recoveryToken,
    }, signal);
    const row = Array.isArray(startedResult.data) && startedResult.data.length === 1
      ? startedResult.data[0] : null;
    if (startedResult.error || !row || typeof row !== "object") throw new Error("rejected");
    const started = row as Partial<StartedFinalizationRpcRow>;
    if (typeof started.attempt_id !== "string" ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(started.attempt_id) ||
        typeof started.deadline_at !== "string" || typeof started.revision !== "string") {
      throw new Error("malformed");
    }
    const deadline = Date.parse(started.deadline_at);
    const revision = Date.parse(started.revision);
    if (!Number.isFinite(deadline) || !Number.isFinite(revision) || deadline <= revision ||
        deadline > Date.parse(existing.expiresAt)) throw new Error("malformed");

    const capability = Object.freeze({}) as VerifiedFinalizationAttempt;
    finalizationAttempts.set(capability as object, Object.freeze({
      runId, goalId, userId, attemptId: started.attempt_id,
    }));
    return capability;
  } catch {
    throw new Error("Failed to start strategy-run finalization.");
  }
}

export async function recoverGoalStrategyRunFinalizationStart(
  recovery: RecoverableFinalizationStart,
  fenceExecutor: StrategyStageFenceRpcExecutor,
  signal?: AbortSignal,
): Promise<"failed" | "succeeded"> {
  if (signal?.aborted || !recovery || typeof recovery !== "object") {
    throw new Error("Failed to recover strategy-run finalization start.");
  }
  const context = recoverableFinalizationStarts.get(recovery as object);
  if (!context) throw new Error("Failed to recover strategy-run finalization start.");
  try {
    const result = await fenceExecutor.execute("recover_goal_strategy_run_finalization_start", {
      p_user_id: context.userId, p_run_id: context.runId, p_goal_id: context.goalId,
      p_start_recovery_token: context.recoveryToken,
    }, signal);
    if (!result.error && (result.data === "failed" || result.data === "succeeded")) return result.data;
  } catch {}
  throw new Error("Failed to recover strategy-run finalization start.");
}

export interface CommittedFinalizedStrategy {
  strategy: PersonalizedStrategy;
  generatedAt: string;
}

/** Atomically persist the strategy and commit this exact live final attempt. */
export async function commitGoalStrategyRunFinalization(
  capability: VerifiedFinalizationAttempt,
  strategy: PersonalizedStrategy,
  generatedAt: string,
  fenceExecutor: StrategyStageFenceRpcExecutor,
  signal?: AbortSignal,
): Promise<CommittedFinalizedStrategy> {
  if (signal?.aborted || !capability || typeof capability !== "object") {
    throw new Error("Failed to commit strategy-run finalization.");
  }
  const context = finalizationAttempts.get(capability as object);
  if (!context) throw new Error("Failed to commit strategy-run finalization.");
  const result = await fenceExecutor.execute("commit_goal_strategy_run_finalization", {
    p_user_id: context.userId, p_run_id: context.runId, p_goal_id: context.goalId,
    p_attempt_id: context.attemptId, p_strategy_json: strategy,
    p_schema_version: 1, p_generated_at: generatedAt,
  }, signal);
  const row = Array.isArray(result.data) && result.data.length === 1 ? result.data[0] : null;
  const outcome = row && typeof row === "object" ? (row as Record<string, unknown>).outcome : null;
  if (!result.error && outcome === "deadline_expired") throw new StrategyRunFinalizationDeadlineError();
  if (result.error || outcome !== "succeeded") throw new Error("Failed to commit strategy-run finalization.");
  const persistedAt = (row as Record<string, unknown>).generated_at;
  const persistedStrategy = (row as Record<string, unknown>).strategy_json;
  if (typeof persistedAt !== "string" || !Number.isFinite(Date.parse(persistedAt)) ||
      typeof persistedStrategy !== "object" || persistedStrategy === null || Array.isArray(persistedStrategy)) {
    throw new Error("Failed to commit strategy-run finalization.");
  }
  return { strategy, generatedAt: new Date(persistedAt).toISOString() };
}

/** Fail only the exact current finalization attempt. A committed success wins. */
export async function failGoalStrategyRunFinalization(
  capability: VerifiedFinalizationAttempt,
  fenceExecutor: StrategyStageFenceRpcExecutor,
  signal?: AbortSignal,
): Promise<"failed" | "succeeded"> {
  if (signal?.aborted || !capability || typeof capability !== "object") {
    throw new Error("Failed to fail strategy-run finalization.");
  }
  const context = finalizationAttempts.get(capability as object);
  if (!context) throw new Error("Failed to fail strategy-run finalization.");
  const result = await fenceExecutor.execute("fail_goal_strategy_run_finalization", {
    p_user_id: context.userId, p_run_id: context.runId, p_goal_id: context.goalId,
    p_attempt_id: context.attemptId,
  }, signal);
  if (result.error || (result.data !== "failed" && result.data !== "succeeded")) {
    throw new Error("Failed to fail strategy-run finalization.");
  }
  return result.data;
}

/**
 * Transition a fully verified run's final status.
 *
 * Preconditions:
 * - The owned, unexpired, signed run must exist (full stage HMAC verification).
 * - Both flightStatus and hotelStatus must be terminal (succeeded or failed).
 *
 * Allowed transitions (current finalStatus → target):
 * - pending → running
 * - failed  → running (retry)
 * - running → succeeded
 * - running → failed
 *
 * Any other transition is rejected generically. Only final_status and
 * updated_at are written, and the update filters on the exact current
 * final_status to prevent stale/racing transitions.
 */
export async function updateGoalStrategyRunFinalStatus(
  runId: string,
  goalId: string,
  userId: string,
  status: StrategyRunFinalStatus,
  client?: SupabaseClient,
): Promise<SavedGoalStrategyRun> {
  const supabase = client ?? (await createServerClient());

  let existing: SavedGoalStrategyRun;
  try {
    const loaded = await getGoalStrategyRun(runId, goalId, userId, supabase);
    if (!loaded) {
      throw new Error("Failed to update strategy-run final status.");
    }
    existing = loaded;
  } catch {
    throw new Error("Failed to update strategy-run final status.");
  }

  const flightTerminal =
    existing.flightStatus === "succeeded" || existing.flightStatus === "failed";
  const hotelTerminal =
    existing.hotelStatus === "succeeded" || existing.hotelStatus === "failed";
  if (!flightTerminal || !hotelTerminal) {
    throw new Error("Failed to update strategy-run final status.");
  }

  const current = existing.finalStatus;

  const allowed =
    (status === "running" && (current === "pending" || current === "failed")) ||
    (status === "succeeded" && current === "running") ||
    (status === "failed" && current === "running");

  if (!allowed) {
    throw new Error("Failed to update strategy-run final status.");
  }

  const now = new Date().toISOString();

  const { data: row, error } = await supabase
    .from("goal_strategy_runs")
    .update({ final_status: status, updated_at: now })
    .eq("id", runId)
    .eq("goal_id", goalId)
    .eq("user_id", userId)
    .eq("final_status", current)
    .select(SELECT_COLUMNS)
    .single();

  if (error || !row) {
    throw new Error("Failed to update strategy-run final status.");
  }

  if (!isValidRunRow(row)) {
    throw new Error("Failed to update strategy-run final status.");
  }

  const saved = toSavedGoalStrategyRun(row);

  if (saved.id !== runId || saved.goalId !== goalId || saved.userId !== userId) {
    throw new Error("Failed to update strategy-run final status.");
  }

  verifyRunIntegrity(saved, true);

  return immutableSavedRun(saved);
}

/**
 * Delete a fully verified, succeeded strategy run.
 *
 * Preconditions:
 * - The owned, unexpired, signed run must exist (full stage HMAC verification).
 * - finalStatus must be "succeeded".
 */
export async function deleteGoalStrategyRun(
  runId: string,
  goalId: string,
  userId: string,
  client?: SupabaseClient,
): Promise<void> {
  const supabase = client ?? (await createServerClient());

  let existing: SavedGoalStrategyRun;
  try {
    const loaded = await getGoalStrategyRun(runId, goalId, userId, supabase);
    if (!loaded) {
      throw new Error("Failed to delete strategy run.");
    }
    existing = loaded;
  } catch {
    throw new Error("Failed to delete strategy run.");
  }

  if (existing.finalStatus !== "succeeded") {
    throw new Error("Failed to delete strategy run.");
  }

  const { error } = await supabase
    .from("goal_strategy_runs")
    .delete()
    .eq("id", runId)
    .eq("goal_id", goalId)
    .eq("user_id", userId)
    .eq("final_status", "succeeded");

  if (error) {
    throw new Error("Failed to delete strategy run.");
  }
}
