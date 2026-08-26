import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { signImportDraft, verifyImportDraftSignature } from "./signing";

const secret = "import-draft-test-secret-at-least-32-characters";
let originalSecret: string | undefined;

before(() => {
  originalSecret = process.env.IMPORT_DRAFT_SIGNING_SECRET;
  process.env.IMPORT_DRAFT_SIGNING_SECRET = secret;
});

after(() => {
  if (originalSecret === undefined) {
    delete process.env.IMPORT_DRAFT_SIGNING_SECRET;
  } else {
    process.env.IMPORT_DRAFT_SIGNING_SECRET = originalSecret;
  }
});

describe("import draft signing", () => {
  const input = {
    version: 1 as const,
    draftId: "11111111-1111-4111-8111-111111111111",
    userId: "22222222-2222-4222-8222-222222222222",
    kind: "receipt" as const,
    status: "pending" as const,
    expiresAt: "2026-08-26T20:00:00.000Z",
    payload: '{"version":1}',
    persistencePayload: '[{"purchase":{"amount":1}}]',
    claimToken: null,
    claimExpiresAt: null,
  };

  it("verifies the exact signed draft", () => {
    const signature = signImportDraft(input);
    assert.equal(verifyImportDraftSignature(input, signature), true);
  });

  it("binds the payload, owner, kind, status, and expiration", () => {
    const signature = signImportDraft(input);
    assert.equal(
      verifyImportDraftSignature({ ...input, payload: "{}" }, signature),
      false
    );
    assert.equal(
      verifyImportDraftSignature(
        { ...input, persistencePayload: "[]" },
        signature
      ),
      false
    );
    assert.equal(
      verifyImportDraftSignature({ ...input, userId: "other-user" }, signature),
      false
    );
    assert.equal(
      verifyImportDraftSignature({ ...input, kind: "statement" }, signature),
      false
    );
    assert.equal(
      verifyImportDraftSignature({ ...input, status: "confirmed" }, signature),
      false
    );
    assert.equal(
      verifyImportDraftSignature(
        { ...input, expiresAt: "2026-08-26T21:00:00.000Z" },
        signature
      ),
      false
    );
  });

  it("never falls back to the strategy signing secret", () => {
    const importSecret = process.env.IMPORT_DRAFT_SIGNING_SECRET;
    const strategySecret = process.env.STRATEGY_RUN_SIGNING_SECRET;
    delete process.env.IMPORT_DRAFT_SIGNING_SECRET;
    process.env.STRATEGY_RUN_SIGNING_SECRET = secret;

    try {
      assert.throws(() => signImportDraft(input), /not configured/);
    } finally {
      if (importSecret === undefined) {
        delete process.env.IMPORT_DRAFT_SIGNING_SECRET;
      } else {
        process.env.IMPORT_DRAFT_SIGNING_SECRET = importSecret;
      }
      if (strategySecret === undefined) {
        delete process.env.STRATEGY_RUN_SIGNING_SECRET;
      } else {
        process.env.STRATEGY_RUN_SIGNING_SECRET = strategySecret;
      }
    }
  });
});
