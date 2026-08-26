import assert from "node:assert/strict";
import { test } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  createImportDraft,
  getImportDraft,
  ImportDraftError,
} from "@/lib/imports/repository";
import {
  createReceiptImportDraftPayload,
  createStatementImportDraftPayload,
  purchasesFromImportDraft,
} from "@/lib/imports/payload";
import { signImportDraft } from "@/lib/imports/signing";
import { confirmImportDraft } from "@/lib/imports/workflow";
import { summarizeSpending } from "@/lib/purchases/spendingSummary";

const SYNTHETIC_SIGNING_SECRET =
  "integration-tests-only-0123456789abcdef";
const USER_ID = "11111111-1111-4111-8111-111111111111";
const STATEMENT_DIGEST = "a".repeat(64);

type Row = Record<string, unknown>;
type Filter = { field: string; value: unknown };

class PurchaseFlowDatabase {
  readonly client = {
    from: (table: string) => this.from(table),
    rpc: (name: string, args: Record<string, unknown>) => this.rpc(name, args),
  } as unknown as SupabaseClient;

  readonly drafts = new Map<string, Row>();
  readonly rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
  private readonly purchases = new Map<string, Row>();
  private readonly items: Row[] = [];
  private readonly evidence: Row[] = [];
  private loseConfirmationResponse = false;

  loseNextConfirmationResponse(): void {
    this.loseConfirmationResponse = true;
  }

  get persistedPurchaseCount(): number {
    return this.purchases.size;
  }

  get persistedEvidenceCount(): number {
    return this.evidence.length;
  }

  get persistedEvidenceMetadata(): unknown[] {
    return this.evidence.map((row) => row.metadata);
  }

  tamperDraftPersistencePayload(draftId: string): void {
    const row = this.drafts.get(draftId);
    assert.ok(row);
    row.persistence_payload = `${String(row.persistence_payload)} `;
  }

  private matches(row: Row, filters: Filter[]): boolean {
    return filters.every(({ field, value }) => row[field] === value);
  }

  private from(table: string) {
    if (table === "purchase_items" || table === "purchase_evidence") {
      const rows = table === "purchase_items" ? this.items : this.evidence;
      return {
        select() {
          return this;
        },
        in(field: string, values: unknown[]) {
          return {
            data: rows.filter((row) => values.includes(row[field])),
            error: null,
          };
        },
      };
    }

    assert.equal(table, "import_drafts");
    const filters: Filter[] = [];
    let inserted: Row | null = null;
    let updates: Row | null = null;

    const finish = (single: boolean) => {
      if (inserted) {
        const now = "2026-08-26T12:00:00.000Z";
        const row: Row = {
          ...(inserted as Row),
          created_at: now,
          updated_at: now,
        };
        this.drafts.set(row.id as string, row);
        return { data: row, error: null };
      }

      const row = [...this.drafts.values()].find((candidate) =>
        this.matches(candidate, filters)
      );
      if (!row) {
        return {
          data: null,
          error: single ? { message: "No matching row." } : null,
        };
      }

      if (updates) {
        Object.assign(row, updates, {
          updated_at: "2026-08-26T12:01:00.000Z",
        });
      }
      return { data: row, error: null };
    };

    const builder = {
      insert: (payload: Row) => {
        inserted = payload;
        return builder;
      },
      update: (payload: Row) => {
        updates = payload;
        return builder;
      },
      select: () => builder,
      eq: (field: string, value: unknown) => {
        filters.push({ field, value });
        return builder;
      },
      single: () => finish(true),
      maybeSingle: () => finish(false),
    };
    return builder;
  }

  private async rpc(name: string, args: Record<string, unknown>) {
    assert.equal(name, "confirm_import_draft");
    this.rpcCalls.push({ name, args });

    const draft = this.drafts.get(String(args.p_draft_id));
    assert.ok(draft);
    assert.equal(draft.status, "confirming");
    assert.equal(args.p_claim_token, draft.claim_token);
    assert.equal(args.p_payload_signature, draft.payload_signature);

    const userId = String(draft.user_id);
    const envelopes = JSON.parse(String(draft.persistence_payload)) as Array<{
      purchase: Row;
      items: Row[];
      evidence: Row[];
    }>;
    const parentRows = envelopes.map((envelope) => {
      const sourceKey = String(envelope.purchase.source_key);
      const idempotencyKey = `${userId}:${sourceKey}`;
      const existing = this.purchases.get(idempotencyKey);
      const purchaseId =
        (existing?.id as string | undefined) ??
        `persisted-purchase-${this.purchases.size + 1}`;
      const parent = {
        ...existing,
        id: purchaseId,
        user_id: userId,
        ...envelope.purchase,
      };
      this.purchases.set(idempotencyKey, parent);

      for (let index = this.items.length - 1; index >= 0; index -= 1) {
        if (this.items[index].purchase_id === purchaseId) {
          this.items.splice(index, 1);
        }
      }
      for (let index = this.evidence.length - 1; index >= 0; index -= 1) {
        if (this.evidence[index].purchase_id === purchaseId) {
          this.evidence.splice(index, 1);
        }
      }
      for (const [itemIndex, item] of envelope.items.entries()) {
        this.items.push({
          id: `${purchaseId}-item-${itemIndex + 1}`,
          purchase_id: purchaseId,
          ...item,
        });
      }
      for (const [evidenceIndex, item] of envelope.evidence.entries()) {
        this.evidence.push({
          id: `${purchaseId}-evidence-${evidenceIndex + 1}`,
          purchase_id: purchaseId,
          ...item,
        });
      }
      return parent;
    });

    draft.status = "confirmed";
    draft.claim_token = null;
    draft.claim_expires_at = null;
    draft.updated_at = "2026-08-26T12:02:00.000Z";
    draft.payload_signature = signImportDraft({
      version: 1,
      draftId: String(draft.id),
      userId,
      kind: draft.kind as "receipt" | "statement",
      status: "confirmed",
      expiresAt: String(draft.expires_at),
      payload: String(draft.payload),
      persistencePayload: String(draft.persistence_payload),
      claimToken: null,
      claimExpiresAt: null,
    });

    if (this.loseConfirmationResponse) {
      this.loseConfirmationResponse = false;
      return { data: null, error: { message: "Response was lost." } };
    }
    return { data: parentRows, error: null };
  }
}

test("receipt extraction remains a signed draft until explicit approval", async (t) => {
  const originalSecret = process.env.IMPORT_DRAFT_SIGNING_SECRET;
  process.env.IMPORT_DRAFT_SIGNING_SECRET = SYNTHETIC_SIGNING_SECRET;
  t.after(() => {
    if (originalSecret === undefined) {
      delete process.env.IMPORT_DRAFT_SIGNING_SECRET;
    } else {
      process.env.IMPORT_DRAFT_SIGNING_SECRET = originalSecret;
    }
  });

  const database = new PurchaseFlowDatabase();
  const payload = createReceiptImportDraftPayload({
    receipt: {
      merchant: "Corner Market",
      transaction_date: "2026-08-25",
      currency: "USD",
      items: [],
      subtotal: 4.5,
      tax: 0,
      tip: null,
      discount: null,
      total: 4.5,
      confidence: 0.95,
      source: "ollama",
    },
    sourceId: `sha256:${STATEMENT_DIGEST}`,
    storagePath: `${USER_ID}/receipt.pdf`,
  });

  const draft = await createImportDraft(payload, USER_ID, database.client);

  assert.equal(draft.status, "pending");
  assert.equal(database.persistedPurchaseCount, 0);
  assert.equal(database.persistedEvidenceCount, 0);
  assert.equal(database.rpcCalls.length, 0);

  const confirmation = await confirmImportDraft(
    draft.id,
    "receipt",
    USER_ID,
    database.client
  );

  assert.equal(confirmation.purchaseCount, 1);
  assert.equal(database.persistedPurchaseCount, 1);
  assert.equal(database.persistedEvidenceCount, 1);
  assert.equal(database.rpcCalls.length, 1);
});

test("signed statement retry commits one idempotent repository envelope", async (t) => {
  const originalSecret = process.env.IMPORT_DRAFT_SIGNING_SECRET;
  process.env.IMPORT_DRAFT_SIGNING_SECRET = SYNTHETIC_SIGNING_SECRET;
  t.after(() => {
    if (originalSecret === undefined) {
      delete process.env.IMPORT_DRAFT_SIGNING_SECRET;
    } else {
      process.env.IMPORT_DRAFT_SIGNING_SECRET = originalSecret;
    }
  });

  const database = new PurchaseFlowDatabase();
  const payload = createStatementImportDraftPayload({
    statementDigest: STATEMENT_DIGEST,
    storagePath: `${USER_ID}/statement.pdf`,
    transactions: [
      {
        id: "stx-a1",
        date: "2026-08-20",
        merchant: "Neighborhood Cafe",
        amount: 25,
        currency: "USD",
        cardId: null,
        category: "food:dining",
        confidence: 0.98,
      },
      {
        id: "stx-b2",
        date: "2026-08-21",
        merchant: "Rail Tickets",
        amount: 100,
        currency: "USD",
        cardId: null,
        category: "travel",
        confidence: 0.97,
      },
    ],
  });

  const draft = await createImportDraft(payload, USER_ID, database.client);
  assert.equal(
    await getImportDraft(draft.id, "another-user", "statement", database.client),
    null
  );

  database.loseNextConfirmationResponse();
  await assert.rejects(
    () => confirmImportDraft(draft.id, "statement", USER_ID, database.client),
    (error: unknown) =>
      error instanceof ImportDraftError && error.code === "save_failed"
  );
  assert.equal(database.rpcCalls.length, 1);
  assert.equal(database.persistedPurchaseCount, 2);
  assert.equal(database.persistedEvidenceCount, 2);

  const confirmation = await confirmImportDraft(
    draft.id,
    "statement",
    USER_ID,
    database.client
  );

  assert.deepEqual(confirmation, {
    draftId: draft.id,
    purchaseCount: 2,
    alreadyConfirmed: true,
  });
  assert.equal(database.rpcCalls.length, 1);
  assert.deepEqual(Object.keys(database.rpcCalls[0].args).sort(), [
    "p_claim_token",
    "p_draft_id",
    "p_payload_signature",
  ]);
  assert.equal(database.rpcCalls[0].args.p_draft_id, draft.id);
  assert.equal(database.persistedPurchaseCount, 2);
  assert.equal(database.persistedEvidenceCount, 2);

  const rpcPurchases = JSON.parse(
    draft.serializedPersistencePayload ?? ""
  ) as Array<{
    purchase: Row;
  }>;
  assert.deepEqual(
    rpcPurchases.map((entry) => entry.purchase.source_key),
    [
      `sha256:${STATEMENT_DIGEST}:stx-a1`,
      `sha256:${STATEMENT_DIGEST}:stx-b2`,
    ]
  );
  assert.equal(
    rpcPurchases.some((entry) => "user_id" in entry.purchase),
    false
  );
  assert.deepEqual(
    database.persistedEvidenceMetadata,
    [
      { bucket: "statements", path: `${USER_ID}/statement.pdf` },
      { bucket: "statements", path: `${USER_ID}/statement.pdf` },
    ]
  );
  assert.deepEqual(summarizeSpending(purchasesFromImportDraft(payload)), {
    status: "single_currency",
    currency: "USD",
    total: 125,
    categoryTotals: [
      { category: "travel", total: 100 },
      { category: "food:dining", total: 25 },
    ],
  });

  const repeated = await confirmImportDraft(
    draft.id,
    "statement",
    USER_ID,
    database.client
  );
  assert.equal(repeated.alreadyConfirmed, true);
  assert.equal(database.rpcCalls.length, 1);
  assert.equal(
    (await getImportDraft(draft.id, USER_ID, "statement", database.client))
      ?.status,
    "confirmed"
  );

  database.tamperDraftPersistencePayload(draft.id);
  await assert.rejects(
    () => getImportDraft(draft.id, USER_ID, "statement", database.client),
    (error: unknown) =>
      error instanceof ImportDraftError && error.code === "invalid"
  );
});
