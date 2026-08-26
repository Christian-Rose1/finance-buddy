import assert from "node:assert/strict";
import { test } from "node:test";
import React, { type ReactElement, type ReactNode } from "react";

import type { CardProduct } from "../rewards/catalogTypes";
import type { WalletCard } from "./types";

type ElementProps = {
  children?: ReactNode;
  id?: string;
  onClick?: () => void;
  "aria-controls"?: string;
  "aria-expanded"?: boolean;
};

function elements(node: ReactNode): ReactElement<ElementProps>[] {
  if (!React.isValidElement<ElementProps>(node)) return [];
  return [
    node,
    ...React.Children.toArray(node.props.children).flatMap((child) =>
      elements(child)
    ),
  ];
}

test("the product-link disclosure retains its trigger and valid expanded relationship", async () => {
  const state: unknown[] = [];
  let hookIndex = 0;
  const mutableReact = React as typeof React & {
    useContext: typeof React.useContext;
    useId: typeof React.useId;
    useState: typeof React.useState;
    useTransition: typeof React.useTransition;
  };

  mutableReact.useContext = (() => ({ refresh() {} })) as typeof React.useContext;
  mutableReact.useId = () => "product-editor";
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
  mutableReact.useTransition = (() => [
    false,
    (callback: () => void | Promise<void>) => {
      void callback();
    },
  ]) as typeof React.useTransition;
  (globalThis as typeof globalThis & { React: typeof React }).React = React;

  const { WalletCardProductLink } = await import(
    "../../components/wallet-card-product-link"
  );
  const card: WalletCard = {
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
  const products: CardProduct[] = [
    {
      id: "product-1",
      rewardProgramId: null,
      issuer: "Example Bank",
      name: "Travel Product",
      network: "visa",
      active: true,
      annualFee: null,
      source: "issuer_website",
      lastVerifiedAt: null,
      metadata: null,
    },
  ];
  const render = () => {
    hookIndex = 0;
    return WalletCardProductLink({ card, products });
  };

  let tree = render();
  const closedTrigger = elements(tree).find(
    (element) => element.type === "button" && element.props["aria-controls"]
  );
  assert.ok(closedTrigger?.props.onClick);
  assert.equal(closedTrigger.props["aria-expanded"], false);

  closedTrigger.props.onClick();
  tree = render();

  const openElements = elements(tree);
  assert.ok(openElements.some((element) => element.props.id === "product-editor"));
  const openTrigger = openElements.find(
    (element) =>
      element.type === "button" &&
      element.props["aria-controls"] === "product-editor"
  );
  assert.ok(openTrigger, "The disclosure trigger must remain mounted while expanded.");
  assert.equal(openTrigger.props["aria-expanded"], true);
});
