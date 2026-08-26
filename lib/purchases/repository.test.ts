import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { persistPurchases, stableEvidenceUuid, toPurchasePersistenceEnvelope } from "./repository";
import type { Purchase } from "./types";

function purchase(id: string, sourceId: string): Purchase {
  return {
    id,
    merchant: "Example Merchant",
    date: "2026-08-01",
    amount: 42.5,
    currency: "USD",
    category: "Dining",
    source: "statement",
    sourceConfidence: 1,
    cardId: null,
    items: [],
    discount: null,
    tax: null,
    tip: null,
    fees: null,
    evidence: [
      {
        id: `${id}-evidence`,
        type: "statement",
        sourceId,
        sourceName: "Example Merchant",
        confidence: 1,
        verified: false,
        metadata: null,
      },
    ],
    metadata: null,
    provenance: {
      merchant: {
        field: "merchant",
        origin: "evidence",
        evidenceIds: [`${id}-evidence`],
        confidence: 1,
        verificationStatus: "unverified",
        method: "statement-parser",
      },
    },
  };
}

function persistedRow(id: string): Record<string, unknown> {
  return {
    id,
    merchant: "Example Merchant",
    date: "2026-08-01",
    amount: 42.5,
    currency: "USD",
    category: "Dining",
    source: "statement",
    source_confidence: 1,
    card_id: null,
    discount: null,
    tax: null,
    tip: null,
    fees: null,
    provenance: {},
    metadata: null,
  };
}

describe("persistPurchases", () => {
  it("keeps the new RPC contract UUID-backed for evidence IDs", () => {
    const migration = readFileSync(
      "supabase/migrations/20260826160000_close_import_lifecycle_and_source_conflicts.sql",
      "utf8"
    );
    assert.match(migration, /insert into public\.purchase_evidence \(\s*id, purchase_id,/);
    assert.match(migration, /as r\(\s*id uuid, type text,/);
  });

  it("serializes evidence IDs as UUIDs and rewrites provenance to the same IDs", () => {
    const envelope = toPurchasePersistenceEnvelope(purchase("input-1", "source-1"));
    const evidence = envelope.evidence[0] as { id: string };
    const provenance = envelope.purchase.provenance as Record<string, { evidenceIds: string[] }>;

    assert.match(evidence.id, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    assert.deepEqual(provenance.merchant.evidenceIds, [evidence.id]);
    assert.equal(stableEvidenceUuid("input-1-evidence"), evidence.id);
  });

  it("sends one batch RPC with stable source keys and rehydrates children", async () => {
    const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
    const client = {
      async rpc(name: string, args: Record<string, unknown>) {
        rpcCalls.push({ name, args });
        return {
          data: [persistedRow("db-1"), persistedRow("db-2")],
          error: null,
        };
      },
      from() {
        return {
          select() {
            return this;
          },
          async in() {
            return { data: [], error: null };
          },
        };
      },
    } as unknown as SupabaseClient;

    const result = await persistPurchases(
      [purchase("input-1", "source-1"), purchase("input-2", "source-2")],
      "user-1",
      client
    );

    assert.equal(result.length, 2);
    assert.equal(rpcCalls.length, 1);
    assert.equal(rpcCalls[0].name, "persist_purchases");
    assert.equal(rpcCalls[0].args.p_user_id, "user-1");

    const payload = rpcCalls[0].args.p_purchases as Array<{
      purchase: Record<string, unknown>;
    }>;
    assert.equal(payload[0].purchase.source_key, "source-1");
    assert.equal(payload[1].purchase.source_key, "source-2");
  });

  it("does not call the database for an empty batch", async () => {
    let called = false;
    const client = {
      async rpc() {
        called = true;
        return { data: [], error: null };
      },
    } as unknown as SupabaseClient;

    assert.deepEqual(await persistPurchases([], "user-1", client), []);
    assert.equal(called, false);
  });

  it("rejects partial or malformed batch results", async () => {
    const client = {
      async rpc() {
        return { data: [persistedRow("db-1")], error: null };
      },
    } as unknown as SupabaseClient;

    await assert.rejects(
      () =>
        persistPurchases(
          [purchase("input-1", "source-1"), purchase("input-2", "source-2")],
          "user-1",
          client
        ),
      /Failed to persist purchases\./
    );
  });
});
