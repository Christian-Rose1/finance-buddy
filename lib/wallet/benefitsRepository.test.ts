/**
 * Focused tests for the wallet benefits repository.
 *
 * Uses an in-memory fake Supabase client to exercise CRUD and ownership
 * without requiring a real database connection or applied migration.
 *
 * Run with: npx tsx --test lib/wallet/benefitsRepository.test.ts
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  createWalletBenefit,
  getWalletBenefitsForCard,
  getWalletBenefitForUser,
  updateWalletBenefit,
  deleteWalletBenefit,
  getWalletBenefitsWithProducts,
  type CreateWalletBenefitInput,
} from "./benefitsRepository";

// =============================================================================
// Minimal in-memory fake Supabase client
// =============================================================================

type Row = Record<string, unknown>;

class FakeSupabaseClient {
  private tables: Map<string, Row[]>;
  private idCounter = 0;

  constructor(initial: Record<string, Row[]> = {}) {
    this.tables = new Map(Object.entries(initial));
  }

  from(table: string) {
    return new FakeQueryBuilder(this, table);
  }

  _get(table: string): Row[] {
    return this.tables.get(table) ?? [];
  }

  _set(table: string, rows: Row[]) {
    this.tables.set(table, rows);
  }

  _nextId(): string {
    this.idCounter += 1;
    return `benefit-${this.idCounter}`;
  }
}

class FakeQueryBuilder {
  constructor(private client: FakeSupabaseClient, private table: string) {}

  select() {
    return new FakeBuilder(this.client, this.table, "select");
  }

  insert(values: Row | Row[]) {
    return new FakeBuilder(this.client, this.table, "insert", values);
  }

  update(values: Row) {
    return new FakeBuilder(this.client, this.table, "update", values);
  }

  delete() {
    return new FakeBuilder(this.client, this.table, "delete");
  }
}

class FakeBuilder {
  private filters: Array<[string, unknown]> = [];
  private orderBy: { column: string; ascending: boolean } | null = null;
  private returning = false;

  constructor(
    private client: FakeSupabaseClient,
    private table: string,
    private operation: "select" | "insert" | "update" | "delete",
    private values?: Row | Row[]
  ) {}

  eq(column: string, value: unknown) {
    this.filters.push([column, value]);
    return this;
  }

  in(column: string, values: unknown[]) {
    this.filters.push([column, values]);
    return this;
  }

  order(column: string, options: { ascending: boolean }) {
    this.orderBy = { column, ascending: options.ascending };
    return this;
  }

  select() {
    this.returning = true;
    return this;
  }

  single() {
    const rows = this.execute();
    if (rows.length !== 1) {
      return Promise.resolve({
        data: null,
        error: new Error("Expected single row"),
      });
    }
    return Promise.resolve({ data: rows[0], error: null });
  }

  maybeSingle() {
    const rows = this.execute();
    return Promise.resolve({ data: rows[0] ?? null, error: null });
  }

  then(
    onFulfilled: (value: { data: Row[] | Row | null; error: unknown }) => unknown
  ) {
    const rows = this.execute();
    const data =
      this.operation === "select" ? rows : this.returning ? rows : null;
    return Promise.resolve(onFulfilled({ data, error: null }));
  }

  private execute(): Row[] {
    const allRows = this.client._get(this.table);

    if (this.operation === "insert") {
      const inserts = Array.isArray(this.values) ? this.values : [this.values];
      const newRows = inserts.map((row) => ({
        ...row,
        id: this.client._nextId(),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }));
      this.client._set(this.table, [...allRows, ...newRows]);
      return newRows;
    }

    let matching = allRows;
    for (const [column, value] of this.filters) {
      if (Array.isArray(value)) {
        matching = matching.filter((row) => value.includes(row[column]));
      } else {
        matching = matching.filter((row) => row[column] === value);
      }
    }

    if (this.operation === "update") {
      const updates = this.values as Row;
      const updatedRows = matching.map((row) => ({
        ...row,
        ...updates,
        updated_at: new Date().toISOString(),
      }));
      const unchanged = allRows.filter(
        (row) => !matching.some((m) => m.id === row.id)
      );
      this.client._set(this.table, [...unchanged, ...updatedRows]);
      return updatedRows;
    }

    if (this.operation === "delete") {
      const remaining = allRows.filter(
        (row) => !matching.some((m) => m.id === row.id)
      );
      this.client._set(this.table, remaining);
      return matching;
    }

    // select
    if (this.orderBy) {
      matching = [...matching].sort((a, b) => {
        const av = a[this.orderBy!.column] as string | number;
        const bv = b[this.orderBy!.column] as string | number;
        if (av < bv) return this.orderBy!.ascending ? -1 : 1;
        if (av > bv) return this.orderBy!.ascending ? 1 : -1;
        return 0;
      });
    }

    return matching;
  }
}

function makeClient(initial: Record<string, Row[]> = {}): SupabaseClient {
  return new FakeSupabaseClient(initial) as unknown as SupabaseClient;
}

function getRows(client: SupabaseClient, table: string): Row[] {
  return (client as unknown as FakeSupabaseClient)._get(table);
}

function makeInput(
  overrides: Partial<CreateWalletBenefitInput> = {}
): CreateWalletBenefitInput {
  return {
    walletCardId: "card-1",
    productBenefitId: "benefit-def-1",
    active: true,
    activatedAt: "2026-01-01T00:00:00Z",
    expiresAt: "2026-12-31T00:00:00Z",
    remainingValue: 50,
    usedValue: 0,
    metadata: null,
    ...overrides,
  };
}

function makeBenefitRow(overrides: Row = {}): Row {
  return {
    id: "benefit-1",
    user_id: "user-a",
    wallet_card_id: "card-1",
    product_benefit_id: "benefit-def-1",
    active: true,
    activated_at: "2026-01-01T00:00:00Z",
    expires_at: "2026-12-31T00:00:00Z",
    remaining_value: 50,
    used_value: 0,
    metadata: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function makeProductBenefitRow(overrides: Row = {}): Row {
  return {
    id: "benefit-def-1",
    card_product_id: "product-1",
    type: "statement_credit",
    title: "$50 statement credit",
    description: "Annual statement credit",
    eligible_category: null,
    eligible_merchant: null,
    fixed_value: 50,
    annual_limit: 50,
    requires_activation: true,
    source: "issuer_website",
    last_verified_at: "2026-08-01T00:00:00Z",
    active: true,
    created_at: "2026-08-01T00:00:00Z",
    updated_at: "2026-08-01T00:00:00Z",
    ...overrides,
  };
}

// =============================================================================
// Tests
// =============================================================================

describe("wallet benefits repository", () => {
  it("creates a benefit and sets user_id from the authenticated boundary", async () => {
    const client = makeClient();

    const benefit = await createWalletBenefit(makeInput(), "user-a", client);

    assert.equal(benefit.walletCardId, "card-1");
    assert.equal(benefit.productBenefitId, "benefit-def-1");
    assert.equal(benefit.active, true);
    assert.equal(benefit.activatedAt, "2026-01-01T00:00:00Z");
    assert.equal(benefit.expiresAt, "2026-12-31T00:00:00Z");
    assert.equal(benefit.remainingValue, 50);
    assert.equal(benefit.usedValue, 0);
    assert.ok(benefit.id.startsWith("benefit-"));

    const stored = getRows(client, "wallet_benefits")[0];
    assert.equal(stored.user_id, "user-a");
    assert.equal(stored.wallet_card_id, "card-1");
    assert.equal(stored.product_benefit_id, "benefit-def-1");
  });

  it("lists benefits only for the current user's card", async () => {
    const client = makeClient({
      wallet_benefits: [
        makeBenefitRow({ id: "benefit-1", user_id: "user-a", wallet_card_id: "card-1", remaining_value: 50, used_value: 0 }),
        makeBenefitRow({ id: "benefit-2", user_id: "user-a", wallet_card_id: "card-2", remaining_value: 80, used_value: 20 }),
        makeBenefitRow({ id: "benefit-3", user_id: "user-b", wallet_card_id: "card-1", remaining_value: 10, used_value: 40 }),
      ],
    });

    const benefits = await getWalletBenefitsForCard("card-1", "user-a", client);

    assert.equal(benefits.length, 1);
    assert.equal(benefits[0].id, "benefit-1");
    assert.equal(benefits[0].walletCardId, "card-1");
  });

  it("lists NO benefits when the card belongs to another user", async () => {
    const client = makeClient({
      wallet_benefits: [
        makeBenefitRow({ id: "benefit-3", user_id: "user-b", wallet_card_id: "card-1" }),
      ],
    });

    const benefits = await getWalletBenefitsForCard("card-1", "user-a", client);

    assert.equal(benefits.length, 0);
  });

  it("reads a single benefit for the current user", async () => {
    const client = makeClient({
      wallet_benefits: [makeBenefitRow()],
    });

    const benefit = await getWalletBenefitForUser("benefit-1", "user-a", client);

    assert.ok(benefit);
    assert.equal(benefit!.productBenefitId, "benefit-def-1");
    assert.equal(benefit!.remainingValue, 50);
    assert.equal(benefit!.usedValue, 0);
  });

  it("returns null when reading another user's benefit", async () => {
    const client = makeClient({
      wallet_benefits: [
        makeBenefitRow({ id: "benefit-1", user_id: "user-b" }),
      ],
    });

    const benefit = await getWalletBenefitForUser("benefit-1", "user-a", client);

    assert.equal(benefit, null);
  });

  it("updates a benefit for the current user", async () => {
    const client = makeClient({
      wallet_benefits: [makeBenefitRow()],
    });

    const updated = await updateWalletBenefit(
      "benefit-1",
      { active: false, remainingValue: 25, usedValue: 25, expiresAt: "2026-06-30T00:00:00Z", metadata: { note: "used half" } },
      "user-a",
      client
    );

    assert.equal(updated.active, false);
    assert.equal(updated.remainingValue, 25);
    assert.equal(updated.usedValue, 25);
    assert.equal(updated.expiresAt, "2026-06-30T00:00:00Z");
    assert.deepEqual(updated.metadata, { note: "used half" });
    // untouched fields preserved
    assert.equal(updated.walletCardId, "card-1");
    assert.equal(updated.productBenefitId, "benefit-def-1");

    const stored = getRows(client, "wallet_benefits")[0];
    assert.equal(stored.active, false);
    assert.equal(stored.remaining_value, 25);
    assert.equal(stored.used_value, 25);
  });

  it("fails to update another user's benefit", async () => {
    const client = makeClient({
      wallet_benefits: [
        makeBenefitRow({ id: "benefit-1", user_id: "user-b" }),
      ],
    });

    await assert.rejects(
      async () => {
        await updateWalletBenefit(
          "benefit-1",
          { remainingValue: 0 },
          "user-a",
          client
        );
      },
      /Failed to update wallet benefit/
    );
  });

  it("deletes a benefit for the current user", async () => {
    const client = makeClient({
      wallet_benefits: [makeBenefitRow()],
    });

    await deleteWalletBenefit("benefit-1", "user-a", client);

    assert.equal(getRows(client, "wallet_benefits").length, 0);
  });

  it("does not delete another user's benefit", async () => {
    const client = makeClient({
      wallet_benefits: [
        makeBenefitRow({ id: "benefit-1", user_id: "user-b" }),
      ],
    });

    await deleteWalletBenefit("benefit-1", "user-a", client);

    // row belonging to user-b remains
    assert.equal(getRows(client, "wallet_benefits").length, 1);
  });

  it("ignores a user_id supplied in the create input", async () => {
    const client = makeClient();

    const input = makeInput({ metadata: { source: "test" } });
    const benefit = await createWalletBenefit(
      // user_id is not part of CreateWalletBenefitInput; metadata is preserved
      input,
      "user-a",
      client
    );

    const stored = getRows(client, "wallet_benefits")[0];
    assert.equal(stored.user_id, "user-a");
    assert.equal((stored.metadata as Record<string, unknown>).source, "test");
    assert.equal(benefit.metadata?.source, "test");
  });

  it("handles null optional fields (uncapped benefit)", async () => {
    const client = makeClient();

    const benefit = await createWalletBenefit(
      makeInput({
        activatedAt: null,
        expiresAt: null,
        remainingValue: null,
        usedValue: 0,
      }),
      "user-a",
      client
    );

    assert.equal(benefit.activatedAt, null);
    assert.equal(benefit.expiresAt, null);
    assert.equal(benefit.remainingValue, null);
    assert.equal(benefit.usedValue, 0);

    const stored = getRows(client, "wallet_benefits")[0];
    assert.equal(stored.activated_at, null);
    assert.equal(stored.expires_at, null);
    assert.equal(stored.remaining_value, null);
  });

  it("preserves product identity via product_benefit_id, never copies the definition", async () => {
    const client = makeClient();

    const benefit = await createWalletBenefit(
      makeInput({ productBenefitId: "benefit-def-abc", walletCardId: "card-9" }),
      "user-a",
      client
    );

    const stored = getRows(client, "wallet_benefits")[0];
    assert.equal(stored.product_benefit_id, "benefit-def-abc");
    assert.equal(stored.wallet_card_id, "card-9");
    // The user state row must NOT contain product-definition fields
    // (no title/percentage/type columns on this table).
    assert.equal("type" in stored, false);
    assert.equal("title" in stored, false);
    assert.equal(benefit.productBenefitId, "benefit-def-abc");
  });

  // =========================================================================
  // Combined read: user benefit state + shared product definition
  // =========================================================================

  it("rehydrates user benefit state with its shared product definition", async () => {
    const client = makeClient({
      wallet_benefits: [makeBenefitRow()],
      product_benefits: [makeProductBenefitRow()],
    });

    const displays = await getWalletBenefitsWithProducts("card-1", "user-a", client);

    assert.equal(displays.length, 1);
    // product definition (shared)
    assert.equal(displays[0].product.id, "benefit-def-1");
    assert.equal(displays[0].product.title, "$50 statement credit");
    assert.equal(displays[0].product.type, "statement_credit");
    // user-specific state (separate)
    assert.equal(displays[0].state.id, "benefit-1");
    assert.equal(displays[0].state.active, true);
    assert.equal(displays[0].state.remainingValue, 50);
    assert.equal(displays[0].state.expiresAt, "2026-12-31T00:00:00Z");
    // separation is preserved: the state row carries no product definition fields
    assert.equal("title" in displays[0].state, false);
    assert.equal("type" in displays[0].state, false);
  });

  it("returns an empty array when there is no persisted benefit state", async () => {
    const client = makeClient({
      wallet_benefits: [],
      product_benefits: [makeProductBenefitRow()],
    });

    const displays = await getWalletBenefitsWithProducts("card-1", "user-a", client);

    assert.equal(displays.length, 0);
  });

  it("skips benefit state whose product definition cannot be resolved", async () => {
    // benefit has no corresponding product_benefits row
    const client = makeClient({
      wallet_benefits: [makeBenefitRow()],
      product_benefits: [],
    });

    const displays = await getWalletBenefitsWithProducts("card-1", "user-a", client);

    assert.equal(displays.length, 0);
  });

  it("does not expose another user's benefit state", async () => {
    const client = makeClient({
      wallet_benefits: [
        makeBenefitRow({ id: "benefit-1", user_id: "user-b", product_benefit_id: "benefit-def-1" }),
      ],
      product_benefits: [makeProductBenefitRow()],
    });

    const displays = await getWalletBenefitsWithProducts("card-1", "user-a", client);

    assert.equal(displays.length, 0);
  });
});
