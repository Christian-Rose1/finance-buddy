import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const migration = readFileSync(
  new URL(
    "../../supabase/migrations/20260826150000_allow_statement_csv_uploads.sql",
    import.meta.url
  ),
  "utf8"
);

describe("statement CSV Storage migration", () => {
  it("adds CSV MIME types to the private statements bucket without changing size", () => {
    assert.match(migration, /update storage\.buckets/i);
    assert.match(migration, /where id = 'statements'/i);
    assert.match(migration, /'application\/pdf'/i);
    assert.match(migration, /'text\/csv'/i);
    assert.match(migration, /'application\/csv'/i);
    assert.match(migration, /'application\/vnd\.ms-excel'/i);
    assert.doesNotMatch(migration, /file_size_limit/i);
    assert.doesNotMatch(migration, /create policy|alter policy/i);
  });
});
