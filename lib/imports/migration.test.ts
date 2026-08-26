import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const sql = readFileSync(
  "supabase/migrations/20260826140000_secure_import_confirmation.sql",
  "utf8"
);

describe("secure import confirmation migration", () => {
  it("removes every authenticated arbitrary purchase creation path", () => {
    assert.match(sql, /drop policy if exists "purchases_insert_own"/i);
    assert.match(sql, /revoke insert on table public\.purchases[\s\S]*authenticated/i);
    assert.match(
      sql,
      /revoke execute on function public\.persist_purchase\(uuid, jsonb, jsonb, jsonb\)[\s\S]*authenticated/i
    );
    assert.match(
      sql,
      /revoke execute on function public\.persist_purchases\(uuid, jsonb\)[\s\S]*authenticated/i
    );
  });

  it("confirms only a locked stored draft without a purchase JSON argument", () => {
    assert.match(
      sql,
      /function public\.confirm_import_draft\(\s*p_draft_id uuid,\s*p_claim_token uuid,\s*p_payload_signature text\s*\)/i
    );
    assert.match(sql, /from public\.import_drafts draft[\s\S]*for update/i);
    assert.match(sql, /v_draft\.persistence_payload::jsonb/i);
    assert.match(sql, /status = 'confirmed'/i);
  });

  it("verifies draft HMACs with a database-owner-only secret", () => {
    assert.match(sql, /finance_buddy_private\.import_draft_signing_config/i);
    assert.match(sql, /finance_buddy_private\.import_draft_signature/i);
    assert.match(sql, /create trigger import_drafts_verify_signature/i);
    assert.match(
      sql,
      /revoke all on table finance_buddy_private\.import_draft_signing_config[\s\S]*authenticated/i
    );
  });
});
