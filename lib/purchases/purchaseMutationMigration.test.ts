import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const sql = readFileSync(
  "supabase/migrations/20260826170000_restrict_purchase_mutations.sql",
  "utf8"
);

describe("purchase mutation migration", () => {
  it("revokes broad authenticated update and delete access", () => {
    assert.match(sql, /revoke update, delete on table public\.purchases[\s\S]*authenticated/i);
    assert.match(sql, /revoke update, delete on table public\.purchase_items[\s\S]*authenticated/i);
    assert.match(sql, /revoke update, delete on table public\.purchase_evidence[\s\S]*authenticated/i);
  });

  it("defines narrow card and booking-channel RPCs", () => {
    assert.match(sql, /create or replace function public\.confirm_purchase_card\(\s*p_purchase_id uuid,\s*p_card_id uuid/i);
    assert.match(sql, /card\.user_id = auth\.uid\(\)[\s\S]*card\.active = true/i);
    assert.match(sql, /coalesce\(v_purchase\.provenance, '\{\}'::jsonb\) - 'cardId'/i);
    assert.match(sql, /create or replace function public\.confirm_purchase_booking_channel\(\s*p_purchase_id uuid,\s*p_channel text/i);
    assert.match(sql, /p_channel is not null and p_channel <> 'chase_travel'/i);
    assert.match(sql, /coalesce\(v_purchase\.metadata, '\{\}'::jsonb\) - 'bookingChannel'/i);
    assert.match(sql, /coalesce\(v_purchase\.provenance, '\{\}'::jsonb\) - 'bookingChannel'/i);
  });

  it("grants execution only on the two narrow authenticated RPCs", () => {
    assert.match(sql, /grant execute on function public\.confirm_purchase_card\(uuid, uuid\)[\s\S]*to authenticated/i);
    assert.match(sql, /grant execute on function public\.confirm_purchase_booking_channel\(uuid, text\)[\s\S]*to authenticated/i);
  });
});
