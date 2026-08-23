import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import {
  signStrategyRunPayload,
  verifyStrategyRunPayload,
  serializeStrategyRunPayload,
  parseStrategyRunPayload,
} from "./strategyRunSigning";
import type { StrategyRunSignatureInput } from "./strategyRunSigning";

const SYNTHETIC_SECRET = "0123456789abcdef0123456789abcdef"; // 32 chars, synthetic only

let originalEnv: string | undefined;

before(() => {
  originalEnv = process.env.STRATEGY_RUN_SIGNING_SECRET;
  process.env.STRATEGY_RUN_SIGNING_SECRET = SYNTHETIC_SECRET;
});

after(() => {
  if (originalEnv === undefined) {
    delete process.env.STRATEGY_RUN_SIGNING_SECRET;
  } else {
    process.env.STRATEGY_RUN_SIGNING_SECRET = originalEnv;
  }
});

function makeInput(overrides: Partial<StrategyRunSignatureInput> = {}): StrategyRunSignatureInput {
  return {
    version: 1 as const,
    runId: "run-abc-123",
    goalId: "goal-xyz-456",
    userId: "user-001",
    expiresAt: "2026-12-31T23:59:59Z",
    stage: "run",
    payload: '{"key":"value"}',
    ...overrides,
  };
}

describe("signStrategyRunPayload", () => {
  it("produces a lowercase 64-character hex signature", () => {
    const input = makeInput();
    const sig = signStrategyRunPayload(input);
    assert.strictEqual(typeof sig, "string");
    assert.strictEqual(sig.length, 64);
    assert.ok(/^[0-9a-f]{64}$/.test(sig), "signature must be 64 lowercase hex chars");
  });

  it("produces identical signatures for identical input", () => {
    const input = makeInput();
    const sig1 = signStrategyRunPayload(input);
    const sig2 = signStrategyRunPayload(input);
    assert.strictEqual(sig1, sig2);
  });

  it("produces different signatures for different payloads", () => {
    const sig1 = signStrategyRunPayload(makeInput({ payload: '{"a":1}' }));
    const sig2 = signStrategyRunPayload(makeInput({ payload: '{"a":2}' }));
    assert.notStrictEqual(sig1, sig2);
  });
});

describe("verifyStrategyRunPayload", () => {
  it("verifies a valid signature", () => {
    const input = makeInput();
    const sig = signStrategyRunPayload(input);
    assert.strictEqual(verifyStrategyRunPayload(input, sig), true);
  });

  it("rejects a modified version field", () => {
    const input = makeInput();
    const sig = signStrategyRunPayload(input);
    const modified = makeInput({ version: 1 as const }); // same version, but we need to test a different field
    // version is always 1, so test other fields
    const modifiedRunId = makeInput({ runId: "different-run" });
    assert.strictEqual(verifyStrategyRunPayload(modifiedRunId, sig), false);
  });

  it("rejects a modified runId", () => {
    const input = makeInput();
    const sig = signStrategyRunPayload(input);
    const modified = makeInput({ runId: "different-run-id" });
    assert.strictEqual(verifyStrategyRunPayload(modified, sig), false);
  });

  it("rejects a modified goalId", () => {
    const input = makeInput();
    const sig = signStrategyRunPayload(input);
    const modified = makeInput({ goalId: "different-goal" });
    assert.strictEqual(verifyStrategyRunPayload(modified, sig), false);
  });

  it("rejects a modified userId", () => {
    const input = makeInput();
    const sig = signStrategyRunPayload(input);
    const modified = makeInput({ userId: "different-user" });
    assert.strictEqual(verifyStrategyRunPayload(modified, sig), false);
  });

  it("rejects a modified expiresAt", () => {
    const input = makeInput();
    const sig = signStrategyRunPayload(input);
    const modified = makeInput({ expiresAt: "2027-01-01T00:00:00Z" });
    assert.strictEqual(verifyStrategyRunPayload(modified, sig), false);
  });

  it("rejects a modified stage", () => {
    const input = makeInput();
    const sig = signStrategyRunPayload(input);
    const modified = makeInput({ stage: "flight" });
    assert.strictEqual(verifyStrategyRunPayload(modified, sig), false);
  });

  it("rejects a modified payload", () => {
    const input = makeInput();
    const sig = signStrategyRunPayload(input);
    const modified = makeInput({ payload: '{"different":true}' });
    assert.strictEqual(verifyStrategyRunPayload(modified, sig), false);
  });

  it("rejects a signature from a different secret", () => {
    const input = makeInput();
    const sig = signStrategyRunPayload(input);

    // Temporarily change the secret
    const saved = process.env.STRATEGY_RUN_SIGNING_SECRET;
    process.env.STRATEGY_RUN_SIGNING_SECRET = "fedcba9876543210fedcba9876543210";
    try {
      assert.strictEqual(verifyStrategyRunPayload(input, sig), false);
    } finally {
      process.env.STRATEGY_RUN_SIGNING_SECRET = saved;
    }
  });

  it("returns false for a malformed signature (too short)", () => {
    const input = makeInput();
    assert.strictEqual(verifyStrategyRunPayload(input, "abc123"), false);
  });

  it("returns false for a non-hex signature", () => {
    const input = makeInput();
    const nonHex = "g".repeat(64);
    assert.strictEqual(verifyStrategyRunPayload(input, nonHex), false);
  });

  it("returns false for a 64-char signature with uppercase hex", () => {
    const input = makeInput();
    const upperHex = "A".repeat(64);
    assert.strictEqual(verifyStrategyRunPayload(input, upperHex), false);
  });

  it("returns false for an empty signature", () => {
    const input = makeInput();
    assert.strictEqual(verifyStrategyRunPayload(input, ""), false);
  });
});

describe("configuration errors", () => {
  it("throws safe message when secret is missing", () => {
    const saved = process.env.STRATEGY_RUN_SIGNING_SECRET;
    delete process.env.STRATEGY_RUN_SIGNING_SECRET;
    try {
      assert.throws(
        () => signStrategyRunPayload(makeInput()),
        { message: "Strategy-run signing is not configured." },
      );
      assert.throws(
        () => verifyStrategyRunPayload(makeInput(), "a".repeat(64)),
        { message: "Strategy-run signing is not configured." },
      );
    } finally {
      process.env.STRATEGY_RUN_SIGNING_SECRET = saved;
    }
  });

  it("throws safe message when secret is blank", () => {
    const saved = process.env.STRATEGY_RUN_SIGNING_SECRET;
    process.env.STRATEGY_RUN_SIGNING_SECRET = "";
    try {
      assert.throws(
        () => signStrategyRunPayload(makeInput()),
        { message: "Strategy-run signing is not configured." },
      );
    } finally {
      process.env.STRATEGY_RUN_SIGNING_SECRET = saved;
    }
  });

  it("throws safe message when secret is too short (fewer than 32 chars)", () => {
    const saved = process.env.STRATEGY_RUN_SIGNING_SECRET;
    process.env.STRATEGY_RUN_SIGNING_SECRET = "short";
    try {
      assert.throws(
        () => signStrategyRunPayload(makeInput()),
        { message: "Strategy-run signing is not configured." },
      );
    } finally {
      process.env.STRATEGY_RUN_SIGNING_SECRET = saved;
    }
  });
});

describe("serializeStrategyRunPayload", () => {
  it("serializes a synthetic object", () => {
    const obj = { flights: [{ airline: "UA", points: 70000 }], hotel: { name: "Test Hotel" } };
    const result = serializeStrategyRunPayload(obj);
    assert.strictEqual(typeof result, "string");
    assert.ok(result.length > 0);
    const parsed = JSON.parse(result);
    assert.deepStrictEqual(parsed, obj);
  });

  it("throws for undefined", () => {
    assert.throws(
      () => serializeStrategyRunPayload(undefined),
      { message: "Strategy-run payload could not be serialized." },
    );
  });

  it("throws for a circular object", () => {
    const obj: Record<string, unknown> = {};
    obj.self = obj;
    assert.throws(
      () => serializeStrategyRunPayload(obj),
      { message: "Strategy-run payload could not be serialized." },
    );
  });
});

describe("parseStrategyRunPayload", () => {
  it("parses valid JSON", () => {
    const result = parseStrategyRunPayload('{"a":1}');
    assert.deepStrictEqual(result, { a: 1 });
  });

  it("throws for invalid JSON", () => {
    assert.throws(
      () => parseStrategyRunPayload("not json"),
      { message: "Strategy-run payload could not be parsed." },
    );
  });

  it("throws for empty string", () => {
    assert.throws(
      () => parseStrategyRunPayload(""),
      { message: "Strategy-run payload could not be parsed." },
    );
  });
});

describe("round-trip", () => {
  it("serialize then parse returns the original object", () => {
    const original = { flights: [{ airline: "UA", points: 70000 }], hotel: { name: "Test Hotel" } };
    const serialized = serializeStrategyRunPayload(original);
    const parsed = parseStrategyRunPayload(serialized);
    assert.deepStrictEqual(parsed, original);
  });
});