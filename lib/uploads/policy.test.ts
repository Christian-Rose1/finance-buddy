import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  MAX_RECEIPT_FILE_BYTES,
  normalizeOwnedStoragePath,
  requestBodyIsTooLarge,
} from "./policy";

describe("upload policy", () => {
  it("rejects oversized requests while allowing absent or bounded lengths", () => {
    assert.equal(requestBodyIsTooLarge(null, MAX_RECEIPT_FILE_BYTES), false);
    assert.equal(
      requestBodyIsTooLarge(String(MAX_RECEIPT_FILE_BYTES), MAX_RECEIPT_FILE_BYTES),
      false
    );
    assert.equal(
      requestBodyIsTooLarge(
        String(MAX_RECEIPT_FILE_BYTES + 1024 * 1024 + 1),
        MAX_RECEIPT_FILE_BYTES
      ),
      true
    );
  });

  it("accepts only paths rooted under the authenticated user", () => {
    assert.deepEqual(normalizeOwnedStoragePath(null, "user-1"), {
      valid: true,
      path: null,
    });
    assert.deepEqual(
      normalizeOwnedStoragePath("user-1/receipt.png", "user-1"),
      { valid: true, path: "user-1/receipt.png" }
    );
    assert.equal(
      normalizeOwnedStoragePath("user-2/receipt.png", "user-1").valid,
      false
    );
    assert.equal(
      normalizeOwnedStoragePath("user-1/../user-2/receipt.png", "user-1").valid,
      false
    );
  });

  it("exposes the same hard upload limit to route boundaries", () => {
    assert.equal(MAX_RECEIPT_FILE_BYTES, 10 * 1024 * 1024);
  });
});
