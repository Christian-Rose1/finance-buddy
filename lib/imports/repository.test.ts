import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { claimImportDraft, getImportDraft, ImportDraftError } from "./repository";
import {
  createReceiptImportDraftPayload,
  serializeImportDraftPayload,
  serializeImportPersistencePayload,
} from "./payload";
import { signImportDraft } from "./signing";

const secret = "repository-test-secret-that-is-at-least-32-characters";
const id = "11111111-1111-4111-8111-111111111111";
const userId = "22222222-2222-4222-8222-222222222222";
const expiresAt = "2099-01-01T00:00:00.000Z";
let originalSecret: string | undefined;

before(() => {
  originalSecret = process.env.IMPORT_DRAFT_SIGNING_SECRET;
  process.env.IMPORT_DRAFT_SIGNING_SECRET = secret;
});

after(() => {
  if (originalSecret === undefined) {
    delete process.env.IMPORT_DRAFT_SIGNING_SECRET;
  } else {
    process.env.IMPORT_DRAFT_SIGNING_SECRET = originalSecret;
  }
});

function validRow() {
  const draftPayload = createReceiptImportDraftPayload({
    receipt: {
      merchant: "Example Market",
      transaction_date: "2026-08-26",
      currency: "USD",
      items: [],
      subtotal: 10,
      tax: 1,
      tip: null,
      discount: null,
      total: 11,
      confidence: 1,
      source: "ollama",
    },
    sourceId: `sha256:${"c".repeat(64)}`,
    storagePath: `${userId}/receipt.png`,
  });
  const payload = serializeImportDraftPayload(draftPayload);
  const persistencePayload = serializeImportPersistencePayload(draftPayload);

  return {
    id,
    user_id: userId,
    signature_version: 1,
    kind: "receipt",
    status: "pending",
    payload,
    persistence_payload: persistencePayload,
    payload_signature: signImportDraft({
      version: 1,
      draftId: id,
      userId,
      kind: "receipt",
      status: "pending",
      expiresAt,
      payload,
      persistencePayload,
      claimToken: null,
      claimExpiresAt: null,
    }),
    claim_token: null,
    claim_expires_at: null,
    expires_at: expiresAt,
    created_at: "2026-08-26T00:00:00.000Z",
    updated_at: "2026-08-26T00:00:00.000Z",
  };
}

function readClient(row: Record<string, unknown>) {
  const filters: Array<[string, unknown]> = [];
  const query = {
    select() {
      return this;
    },
    eq(column: string, value: unknown) {
      filters.push([column, value]);
      return this;
    },
    async maybeSingle() {
      return { data: row, error: null };
    },
  };
  const client = {
    from(table: string) {
      assert.equal(table, "import_drafts");
      return query;
    },
  } as unknown as SupabaseClient;
  return { client, filters };
}

function competingClaimClient(row: Record<string, unknown>): SupabaseClient {
  let call = 0;
  return {
    from(table: string) {
      assert.equal(table, "import_drafts");
      call += 1;
      if (call === 1) {
        const updateQuery = {
          update() {
            return this;
          },
          eq() {
            return this;
          },
          select() {
            return this;
          },
          async maybeSingle() {
            return { data: null, error: null };
          },
        };
        return updateQuery;
      }

      return {
        select() {
          return this;
        },
        eq() {
          return this;
        },
        async maybeSingle() {
          return { data: row, error: null };
        },
      };
    },
  } as unknown as SupabaseClient;
}

describe("import draft repository", () => {
  it("loads by id, authenticated owner, and import kind", async () => {
    const { client, filters } = readClient(validRow());
    const draft = await getImportDraft(id, userId, "receipt", client);

    assert.equal(draft?.id, id);
    assert.deepEqual(filters, [
      ["id", id],
      ["user_id", userId],
      ["kind", "receipt"],
    ]);
  });

  it("rejects a stored payload changed without a new server signature", async () => {
    const row = validRow();
    row.payload = row.payload.replace("Example Market", "Forged Market");
    const { client } = readClient(row);

    await assert.rejects(
      () => getImportDraft(id, userId, "receipt", client),
      (error: unknown) =>
        error instanceof ImportDraftError && error.code === "invalid"
    );
  });

  it("rejects a changed canonical persistence payload", async () => {
    const row = validRow();
    row.persistence_payload = String(row.persistence_payload).replace(
      "Example Market",
      "Forged Market"
    );
    const { client } = readClient(row);

    await assert.rejects(
      () => getImportDraft(id, userId, "receipt", client),
      (error: unknown) =>
        error instanceof ImportDraftError && error.code === "invalid"
    );
  });

  it("rejects a row whose owner differs from the authenticated owner", async () => {
    const row = validRow();
    row.user_id = "33333333-3333-4333-8333-333333333333";
    const { client } = readClient(row);

    await assert.rejects(
      () => getImportDraft(id, userId, "receipt", client),
      (error: unknown) =>
        error instanceof ImportDraftError && error.code === "not_found"
    );
  });

  it("does not adopt another claimant's active token after losing the CAS", async () => {
    const pending = await getImportDraft(
      id,
      userId,
      "receipt",
      readClient(validRow()).client
    );
    assert.ok(pending);

    const competingToken = "33333333-3333-4333-8333-333333333333";
    const competingExpiry = "2098-12-31T23:59:00.000Z";
    const row: Record<string, unknown> = validRow();
    row.status = "confirming";
    row.claim_token = competingToken;
    row.claim_expires_at = competingExpiry;
    row.payload_signature = signImportDraft({
      version: 1,
      draftId: id,
      userId,
      kind: "receipt",
      status: "confirming",
      expiresAt,
      payload: String(row.payload),
      persistencePayload: String(row.persistence_payload),
      claimToken: competingToken,
      claimExpiresAt: competingExpiry,
    });

    await assert.rejects(
      () => claimImportDraft(pending, competingClaimClient(row)),
      (error: unknown) =>
        error instanceof ImportDraftError && error.code === "in_progress"
    );
  });
});
