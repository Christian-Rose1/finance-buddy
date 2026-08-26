import assert from "node:assert/strict";
import { test } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CardUsedSelector } from "../../components/card-used-selector";
import type { WalletCard } from "../wallet/types";

(globalThis as typeof globalThis & { React: typeof React }).React = React;

const card: WalletCard = {
  id: "card-1",
  name: "Travel card",
  issuer: "Example Bank",
  network: "visa",
  rewardCurrency: "points",
  lastFour: "1234",
  active: true,
  source: "user",
  cardProductId: null,
};

test("card-used selector associates its label and help text with one clear empty option", () => {
  const html = renderToStaticMarkup(
    React.createElement(CardUsedSelector, {
      purchaseId: "purchase-1",
      currentCardId: null,
      activeCards: [card],
    })
  );
  const labelMatch = html.match(/<label[^>]*for="([^"]+)"/);

  assert.ok(labelMatch);
  const selectId = labelMatch[1];
  assert.ok(html.includes(`<select id="${selectId}"`));
  assert.ok(html.includes(`id="${selectId}-help"`));
  assert.ok(html.includes(`aria-describedby="${selectId}-help"`));
  assert.equal(
    (html.match(/<option value=""[^>]*>None \/ Unknown/g) ?? []).length,
    1
  );
  assert.doesNotMatch(html, /Select the card you used/);
  assert.match(html, /Travel card ending in 1234/);
});

test("card-used selector explains the no-active-card state without disabling unknown", () => {
  const html = renderToStaticMarkup(
    React.createElement(CardUsedSelector, {
      purchaseId: "purchase-1",
      currentCardId: null,
      activeCards: [],
    })
  );

  assert.match(html, /<option value=""[^>]*>None \/ Unknown/);
  assert.match(html, /No active wallet cards available/);
});
