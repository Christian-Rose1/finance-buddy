/**
 * Focused tests for the card product catalog repository.
 *
 * Uses an in-memory fake Supabase client to exercise read-only mapping and
 * query behavior without requiring a real database connection.
 *
 * Run with: npx tsx --test lib/rewards/catalogRepository.test.ts
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  getRewardPrograms,
  getCardProducts,
  getCardProduct,
  getEarningRulesForProduct,
} from "./catalogRepository";

// =============================================================================
// Minimal in-memory fake Supabase client
// =============================================================================

type Row = Record<string, unknown>;

class FakeSupabaseClient {
  private tables: Map<string, Row[]>;

  constructor(initial: Record<string, Row[]> = {}) {
    this.tables = new Map(Object.entries(initial));
  }

  from(table: string) {
    return new FakeQueryBuilder(this, table);
  }

  _get(table: string): Row[] {
    return this.tables.get(table) ?? [];
  }
}

class FakeQueryBuilder {
  constructor(private client: FakeSupabaseClient, private table: string) {}

  select() {
    return new FakeBuilder(this.client, this.table, "select");
  }
}

class FakeBuilder {
  private filters: Array<[string, unknown]> = [];
  private orderBy: { column: string; ascending: boolean } | null = null;

  constructor(
    private client: FakeSupabaseClient,
    private table: string,
    private operation: "select"
  ) {}

  eq(column: string, value: unknown) {
    this.filters.push([column, value]);
    return this;
  }

  order(column: string, options: { ascending: boolean }) {
    this.orderBy = { column, ascending: options.ascending };
    return this;
  }

  maybeSingle() {
    const rows = this.execute();
    return Promise.resolve({ data: rows[0] ?? null, error: null });
  }

  then(
    onFulfilled: (value: { data: Row[] | Row | null; error: unknown }) => unknown
  ) {
    const rows = this.execute();
    return Promise.resolve(onFulfilled({ data: rows, error: null }));
  }

  private execute(): Row[] {
    let rows = this.client._get(this.table);

    for (const [column, value] of this.filters) {
      rows = rows.filter((row) => row[column] === value);
    }

    if (this.orderBy) {
      rows = [...rows].sort((a, b) => {
        const av = a[this.orderBy!.column] as string | number;
        const bv = b[this.orderBy!.column] as string | number;
        if (av < bv) return this.orderBy!.ascending ? -1 : 1;
        if (av > bv) return this.orderBy!.ascending ? 1 : -1;
        return 0;
      });
    }

    return rows;
  }
}

function makeClient(initial: Record<string, Row[]> = {}): SupabaseClient {
  return new FakeSupabaseClient(initial) as unknown as SupabaseClient;
}

const rewardProgramRow = {
  id: "rp-1",
  name: "Chase Ultimate Rewards",
  currency: "points",
  family: "bank_points",
  source: "issuer_website",
  last_verified_at: "2026-01-01T00:00:00Z",
  metadata: null,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

const cardProductRow = {
  id: "cp-1",
  reward_program_id: "rp-1",
  issuer: "Chase",
  name: "Chase Sapphire Preferred",
  network: "visa",
  active: true,
  annual_fee: 95,
  source: "issuer_website",
  last_verified_at: "2026-01-01T00:00:00Z",
  metadata: null,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

const inactiveCardProductRow = {
  id: "cp-2",
  reward_program_id: null,
  issuer: "Old Bank",
  name: "Discontinued Card",
  network: "other",
  active: false,
  annual_fee: null,
  source: "unknown",
  last_verified_at: null,
  metadata: null,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

const earningRuleRow = {
  id: "er-1",
  card_product_id: "cp-1",
  type: "earning_rate",
  eligible_category: "food:dining",
  eligible_merchant: null,
  excluded_merchants: ["{walmart}"],
  reward_currency: "points",
  reward_value: 3,
  percentage: null,
  fixed_value: null,
  explanation: "3 points per dollar on dining.",
  source: "issuer_website",
  last_verified_at: "2026-01-01T00:00:00Z",
  metadata: null,
  active: true,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

// =============================================================================
// Tests
// =============================================================================

describe("catalog repository", () => {
  it("maps and returns reward programs", async () => {
    const client = makeClient({ reward_programs: [rewardProgramRow] });

    const programs = await getRewardPrograms(client);

    assert.equal(programs.length, 1);
    assert.equal(programs[0].name, "Chase Ultimate Rewards");
    assert.equal(programs[0].currency, "points");
    assert.equal(programs[0].family, "bank_points");
    assert.equal(programs[0].source, "issuer_website");
  });

  it("returns an empty array when no reward programs exist", async () => {
    const client = makeClient();

    const programs = await getRewardPrograms(client);

    assert.equal(programs.length, 0);
  });

  it("maps and returns card products", async () => {
    const client = makeClient({ card_products: [cardProductRow] });

    const products = await getCardProducts({}, client);

    assert.equal(products.length, 1);
    assert.equal(products[0].name, "Chase Sapphire Preferred");
    assert.equal(products[0].issuer, "Chase");
    assert.equal(products[0].network, "visa");
    assert.equal(products[0].annualFee, 95);
    assert.equal(products[0].rewardProgramId, "rp-1");
  });

  it("filters card products to active only", async () => {
    const client = makeClient({
      card_products: [cardProductRow, inactiveCardProductRow],
    });

    const products = await getCardProducts({ activeOnly: true }, client);

    assert.equal(products.length, 1);
    assert.equal(products[0].id, "cp-1");
  });

  it("returns null when a card product is not found", async () => {
    const client = makeClient({ card_products: [cardProductRow] });

    const product = await getCardProduct("missing", client);

    assert.equal(product, null);
  });

  it("returns a single card product by id", async () => {
    const client = makeClient({ card_products: [cardProductRow] });

    const product = await getCardProduct("cp-1", client);

    assert.ok(product);
    assert.equal(product!.name, "Chase Sapphire Preferred");
  });

  it("maps and returns earning rules for a product", async () => {
    const client = makeClient({ earning_rules: [earningRuleRow] });

    const rules = await getEarningRulesForProduct("cp-1", {}, client);

    assert.equal(rules.length, 1);
    assert.equal(rules[0].eligibleCategory, "food:dining");
    assert.deepEqual(rules[0].excludedMerchants, ["{walmart}"]);
    assert.equal(rules[0].rewardValue, 3);
    assert.equal(rules[0].explanation, "3 points per dollar on dining.");
  });

  it("returns an empty array when a product has no earning rules", async () => {
    const client = makeClient();

    const rules = await getEarningRulesForProduct("cp-1", {}, client);

    assert.equal(rules.length, 0);
  });
});
