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
  createWalletBenefitFromProduct,
  updateWalletBenefitForCard,
  getWalletBenefitOptionsForCard,
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

function makeWalletCardRow(overrides: Row = {}): Row {
  return {
    id: "card-1",
    user_id: "user-a",
    name: "Card A",
    issuer: "Bank A",
    network: "visa",
    reward_currency: "points",
    last_four: "1111",
    active: true,
    source: "user",
    card_product_id: "product-1",
    metadata: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
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

  it("rejects deleting another user's benefit", async () => {
    const client = makeClient({
      wallet_benefits: [
        makeBenefitRow({ id: "benefit-1", user_id: "user-b" }),
      ],
    });

    await assert.rejects(
      deleteWalletBenefit("benefit-1", "user-a", client),
      /Failed to delete wallet benefit/
    );

    // row belonging to user-b remains
    assert.equal(getRows(client, "wallet_benefits").length, 1);
  });

  it("creates catalog-derived state only for an owned card's linked product", async () => {
    const client = makeClient({
      wallet_cards: [makeWalletCardRow()],
      product_benefits: [makeProductBenefitRow()],
    });

    const benefit = await createWalletBenefitFromProduct(
      "card-1",
      "benefit-def-1",
      "user-a",
      client
    );

    assert.equal(benefit.active, false);
    assert.equal(benefit.remainingValue, 50);
    assert.equal(benefit.usedValue, 0);
    assert.equal(benefit.activatedAt, null);
  });

  it("rejects catalog state for another user's card or a different card product", async () => {
    const otherUserClient = makeClient({
      wallet_cards: [makeWalletCardRow({ user_id: "user-b" })],
      product_benefits: [makeProductBenefitRow()],
    });
    const wrongProductClient = makeClient({
      wallet_cards: [makeWalletCardRow()],
      product_benefits: [
        makeProductBenefitRow({ card_product_id: "product-2" }),
      ],
    });

    await assert.rejects(
      createWalletBenefitFromProduct(
        "card-1",
        "benefit-def-1",
        "user-a",
        otherUserClient
      ),
      /not linked to a catalog product/
    );
    await assert.rejects(
      createWalletBenefitFromProduct(
        "card-1",
        "benefit-def-1",
        "user-a",
        wrongProductClient
      ),
      /not available for this card/
    );
  });

  it("returns existing state instead of creating a duplicate", async () => {
    const client = makeClient({
      wallet_cards: [makeWalletCardRow()],
      product_benefits: [makeProductBenefitRow()],
      wallet_benefits: [makeBenefitRow()],
    });

    const benefit = await createWalletBenefitFromProduct(
      "card-1",
      "benefit-def-1",
      "user-a",
      client
    );

    assert.equal(benefit.id, "benefit-1");
    assert.equal(getRows(client, "wallet_benefits").length, 1);
  });

  it("updates state only through the owned card and enforces the catalog cap", async () => {
    const client = makeClient({
      wallet_cards: [makeWalletCardRow()],
      product_benefits: [makeProductBenefitRow()],
      wallet_benefits: [makeBenefitRow()],
    });

    const updated = await updateWalletBenefitForCard(
      "benefit-1",
      "card-1",
      { remainingValue: 30, usedValue: 20 },
      "user-a",
      client
    );
    assert.equal(updated.remainingValue, 30);
    assert.equal(updated.usedValue, 20);

    await assert.rejects(
      updateWalletBenefitForCard(
        "benefit-1",
        "card-1",
        { remainingValue: 40, usedValue: 20 },
        "user-a",
        client
      ),
      /cannot exceed the catalog limit/
    );
    await assert.rejects(
      updateWalletBenefitForCard(
        "benefit-1",
        "card-2",
        { active: false },
        "user-a",
        client
      ),
      /not found for this card/
    );
  });

  it("cannot mutate another user's benefit through an owned card", async () => {
    const client = makeClient({
      wallet_cards: [makeWalletCardRow()],
      product_benefits: [makeProductBenefitRow()],
      wallet_benefits: [makeBenefitRow({ user_id: "user-b" })],
    });

    await assert.rejects(
      updateWalletBenefitForCard(
        "benefit-1",
        "card-1",
        { active: false },
        "user-a",
        client
      ),
      /not found for this card/
    );

    assert.equal(getRows(client, "wallet_benefits")[0].active, true);
  });

  it("rejects negative and non-finite usage at the repository boundary", async () => {
    const client = makeClient({
      wallet_cards: [makeWalletCardRow()],
      product_benefits: [makeProductBenefitRow()],
      wallet_benefits: [makeBenefitRow()],
    });

    for (const updates of [
      { remainingValue: -1 },
      { remainingValue: Number.NaN },
      { remainingValue: Number.POSITIVE_INFINITY },
      { usedValue: -1 },
      { usedValue: Number.NaN },
      { usedValue: Number.POSITIVE_INFINITY },
    ]) {
      await assert.rejects(
        updateWalletBenefitForCard(
          "benefit-1",
          "card-1",
          updates,
          "user-a",
          client
        ),
        /non-negative number/
      );
    }
  });

  it("allows deactivation but rejects activation after a catalog benefit is retired", async () => {
    const deactivateClient = makeClient({
      wallet_cards: [makeWalletCardRow()],
      product_benefits: [makeProductBenefitRow({ active: false })],
      wallet_benefits: [makeBenefitRow({ active: true })],
    });
    const activateClient = makeClient({
      wallet_cards: [makeWalletCardRow()],
      product_benefits: [makeProductBenefitRow({ active: false })],
      wallet_benefits: [makeBenefitRow({ active: false })],
    });

    const deactivated = await updateWalletBenefitForCard(
      "benefit-1",
      "card-1",
      { active: false },
      "user-a",
      deactivateClient
    );
    assert.equal(deactivated.active, false);

    await assert.rejects(
      updateWalletBenefitForCard(
        "benefit-1",
        "card-1",
        { active: true },
        "user-a",
        activateClient
      ),
      /no longer active/
    );
  });

  it("rejects updates when the state definition no longer matches the linked product", async () => {
    const client = makeClient({
      wallet_cards: [makeWalletCardRow()],
      product_benefits: [
        makeProductBenefitRow({ card_product_id: "product-2" }),
      ],
      wallet_benefits: [makeBenefitRow()],
    });

    await assert.rejects(
      updateWalletBenefitForCard(
        "benefit-1",
        "card-1",
        { active: false },
        "user-a",
        client
      ),
      /not available for this card/
    );
  });

  it("lists active definitions for the linked product with optional state", async () => {
    const client = makeClient({
      wallet_cards: [makeWalletCardRow()],
      product_benefits: [
        makeProductBenefitRow(),
        makeProductBenefitRow({
          id: "benefit-def-2",
          title: "Trip protection",
          type: "trip_delay",
          fixed_value: null,
          annual_limit: null,
          requires_activation: false,
        }),
        makeProductBenefitRow({
          id: "benefit-def-other",
          card_product_id: "product-2",
        }),
      ],
      wallet_benefits: [makeBenefitRow()],
    });

    const options = await getWalletBenefitOptionsForCard(
      "card-1",
      "user-a",
      client
    );

    assert.deepEqual(
      options.map((option) => option.product.id),
      ["benefit-def-1", "benefit-def-2"]
    );
    assert.equal(options[0].state?.id, "benefit-1");
    assert.equal(options[1].state, null);
  });

  it("does not attach stale state from a previously linked product", async () => {
    const client = makeClient({
      wallet_cards: [makeWalletCardRow({ card_product_id: "product-2" })],
      product_benefits: [
        makeProductBenefitRow(),
        makeProductBenefitRow({
          id: "benefit-def-2",
          card_product_id: "product-2",
          title: "Current product benefit",
        }),
      ],
      wallet_benefits: [makeBenefitRow()],
    });

    const options = await getWalletBenefitOptionsForCard(
      "card-1",
      "user-a",
      client
    );

    assert.deepEqual(
      options.map(({ product, state }) => [product.id, state?.id ?? null]),
      [["benefit-def-2", null]]
    );
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
      wallet_cards: [makeWalletCardRow()],
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
      wallet_cards: [makeWalletCardRow()],
      wallet_benefits: [],
      product_benefits: [makeProductBenefitRow()],
    });

    const displays = await getWalletBenefitsWithProducts("card-1", "user-a", client);

    assert.equal(displays.length, 0);
  });

  it("skips benefit state whose product definition cannot be resolved", async () => {
    // benefit has no corresponding product_benefits row
    const client = makeClient({
      wallet_cards: [makeWalletCardRow()],
      wallet_benefits: [makeBenefitRow()],
      product_benefits: [],
    });

    const displays = await getWalletBenefitsWithProducts("card-1", "user-a", client);

    assert.equal(displays.length, 0);
  });

  it("skips state for a definition from a different linked product", async () => {
    const client = makeClient({
      wallet_cards: [makeWalletCardRow()],
      wallet_benefits: [makeBenefitRow()],
      product_benefits: [
        makeProductBenefitRow({ card_product_id: "product-2" }),
      ],
    });

    const displays = await getWalletBenefitsWithProducts(
      "card-1",
      "user-a",
      client
    );

    assert.equal(displays.length, 0);
  });

  it("does not expose another user's benefit state", async () => {
    const client = makeClient({
      wallet_cards: [makeWalletCardRow()],
      wallet_benefits: [
        makeBenefitRow({ id: "benefit-1", user_id: "user-b", product_benefit_id: "benefit-def-1" }),
      ],
      product_benefits: [makeProductBenefitRow()],
    });

    const displays = await getWalletBenefitsWithProducts("card-1", "user-a", client);

    assert.equal(displays.length, 0);
  });
});
