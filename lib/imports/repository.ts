import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServerClient } from "@/lib/supabase-server";
import {
  parseImportDraftPayload,
  serializeImportDraftPayload,
  serializeImportPersistencePayload,
  validateImportDraftPayload,
} from "./payload";
import { signImportDraft, verifyImportDraftSignature } from "./signing";
import type {
  ImportDraftKind,
  ImportDraftPayload,
  ImportDraftStatus,
  SavedImportDraft,
} from "./types";

const SELECT_COLUMNS =
  "id, user_id, signature_version, kind, status, payload, persistence_payload, payload_signature, claim_token, claim_expires_at, expires_at, created_at, updated_at";
const STATUSES = [
  "pending",
  "confirming",
  "failed",
  "confirmed",
  "discarded",
] as const;
const KINDS = ["receipt", "statement"] as const;
const DRAFT_TTL_MS = 60 * 60 * 1000;
const CLAIM_TTL_MS = 2 * 60 * 1000;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type ImportDraftErrorCode =
  | "not_found"
  | "invalid"
  | "expired"
  | "discarded"
  | "already_confirmed"
  | "in_progress"
  | "save_failed";

export class ImportDraftError extends Error {
  constructor(
    public readonly code: ImportDraftErrorCode,
    message: string
  ) {
    super(message);
    this.name = "ImportDraftError";
  }
}

function normalizedDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

function isDraftRow(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const row = value as Record<string, unknown>;
  return (
    typeof row.id === "string" &&
    UUID.test(row.id) &&
    typeof row.user_id === "string" &&
    row.signature_version === 1 &&
    typeof row.kind === "string" &&
    KINDS.includes(row.kind as ImportDraftKind) &&
    typeof row.status === "string" &&
    STATUSES.includes(row.status as ImportDraftStatus) &&
    typeof row.payload === "string" &&
    typeof row.persistence_payload === "string" &&
    typeof row.payload_signature === "string" &&
    (row.claim_token === null ||
      (typeof row.claim_token === "string" && UUID.test(row.claim_token))) &&
    (row.claim_expires_at === null ||
      normalizedDate(row.claim_expires_at) !== null) &&
    (row.status === "confirming"
      ? typeof row.claim_token === "string" &&
        normalizedDate(row.claim_expires_at) !== null
      : row.claim_token === null && row.claim_expires_at === null) &&
    normalizedDate(row.expires_at) !== null &&
    normalizedDate(row.created_at) !== null &&
    normalizedDate(row.updated_at) !== null
  );
}

function verifiedDraft(
  row: Record<string, unknown>,
  expected: { id: string; userId: string; kind: ImportDraftKind }
): SavedImportDraft {
  const expiresAt = normalizedDate(row.expires_at);
  const createdAt = normalizedDate(row.created_at);
  const updatedAt = normalizedDate(row.updated_at);
  if (!expiresAt || !createdAt || !updatedAt) {
    throw new ImportDraftError("invalid", "Import draft is invalid.");
  }

  const id = row.id as string;
  const userId = row.user_id as string;
  const kind = row.kind as ImportDraftKind;
  const status = row.status as ImportDraftStatus;
  const serializedPayload = row.payload as string;
  const serializedPersistencePayload = row.persistence_payload as string;
  const payloadSignature = row.payload_signature as string;
  const claimToken = (row.claim_token as string | null) ?? null;
  const claimExpiresAt = normalizedDate(row.claim_expires_at);

  if (id !== expected.id || userId !== expected.userId || kind !== expected.kind) {
    throw new ImportDraftError("not_found", "Import draft was not found.");
  }

  if (
    !verifyImportDraftSignature(
      {
        version: 1,
        draftId: id,
        userId,
        kind,
        status,
        expiresAt,
        payload: serializedPayload,
        persistencePayload: serializedPersistencePayload,
        claimToken,
        claimExpiresAt,
      },
      payloadSignature
    )
  ) {
    throw new ImportDraftError("invalid", "Import draft is invalid.");
  }

  let payload: ImportDraftPayload;
  try {
    payload = parseImportDraftPayload(kind, serializedPayload, userId);
  } catch {
    throw new ImportDraftError("invalid", "Import draft is invalid.");
  }
  if (serializeImportPersistencePayload(payload) !== serializedPersistencePayload) {
    throw new ImportDraftError("invalid", "Import draft is invalid.");
  }

  return {
    id,
    userId,
    signatureVersion: 1,
    kind,
    status,
    payload,
    serializedPayload,
    serializedPersistencePayload,
    payloadSignature,
    claimToken,
    claimExpiresAt,
    expiresAt,
    createdAt,
    updatedAt,
  };
}

export async function createImportDraft(
  payload: ImportDraftPayload,
  userId: string,
  client?: SupabaseClient
): Promise<SavedImportDraft> {
  let validatedPayload: ImportDraftPayload;
  try {
    validatedPayload = validateImportDraftPayload(payload.kind, payload, userId);
  } catch {
    throw new ImportDraftError("invalid", "Import draft could not be created.");
  }

  const id = randomUUID();
  const expiresAt = new Date(Date.now() + DRAFT_TTL_MS).toISOString();
  const serializedPayload = serializeImportDraftPayload(validatedPayload);
  const serializedPersistencePayload =
    serializeImportPersistencePayload(validatedPayload);
  const status: ImportDraftStatus = "pending";
  const payloadSignature = signImportDraft({
    version: 1,
    draftId: id,
    userId,
    kind: validatedPayload.kind,
    status,
    expiresAt,
    payload: serializedPayload,
    persistencePayload: serializedPersistencePayload,
    claimToken: null,
    claimExpiresAt: null,
  });

  const supabase = client ?? (await createServerClient());
  const { data: row, error } = await supabase
    .from("import_drafts")
    .insert({
      id,
      user_id: userId,
      signature_version: 1,
      kind: validatedPayload.kind,
      status,
      payload: serializedPayload,
      persistence_payload: serializedPersistencePayload,
      payload_signature: payloadSignature,
      claim_token: null,
      claim_expires_at: null,
      expires_at: expiresAt,
    })
    .select(SELECT_COLUMNS)
    .single();

  if (error || !isDraftRow(row)) {
    throw new ImportDraftError("save_failed", "Import draft could not be created.");
  }

  return verifiedDraft(row, { id, userId, kind: validatedPayload.kind });
}

export async function getImportDraft(
  id: string,
  userId: string,
  kind: ImportDraftKind,
  client?: SupabaseClient
): Promise<SavedImportDraft | null> {
  if (!UUID.test(id) || !userId) {
    throw new ImportDraftError("not_found", "Import draft was not found.");
  }

  const supabase = client ?? (await createServerClient());
  const { data: row, error } = await supabase
    .from("import_drafts")
    .select(SELECT_COLUMNS)
    .eq("id", id)
    .eq("user_id", userId)
    .eq("kind", kind)
    .maybeSingle();

  if (error) {
    throw new ImportDraftError("save_failed", "Import draft could not be loaded.");
  }
  if (!row) return null;
  if (!isDraftRow(row)) {
    throw new ImportDraftError("invalid", "Import draft is invalid.");
  }
  return verifiedDraft(row, { id, userId, kind });
}

async function transitionImportDraft(
  draft: SavedImportDraft,
  target: ImportDraftStatus,
  claim: { token: string; expiresAt: string } | null,
  client?: SupabaseClient,
  retryStaleClaim = true
): Promise<SavedImportDraft> {
  if (!draft.serializedPersistencePayload) {
    throw new ImportDraftError("invalid", "Import draft is invalid.");
  }

  const claimToken = claim?.token ?? null;
  const claimExpiresAt = claim?.expiresAt ?? null;
  const payloadSignature = signImportDraft({
    version: 1,
    draftId: draft.id,
    userId: draft.userId,
    kind: draft.kind,
    status: target,
    expiresAt: draft.expiresAt,
    payload: draft.serializedPayload,
    persistencePayload: draft.serializedPersistencePayload,
    claimToken,
    claimExpiresAt,
  });

  const supabase = client ?? (await createServerClient());
  const { data: row, error } = await supabase
    .from("import_drafts")
    .update({
      status: target,
      payload_signature: payloadSignature,
      claim_token: claimToken,
      claim_expires_at: claimExpiresAt,
    })
    .eq("id", draft.id)
    .eq("user_id", draft.userId)
    .eq("kind", draft.kind)
    .eq("status", draft.status)
    .eq("payload_signature", draft.payloadSignature)
    .select(SELECT_COLUMNS)
    .maybeSingle();

  if (!error && row && isDraftRow(row)) {
    const saved = verifiedDraft(row, {
      id: draft.id,
      userId: draft.userId,
      kind: draft.kind,
    });
    if (
      target === "confirming" &&
      claimToken !== null &&
      saved.claimToken !== claimToken
    ) {
      throw new ImportDraftError(
        "in_progress",
        "Import confirmation is already in progress."
      );
    }
    return saved;
  }

  // A racing retry may already have completed the same transition.
  const current = await getImportDraft(
    draft.id,
    draft.userId,
    draft.kind,
    supabase
  );
  if (current?.status === target) {
    if (
      target !== "confirming" ||
      claimToken === null ||
      current.claimToken === claimToken
    ) {
      return current;
    }

    const currentClaimExpiresAt = current.claimExpiresAt
      ? new Date(current.claimExpiresAt).getTime()
      : Number.NaN;
    if (currentClaimExpiresAt > Date.now()) {
      throw new ImportDraftError(
        "in_progress",
        "Import confirmation is already in progress."
      );
    }
    if (retryStaleClaim) {
      return transitionImportDraft(current, target, claim, supabase, false);
    }
  }
  if (current?.status === "confirming") {
    throw new ImportDraftError(
      "in_progress",
      "Import confirmation is already in progress."
    );
  }
  if (current?.status === "discarded") {
    throw new ImportDraftError("discarded", "Import draft was discarded.");
  }
  if (current?.status === "confirmed") {
    throw new ImportDraftError(
      "already_confirmed",
      "Approved purchases have already been saved."
    );
  }
  throw new ImportDraftError("save_failed", "Import draft could not be updated.");
}

export async function markImportDraftConfirmed(
  draft: SavedImportDraft,
  client?: SupabaseClient
): Promise<SavedImportDraft> {
  if (draft.status !== "confirming") {
    throw new ImportDraftError("invalid", "Import draft cannot be confirmed.");
  }
  return transitionImportDraft(draft, "confirmed", null, client);
}

export async function markImportDraftDiscarded(
  draft: SavedImportDraft,
  client?: SupabaseClient
): Promise<SavedImportDraft> {
  if (draft.status !== "pending" && draft.status !== "failed") {
    throw new ImportDraftError("in_progress", "Import confirmation is in progress.");
  }
  return transitionImportDraft(draft, "discarded", null, client);
}

export async function claimImportDraft(
  draft: SavedImportDraft,
  client?: SupabaseClient
): Promise<SavedImportDraft> {
  if (draft.status === "confirming") {
    const claimExpiresAt = draft.claimExpiresAt
      ? new Date(draft.claimExpiresAt).getTime()
      : Number.NaN;
    if (claimExpiresAt > Date.now()) {
      throw new ImportDraftError(
        "in_progress",
        "Import confirmation is already in progress."
      );
    }
  } else if (draft.status !== "pending" && draft.status !== "failed") {
    throw new ImportDraftError("invalid", "Import draft cannot be claimed.");
  }

  const claim = {
    token: randomUUID(),
    expiresAt: new Date(Date.now() + CLAIM_TTL_MS).toISOString(),
  };
  return transitionImportDraft(draft, "confirming", claim, client);
}

export async function markImportDraftFailed(
  draft: SavedImportDraft,
  client?: SupabaseClient
): Promise<SavedImportDraft> {
  if (draft.status !== "confirming") {
    throw new ImportDraftError("invalid", "Import draft cannot be retried.");
  }
  return transitionImportDraft(draft, "failed", null, client);
}

export async function persistClaimedImportDraft(
  draft: SavedImportDraft,
  client?: SupabaseClient
): Promise<SavedImportDraft> {
  if (
    draft.status !== "confirming" ||
    !draft.claimToken ||
    !draft.serializedPersistencePayload
  ) {
    throw new ImportDraftError("invalid", "Import draft is not claimed.");
  }

  const expectedCount =
    draft.payload.kind === "receipt" ? 1 : draft.payload.transactions.length;
  const supabase = client ?? (await createServerClient());
  const { data, error } = await supabase.rpc("confirm_import_draft", {
    p_draft_id: draft.id,
    p_claim_token: draft.claimToken,
    p_payload_signature: draft.payloadSignature,
  });

  if (error || !Array.isArray(data) || data.length !== expectedCount) {
    throw new ImportDraftError(
      "save_failed",
      "Failed to save approved purchases. Please retry."
    );
  }

  const confirmed = await getImportDraft(
    draft.id,
    draft.userId,
    draft.kind,
    supabase
  );
  if (!confirmed || confirmed.status !== "confirmed") {
    throw new ImportDraftError(
      "save_failed",
      "Failed to finish the import. Please retry."
    );
  }
  return confirmed;
}
