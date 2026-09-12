import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const migrationUrl = new URL(
  "../../supabase/migrations/20260912130000_seed_virgin_atlantic_transfer_partner.sql",
  import.meta.url,
);

test("virgin transfer-partner seed is transactional and idempotent", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  assert.match(sql, /^begin;/m);
  assert.match(sql, /^commit;/m);
  assert.match(sql, /not exists\s*\(\s*select 1\s*from public\.transfer_partners/s);
});

test("seed targets exactly the chase-to-virgin 1:1 row with an official source", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  // Fixed Chase Ultimate Rewards seed id used by the original benchmark seed.
  assert.match(sql, /'0eed418a-7352-41a3-bed2-fbde756bc416'/);
  // Case-insensitive program-name join (same idiom as the original seed).
  assert.match(sql, /lower\(rp\.name\) = lower\('Virgin Atlantic Flying Club'\)/);
  // Verified base ratio only — never a promotional bonus ratio.
  assert.match(sql, /1\.0/);
  assert.doesNotMatch(sql, /1\.3|1\.4/);
  // The source URL must be Virgin Atlantic's official partner page.
  assert.match(
    sql,
    /https:\/\/www\.virginatlantic\.com\/en-US\/flying-club\/earn-points\/chase-ultimate-rewards/,
  );
  // Verification timestamp is the transfer-time clock, matching the original idiom.
  assert.match(sql, /now\(\)/);
});
