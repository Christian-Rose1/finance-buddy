import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  confirmImportDraft,
  discardImportDraft,
  type ImportWorkflowDependencies,
} from "./workflow";
import { ImportDraftError } from "./repository";
import {
  createReceiptImportDraftPayload,
  createStatementImportDraftPayload,
  serializeImportDraftPayload,
} from "./payload";
import type { SavedImportDraft } from "./types";
import type { Purchase } from "@/lib/purchases/types";

const client = {} as SupabaseClient;
const userId = "11111111-1111-4111-8111-111111111111";
const draftId = "22222222-2222-4222-8222-222222222222";
const digest = "b".repeat(64);

function savedDraft(
  overrides: Partial<SavedImportDraft> = {}
): SavedImportDraft {
  const payload = createStatementImportDraftPayload({
    statementDigest: digest,
    storagePath: `${userId}/statement.pdf`,
    transactions: [
      {
        id: "stx-1a",
        date: "2026-08-20",
        merchant: "First Merchant",
        amount: 12,
        currency: null,
        cardId: null,
        category: "Other",
        confidence: 1,
      },
      {
        id: "stx-2b",
        date: "2026-08-21",
        merchant: "Second Merchant",
        amount: 18,
        currency: null,
        cardId: null,
        category: "Dining",
        confidence: 1,
      },
    ],
  });

  return {
    id: draftId,
    userId,
    signatureVersion: 1,
    kind: "statement",
    status: "pending",
    payload,
    serializedPayload: serializeImportDraftPayload(payload),
    payloadSignature: "a".repeat(64),
    expiresAt: "2099-01-01T00:00:00.000Z",
    createdAt: "2026-08-26T00:00:00.000Z",
    updatedAt: "2026-08-26T00:00:00.000Z",
    ...overrides,
  };
}

function dependencies(
  draft: SavedImportDraft,
  overrides: Partial<ImportWorkflowDependencies> = {}
): ImportWorkflowDependencies {
  return {
    loadDraft: async () => draft,
    markConfirmed: async (value) => ({ ...value, status: "confirmed" }),
    markDiscarded: async (value) => ({ ...value, status: "discarded" }),
    persistReceipt: async (purchase) => purchase,
    persistStatement: async (purchases) => purchases,
    now: () => new Date("2026-08-26T12:00:00.000Z").getTime(),
    ...overrides,
  };
}

describe("import draft workflow", () => {
  it("confirms a receipt through the single-purchase persistence path", async () => {
    const payload = createReceiptImportDraftPayload({
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
      sourceId: `sha256:${digest}`,
      storagePath: null,
    });
    const draft = savedDraft({
      kind: "receipt",
      payload,
      serializedPayload: serializeImportDraftPayload(payload),
    });
    let persistedSourceId: string | null = null;

    const result = await confirmImportDraft(
      draftId,
      "receipt",
      userId,
      client,
      dependencies(draft, {
        persistReceipt: async (purchase) => {
          persistedSourceId = purchase.evidence[0].sourceId;
          return purchase;
        },
        persistStatement: async () => {
          throw new Error("statement persistence must not be called");
        },
      })
    );

    assert.equal(result.purchaseCount, 1);
    assert.equal(persistedSourceId, `sha256:${digest}`);
  });

  it("confirms a statement through one complete batch persistence call", async () => {
    const draft = savedDraft();
    let persisted: Purchase[] = [];
    let markedConfirmed = false;

    const result = await confirmImportDraft(
      draftId,
      "statement",
      userId,
      client,
      dependencies(draft, {
        persistStatement: async (purchases) => {
          persisted = purchases;
          return purchases;
        },
        markConfirmed: async (value) => {
          markedConfirmed = true;
          return { ...value, status: "confirmed" };
        },
      })
    );

    assert.equal(result.purchaseCount, 2);
    assert.equal(result.alreadyConfirmed, false);
    assert.equal(markedConfirmed, true);
    assert.deepEqual(
      persisted.map((purchase) => purchase.evidence[0].sourceId),
      [`sha256:${digest}:stx-1a`, `sha256:${digest}:stx-2b`]
    );
  });

  it("does not consume the draft when persistence fails and allows retry", async () => {
    const draft = savedDraft();
    let markedConfirmed = 0;

    await assert.rejects(
      () =>
        confirmImportDraft(
          draftId,
          "statement",
          userId,
          client,
          dependencies(draft, {
            persistStatement: async () => {
              throw new Error("database unavailable");
            },
            markConfirmed: async (value) => {
              markedConfirmed += 1;
              return { ...value, status: "confirmed" };
            },
          })
        ),
      (error: unknown) =>
        error instanceof ImportDraftError && error.code === "save_failed"
    );
    assert.equal(markedConfirmed, 0);

    const retry = await confirmImportDraft(
      draftId,
      "statement",
      userId,
      client,
      dependencies(draft, {
        markConfirmed: async (value) => {
          markedConfirmed += 1;
          return { ...value, status: "confirmed" };
        },
      })
    );
    assert.equal(retry.purchaseCount, 2);
    assert.equal(markedConfirmed, 1);
  });

  it("treats repeated confirmation as success without persisting again", async () => {
    const draft = savedDraft({ status: "confirmed" });
    let persistenceCalls = 0;

    const result = await confirmImportDraft(
      draftId,
      "statement",
      userId,
      client,
      dependencies(draft, {
        persistStatement: async () => {
          persistenceCalls += 1;
          return [];
        },
      })
    );

    assert.equal(result.alreadyConfirmed, true);
    assert.equal(result.purchaseCount, 2);
    assert.equal(persistenceCalls, 0);
  });

  it("rejects an expired pending draft before persistence", async () => {
    const draft = savedDraft({ expiresAt: "2026-08-26T11:00:00.000Z" });
    let persistenceCalls = 0;

    await assert.rejects(
      () =>
        confirmImportDraft(
          draftId,
          "statement",
          userId,
          client,
          dependencies(draft, {
            persistStatement: async (purchases) => {
              persistenceCalls += 1;
              return purchases;
            },
          })
        ),
      (error: unknown) =>
        error instanceof ImportDraftError && error.code === "expired"
    );
    assert.equal(persistenceCalls, 0);
  });

  it("discards a pending receipt without persisting it", async () => {
    const payload = createReceiptImportDraftPayload({
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
      sourceId: `sha256:${digest}`,
      storagePath: null,
    });
    const draft = savedDraft({
      kind: "receipt",
      payload,
      serializedPayload: serializeImportDraftPayload(payload),
    });
    let discarded = false;

    const result = await discardImportDraft(
      draftId,
      "receipt",
      userId,
      client,
      dependencies(draft, {
        markDiscarded: async (value) => {
          discarded = true;
          return { ...value, status: "discarded" };
        },
      })
    );

    assert.equal(result.alreadyDiscarded, false);
    assert.equal(discarded, true);
  });

  it("never persists purchases after a concurrent discard succeeds", async () => {
    const draft = savedDraft();
    let status: SavedImportDraft["status"] = "pending";
    let persistedPurchases = 0;
    let releasePersistence!: () => void;
    let reportPersistenceStarted!: () => void;
    const persistenceGate = new Promise<void>((resolve) => {
      releasePersistence = resolve;
    });
    const persistenceStarted = new Promise<void>((resolve) => {
      reportPersistenceStarted = resolve;
    });
    const sharedDependencies = dependencies(draft, {
      loadDraft: async () => ({ ...draft, status }),
      persistStatement: async (purchases) => {
        reportPersistenceStarted();
        await persistenceGate;
        persistedPurchases += purchases.length;
        return purchases;
      },
      markConfirmed: async (value) => {
        if (status !== "pending") {
          throw new Error("draft is no longer pending");
        }
        status = "confirmed";
        return { ...value, status };
      },
      markDiscarded: async (value) => {
        if (status !== "pending") {
          throw new Error("draft is no longer pending");
        }
        status = "discarded";
        return { ...value, status };
      },
    });

    const confirmationOutcome = confirmImportDraft(
      draftId,
      "statement",
      userId,
      client,
      sharedDependencies
    ).then(
      () => "fulfilled" as const,
      () => "rejected" as const
    );
    await persistenceStarted;

    let discardSucceeded = false;
    try {
      await discardImportDraft(
        draftId,
        "statement",
        userId,
        client,
        sharedDependencies
      );
      discardSucceeded = true;
    } finally {
      releasePersistence();
    }
    await confirmationOutcome;

    assert.equal(
      discardSucceeded && persistedPurchases > 0,
      false,
      "a successful discard must not race with purchase persistence"
    );
  });
});
