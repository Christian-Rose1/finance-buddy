import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const sql = readFileSync(
  "supabase/migrations/20260826160000_close_import_lifecycle_and_source_conflicts.sql",
  "utf8"
);

describe("import and purchase integrity migration", () => {
  it("fails closed on a source-key envelope conflict", () => {
    assert.match(sql, /source_envelope jsonb/i);
    assert.match(sql, /conflicting canonical source envelope/i);
    assert.match(sql, /source_envelope is null[\s\S]*raise exception/i);
  });

  it("provides maintenance cleanup without granting authenticated execution", () => {
    assert.match(sql, /cleanup_import_drafts\(\)/i);
    assert.match(sql, /revoke all on function public\.cleanup_import_drafts\(\)[\s\S]*authenticated/i);
    assert.match(sql, /grant execute on function public\.cleanup_import_drafts\(\)[\s\S]*service_role/i);
  });

  it("keeps arbitrary purchase RPCs closed to authenticated callers", () => {
    assert.match(
      sql,
      /revoke execute on function public\.persist_purchase\(uuid, jsonb, jsonb, jsonb\)[\s\S]*authenticated/i
    );
    assert.doesNotMatch(
      sql,
      /grant execute on function public\.persist_purchase\(uuid, jsonb, jsonb, jsonb\)[\s\S]*to authenticated/i
    );
    assert.doesNotMatch(
      sql,
      /grant execute on function public\.persist_purchases\(uuid, jsonb\)[\s\S]*to authenticated/i
    );
  });

  it("persists caller-supplied evidence UUIDs from the canonical envelope", () => {
    assert.match(
      sql,
      /insert into public\.purchase_evidence \(\s*id, purchase_id,[\s\S]*select r\.id, v_purchase\.id,[\s\S]*id uuid, type text/i
    );
  });

  it("guards the card foreign key with a legacy-data preflight", () => {
    assert.match(sql, /invalid legacy card ids exist/i);
    assert.match(sql, /purchases_card_id_fkey/i);
    assert.match(sql, /on delete set null/i);
  });
});
