/**
 * Development wallet fixtures.
 *
 * IMPORTANT: These are DEVELOPMENT FIXTURES ONLY. The cards and benefits
 * below use fake IDs, fake last-four digits, and made-up benefit numbers.
 * They are NOT verified/current real-world benefits and must not be
 * presented as such. Everything is tagged `source: "development"`.
 */

import type {
  CardBenefit,
  Wallet,
  WalletCard,
} from "./types";

/**
 * Development test wallet with clearly fake cards and benefits.
 */
export const DEVELOPMENT_WALLET: Wallet = {
  cards: [
    {
      id: "dev-card-csp-0001",
      name: "Chase Sapphire Preferred (dev fixture)",
      issuer: "Chase",
      network: "visa",
      rewardCurrency: "points",
      lastFour: "1234",
      active: true,
      source: "development",
    },
    {
      id: "dev-card-amex-gold-0001",
      name: "Amex Gold (dev fixture)",
      issuer: "American Express",
      network: "amex",
      rewardCurrency: "points",
      lastFour: "5678",
      active: true,
      source: "development",
    },
    {
      id: "dev-card-cap1-venturex-0001",
      name: "Capital One Venture X (dev fixture)",
      issuer: "Capital One",
      network: "visa",
      rewardCurrency: "miles",
      lastFour: "9012",
      active: true,
      source: "development",
    },
    {
      id: "dev-card-inactive-0001",
      name: "Inactive Dev Card (dev fixture)",
      issuer: "Dev Bank",
      network: "other",
      rewardCurrency: "cashback",
      lastFour: "0000",
      active: false,
      source: "development",
    },
  ],
  benefits: [
    // Development dining earning benefit
    {
      id: "dev-benefit-csp-dining-0001",
      cardId: "dev-card-csp-0001",
      type: "earning_rate",
      title: "3x points on dining (dev fixture)",
      description:
        "DEVELOPMENT FIXTURE — earns 3 points per dollar on dining. Not a verified/current real-world benefit.",
      category: "Dining",
      merchant: null,
      rewardCurrency: "points",
      rewardValue: 3,
      percentage: null,
      fixedValue: null,
      annualLimit: null,
      remainingLimit: null,
      active: true,
      source: "development",
    },
    // Development grocery earning benefit
    {
      id: "dev-benefit-amex-gold-grocery-0001",
      cardId: "dev-card-amex-gold-0001",
      type: "earning_rate",
      title: "4x points on groceries (dev fixture)",
      description:
        "DEVELOPMENT FIXTURE — earns 4 points per dollar on groceries. Not a verified/current real-world benefit.",
      category: "Groceries",
      merchant: null,
      rewardCurrency: "points",
      rewardValue: 4,
      percentage: null,
      fixedValue: null,
      annualLimit: null,
      remainingLimit: null,
      active: true,
      source: "development",
    },
    // Development travel benefit
    {
      id: "dev-benefit-csp-travel-0001",
      cardId: "dev-card-csp-0001",
      type: "travel",
      title: "Travel purchase protection (dev fixture)",
      description:
        "DEVELOPMENT FIXTURE — illustrative travel benefit. Not a verified/current real-world benefit.",
      category: "Travel",
      merchant: null,
      rewardCurrency: "none",
      rewardValue: 0,
      percentage: null,
      fixedValue: null,
      annualLimit: null,
      remainingLimit: null,
      active: true,
      source: "development",
    },
    // Development statement credit
    {
      id: "dev-benefit-csp-credit-0001",
      cardId: "dev-card-csp-0001",
      type: "statement_credit",
      title: "$50 annual travel credit (dev fixture)",
      description:
        "DEVELOPMENT FIXTURE — illustrative statement credit. Not a verified/current real-world benefit.",
      category: "Travel",
      merchant: null,
      rewardCurrency: "none",
      rewardValue: 0,
      percentage: null,
      fixedValue: 50,
      annualLimit: 50,
      remainingLimit: 50,
      active: true,
      source: "development",
    },
    // Development merchant offer
    {
      id: "dev-benefit-amex-gold-offer-0001",
      cardId: "dev-card-amex-gold-0001",
      type: "offer",
      title: "$10 back on $50 at Dev Cafe (dev fixture)",
      description:
        "DEVELOPMENT FIXTURE — illustrative merchant offer. Not a real, currently available offer.",
      category: null,
      merchant: "Dev Cafe",
      rewardCurrency: "cashback",
      rewardValue: 0,
      percentage: null,
      fixedValue: 10,
      annualLimit: null,
      remainingLimit: null,
      active: true,
      source: "development",
    },
    // Development inactive benefit
    {
      id: "dev-benefit-csp-inactive-0001",
      cardId: "dev-card-csp-0001",
      type: "other",
      title: "Inactive dev benefit",
      description:
        "DEVELOPMENT FIXTURE — intentionally inactive to verify active filtering.",
      category: null,
      merchant: null,
      rewardCurrency: "none",
      rewardValue: 0,
      percentage: null,
      fixedValue: null,
      annualLimit: null,
      remainingLimit: null,
      active: false,
      source: "development",
    },
  ],
};

/** Returns only the cards in the wallet with `active === true`. */
export function getActiveCards(wallet: Wallet): WalletCard[] {
  return wallet.cards.filter((card) => card.active);
}

/** Returns only the benefits in the wallet with `active === true`. */
export function getActiveBenefits(wallet: Wallet): CardBenefit[] {
  return wallet.benefits.filter((benefit) => benefit.active);
}