/**
 * Focused tests for the wallet card repository.
 *
 * Uses an in-memory fake Supabase client to exercise CRUD and ownership
 * without requiring a real database connection or applied migration.
 *
 * Run with: npx tsx --test lib/wallet/repository.test.ts
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  createWalletCard,
  getWalletCardsForUser,
  getWalletCardForUser,
  updateWalletCard,
  deleteWalletCard,
  linkWalletCardToProduct,
  type CreateWalletCardInput,
} from "./repository";

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
    return `card-${this.idCounter}`;
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
      matching = matching.filter((row) => row[column] === value);
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

function makeInput(overrides: Partial<CreateWalletCardInput> = {}): CreateWalletCardInput {
  return {
    name: "Chase Sapphire Preferred",
    issuer: "Chase",
    network: "visa",
    rewardCurrency: "points",
    lastFour: "1234",
    active: true,
    source: "user",
    ...overrides,
  };
}

// =============================================================================
// Tests
// =============================================================================

describe("wallet card repository", () => {
  it("creates a card and sets user_id from the authenticated boundary", async () => {
    const client = makeClient();

    const card = await createWalletCard(makeInput(), "user-a", client);

    assert.equal(card.name, "Chase Sapphire Preferred");
    assert.equal(card.network, "visa");
    assert.equal(card.source, "user");
    assert.ok(card.id.startsWith("card-"));

    const stored = getRows(client, "wallet_cards")[0];
    assert.equal(stored.user_id, "user-a");
    assert.equal(stored.name, "Chase Sapphire Preferred");
  });

  it("lists only the current user's cards", async () => {
    const client = makeClient({
      wallet_cards: [
        {
          id: "card-1",
          user_id: "user-a",
          name: "Card A",
          issuer: "Bank A",
          network: "visa",
          reward_currency: "points",
          last_four: "1111",
          active: true,
          source: "user",
          metadata: null,
          created_at: "2026-01-01T00:00:00Z",
          updated_at: "2026-01-01T00:00:00Z",
        },
        {
          id: "card-2",
          user_id: "user-b",
          name: "Card B",
          issuer: "Bank B",
          network: "amex",
          reward_currency: "cashback",
          last_four: "2222",
          active: true,
          source: "user",
          metadata: null,
          created_at: "2026-01-01T00:00:00Z",
          updated_at: "2026-01-01T00:00:00Z",
        },
      ],
    });

    const cards = await getWalletCardsForUser("user-a", client);

    assert.equal(cards.length, 1);
    assert.equal(cards[0].id, "card-1");
    assert.equal(cards[0].name, "Card A");
  });

  it("reads a single card for the current user", async () => {
    const client = makeClient({
      wallet_cards: [
        {
          id: "card-1",
          user_id: "user-a",
          name: "Card A",
          issuer: "Bank A",
          network: "visa",
          reward_currency: "points",
          last_four: "1111",
          active: true,
          source: "user",
          metadata: null,
          created_at: "2026-01-01T00:00:00Z",
          updated_at: "2026-01-01T00:00:00Z",
        },
      ],
    });

    const card = await getWalletCardForUser("card-1", "user-a", client);

    assert.ok(card);
    assert.equal(card!.name, "Card A");
  });

  it("returns null when reading another user's card", async () => {
    const client = makeClient({
      wallet_cards: [
        {
          id: "card-1",
          user_id: "user-b",
          name: "Card B",
          issuer: "Bank B",
          network: "amex",
          reward_currency: "cashback",
          last_four: "2222",
          active: true,
          source: "user",
          metadata: null,
          created_at: "2026-01-01T00:00:00Z",
          updated_at: "2026-01-01T00:00:00Z",
        },
      ],
    });

    const card = await getWalletCardForUser("card-1", "user-a", client);

    assert.equal(card, null);
  });

  it("updates a card for the current user", async () => {
    const client = makeClient({
      wallet_cards: [
        {
          id: "card-1",
          user_id: "user-a",
          name: "Old Name",
          issuer: "Bank A",
          network: "visa",
          reward_currency: "points",
          last_four: "1111",
          active: true,
          source: "user",
          metadata: null,
          created_at: "2026-01-01T00:00:00Z",
          updated_at: "2026-01-01T00:00:00Z",
        },
      ],
    });

    const updated = await updateWalletCard(
      "card-1",
      { name: "New Name", active: false },
      "user-a",
      client
    );

    assert.equal(updated.name, "New Name");
    assert.equal(updated.active, false);
    assert.equal(updated.network, "visa");

    const stored = getRows(client, "wallet_cards")[0];
    assert.equal(stored.name, "New Name");
    assert.equal(stored.active, false);
  });

  it("fails to update another user's card", async () => {
    const client = makeClient({
      wallet_cards: [
        {
          id: "card-1",
          user_id: "user-b",
          name: "Card B",
          issuer: "Bank B",
          network: "amex",
          reward_currency: "cashback",
          last_four: "2222",
          active: true,
          source: "user",
          metadata: null,
          created_at: "2026-01-01T00:00:00Z",
          updated_at: "2026-01-01T00:00:00Z",
        },
      ],
    });

    await assert.rejects(
      async () => {
        await updateWalletCard("card-1", { name: "Hacked" }, "user-a", client);
      },
      /Failed to update wallet card/
    );
  });

  it("deletes a card for the current user", async () => {
    const client = makeClient({
      wallet_cards: [
        {
          id: "card-1",
          user_id: "user-a",
          name: "Card A",
          issuer: "Bank A",
          network: "visa",
          reward_currency: "points",
          last_four: "1111",
          active: true,
          source: "user",
          metadata: null,
          created_at: "2026-01-01T00:00:00Z",
          updated_at: "2026-01-01T00:00:00Z",
        },
      ],
    });

    await deleteWalletCard("card-1", "user-a", client);

    assert.equal(getRows(client, "wallet_cards").length, 0);
  });

  it("ignores a user_id supplied in the create input", async () => {
    const client = makeClient();
    const input = makeInput({ metadata: { source: "test" } });

    const card = await createWalletCard(input, "user-a", client);

    const stored = getRows(client, "wallet_cards")[0];
    assert.equal(stored.user_id, "user-a");
    assert.equal((stored.metadata as Record<string, unknown>).source, "test");
  });

  it("links a user's card to a card product", async () => {
    const client = makeClient({
      wallet_cards: [
        {
          id: "card-1",
          user_id: "user-a",
          name: "Card A",
          issuer: "Bank A",
          network: "visa",
          reward_currency: "points",
          last_four: "1111",
          active: true,
          source: "user",
          metadata: null,
          created_at: "2026-01-01T00:00:00Z",
          updated_at: "2026-01-01T00:00:00Z",
        },
      ],
    });

    const updated = await linkWalletCardToProduct("card-1", "cp-1", "user-a", client);

    assert.equal(updated.cardProductId, "cp-1");
    assert.equal(updated.name, "Card A"); // user-entered fields preserved
    assert.equal(updated.issuer, "Bank A");

    const stored = getRows(client, "wallet_cards")[0];
    assert.equal(stored.card_product_id, "cp-1");
  });

  it("unlinks a user's card from a card product", async () => {
    const client = makeClient({
      wallet_cards: [
        {
          id: "card-1",
          user_id: "user-a",
          name: "Card A",
          issuer: "Bank A",
          network: "visa",
          reward_currency: "points",
          last_four: "1111",
          active: true,
          source: "user",
          card_product_id: "cp-1",
          metadata: null,
          created_at: "2026-01-01T00:00:00Z",
          updated_at: "2026-01-01T00:00:00Z",
        },
      ],
    });

    const updated = await linkWalletCardToProduct("card-1", null, "user-a", client);

    assert.equal(updated.cardProductId, null);

    const stored = getRows(client, "wallet_cards")[0];
    assert.equal(stored.card_product_id, null);
  });

  it("fails to link another user's card", async () => {
    const client = makeClient({
      wallet_cards: [
        {
          id: "card-1",
          user_id: "user-b",
          name: "Card B",
          issuer: "Bank B",
          network: "amex",
          reward_currency: "cashback",
          last_four: "2222",
          active: true,
          source: "user",
          metadata: null,
          created_at: "2026-01-01T00:00:00Z",
          updated_at: "2026-01-01T00:00:00Z",
        },
      ],
    });

    await assert.rejects(
      async () => {
        await linkWalletCardToProduct("card-1", "cp-1", "user-a", client);
      },
      /Failed to update wallet card/
    );
  });
});
