import assert from "node:assert/strict";
import { test } from "node:test";
import React, { type ReactElement, type ReactNode } from "react";

import type { WalletCard } from "../wallet/types";

type ElementProps = {
  children?: ReactNode;
  onChange?: (event: { target: { value: string } }) => Promise<void>;
  role?: string;
  value?: string;
  "aria-invalid"?: boolean;
};

function findElement(
  node: ReactNode,
  predicate: (element: ReactElement<ElementProps>) => boolean
): ReactElement<ElementProps> | null {
  if (!React.isValidElement<ElementProps>(node)) return null;
  if (predicate(node)) return node;

  for (const child of React.Children.toArray(node.props.children)) {
    const match = findElement(child, predicate);
    if (match) return match;
  }

  return null;
}

test("a failed card save restores the persisted selection without marking it invalid", async () => {
  const state: unknown[] = [];
  let hookIndex = 0;
  const mutableReact = React as typeof React & {
    useId: typeof React.useId;
    useState: typeof React.useState;
  };

  mutableReact.useId = () => "card-used-test";
  mutableReact.useState = (<T,>(initial: T | (() => T)) => {
    const index = hookIndex++;
    if (!(index in state)) {
      state[index] = typeof initial === "function"
        ? (initial as () => T)()
        : initial;
    }

    const setState: React.Dispatch<React.SetStateAction<T>> = (next) => {
      state[index] = typeof next === "function"
        ? (next as (current: T) => T)(state[index] as T)
        : next;
    };
    return [state[index] as T, setState];
  }) as typeof React.useState;
  (globalThis as typeof globalThis & { React: typeof React }).React = React;

  // Force the imported server action to reject before any external request.
  process.env.NEXT_PUBLIC_SUPABASE_URL = "";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "";

  const { CardUsedSelector } = await import("../../components/card-used-selector");
  const cards: WalletCard[] = [
    {
      id: "card-1",
      name: "Persisted card",
      issuer: "Example Bank",
      network: "visa",
      rewardCurrency: "points",
      lastFour: "1111",
      active: true,
      source: "user",
      cardProductId: null,
    },
    {
      id: "card-2",
      name: "Rejected card",
      issuer: "Example Bank",
      network: "mastercard",
      rewardCurrency: "points",
      lastFour: "2222",
      active: true,
      source: "user",
      cardProductId: null,
    },
  ];

  const render = () => {
    hookIndex = 0;
    return CardUsedSelector({
      purchaseId: "purchase-1",
      currentCardId: "card-1",
      activeCards: cards,
    });
  };

  let tree = render();
  const initialSelect = findElement(tree, (element) => element.type === "select");
  assert.ok(initialSelect?.props.onChange);
  assert.equal(initialSelect.props.value, "card-1");

  await initialSelect.props.onChange({ target: { value: "card-2" } });
  tree = render();

  const restoredSelect = findElement(tree, (element) => element.type === "select");
  const alert = findElement(tree, (element) => element.props.role === "alert");
  assert.equal(restoredSelect?.props.value, "card-1");
  assert.ok(alert);
  assert.match(String(alert.props.children), /previous card remains selected/i);
  assert.equal(
    restoredSelect?.props["aria-invalid"],
    undefined,
    "A persistence failure should be an alert, not mark the restored valid selection invalid."
  );
});
