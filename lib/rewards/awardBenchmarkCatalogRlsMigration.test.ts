import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const originalMigrationUrl = new URL(
  "../../supabase/migrations/20260909120000_create_award_benchmarks.sql",
  import.meta.url,
);
const fixMigrationUrl = new URL(
  "../../supabase/migrations/20260912120000_fix_award_benchmark_catalog_rls.sql",
  import.meta.url,
);

const TABLES = ["airport_region_map", "transfer_partners", "award_price_benchmarks"] as const;

test("award-benchmark RLS fix is a separate forward-only transactional migration", async () => {
  const sql = await readFile(fixMigrationUrl, "utf8");
  assert.match(sql, /^begin;/m);
  assert.match(sql, /^commit;/m);
  // Forward-only: the fix never touches the permissive SELECT policies from
  // the applied original migration (documenting it by name in comments is
  // fine; altering it is not).
  assert.doesNotMatch(sql, /drop policy if exists "[^"]*_select_authenticated"/);
  assert.doesNotMatch(sql, /disable row level security/);
});

test("fix drops exactly the three restrictive no-write policies", async () => {
  const sql = await readFile(fixMigrationUrl, "utf8");
  assert.equal((sql.match(/drop policy if exists/g) ?? []).length, 3);
  for (const table of TABLES) {
    assert.match(sql, new RegExp(`drop policy if exists "${table}_no_write" on public\\.${table};`));
  }
});

test("fix recreates write protection without covering SELECT", async () => {
  const sql = await readFile(fixMigrationUrl, "utf8");
  // Nine command-specific policies: 3 tables x insert/update/delete.
  assert.equal((sql.match(/create policy/g) ?? []).length, 9);
  // No restrictive policy may target ALL or SELECT (the original defect).
  assert.doesNotMatch(sql, /as restrictive\s+for all/);
  assert.doesNotMatch(sql, /as restrictive\s+for select/);
  assert.doesNotMatch(sql, /restrictive[\s\S]*?for select/);
  // Every created policy targets authenticated only.
  assert.equal((sql.match(/to authenticated/g) ?? []).length, 9);
  assert.doesNotMatch(sql, /to anon|to service_role/);
});

test("original migration keeps its permissive SELECT policies verbatim", async () => {
  const sql = await readFile(originalMigrationUrl, "utf8");
  for (const table of TABLES) {
    assert.match(sql, new RegExp(`create policy "${table}_select_authenticated"`));
    assert.match(sql, new RegExp(`alter table public\\.${table} enable row level security;`));
  }
  // The applied migration is history: the defective policies remain in the
  // file and are dropped by the new migration at apply time.
  for (const table of TABLES) {
    assert.match(sql, new RegExp(`create policy "${table}_no_write"`));
  }
});
