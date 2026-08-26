import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

describe("purchase confirmation action mutation boundary", () => {
  const source = readFileSync(new URL("./actions.ts", import.meta.url), "utf8");

  it("uses the narrow RPCs with the paired migration signatures", () => {
    assert.match(source, /rpc\("confirm_purchase_card",\s*\{[\s\S]*p_purchase_id:\s*purchaseId,[\s\S]*p_card_id:\s*cardId/);
    assert.match(source, /rpc\(\s*"confirm_purchase_booking_channel",\s*\{[\s\S]*p_purchase_id:\s*purchaseId,[\s\S]*p_channel:\s*channel/);
  });

  it("does not directly update or merge purchase rows", () => {
    assert.doesNotMatch(source, /from\(["']purchases["']\)/);
    assert.doesNotMatch(source, /\.update\(/);
  });

  it("rehydrates both action results through the ownership-scoped repository", () => {
    assert.equal((source.match(/getPurchaseForUser\(/g) ?? []).length, 4);
  });
});
