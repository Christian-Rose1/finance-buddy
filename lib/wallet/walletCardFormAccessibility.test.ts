import assert from "node:assert/strict";
import { test } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { WalletCardForm } from "../../components/wallet-card-form";
import type { WalletCard } from "./types";

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

test("create and edit card forms keep every label target unique", () => {
  const html = renderToStaticMarkup(
    React.createElement(
      React.Fragment,
      null,
      React.createElement(WalletCardForm, { mode: "create" }),
      React.createElement(WalletCardForm, { mode: "edit", card })
    )
  );
  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
  const duplicateIds = [
    ...new Set(ids.filter((id, index) => ids.indexOf(id) !== index)),
  ];

  assert.deepEqual(
    duplicateIds,
    [],
    `Duplicate form-control IDs break label association: ${duplicateIds.join(", ")}`
  );
});
