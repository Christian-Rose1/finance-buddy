import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import {
  SAVED_STRATEGY_SIGNATURE_VERSION,
  serializeSavedStrategy,
  signSavedStrategy,
  verifySavedStrategy,
} from "./strategyPersistenceSigning";

const SYNTHETIC_SECRET = "abcdef0123456789abcdef0123456789";
let originalSigningSecret: string | undefined;

before(() => {
  originalSigningSecret = process.env.STRATEGY_RUN_SIGNING_SECRET;
  process.env.STRATEGY_RUN_SIGNING_SECRET = SYNTHETIC_SECRET;
});

after(() => {
  if (originalSigningSecret === undefined) {
    delete process.env.STRATEGY_RUN_SIGNING_SECRET;
  } else {
    process.env.STRATEGY_RUN_SIGNING_SECRET = originalSigningSecret;
  }
});

function input(strategy: unknown = { headline: "Plan", points: [2, 1] }) {
  return {
    version: SAVED_STRATEGY_SIGNATURE_VERSION,
    goalId: "goal-1",
    userId: "user-1",
    generatedAt: "2026-08-26T12:00:00.000Z",
    strategy,
  };
}

describe("saved strategy signing", () => {
  it("canonicalizes object keys recursively", () => {
    assert.equal(
      serializeSavedStrategy({ z: 1, a: { y: 2, x: 3 } }),
      serializeSavedStrategy({ a: { x: 3, y: 2 }, z: 1 })
    );
  });

  it("verifies the exact signed strategy", () => {
    const value = input();
    const signature = signSavedStrategy(value);

    assert.match(signature, /^[0-9a-f]{64}$/);
    assert.equal(verifySavedStrategy(value, signature), true);
  });

  it("rejects modified strategy data and ownership fields", () => {
    const value = input();
    const signature = signSavedStrategy(value);

    assert.equal(
      verifySavedStrategy(input({ headline: "Changed", points: [2, 1] }), signature),
      false
    );
    assert.equal(
      verifySavedStrategy({ ...value, userId: "user-2" }, signature),
      false
    );
  });

  it("rejects malformed signatures and non-JSON values", () => {
    assert.equal(verifySavedStrategy(input(), "not-a-signature"), false);
    assert.throws(
      () => serializeSavedStrategy({ value: Number.POSITIVE_INFINITY }),
      /non-finite/
    );
  });
});
