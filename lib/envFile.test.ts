import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { loadEnvFileIntoProcess, parseEnvFile } from "./envFile";

const SECRET_SENTINEL = "unit-test-secret-value-do-not-log";

function withTempEnvFile(
  content: string,
  run: (filePath: string) => void,
): void {
  const dir = mkdtempSync(join(tmpdir(), "envfile-test-"));
  const filePath = join(dir, ".env.local");
  writeFileSync(filePath, content);
  try {
    run(filePath);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("parses standard dotenv shapes", () => {
  const entries = parseEnvFile(
    [
      "PLAIN=value",
      "QUOTED=\"quoted value\"",
      "SINGLE='single quoted'",
      "  SPACED=  padded  ",
      "export EXPORTED=1",
      "# comment line",
      "",
      "INLINE=keep # trailing comment",
      "EMPTY=",
    ].join("\n"),
  );
  const byKey = new Map(entries.map((e) => [e.key, e.value]));
  assert.equal(byKey.get("PLAIN"), "value");
  assert.equal(byKey.get("QUOTED"), "quoted value");
  assert.equal(byKey.get("SINGLE"), "single quoted");
  assert.equal(byKey.get("SPACED"), "padded");
  assert.equal(byKey.get("EXPORTED"), "1");
  assert.equal(byKey.get("INLINE"), "keep");
  assert.equal(byKey.get("EMPTY"), "");
});

test("skips malformed lines instead of throwing", () => {
  const entries = parseEnvFile(
    ["no equals sign", "=novalue", "1BAD=x", "GOOD=ok", "BAD KEY=x", "A=1", "A=2"].join("\n"),
  );
  // Malformed lines are gone; duplicates are preserved in order. The loader
  // applies first-occurrence-wins by skipping keys already set.
  assert.deepEqual(entries.map((e) => e.key), ["GOOD", "A", "A"]);
  assert.equal(entries[1]?.value, "1");
});

test("rejects oversized input outright", () => {
  assert.equal(parseEnvFile("A=1".repeat(64 * 1024 + 1)).length, 0);
  assert.equal(parseEnvFile("A=" + "x".repeat(5000)).length, 0);
});

test("tolerates a UTF-8 BOM", () => {
  const entries = parseEnvFile("\uFEFFBOMKEY=bomvalue");
  assert.deepEqual(entries, [{ key: "BOMKEY", value: "bomvalue" }]);
});

test("loads entries into process.env and reports the count", () => {
  withTempEnvFile(`TEST_LOADED_ONE=${SECRET_SENTINEL}\nTEST_LOADED_TWO=2\n`, (filePath) => {
    delete process.env.TEST_LOADED_ONE;
    delete process.env.TEST_LOADED_TWO;
    const loaded = loadEnvFileIntoProcess(filePath);
    assert.equal(loaded, 2);
    assert.equal(process.env.TEST_LOADED_ONE, SECRET_SENTINEL);
    assert.equal(process.env.TEST_LOADED_TWO, "2");
    delete process.env.TEST_LOADED_ONE;
    delete process.env.TEST_LOADED_TWO;
  });
});

test("existing environment entries always win and are never overwritten", () => {
  withTempEnvFile("TEST_PRECEDENCE=from-file\n", (filePath) => {
    process.env.TEST_PRECEDENCE = "from-shell";
    const loaded = loadEnvFileIntoProcess(filePath);
    assert.equal(loaded, 0);
    assert.equal(process.env.TEST_PRECEDENCE, "from-shell");
    delete process.env.TEST_PRECEDENCE;
  });
});

test("missing, unreadable, and directory paths contribute zero entries without throwing", () => {
  assert.equal(loadEnvFileIntoProcess("/nonexistent/.env.local"), 0);
  const dir = mkdtempSync(join(tmpdir(), "envfile-test-"));
  try {
    assert.equal(loadEnvFileIntoProcess(dir), 0);
    const locked = join(dir, "locked.env");
    writeFileSync(locked, "X=1\n");
    chmodSync(locked, 0o000);
    // Reading as a non-root user fails; as root it may succeed — either way
    // the loader must not throw and must not overwrite an existing value.
    process.env.X = "existing";
    assert.doesNotThrow(() => loadEnvFileIntoProcess(locked));
    assert.equal(process.env.X, "existing");
    delete process.env.X;
  } finally {
    try {
      chmodSync(join(dir, "locked.env"), 0o644);
    } catch {
      // Best-effort restore; the directory is removed below regardless.
    }
    rmSync(dir, { recursive: true, force: true });
  }
});

test("oversized file contributes zero entries", () => {
  withTempEnvFile("BIG=" + "x".repeat(300 * 1024) + "\n", (filePath) => {
    delete process.env.BIG;
    assert.equal(loadEnvFileIntoProcess(filePath), 0);
    assert.equal(process.env.BIG, undefined);
  });
});

test("loading never exposes values through the loader API", () => {
  // The only observable return value is a count — the sentinel must never
  // appear in it or in any thrown message.
  withTempEnvFile(`TEST_COUNT_ONLY=${SECRET_SENTINEL}\n`, (filePath) => {
    delete process.env.TEST_COUNT_ONLY;
    const loaded = loadEnvFileIntoProcess(filePath);
    assert.equal(typeof loaded, "number");
    assert.ok(!String(loaded).includes(SECRET_SENTINEL));
    delete process.env.TEST_COUNT_ONLY;
  });
});
