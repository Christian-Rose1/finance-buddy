/**
 * Wallet card form validation.
 *
 * Validates user-entered wallet card metadata. This module does NOT collect
 * or accept full card numbers, CVV/security codes, PINs, or banking
 * credentials. It only validates the limited card metadata Finance Buddy
 * stores (name, issuer, network, reward type, and optional last four digits).
 */

import type { CardNetwork, RewardCurrency } from "./types";

const CARD_NETWORKS: readonly CardNetwork[] = [
  "visa",
  "mastercard",
  "amex",
  "discover",
  "other",
];

const REWARD_CURRENCIES: readonly RewardCurrency[] = [
  "cashback",
  "points",
  "miles",
  "none",
];

export interface WalletCardFormData {
  name: string;
  issuer: string;
  network: CardNetwork;
  rewardCurrency: RewardCurrency;
  lastFour: string | null;
}

export interface WalletCardFormErrors {
  name?: string;
  issuer?: string;
  network?: string;
  rewardCurrency?: string;
  lastFour?: string;
}

/** Formats a validation error map into a single human-readable message. */
export function formatWalletCardFormErrors(
  errors: WalletCardFormErrors
): string {
  const messages = Object.values(errors).filter(Boolean);
  if (messages.length === 0) return "Please check your entries and try again.";
  return messages.join(" ");
}

/**
 * Validates the limited wallet card metadata collected from the user.
 *
 * Rejects any full card number, CVV, PIN, or credential-like input by
 * enforcing that the last-four field is null or exactly four digits.
 */
export function validateWalletCardForm(raw: {
  name: string;
  issuer: string;
  network: string;
  rewardCurrency: string;
  lastFour: string;
}):
  | { valid: true; data: WalletCardFormData }
  | { valid: false; errors: WalletCardFormErrors } {
  const errors: WalletCardFormErrors = {};

  const name = raw.name.trim();
  if (!name) {
    errors.name = "Card name is required.";
  } else if (name.length > 100) {
    errors.name = "Card name must be 100 characters or fewer.";
  }

  const issuer = raw.issuer.trim();
  if (!issuer) {
    errors.issuer = "Issuer is required.";
  } else if (issuer.length > 100) {
    errors.issuer = "Issuer must be 100 characters or fewer.";
  }

  if (!CARD_NETWORKS.includes(raw.network as CardNetwork)) {
    errors.network = "Please select a valid card network.";
  }

  if (!REWARD_CURRENCIES.includes(raw.rewardCurrency as RewardCurrency)) {
    errors.rewardCurrency = "Please select a valid reward type.";
  }

  let lastFour: string | null = null;
  const lastFourRaw = raw.lastFour ? raw.lastFour.trim() : "";
  if (lastFourRaw) {
    const cleaned = lastFourRaw.replace(/\s/g, "");
    if (!/^\d{4}$/.test(cleaned)) {
      errors.lastFour =
        "Only the last four digits are stored. Please enter exactly 4 digits.";
    } else {
      lastFour = cleaned;
    }
  }

  if (Object.keys(errors).length > 0) {
    return { valid: false, errors };
  }

  return {
    valid: true,
    data: {
      name,
      issuer,
      network: raw.network as CardNetwork,
      rewardCurrency: raw.rewardCurrency as RewardCurrency,
      lastFour,
    },
  };
}
