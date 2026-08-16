/**
 * Focused tests for wallet card form validation.
 *
 * Run with: npx tsx --test lib/wallet/validation.test.ts
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  validateWalletCardForm,
  formatWalletCardFormErrors,
} from "./validation";

describe("validateWalletCardForm", () => {
  it("accepts a valid card with all fields", () => {
    const result = validateWalletCardForm({
      name: "Chase Sapphire Preferred",
      issuer: "Chase",
      network: "visa",
      rewardCurrency: "points",
      lastFour: "1234",
    });

    assert.equal(result.valid, true);
    if (!result.valid) throw new Error("unexpected");
    assert.equal(result.data.name, "Chase Sapphire Preferred");
    assert.equal(result.data.issuer, "Chase");
    assert.equal(result.data.network, "visa");
    assert.equal(result.data.rewardCurrency, "points");
    assert.equal(result.data.lastFour, "1234");
  });

  it("accepts a valid card without last four digits", () => {
    const result = validateWalletCardForm({
      name: "Amex Gold",
      issuer: "American Express",
      network: "amex",
      rewardCurrency: "points",
      lastFour: "",
    });

    assert.equal(result.valid, true);
    if (!result.valid) throw new Error("unexpected");
    assert.equal(result.data.lastFour, null);
  });

  it("trims whitespace from name and issuer", () => {
    const result = validateWalletCardForm({
      name: "  Freedom Flex  ",
      issuer: "  Chase  ",
      network: "visa",
      rewardCurrency: "cashback",
      lastFour: "",
    });

    assert.equal(result.valid, true);
    if (!result.valid) throw new Error("unexpected");
    assert.equal(result.data.name, "Freedom Flex");
    assert.equal(result.data.issuer, "Chase");
  });

  it("rejects missing required fields", () => {
    const result = validateWalletCardForm({
      name: "",
      issuer: "",
      network: "visa",
      rewardCurrency: "points",
      lastFour: "",
    });

    assert.equal(result.valid, false);
    if (result.valid) throw new Error("unexpected");
    assert.ok(result.errors.name);
    assert.ok(result.errors.issuer);
  });

  it("rejects invalid card networks", () => {
    const result = validateWalletCardForm({
      name: "Card",
      issuer: "Bank",
      network: "jcb" as "visa",
      rewardCurrency: "points",
      lastFour: "",
    });

    assert.equal(result.valid, false);
    if (result.valid) throw new Error("unexpected");
    assert.ok(result.errors.network);
  });

  it("rejects invalid reward currencies", () => {
    const result = validateWalletCardForm({
      name: "Card",
      issuer: "Bank",
      network: "visa",
      rewardCurrency: "crypto" as "points",
      lastFour: "",
    });

    assert.equal(result.valid, false);
    if (result.valid) throw new Error("unexpected");
    assert.ok(result.errors.rewardCurrency);
  });

  it("rejects last four digits that are not exactly four digits", () => {
    const result = validateWalletCardForm({
      name: "Card",
      issuer: "Bank",
      network: "visa",
      rewardCurrency: "points",
      lastFour: "12345",
    });

    assert.equal(result.valid, false);
    if (result.valid) throw new Error("unexpected");
    assert.ok(result.errors.lastFour);
  });

  it("rejects non-numeric last four digits", () => {
    const result = validateWalletCardForm({
      name: "Card",
      issuer: "Bank",
      network: "visa",
      rewardCurrency: "points",
      lastFour: "abcd",
    });

    assert.equal(result.valid, false);
    if (result.valid) throw new Error("unexpected");
    assert.ok(result.errors.lastFour);
  });

  it("rejects full card numbers passed as last four", () => {
    const result = validateWalletCardForm({
      name: "Card",
      issuer: "Bank",
      network: "visa",
      rewardCurrency: "points",
      lastFour: "4111111111111111",
    });

    assert.equal(result.valid, false);
    if (result.valid) throw new Error("unexpected");
    assert.ok(result.errors.lastFour);
  });

  it("cleans whitespace from last four digits", () => {
    const result = validateWalletCardForm({
      name: "Card",
      issuer: "Bank",
      network: "visa",
      rewardCurrency: "points",
      lastFour: " 1 2 3 4 ",
    });

    assert.equal(result.valid, true);
    if (!result.valid) throw new Error("unexpected");
    assert.equal(result.data.lastFour, "1234");
  });

  it("rejects names and issuers that are too long", () => {
    const result = validateWalletCardForm({
      name: "a".repeat(101),
      issuer: "b".repeat(101),
      network: "visa",
      rewardCurrency: "points",
      lastFour: "",
    });

    assert.equal(result.valid, false);
    if (result.valid) throw new Error("unexpected");
    assert.ok(result.errors.name);
    assert.ok(result.errors.issuer);
  });
});

describe("formatWalletCardFormErrors", () => {
  it("joins error messages with spaces", () => {
    const message = formatWalletCardFormErrors({
      name: "Name required.",
      issuer: "Issuer required.",
    });
    assert.equal(message, "Name required. Issuer required.");
  });

  it("returns a fallback message when no errors are present", () => {
    const message = formatWalletCardFormErrors({});
    assert.equal(message, "Please check your entries and try again.");
  });
});
