import assert from "node:assert/strict";
import { test } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { parseCsvStatement } from "@/lib/parser/csvStatementParser";
import {
  createStatementImportDraftPayload,
  serializeImportDraftPayload,
  serializeImportPersistencePayload,
} from "@/lib/imports/payload";
import { signImportDraft, verifyImportDraftSignature } from "@/lib/imports/signing";
import { confirmImportDraft } from "@/lib/imports/workflow";
import type { SavedImportDraft } from "@/lib/imports/types";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const DRAFT_ID = "22222222-2222-4222-8222-222222222222";
const SIGNING_SECRET = "csv-integration-test-only-0123456789abcdef";

test("CSV statement remains a signed draft until explicit approval", async (t) => {
  const originalSecret = process.env.IMPORT_DRAFT_SIGNING_SECRET;
  process.env.IMPORT_DRAFT_SIGNING_SECRET = SIGNING_SECRET;
  t.after(() => {
    if (originalSecret === undefined) {
      delete process.env.IMPORT_DRAFT_SIGNING_SECRET;
    } else {
      process.env.IMPORT_DRAFT_SIGNING_SECRET = originalSecret;
    }
  });

  const transactions = parseCsvStatement(
    Buffer.from(
      "Date,Description,Amount,Currency\n" +
        "08/20/2026,Independent Cafe,-12.50,USD\n"
    )
  );
  const payload = createStatementImportDraftPayload({
    transactions,
    statementDigest: "d".repeat(64),
    storagePath: `${USER_ID}/statement.csv`,
  });
  const serializedPayload = serializeImportDraftPayload(payload);
  const serializedPersistencePayload = serializeImportPersistencePayload(payload);
  const expiresAt = "2099-01-01T00:00:00.000Z";
  const signatureInput = {
    version: 1 as const,
    draftId: DRAFT_ID,
    userId: USER_ID,
    kind: "statement" as const,
    status: "pending" as const,
    expiresAt,
    payload: serializedPayload,
    persistencePayload: serializedPersistencePayload,
    claimToken: null,
    claimExpiresAt: null,
  };
  const payloadSignature = signImportDraft(signatureInput);
  const draft: SavedImportDraft = {
    id: DRAFT_ID,
    userId: USER_ID,
    signatureVersion: 1,
    kind: "statement",
    status: "pending",
    payload,
    serializedPayload,
    serializedPersistencePayload,
    payloadSignature,
    expiresAt,
    createdAt: "2026-08-26T00:00:00.000Z",
    updatedAt: "2026-08-26T00:00:00.000Z",
  };

  let persistenceCalls = 0;
  let persistedCount = 0;
  assert.equal(verifyImportDraftSignature(signatureInput, payloadSignature), true);
  assert.equal(persistenceCalls, 0);

  const result = await confirmImportDraft(
    DRAFT_ID,
    "statement",
    USER_ID,
    {} as SupabaseClient,
    {
      loadDraft: async () => draft,
      persistStatement: async (purchases) => {
        persistenceCalls += 1;
        persistedCount = purchases.length;
        return purchases;
      },
      markConfirmed: async (value) => ({ ...value, status: "confirmed" }),
      markDiscarded: async (value) => ({ ...value, status: "discarded" }),
      now: () => new Date("2026-08-26T12:00:00.000Z").getTime(),
    }
  );

  assert.equal(result.purchaseCount, 1);
  assert.equal(persistenceCalls, 1);
  assert.equal(persistedCount, 1);
});
