import assert from "node:assert/strict";
import { test } from "node:test";
import { getProductLinkFeedback } from "../../components/wallet-card-product-link-presentation";
import type { WalletCard } from "./types";

const updatedCard: WalletCard = {
  id: "card-1",
  name: "Travel card",
  issuer: "Example Bank",
  network: "visa",
  rewardCurrency: "points",
  lastFour: "1234",
  active: true,
  source: "user",
  cardProductId: "product-1",
};

test("product-link feedback classifies typed errors without inspecting message text", () => {
  assert.deepEqual(
    getProductLinkFeedback(false, null, {
      success: false,
      error: "Catalog product is unavailable.",
    }),
    { kind: "error", message: "Catalog product is unavailable." }
  );
});

test("product-link feedback preserves pending and successful action states", () => {
  assert.deepEqual(
    getProductLinkFeedback(true, "Unlinking Travel card...", null),
    { kind: "pending", message: "Unlinking Travel card..." }
  );
  assert.deepEqual(
    getProductLinkFeedback(false, null, {
      success: true,
      card: updatedCard,
      message: "Travel card linked to catalog product.",
    }),
    {
      kind: "success",
      message: "Travel card linked to catalog product.",
    }
  );
});
