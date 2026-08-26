/**
 * Focused tests for the Goals and RewardAccounts repositories.
 *
 * Uses an in-memory fake Supabase client to exercise CRUD and ownership
 * without requiring a real database connection or applied migration.
 *
 * Run with: npx tsx --test lib/goals/repositories.test.ts
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  createGoal,
  getGoalsForUser,
  getGoalForUser,
  updateGoal,
  deleteGoal,
  type CreateGoalInput,
} from "./repository";
import {
  createRewardAccount,
  getRewardAccountsForUser,
  getRewardAccountForUser,
  updateRewardAccount,
  deleteRewardAccount,
  type CreateRewardAccountInput,
} from "./rewardAccountsRepository";

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
    return `id-${this.idCounter}`;
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
        // The goals table defaults `type` to 'travel' in the database.
        ...(this.table === "goals" ? { type: "travel" } : {}),
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

// =============================================================================
// Helpers
// =============================================================================

function makeGoalInput(overrides: Partial<CreateGoalInput> = {}): CreateGoalInput {
  return {
    title: "Europe Trip",
    status: "active",
    origin: ["JFK"],
    destinations: ["CDG"],
    earliestDeparture: "2027-06-01T00:00:00Z",
    latestReturn: "2027-06-15T00:00:00Z",
    minimumNights: 5,
    maximumNights: 14,
    travelerCount: 2,
    cabinPreference: "economy",
    optimizationPriority: "lowest_cash",
    maximumCashBudget: 2500.5,
    currency: "USD",
    allowNewCards: true,
    ...overrides,
  };
}

function makeRewardAccountInput(
  overrides: Partial<CreateRewardAccountInput> = {}
): CreateRewardAccountInput {
  return {
    rewardProgramId: "chase-ultimate-rewards",
    ownerKey: "self",
    ownerLabel: "Me",
    ownerType: "self",
    balance: 12345.5,
    balanceAsOf: "2026-08-01T00:00:00Z",
    origin: "manual",
    verificationStatus: "unverified",
    ...overrides,
  };
}

// =============================================================================
// Goals repository tests
// =============================================================================

describe("goals repository", () => {
  it("creates a goal, sets user_id from the explicit userId, and maps the returned row to a complete Goal", async () => {
    const client = makeClient();

    const goal = await createGoal(makeGoalInput(), "user-a", client);

    assert.equal(goal.userId, "user-a");
    assert.equal(goal.type, "travel");
    assert.equal(goal.title, "Europe Trip");
    assert.equal(goal.status, "active");
    assert.deepEqual(goal.origin, ["JFK"]);
    assert.deepEqual(goal.destinations, ["CDG"]);
    assert.equal(goal.earliestDeparture, "2027-06-01T00:00:00Z");
    assert.equal(goal.latestReturn, "2027-06-15T00:00:00Z");
    assert.equal(goal.minimumNights, 5);
    assert.equal(goal.maximumNights, 14);
    assert.equal(goal.travelerCount, 2);
    assert.equal(goal.cabinPreference, "economy");
    assert.equal(goal.optimizationPriority, "lowest_cash");
    assert.equal(goal.maximumCashBudget, 2500.5);
    assert.equal(goal.currency, "USD");
    assert.equal(goal.allowNewCards, true);
    assert.ok(goal.id.startsWith("id-"));
    assert.ok(goal.createdAt);
    assert.ok(goal.updatedAt);

    const stored = getRows(client, "goals")[0];
    assert.equal(stored.user_id, "user-a");
    assert.equal(stored.title, "Europe Trip");
    assert.equal(stored.status, "active");
    assert.deepEqual(stored.origin, ["JFK"]);
    assert.deepEqual(stored.destinations, ["CDG"]);
    assert.equal(stored.earliest_departure, "2027-06-01T00:00:00Z");
    assert.equal(stored.latest_return, "2027-06-15T00:00:00Z");
    assert.equal(stored.minimum_nights, 5);
    assert.equal(stored.maximum_nights, 14);
    assert.equal(stored.traveler_count, 2);
    assert.equal(stored.cabin_preference, "economy");
    assert.equal(stored.optimization_priority, "lowest_cash");
    assert.equal(stored.maximum_cash_budget, 2500.5);
    assert.equal(stored.currency, "USD");
    assert.equal(stored.allow_new_cards, true);
  });

  it("maps a string maximum_cash_budget to a number and keeps null as null", async () => {
    const client = makeClient({
      goals: [
        {
          id: "goal-1",
          user_id: "user-a",
          type: "travel",
          title: "String Budget",
          status: "active",
          origin: [],
          destinations: [],
          earliest_departure: null,
          latest_return: null,
          minimum_nights: null,
          maximum_nights: null,
          traveler_count: 1,
          cabin_preference: "economy",
          optimization_priority: "balanced",
          maximum_cash_budget: "2500.50",
          currency: "USD",
          allow_new_cards: false,
          created_at: "2026-01-01T00:00:00Z",
          updated_at: "2026-01-01T00:00:00Z",
        },
        {
          id: "goal-2",
          user_id: "user-a",
          type: "travel",
          title: "Null Budget",
          status: "active",
          origin: [],
          destinations: [],
          earliest_departure: null,
          latest_return: null,
          minimum_nights: null,
          maximum_nights: null,
          traveler_count: 1,
          cabin_preference: "economy",
          optimization_priority: "balanced",
          maximum_cash_budget: null,
          currency: "USD",
          allow_new_cards: false,
          created_at: "2026-01-01T00:00:00Z",
          updated_at: "2026-01-01T00:00:00Z",
        },
      ],
    });

    const goals = await getGoalsForUser("user-a", client);

    const stringBudget = goals.find((g) => g.id === "goal-1");
    const nullBudget = goals.find((g) => g.id === "goal-2");

    assert.equal(stringBudget!.maximumCashBudget, 2500.5);
    assert.equal(nullBudget!.maximumCashBudget, null);
  });

  it("lists only the requested user's goals", async () => {
    const client = makeClient({
      goals: [
        {
          id: "goal-1",
          user_id: "user-a",
          type: "travel",
          title: "Goal A",
          status: "active",
          origin: [],
          destinations: [],
          earliest_departure: null,
          latest_return: null,
          minimum_nights: null,
          maximum_nights: null,
          traveler_count: 1,
          cabin_preference: "economy",
          optimization_priority: "balanced",
          maximum_cash_budget: null,
          currency: "USD",
          allow_new_cards: false,
          created_at: "2026-01-01T00:00:00Z",
          updated_at: "2026-01-01T00:00:00Z",
        },
        {
          id: "goal-2",
          user_id: "user-b",
          type: "travel",
          title: "Goal B",
          status: "active",
          origin: [],
          destinations: [],
          earliest_departure: null,
          latest_return: null,
          minimum_nights: null,
          maximum_nights: null,
          traveler_count: 1,
          cabin_preference: "economy",
          optimization_priority: "balanced",
          maximum_cash_budget: null,
          currency: "USD",
          allow_new_cards: false,
          created_at: "2026-01-01T00:00:00Z",
          updated_at: "2026-01-01T00:00:00Z",
        },
      ],
    });

    const goals = await getGoalsForUser("user-a", client);

    assert.equal(goals.length, 1);
    assert.equal(goals[0].id, "goal-1");
    assert.equal(goals[0].title, "Goal A");
  });

  it("returns null when reading another user's goal", async () => {
    const client = makeClient({
      goals: [
        {
          id: "goal-1",
          user_id: "user-b",
          type: "travel",
          title: "Goal B",
          status: "active",
          origin: [],
          destinations: [],
          earliest_departure: null,
          latest_return: null,
          minimum_nights: null,
          maximum_nights: null,
          traveler_count: 1,
          cabin_preference: "economy",
          optimization_priority: "balanced",
          maximum_cash_budget: null,
          currency: "USD",
          allow_new_cards: false,
          created_at: "2026-01-01T00:00:00Z",
          updated_at: "2026-01-01T00:00:00Z",
        },
      ],
    });

    const goal = await getGoalForUser("goal-1", "user-a", client);

    assert.equal(goal, null);
  });

  it("fails to update another user's goal", async () => {
    const client = makeClient({
      goals: [
        {
          id: "goal-1",
          user_id: "user-b",
          type: "travel",
          title: "Goal B",
          status: "active",
          origin: [],
          destinations: [],
          earliest_departure: null,
          latest_return: null,
          minimum_nights: null,
          maximum_nights: null,
          traveler_count: 1,
          cabin_preference: "economy",
          optimization_priority: "balanced",
          maximum_cash_budget: null,
          currency: "USD",
          allow_new_cards: false,
          created_at: "2026-01-01T00:00:00Z",
          updated_at: "2026-01-01T00:00:00Z",
        },
      ],
    });

    await assert.rejects(
      async () => {
        await updateGoal("goal-1", { title: "Hacked" }, "user-a", client);
      },
      /Failed to update goal/
    );

    const stored = getRows(client, "goals")[0];
    assert.equal(stored.title, "Goal B");
  });

  it("rejects deleting another user's goal without removing it", async () => {
    const client = makeClient({
      goals: [
        {
          id: "goal-1",
          user_id: "user-b",
          type: "travel",
          title: "Goal B",
          status: "active",
          origin: [],
          destinations: [],
          earliest_departure: null,
          latest_return: null,
          minimum_nights: null,
          maximum_nights: null,
          traveler_count: 1,
          cabin_preference: "economy",
          optimization_priority: "balanced",
          maximum_cash_budget: null,
          currency: "USD",
          allow_new_cards: false,
          created_at: "2026-01-01T00:00:00Z",
          updated_at: "2026-01-01T00:00:00Z",
        },
      ],
    });

    await assert.rejects(
      deleteGoal("goal-1", "user-a", client),
      /Failed to delete goal/
    );

    assert.equal(getRows(client, "goals").length, 1);
  });

  it("deletes an owned goal", async () => {
    const client = makeClient({
      goals: [
        {
          id: "goal-1",
          user_id: "user-a",
          type: "travel",
          title: "Goal A",
          status: "active",
          origin: ["DEN"],
          destinations: ["CDG"],
          earliest_departure: null,
          latest_return: null,
          minimum_nights: null,
          maximum_nights: null,
          traveler_count: 1,
          cabin_preference: "economy",
          optimization_priority: "balanced",
          maximum_cash_budget: null,
          currency: "USD",
          allow_new_cards: false,
          created_at: "2026-01-01T00:00:00Z",
          updated_at: "2026-01-01T00:00:00Z",
        },
      ],
    });

    await deleteGoal("goal-1", "user-a", client);

    assert.equal(getRows(client, "goals").length, 0);
  });

  it("updates a goal mapping nullable and non-null fields and setting updated_at", async () => {
    const client = makeClient({
      goals: [
        {
          id: "goal-1",
          user_id: "user-a",
          type: "travel",
          title: "Old Title",
          status: "active",
          origin: ["JFK"],
          destinations: ["CDG"],
          earliest_departure: "2027-06-01T00:00:00Z",
          latest_return: "2027-06-15T00:00:00Z",
          minimum_nights: 5,
          maximum_nights: 14,
          traveler_count: 2,
          cabin_preference: "economy",
          optimization_priority: "lowest_cash",
          maximum_cash_budget: 2500.5,
          currency: "USD",
          allow_new_cards: true,
          created_at: "2026-01-01T00:00:00Z",
          updated_at: "2026-01-01T00:00:00Z",
        },
      ],
    });

    const updated = await updateGoal(
      "goal-1",
      {
        title: "New Title",
        status: "paused",
        earliestDeparture: null,
        latestReturn: null,
        minimumNights: null,
        maximumNights: null,
        maximumCashBudget: 3000,
        allowNewCards: false,
      },
      "user-a",
      client
    );

    assert.equal(updated.title, "New Title");
    assert.equal(updated.status, "paused");
    assert.equal(updated.earliestDeparture, null);
    assert.equal(updated.latestReturn, null);
    assert.equal(updated.minimumNights, null);
    assert.equal(updated.maximumNights, null);
    assert.equal(updated.maximumCashBudget, 3000);
    assert.equal(updated.allowNewCards, false);
    // Non-updated fields are preserved.
    assert.deepEqual(updated.origin, ["JFK"]);
    assert.deepEqual(updated.destinations, ["CDG"]);
    assert.equal(updated.travelerCount, 2);
    assert.equal(updated.cabinPreference, "economy");
    assert.equal(updated.optimizationPriority, "lowest_cash");
    assert.equal(updated.currency, "USD");

    const stored = getRows(client, "goals")[0];
    assert.equal(stored.title, "New Title");
    assert.equal(stored.earliest_departure, null);
    assert.equal(stored.minimum_nights, null);
    assert.equal(stored.maximum_cash_budget, 3000);
    assert.notEqual(stored.updated_at, "2026-01-01T00:00:00Z");
  });
});

// =============================================================================
// Reward accounts repository tests
// =============================================================================

describe("reward accounts repository", () => {
  it("creates a reward account with user_id from the explicit argument and all payload fields", async () => {
    const client = makeClient();

    const account = await createRewardAccount(
      makeRewardAccountInput(),
      "user-a",
      client
    );

    assert.equal(account.userId, "user-a");
    assert.equal(account.rewardProgramId, "chase-ultimate-rewards");
    assert.equal(account.ownerKey, "self");
    assert.equal(account.ownerLabel, "Me");
    assert.equal(account.ownerType, "self");
    assert.equal(account.balance, 12345.5);
    assert.equal(account.balanceAsOf, "2026-08-01T00:00:00Z");
    assert.equal(account.origin, "manual");
    assert.equal(account.verificationStatus, "unverified");
    assert.ok(account.id.startsWith("id-"));
    assert.ok(account.createdAt);
    assert.ok(account.updatedAt);

    const stored = getRows(client, "reward_accounts")[0];
    assert.equal(stored.user_id, "user-a");
    assert.equal(stored.reward_program_id, "chase-ultimate-rewards");
    assert.equal(stored.owner_key, "self");
    assert.equal(stored.owner_label, "Me");
    assert.equal(stored.owner_type, "self");
    assert.equal(stored.balance, 12345.5);
    assert.equal(stored.balance_as_of, "2026-08-01T00:00:00Z");
    assert.equal(stored.origin, "manual");
    assert.equal(stored.verification_status, "unverified");
  });

  it("maps a string balance to a number", async () => {
    const client = makeClient({
      reward_accounts: [
        {
          id: "account-1",
          user_id: "user-a",
          reward_program_id: "chase-ultimate-rewards",
          owner_key: "self",
          owner_label: "Me",
          owner_type: "self",
          balance: "12345.50",
          balance_as_of: "2026-08-01T00:00:00Z",
          origin: "manual",
          verification_status: "unverified",
          created_at: "2026-01-01T00:00:00Z",
          updated_at: "2026-01-01T00:00:00Z",
        },
      ],
    });

    const accounts = await getRewardAccountsForUser("user-a", client);

    assert.equal(accounts[0].balance, 12345.5);
  });

  it("lists only the requested user's reward accounts", async () => {
    const client = makeClient({
      reward_accounts: [
        {
          id: "account-1",
          user_id: "user-a",
          reward_program_id: "p1",
          owner_key: "self",
          owner_label: "Me",
          owner_type: "self",
          balance: 100,
          balance_as_of: "2026-08-01T00:00:00Z",
          origin: "manual",
          verification_status: "unverified",
          created_at: "2026-01-01T00:00:00Z",
          updated_at: "2026-01-01T00:00:00Z",
        },
        {
          id: "account-2",
          user_id: "user-b",
          reward_program_id: "p2",
          owner_key: "self",
          owner_label: "Other",
          owner_type: "self",
          balance: 200,
          balance_as_of: "2026-08-01T00:00:00Z",
          origin: "manual",
          verification_status: "unverified",
          created_at: "2026-01-01T00:00:00Z",
          updated_at: "2026-01-01T00:00:00Z",
        },
      ],
    });

    const accounts = await getRewardAccountsForUser("user-a", client);

    assert.equal(accounts.length, 1);
    assert.equal(accounts[0].id, "account-1");
  });

  it("returns null when reading another user's reward account", async () => {
    const client = makeClient({
      reward_accounts: [
        {
          id: "account-1",
          user_id: "user-b",
          reward_program_id: "p1",
          owner_key: "self",
          owner_label: "Other",
          owner_type: "self",
          balance: 100,
          balance_as_of: "2026-08-01T00:00:00Z",
          origin: "manual",
          verification_status: "unverified",
          created_at: "2026-01-01T00:00:00Z",
          updated_at: "2026-01-01T00:00:00Z",
        },
      ],
    });

    const account = await getRewardAccountForUser("account-1", "user-a", client);

    assert.equal(account, null);
  });

  it("fails to update another user's reward account", async () => {
    const client = makeClient({
      reward_accounts: [
        {
          id: "account-1",
          user_id: "user-b",
          reward_program_id: "p1",
          owner_key: "self",
          owner_label: "Other",
          owner_type: "self",
          balance: 100,
          balance_as_of: "2026-08-01T00:00:00Z",
          origin: "manual",
          verification_status: "unverified",
          created_at: "2026-01-01T00:00:00Z",
          updated_at: "2026-01-01T00:00:00Z",
        },
      ],
    });

    await assert.rejects(
      async () => {
        await updateRewardAccount(
          "account-1",
          { ownerLabel: "Hacked" },
          "user-a",
          client
        );
      },
      /Failed to update reward account/
    );

    const stored = getRows(client, "reward_accounts")[0];
    assert.equal(stored.owner_label, "Other");
  });

  it("does not delete another user's reward account", async () => {
    const client = makeClient({
      reward_accounts: [
        {
          id: "account-1",
          user_id: "user-b",
          reward_program_id: "p1",
          owner_key: "self",
          owner_label: "Other",
          owner_type: "self",
          balance: 100,
          balance_as_of: "2026-08-01T00:00:00Z",
          origin: "manual",
          verification_status: "unverified",
          created_at: "2026-01-01T00:00:00Z",
          updated_at: "2026-01-01T00:00:00Z",
        },
      ],
    });

    await deleteRewardAccount("account-1", "user-a", client);

    assert.equal(getRows(client, "reward_accounts").length, 1);
  });

  it("preserves immutable identity fields when updating mutable fields", async () => {
    const client = makeClient({
      reward_accounts: [
        {
          id: "account-1",
          user_id: "user-a",
          reward_program_id: "chase-ultimate-rewards",
          owner_key: "self",
          owner_label: "Me",
          owner_type: "self",
          balance: 100,
          balance_as_of: "2026-08-01T00:00:00Z",
          origin: "manual",
          verification_status: "unverified",
          created_at: "2026-01-01T00:00:00Z",
          updated_at: "2026-01-01T00:00:00Z",
        },
      ],
    });

    const updated = await updateRewardAccount(
      "account-1",
      {
        ownerLabel: "New Label",
        balance: 500,
        balanceAsOf: "2026-09-01T00:00:00Z",
        origin: "evidence",
        verificationStatus: "verified",
      },
      "user-a",
      client
    );

    assert.equal(updated.rewardProgramId, "chase-ultimate-rewards");
    assert.equal(updated.ownerKey, "self");
    assert.equal(updated.ownerType, "self");
    assert.equal(updated.userId, "user-a");
    assert.equal(updated.ownerLabel, "New Label");
    assert.equal(updated.balance, 500);
    assert.equal(updated.balanceAsOf, "2026-09-01T00:00:00Z");
    assert.equal(updated.origin, "evidence");
    assert.equal(updated.verificationStatus, "verified");

    const stored = getRows(client, "reward_accounts")[0];
    assert.equal(stored.reward_program_id, "chase-ultimate-rewards");
    assert.equal(stored.owner_key, "self");
    assert.equal(stored.owner_type, "self");
    assert.equal(stored.user_id, "user-a");
  });

  it("maps every persisted reward account field to the correct domain field", async () => {
    const client = makeClient({
      reward_accounts: [
        {
          id: "account-1",
          user_id: "user-a",
          reward_program_id: "chase-ultimate-rewards",
          owner_key: "companion",
          owner_label: "Partner",
          owner_type: "companion",
          balance: "9876.25",
          balance_as_of: "2026-07-15T00:00:00Z",
          origin: "connected",
          verification_status: "verified",
          created_at: "2026-01-01T00:00:00Z",
          updated_at: "2026-01-02T00:00:00Z",
        },
      ],
    });

    const accounts = await getRewardAccountsForUser("user-a", client);
    const account = accounts[0];

    assert.equal(account.id, "account-1");
    assert.equal(account.userId, "user-a");
    assert.equal(account.rewardProgramId, "chase-ultimate-rewards");
    assert.equal(account.ownerKey, "companion");
    assert.equal(account.ownerLabel, "Partner");
    assert.equal(account.ownerType, "companion");
    assert.equal(account.balance, 9876.25);
    assert.equal(account.balanceAsOf, "2026-07-15T00:00:00Z");
    assert.equal(account.origin, "connected");
    assert.equal(account.verificationStatus, "verified");
    assert.equal(account.createdAt, "2026-01-01T00:00:00Z");
    assert.equal(account.updatedAt, "2026-01-02T00:00:00Z");
  });
});
